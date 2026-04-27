const fetch = require('node-fetch');
const { getAccessToken, assertEnv, normalizeKenyanPhone, getMpesaBaseUrl } = require('./_lib/mpesa');

exports.handler = async (event) => {
  const { phone, amountKES, withdrawalId, userId } = JSON.parse(event.body);
  const shortcode = assertEnv('MPESA_SHORTCODE');
  const token = await getAccessToken();
  const baseUrl = getMpesaBaseUrl();
  const siteUrl = assertEnv('SITE_URL');

  // IMPORTANT: Replace this with your actual live encrypted security credential.
  // For now, a placeholder – must be generated with Safaricom public key.
  const securityCredential = 'PLACEHOLDER_ENCRYPTED_CREDENTIAL';

  const payload = {
    InitiatorName: 'starlifeapi',
    SecurityCredential: securityCredential,
    CommandID: 'BusinessPayment',
    Amount: amountKES,
    PartyA: shortcode,
    PartyB: normalizeKenyanPhone(phone),
    Remarks: `Withdrawal ${withdrawalId}`,
    QueueTimeOutURL: `${siteUrl}/.netlify/functions/mpesa-b2c-timeout`,
    ResultURL: `${siteUrl}/.netlify/functions/mpesa-b2c-result`,
    Occasion: 'Starlife payout'
  };

  const res = await fetch(`${baseUrl}/mpesa/b2c/v1/paymentrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || 'B2C request failed');
  }

  const admin = require('firebase-admin');
  const db = admin.firestore();
  await db.collection('withdrawals').doc(withdrawalId).update({
    mpesaConversationId: data.ConversationID,
    b2cStatus: 'processing'
  });

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};

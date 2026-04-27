const fetch = require('node-fetch');
const { getAccessToken, assertEnv, normalizeKenyanPhone, getMpesaBaseUrl } = require('./_lib/mpesa');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

exports.handler = async (event) => {
  const { phone, amountKES, withdrawalId, userId } = JSON.parse(event.body);
  const shortcode = assertEnv('MPESA_SHORTCODE');
  const token = await getAccessToken();
  const baseUrl = getMpesaBaseUrl();
  const siteUrl = assertEnv('SITE_URL');

  // IMPORTANT: Replace this placeholder with your actual live encrypted security credential.
  // You must generate this using Safaricom's public key and your API password.
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

  await db.collection('withdrawals').doc(withdrawalId).update({
    mpesaConversationId: data.ConversationID,
    b2cStatus: 'processing'
  });

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};

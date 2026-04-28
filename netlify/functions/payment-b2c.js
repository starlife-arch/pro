const fetch = require('node-fetch');
const { getAccessToken, assertEnv, normalizeKenyanPhone, getMpesaBaseUrl } = require('./_lib/mpesa');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

exports.handler = async (event) => {
  // ── Input validation ──────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { phone, amountKES, withdrawalId, userId } = body;
  if (!phone || !amountKES || !withdrawalId || !userId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: phone, amountKES, withdrawalId, userId' })
    };
  }
  if (typeof amountKES !== 'number' || amountKES < 1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'amountKES must be a positive number' }) };
  }

  let normalizedPhone;
  try {
    normalizedPhone = normalizeKenyanPhone(phone);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: e.message }) };
  }

  // ── Env vars ──────────────────────────────────────────────────────────────
  const shortcode = assertEnv('MPESA_SHORTCODE');
  const siteUrl = assertEnv('SITE_URL');

  // IMPORTANT: Generate this by encrypting your B2C initiator password using
  // Safaricom's public certificate (production or sandbox).
  // Steps:
  //   1. Download cert from https://developer.safaricom.co.ke/docs#security-credential
  //   2. Run: openssl rsautl -encrypt -pubin -inkey cert.pem -in password.txt | base64
  //   3. Store the result as MPESA_SECURITY_CREDENTIAL in Netlify env vars.
  const securityCredential = assertEnv('MPESA_SECURITY_CREDENTIAL');

  const token = await getAccessToken();
  const baseUrl = getMpesaBaseUrl();

  const payload = {
    InitiatorName: assertEnv('MPESA_INITIATOR_NAME'), // e.g. 'starlifeapi' — store in env
    SecurityCredential: securityCredential,
    CommandID: 'BusinessPayment',
    Amount: Math.round(amountKES),
    PartyA: shortcode,
    PartyB: normalizedPhone,
    Remarks: `Withdrawal ${withdrawalId}`,
    QueueTimeOutURL: `${siteUrl}/.netlify/functions/mpesa-b2c-timeout`,
    ResultURL: `${siteUrl}/.netlify/functions/mpesa-b2c-result`,
    Occasion: 'Starlife payout'
  };

  let data;
  try {
    const res = await fetch(`${baseUrl}/mpesa/b2c/v1/paymentrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    data = await res.json();

    if (!res.ok || data.ResponseCode !== '0') {
      console.error('B2C error response:', data);
      throw new Error(data.errorMessage || data.ResponseDescription || 'B2C request failed');
    }
  } catch (e) {
    console.error('B2C fetch error:', e);
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }

  // ── Firestore write ───────────────────────────────────────────────────────
  try {
    await db.collection('withdrawals').doc(withdrawalId).update({
      mpesaConversationId: data.ConversationID,
      b2cStatus: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (dbErr) {
    console.error('Firestore update failed after B2C initiation (ConversationID:', data.ConversationID, '):', dbErr);
    // Do not return error — B2C is already processing. Log for manual reconciliation.
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, conversationId: data.ConversationID }) };
};

const fetch = require('node-fetch');
const {
  getAccessToken,
  timestampNow,
  buildStkPassword,
  assertEnv,
  normalizeKenyanPhone,
  getMpesaBaseUrl
} = require('./_lib/mpesa');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { phone, amountKES, userId, userName } = body;
  if (!phone || !amountKES || !userId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: phone, amountKES, userId' })
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

  const shortcode = assertEnv('MPESA_SHORTCODE');
  const passkey = assertEnv('MPESA_PASSKEY');
  const siteUrl = assertEnv('SITE_URL');
  const timestamp = timestampNow();
  const password = buildStkPassword(shortcode, passkey, timestamp);
  const token = await getAccessToken();
  const baseUrl = getMpesaBaseUrl();

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amountKES),
    PartyA: normalizedPhone,
    PartyB: shortcode,
    PhoneNumber: normalizedPhone,
    CallBackURL: `${siteUrl}/.netlify/functions/payment-callback`,
    AccountReference: `STAR-${Date.now()}`,
    TransactionDesc: 'Starlife deposit'
  };

  let data;
  try {
    const res = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    data = await res.json();

    if (!res.ok || data.ResponseCode !== '0') {
      console.error('STK push error response:', data);
      throw new Error(data.errorMessage || data.ResponseDescription || 'STK push failed');
    }
  } catch (e) {
    console.error('STK push fetch error:', e);
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }

  try {
    await db.collection('mpesa_transactions').doc(data.CheckoutRequestID).set({
      userId,
      userName: userName || '',
      amountKES,
      phone: normalizedPhone,
      checkoutRequestId: data.CheckoutRequestID,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (dbErr) {
    console.error('Firestore write failed after STK push (CheckoutRequestID:', data.CheckoutRequestID, '):', dbErr);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ checkoutId: data.CheckoutRequestID })
  };
};

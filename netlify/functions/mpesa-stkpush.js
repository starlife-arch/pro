const fetch = require('node-fetch');
const { getAccessToken, timestampNow, buildStkPassword, assertEnv, normalizeKenyanPhone, getMpesaBaseUrl } = require('./_lib/mpesa');

exports.handler = async (event) => {
  const { phone, amountKES, userId, userName } = JSON.parse(event.body);
  const shortcode = assertEnv('MPESA_SHORTCODE');
  const passkey = assertEnv('MPESA_PASSKEY');
  const timestamp = timestampNow();
  const password = buildStkPassword(shortcode, passkey, timestamp);
  const token = await getAccessToken();
  const baseUrl = getMpesaBaseUrl();
  const siteUrl = assertEnv('SITE_URL');

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amountKES,
    PartyA: normalizeKenyanPhone(phone),
    PartyB: shortcode,
    PhoneNumber: normalizeKenyanPhone(phone),
    CallBackURL: `${siteUrl}/.netlify/functions/mpesa-callback`,
    AccountReference: `STAR-${Date.now()}`,
    TransactionDesc: 'Starlife deposit'
  };

  const res = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || 'STK push failed');
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();
  await db.collection('mpesa_transactions').doc(data.CheckoutRequestID).set({
    userId,
    userName,
    amountKES,
    phone: normalizeKenyanPhone(phone),
    checkoutRequestId: data.CheckoutRequestID,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ checkoutId: data.CheckoutRequestID })
  };
};

const { getDb, admin } = require('./_lib/firebase');
const { getMpesaBaseUrl, assertEnv, timestampNow, normalizeKenyanPhone, getAccessToken, buildStkPassword } = require('./_lib/mpesa');

const USD_TO_KES = 129;

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  try {
    const { phone, amountKES, userId, userName, depositId } = JSON.parse(event.body || '{}');
    if (!userId || !depositId) throw new Error('userId and depositId are required');

    const normalizedPhone = normalizeKenyanPhone(phone);
    const amount = Math.round(Number(amountKES));
    if (!Number.isFinite(amount) || amount < 1) throw new Error('Invalid amountKES');

    const shortcode = assertEnv('MPESA_SHORTCODE');
    const passkey = assertEnv('MPESA_PASSKEY');
    const callbackBase = assertEnv('URL').replace(/\/$/, '');
    const timestamp = timestampNow();
    const password = buildStkPassword(shortcode, passkey, timestamp);
    const token = await getAccessToken();

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: normalizedPhone,
      PartyB: shortcode,
      PhoneNumber: normalizedPhone,
      CallBackURL: `${callbackBase}/.netlify/functions/mpesa-callback`,
      AccountReference: depositId,
      TransactionDesc: `Starlife deposit ${depositId}`
    };

    const res = await fetch(`${getMpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || data.ResponseCode !== '0' || !data.CheckoutRequestID) {
      throw new Error(data.errorMessage || data.CustomerMessage || data.ResponseDescription || 'STK push failed');
    }

    const db = getDb();
    const amountUSD = Number((amount / USD_TO_KES).toFixed(4));
    await db.collection('mpesa_transactions').doc(data.CheckoutRequestID).set({
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID || null,
      uid: userId,
      userName: userName || null,
      depositId,
      phone: normalizedPhone,
      amountKES: amount,
      amountUSD,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      initiatedResponse: data
    }, { merge: true });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, checkoutRequestId: data.CheckoutRequestID, customerMessage: data.CustomerMessage || 'STK push sent' })
    };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: error.message }) };
  }
};

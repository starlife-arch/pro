const { getDb, admin } = require('./_lib/firebase');
const { getMpesaBaseUrl, assertEnv, getAccessToken, buildStkPassword, timestampNow } = require('./_lib/mpesa');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  try {
    const { checkoutId } = JSON.parse(event.body || '{}');
    if (!checkoutId) throw new Error('checkoutId is required');

    const db = getDb();
    const txRef = db.collection('mpesa_transactions').doc(checkoutId);
    const txSnap = await txRef.get();
    if (!txSnap.exists) return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Transaction not found' }) };

    const tx = txSnap.data() || {};
    if (tx.status !== 'pending') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: tx.status, transaction: tx }) };
    }

    const token = await getAccessToken();
    const shortcode = assertEnv('MPESA_SHORTCODE');
    const passkey = assertEnv('MPESA_PASSKEY');
    const timestamp = timestampNow();
    const password = buildStkPassword(shortcode, passkey, timestamp);

    const res = await fetch(`${getMpesaBaseUrl()}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutId
      })
    });

    const data = await res.json();
    await txRef.set({ lastQueryAt: admin.firestore.FieldValue.serverTimestamp(), lastQueryResponse: data }, { merge: true });

    const resultCode = String(data.ResultCode || '');
    const mapped = resultCode === '0' ? 'completed' : (resultCode ? 'failed' : 'pending');

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        status: tx.status === 'pending' ? mapped : tx.status,
        rawStatus: tx.status,
        queryResultCode: data.ResultCode,
        queryResultDesc: data.ResultDesc,
        note: 'Final wallet credit happens via mpesa-callback to ensure idempotent balance updates.'
      })
    };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: error.message }) };
  }
};

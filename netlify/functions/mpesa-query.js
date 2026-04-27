const { getDb, admin } = require('./_lib/firebase');
const { getMpesaBaseUrl, assertEnv, getAccessToken, buildStkPassword, timestampNow } = require('./_lib/mpesa');
const USD_TO_KES = 129;

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
    const resultDesc = String(data.ResultDesc || '');
    let mapped = 'pending';
    if (resultCode && resultCode !== '0') {
      mapped = 'failed';
      const failureDoc = {
        status: 'failed',
        resultCode: Number.isFinite(Number(resultCode)) ? Number(resultCode) : resultCode,
        resultDesc,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await txRef.set(failureDoc, { merge: true });
      if (tx.depositId) {
        await db.collection('deposits').doc(tx.depositId).set({
          status: 'failed',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          failureReason: resultDesc,
          mpesaCheckoutRequestId: checkoutId,
          amountKES: Number(tx.amountKES || 0),
          amount: Number(Number(tx.amountKES || 0) / USD_TO_KES)
        }, { merge: true });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        status: tx.status === 'pending' ? mapped : tx.status,
        rawStatus: tx.status,
        queryResultCode: data.ResultCode,
        queryResultDesc: resultDesc,
        note: 'Final wallet credit happens via mpesa-callback to ensure idempotent balance updates.'
      })
    };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: error.message }) };
  }
};

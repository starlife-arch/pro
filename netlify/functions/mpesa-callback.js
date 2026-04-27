const { getDb, admin } = require('./_lib/firebase');

const USD_TO_KES = 129;

function extractMetadata(items = []) {
  const out = {};
  items.forEach((item) => {
    if (!item || !item.Name) return;
    out[item.Name] = item.Value;
  });
  return out;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const callback = payload?.Body?.stkCallback || {};
    const checkoutRequestId = callback.CheckoutRequestID;
    if (!checkoutRequestId) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, ignored: true }) };
    }

    const db = getDb();
    const txRef = db.collection('mpesa_transactions').doc(checkoutRequestId);

    await db.runTransaction(async (t) => {
      const txSnap = await t.get(txRef);
      if (!txSnap.exists) {
        t.set(txRef, {
          checkoutRequestId,
          status: 'unknown_callback',
          callbackRaw: callback,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }

      const txData = txSnap.data() || {};
      if (txData.status === 'completed') return;

      const resultCode = Number(callback.ResultCode);
      const resultDesc = callback.ResultDesc || '';

      if (resultCode === 0) {
        const metadata = extractMetadata(callback.CallbackMetadata?.Item || []);
        const amountKES = Number(metadata.Amount || txData.amountKES || 0);
        const amountUSD = Number((amountKES / USD_TO_KES).toFixed(4));
        const mpesaReceiptNumber = metadata.MpesaReceiptNumber || null;
        const userId = txData.uid;
        const depositId = txData.depositId;

        if (userId) {
          const userRef = db.collection('users').doc(userId);
          t.update(userRef, {
            balance: admin.firestore.FieldValue.increment(amountUSD),
            totalEarned: admin.firestore.FieldValue.increment(amountUSD)
          });
        }
        if (depositId) {
          t.set(db.collection('deposits').doc(depositId), {
            status: 'approved',
            approvedAt: admin.firestore.FieldValue.serverTimestamp(),
            mpesaCheckoutRequestId: checkoutRequestId,
            mpesaReceiptNumber,
            amountKES,
            amount: amountUSD
          }, { merge: true });
        }

        t.set(txRef, {
          status: 'completed',
          resultCode,
          resultDesc,
          amountKES,
          amountUSD,
          mpesaReceiptNumber,
          callbackRaw: callback,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        if (txData.depositId) {
          t.set(db.collection('deposits').doc(txData.depositId), {
            status: 'failed',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            failureReason: resultDesc,
            mpesaCheckoutRequestId: checkoutRequestId
          }, { merge: true });
        }
        t.set(txRef, {
          status: 'failed',
          resultCode,
          resultDesc,
          callbackRaw: callback,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });

    return { statusCode: 200, body: JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }) };
  } catch (error) {
    return { statusCode: 200, body: JSON.stringify({ ResultCode: 0, ResultDesc: `Accepted with parse warning: ${error.message}` }) };
  }
};

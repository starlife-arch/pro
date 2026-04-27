const { getDb, admin } = require('./_lib/firebase');

function pickWithdrawalId(result = {}) {
  return result.Occasion || result.OriginatorConversationID?.replace(/^wd-/, '') || null;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const result = payload?.Result || {};
    const resultCode = Number(result.ResultCode);
    const withdrawalId = pickWithdrawalId(result);

    if (!withdrawalId) return { statusCode: 200, body: JSON.stringify({ ok: true, ignored: true }) };

    const db = getDb();
    const wdRef = db.collection('withdrawals').doc(withdrawalId);

    await db.runTransaction(async (t) => {
      const wdSnap = await t.get(wdRef);
      if (!wdSnap.exists) return;
      const wd = wdSnap.data() || {};

      if (resultCode === 0) {
        t.set(wdRef, {
          status: 'paid',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          mpesaResultCode: resultCode,
          mpesaResultDesc: result.ResultDesc || '',
          mpesaConversationId: result.ConversationID || wd.mpesaConversationId || null,
          mpesaOriginatorConversationId: result.OriginatorConversationID || wd.mpesaOriginatorConversationId || null,
          mpesaRawResult: result
        }, { merge: true });
        return;
      }

      const updates = {
        status: 'failed',
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        mpesaResultCode: resultCode,
        mpesaResultDesc: result.ResultDesc || '',
        mpesaConversationId: result.ConversationID || wd.mpesaConversationId || null,
        mpesaOriginatorConversationId: result.OriginatorConversationID || wd.mpesaOriginatorConversationId || null,
        mpesaRawResult: result
      };

      if (!wd.refundedOnMpesaFail && wd.uid && Number.isFinite(Number(wd.amount))) {
        t.update(db.collection('users').doc(wd.uid), {
          balance: admin.firestore.FieldValue.increment(Number(wd.amount))
        });
        updates.refundedOnMpesaFail = true;
      }

      t.set(wdRef, updates, { merge: true });
    });

    return { statusCode: 200, body: JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }) };
  } catch (error) {
    return { statusCode: 200, body: JSON.stringify({ ResultCode: 0, ResultDesc: `Accepted with warning: ${error.message}` }) };
  }
};

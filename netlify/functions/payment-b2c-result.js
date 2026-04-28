const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

exports.handler = async (event) => {
  // ── Parse callback ────────────────────────────────────────────────────────
  let result;
  try {
    result = JSON.parse(event.body);
  } catch {
    console.error('Invalid JSON in B2C result callback');
    return { statusCode: 200, body: 'OK' }; // Always return 200 to M-Pesa
  }

  // FIX: Safaricom wraps B2C result under result.Result — not the top level
  const resultData = result?.Result;
  if (!resultData) {
    console.error('Unexpected B2C result structure:', JSON.stringify(result));
    return { statusCode: 200, body: 'OK' };
  }

  const { ConversationID, ResultCode, ResultDesc } = resultData;

  if (!ConversationID) {
    console.error('Missing ConversationID in B2C result');
    return { statusCode: 200, body: 'OK' };
  }

  // ── Find the withdrawal ───────────────────────────────────────────────────
  let wdQuery;
  try {
    wdQuery = await db.collection('withdrawals')
      .where('mpesaConversationId', '==', ConversationID)
      .limit(1)
      .get();
  } catch (e) {
    console.error('Firestore query error in B2C result:', e);
    return { statusCode: 200, body: 'OK' };
  }

  if (wdQuery.empty) {
    console.warn('No withdrawal found for ConversationID:', ConversationID);
    return { statusCode: 200, body: 'OK' };
  }

  const wdRef = wdQuery.docs[0].ref;

  // ── Update withdrawal status ──────────────────────────────────────────────
  try {
    if (ResultCode === 0) {
      await wdRef.update({
        status: 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`B2C success: ConversationID=${ConversationID}`);
    } else {
      const wdDoc = await wdRef.get();
      const { amount, uid } = wdDoc.data();

      if (!uid || amount == null) {
        console.error('Withdrawal doc missing uid or amount:', wdDoc.id);
      } else {
        // Refund the user because B2C failed
        await db.collection('users').doc(uid).update({
          balance: admin.firestore.FieldValue.increment(amount)
        });
        console.warn(`B2C failed, refunded user ${uid} $${amount}: [${ResultCode}] ${ResultDesc}`);
      }

      await wdRef.update({
        status: 'failed',
        failureReason: ResultDesc || 'B2C payment failed',
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (e) {
    console.error('Firestore update error in B2C result handler:', e);
  }

  return { statusCode: 200, body: 'OK' };
};

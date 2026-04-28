const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

exports.handler = async (event) => {
  let result;
  try {
    result = JSON.parse(event.body);
  } catch {
    console.error('Invalid JSON in B2C timeout callback');
    return { statusCode: 200, body: 'OK' };
  }

  const conversationId = result?.Result?.ConversationID;
  if (!conversationId) {
    console.error('Missing ConversationID in B2C timeout');
    return { statusCode: 200, body: 'OK' };
  }

  try {
    const q = await db.collection('withdrawals')
      .where('conversationId', '==', conversationId)
      .limit(1)
      .get();

    if (!q.empty) {
      const doc = q.docs[0];
      const { amount, uid } = doc.data();

      if (uid && amount != null) {
        await db.collection('users').doc(uid).update({
          balance: admin.firestore.FieldValue.increment(amount)
        });
        console.log(`B2C timeout: refunded user ${uid} $${amount}`);
      }

      await doc.ref.update({
        status: 'failed',
        failureReason: 'B2C timeout',
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      console.warn('No withdrawal found for ConversationID on timeout:', conversationId);
    }
  } catch (e) {
    console.error('Firestore error in B2C timeout handler:', e);
  }

  return { statusCode: 200, body: 'OK' };
};

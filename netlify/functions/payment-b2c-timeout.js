const admin = require('firebase-admin');
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

exports.handler = async (event) => {
  const result = JSON.parse(event.body);
  const conversationId = result?.Result?.ConversationID;
  if (conversationId) {
    const q = await db.collection('withdrawals')
      .where('mpesaConversationId', '==', conversationId).limit(1).get();
    if (!q.empty) {
      const doc = q.docs[0];
      const { amount, uid } = doc.data();
      await db.collection('users').doc(uid).update({
        balance: admin.firestore.FieldValue.increment(amount)
      });
      await doc.ref.update({ status: 'failed', failureReason: 'B2C timeout' });
    }
  }
  return { statusCode: 200, body: 'OK' };
};

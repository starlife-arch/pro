exports.handler = async (event) => {
  const result = JSON.parse(event.body);
  const { ConversationID, ResultCode, ResultDesc } = result;

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  const wdQuery = await db.collection('withdrawals').where('mpesaConversationId', '==', ConversationID).limit(1).get();
  if (wdQuery.empty) {
    return { statusCode: 200, body: 'OK' };
  }

  const wdRef = wdQuery.docs[0].ref;
  if (ResultCode === 0) {
    await wdRef.update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    const wdDoc = await wdRef.get();
    const amount = wdDoc.data().amount;
    const uid = wdDoc.data().uid;
    // Refund the user because B2C failed
    await db.collection('users').doc(uid).update({
      balance: admin.firestore.FieldValue.increment(amount)
    });
    await wdRef.update({
      status: 'failed',
      failureReason: ResultDesc
    });
  }

  return { statusCode: 200, body: 'OK' };
};

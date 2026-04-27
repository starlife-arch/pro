exports.handler = async (event) => {
  const callbackData = JSON.parse(event.body);
  const { Body: { stkCallback } } = callbackData;
  const checkoutId = stkCallback.CheckoutRequestID;
  const resultCode = stkCallback.ResultCode;

  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();

  const txRef = db.collection('mpesa_transactions').doc(checkoutId);
  const txDoc = await txRef.get();
  if (!txDoc.exists) return { statusCode: 200, body: 'OK' };

  if (resultCode === 0) {
    const amountKES = stkCallback.CallbackMetadata.Item.find(i => i.Name === 'Amount').Value;
    const receipt = stkCallback.CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber').Value;
    const userId = txDoc.data().userId;

    const usdAmount = amountKES / 129; // 1 USD = 129 KES

    const userRef = db.collection('users').doc(userId);
    await db.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const currentBal = userSnap.data().balance || 0;
      t.update(userRef, { balance: currentBal + usdAmount, totalEarned: admin.firestore.FieldValue.increment(usdAmount) });
    });

    await txRef.update({ status: 'completed', receipt, amountKES });
    await db.collection('deposits').add({
      uid: userId, amount: usdAmount, method: 'M-Pesa STK', status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await txRef.update({ status: 'failed', resultDesc: stkCallback.ResultDesc });
  }
  return { statusCode: 200, body: 'OK' };
};

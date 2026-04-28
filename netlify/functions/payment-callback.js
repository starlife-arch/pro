const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const KES_TO_USD = parseFloat(process.env.KES_TO_USD_RATE || '129');

exports.handler = async (event) => {
  let callbackData;
  try {
    callbackData = JSON.parse(event.body);
  } catch {
    console.error('Invalid JSON in callback');
    return { statusCode: 200, body: 'OK' };
  }

  const stkCallback = callbackData?.Body?.stkCallback;
  if (!stkCallback) {
    console.error('Unexpected callback structure:', JSON.stringify(callbackData));
    return { statusCode: 200, body: 'OK' };
  }

  const checkoutId = stkCallback.CheckoutRequestID;
  const resultCode = stkCallback.ResultCode;

  if (!checkoutId) {
    console.error('Missing CheckoutRequestID in callback');
    return { statusCode: 200, body: 'OK' };
  }

  const txRef = db.collection('mpesa_transactions').doc(checkoutId);
  let txDoc;
  try {
    txDoc = await txRef.get();
  } catch (e) {
    console.error('Firestore read error:', e);
    return { statusCode: 200, body: 'OK' };
  }

  if (!txDoc.exists) {
    console.warn('No transaction found for CheckoutRequestID:', checkoutId);
    return { statusCode: 200, body: 'OK' };
  }

  const txData = txDoc.data();

  if (resultCode === 0) {
    const items = stkCallback.CallbackMetadata?.Item || [];
    const amountKES = items.find(i => i.Name === 'Amount')?.Value;
    const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;

    if (!amountKES) {
      console.error('Amount missing from callback metadata for:', checkoutId);
      return { statusCode: 200, body: 'OK' };
    }

    const userId = txData.userId;
    const usdAmount = amountKES / KES_TO_USD;

    try {
      const userRef = db.collection('users').doc(userId);
      await db.runTransaction(async (t) => {
        const userSnap = await t.get(userRef);
        if (!userSnap.exists) throw new Error(`User ${userId} not found`);
        const currentBal = userSnap.data().balance || 0;
        t.update(userRef, {
          balance: currentBal + usdAmount,
          totalEarned: admin.firestore.FieldValue.increment(usdAmount)
        });
      });

      await txRef.update({
        status: 'completed',
        receipt: receipt || null,
        amountKES,
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await db.collection('deposits').add({
        uid: userId,
        amount: usdAmount,
        amountKES,
        receipt: receipt || null,
        method: 'STK',
        status: 'approved',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`Payment success: user=${userId} KES=${amountKES} USD=${usdAmount} receipt=${receipt}`);
    } catch (e) {
      console.error('Firestore update failed after successful payment:', e);
    }
  } else {
    console.warn(`Payment failed for ${checkoutId}: [${resultCode}] ${stkCallback.ResultDesc}`);
    try {
      await txRef.update({
        status: 'failed',
        resultCode,
        resultDesc: stkCallback.ResultDesc || 'Payment failed',
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.error('Firestore update error on payment failure:', e);
    }
  }

  return { statusCode: 200, body: 'OK' };
};

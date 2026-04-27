const { getDb, admin } = require('./_lib/firebase');
const { getMpesaBaseUrl, assertEnv, normalizeKenyanPhone, getAccessToken } = require('./_lib/mpesa');

const USD_TO_KES = 129;

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  try {
    const { phone, amountKES, amountUSD, withdrawalId, userId } = JSON.parse(event.body || '{}');
    if (!withdrawalId || !userId) throw new Error('withdrawalId and userId are required');

    const normalizedPhone = normalizeKenyanPhone(phone);
    const amountFromUsd = Number.isFinite(Number(amountUSD))
      ? Math.round(Number(amountUSD) * USD_TO_KES)
      : null;
    const amount = Math.round(Number.isFinite(Number(amountKES)) ? Number(amountKES) : amountFromUsd);
    if (!Number.isFinite(amount) || amount < 1) throw new Error('Invalid amountKES');

    const db = getDb();
    const wdRef = db.collection('withdrawals').doc(withdrawalId);
    const wdSnap = await wdRef.get();
    if (!wdSnap.exists) throw new Error('Withdrawal not found');
    const wd = wdSnap.data() || {};
    if (wd.mpesaConversationId) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyProcessed: true, status: wd.status || 'processing', conversationId: wd.mpesaConversationId }) };
    }
    if (wd.status === 'processing' || wd.status === 'paid') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyProcessed: true, status: wd.status }) };
    }

    const token = await getAccessToken();
    const shortcode = assertEnv('MPESA_SHORTCODE');
    const securityCredential = assertEnv('MPESA_SECURITY_CREDENTIAL');
    const initiatorName = assertEnv('MPESA_INITIATOR_NAME');
    const callbackBase = assertEnv('URL').replace(/\/$/, '');
    const originatorConversationId = `wd-${withdrawalId}`.slice(0, 32);

    const payload = {
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: process.env.MPESA_B2C_COMMAND_ID || 'BusinessPayment',
      Amount: amount,
      PartyA: shortcode,
      PartyB: normalizedPhone,
      Remarks: `Starlife withdrawal ${withdrawalId}`,
      QueueTimeOutURL: `${callbackBase}/.netlify/functions/mpesa-b2c-result`,
      ResultURL: `${callbackBase}/.netlify/functions/mpesa-b2c-result`,
      Occasion: withdrawalId,
      OriginatorConversationID: originatorConversationId
    };

    const res = await fetch(`${getMpesaBaseUrl()}/mpesa/b2c/v3/paymentrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || data.ResponseCode !== '0') {
      throw new Error(data.errorMessage || data.ResponseDescription || 'B2C request failed');
    }

    await wdRef.set({
      status: 'processing',
      mpesaPhone: normalizedPhone,
      mpesaAmountKES: amount,
      mpesaConversationId: data.ConversationID || null,
      mpesaOriginatorConversationId: data.OriginatorConversationID || originatorConversationId,
      mpesaResponseDescription: data.ResponseDescription || null,
      b2cRequestedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        status: 'processing',
        conversationId: data.ConversationID || null,
        originatorConversationId: data.OriginatorConversationID || originatorConversationId
      })
    };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: error.message }) };
  }
};

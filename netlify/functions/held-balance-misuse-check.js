const { getDb } = require('./_lib/firebase');
const { sendTelegramMessage } = require('./_lib/telegram');
const { createAlertIfNotExists, timestampToDate } = require('./_lib/alerts');

/**
 * Firestore collections used:
 * - READ: investments, users
 * - WRITE: risk_alerts
 */
exports.handler = async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: 'Method not allowed' })
    };
  }

  const lookbackHours = Number(process.env.HELD_BALANCE_LOOKBACK_HOURS || 24);

  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const [investmentsSnap, usersSnap] = await Promise.all([
      db.collection('investments').get(),
      db.collection('users').get()
    ]);

    const userMap = new Map();
    for (const doc of usersSnap.docs) {
      const row = doc.data() || {};
      const userId = row.userId || row.uid || doc.id;
      userMap.set(userId, {
        memberId: row.memberId || row.memberCode || null,
        fullName: row.fullName || [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || 'Unknown',
        availableBalance: firstFinite([row.availableBalance, row.withdrawableBalance, row.spendableBalance]),
        heldBalance: firstFinite([row.heldBalance, row.restrictedBalance, row.lockedBalance])
      });
    }

    const createdAlerts = [];

    for (const doc of investmentsSnap.docs) {
      const inv = doc.data() || {};
      const createdAt = timestampToDate(inv.createdAt || inv.timestamp || inv.executedAt);
      if (!createdAt || createdAt < cutoff) continue;

      const userId = inv.userId || inv.uid;
      const amount = Number(inv.amount);
      if (!userId || !Number.isFinite(amount) || amount <= 0) continue;

      const user = userMap.get(userId);
      if (!user) continue;

      const heldBalance = Number(user.heldBalance);
      const availableBalance = Number(user.availableBalance);
      const hasHeld = Number.isFinite(heldBalance) && heldBalance > 0;
      const shortAvailable = Number.isFinite(availableBalance) && availableBalance < amount;

      // Likely misuse signal: user has held/restricted funds and investment amount exceeds available funds.
      if (!(hasHeld && shortAvailable)) continue;

      const alertKey = `risk:held_balance_misuse:${userId}:${doc.id}`;

      const created = await createAlertIfNotExists({
        db,
        alertKey,
        alertType: 'held_balance_misuse',
        payload: {
          userId,
          memberId: user.memberId,
          fullName: user.fullName,
          investmentId: doc.id,
          amount,
          availableBalance: Number.isFinite(availableBalance) ? availableBalance : null,
          heldBalance: Number.isFinite(heldBalance) ? heldBalance : null,
          reason: 'Investment amount exceeds available balance while held/restricted balance is positive.'
        }
      });

      if (created.created) {
        createdAlerts.push({
          userId,
          memberId: user.memberId,
          investmentId: doc.id,
          amount,
          availableBalance,
          heldBalance
        });
      }
    }

    if (createdAlerts.length > 0) {
      const lines = createdAlerts.slice(0, 20).map((x, i) => (
        `${i + 1}) ${x.memberId || x.userId} inv=${x.investmentId}\n` +
        `amount=${x.amount}, available=${x.availableBalance}, held=${x.heldBalance}`
      ));

      const message = [
        '🛑 <b>Held Balance Misuse Alert</b>',
        `New held-balance misuse alerts: <b>${createdAlerts.length}</b>`,
        '',
        ...lines
      ].join('\n');

      await sendTelegramMessage(message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        scannedInvestments: investmentsSnap.size,
        scannedUsers: usersSnap.size,
        newAlerts: createdAlerts.length
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: error.message })
    };
  }
};

function firstFinite(values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

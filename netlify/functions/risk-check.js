const { getDb } = require('./_lib/firebase');
const { sendTelegramMessage } = require('./_lib/telegram');
const { createAlertIfNotExists } = require('./_lib/alerts');

/**
 * Firestore collections used:
 * - READ: users
 * - WRITE: risk_alerts
 */
exports.handler = async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: 'Method not allowed' })
    };
  }

  try {
    const db = getDb();
    const usersSnapshot = await db.collection('users').get();

    let createdAlerts = 0;
    const triggeredUsers = [];

    for (const userDoc of usersSnapshot.docs) {
      const user = userDoc.data() || {};
      const userId = user.uid || user.userId || userDoc.id;
      const memberId = user.memberId || user.memberCode || null;
      const fullName = user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || 'Unknown';

      const balance = Number(user.balance);
      const availableBalanceRaw = user.availableBalance;
      const hasAvailableBalance = availableBalanceRaw !== undefined && availableBalanceRaw !== null;
      const availableBalance = hasAvailableBalance ? Number(availableBalanceRaw) : null;

      const hasNegativeBalance = Number.isFinite(balance) && balance < 0;
      const hasNegativeAvailable = Number.isFinite(availableBalance) && availableBalance < 0;

      if (!hasNegativeBalance && !hasNegativeAvailable) {
        continue;
      }

      const issueType = hasNegativeAvailable ? 'negative_available_balance' : 'negative_balance';
      const alertKey = `risk:${issueType}:${userId}`;

      const result = await createAlertIfNotExists({
        db,
        alertKey,
        alertType: issueType,
        payload: {
          userId,
          memberId,
          fullName,
          balance: Number.isFinite(balance) ? balance : null,
          availableBalance: Number.isFinite(availableBalance) ? availableBalance : null
        }
      });

      if (result.created) {
        createdAlerts += 1;
        triggeredUsers.push({ userId, memberId, fullName, balance, availableBalance, issueType });
      }
    }

    if (triggeredUsers.length > 0) {
      const lines = triggeredUsers.slice(0, 20).map((item, index) => (
        `${index + 1}) ${item.fullName} (${item.memberId || item.userId})\n` +
        `type=${item.issueType}, balance=${item.balance}, availableBalance=${item.availableBalance}`
      ));

      const overflow = triggeredUsers.length > 20 ? `\n...and ${triggeredUsers.length - 20} more.` : '';
      const message = [
        '⚠️ <b>Risk Check Alert</b>',
        `New negative-balance alerts: <b>${triggeredUsers.length}</b>`,
        '',
        ...lines,
        overflow
      ].join('\n');

      await sendTelegramMessage(message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        usersScanned: usersSnapshot.size,
        newAlerts: createdAlerts
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: error.message })
    };
  }
};

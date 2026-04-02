const { getDb } = require('./_lib/firebase');
const { timestampToDate } = require('./_lib/alerts');
const { sendTelegramMessage } = require('./_lib/telegram');

/**
 * Firestore collections used:
 * - READ: deposits, withdrawals, risk_alerts, users
 * - WRITE: none (Telegram only)
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
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [depositsSnap, withdrawalsSnap, alertsSnap, usersSnap] = await Promise.all([
      db.collection('deposits').get(),
      db.collection('withdrawals').get(),
      db.collection('risk_alerts').where('resolved', '==', false).get(),
      db.collection('users').get()
    ]);

    const newDeposits = countDocsSince(depositsSnap.docs, since);
    const newWithdrawals = countDocsSince(withdrawalsSnap.docs, since);

    let unresolvedRiskAlerts = 0;
    let duplicateInvestmentAlerts = 0;
    let negativeBalanceAlerts = 0;

    for (const alertDoc of alertsSnap.docs) {
      unresolvedRiskAlerts += 1;
      const alert = alertDoc.data() || {};
      if (alert.type === 'duplicate_investment') {
        duplicateInvestmentAlerts += 1;
      }
      if (alert.type === 'negative_balance' || alert.type === 'negative_available_balance') {
        negativeBalanceAlerts += 1;
      }
    }

    const activeInvestors = countActiveInvestors(usersSnap.docs);

    const message = [
      '📊 <b>Daily Starlife Admin Report</b>',
      `Period: ${since.toISOString()} to ${now.toISOString()}`,
      '',
      `New deposits: <b>${newDeposits}</b>`,
      `Withdrawals: <b>${newWithdrawals}</b>`,
      `Unresolved risk alerts: <b>${unresolvedRiskAlerts}</b>`,
      `Duplicate investment alerts: <b>${duplicateInvestmentAlerts}</b>`,
      `Negative balance alerts: <b>${negativeBalanceAlerts}</b>`,
      `Active investors: <b>${activeInvestors !== null ? activeInvestors : 'N/A'}</b>`
    ].join('\n');

    await sendTelegramMessage(message);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        summary: {
          newDeposits,
          newWithdrawals,
          unresolvedRiskAlerts,
          duplicateInvestmentAlerts,
          negativeBalanceAlerts,
          activeInvestors
        }
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: error.message })
    };
  }
};

function countDocsSince(docs, sinceDate) {
  let count = 0;

  for (const doc of docs) {
    const row = doc.data() || {};
    const createdAt = timestampToDate(
      row.createdAt || row.timestamp || row.executedAt || row.updatedAt
    );

    if (createdAt && createdAt >= sinceDate) {
      count += 1;
    }
  }

  return count;
}

function countActiveInvestors(userDocs) {
  let hasSignal = false;
  let count = 0;

  for (const userDoc of userDocs) {
    const user = userDoc.data() || {};

    const isActiveInvestor =
      user.isActiveInvestor === true ||
      user.activeInvestor === true ||
      user.isInvestor === true ||
      user.investorStatus === 'active';

    if (
      user.isActiveInvestor !== undefined ||
      user.activeInvestor !== undefined ||
      user.isInvestor !== undefined ||
      user.investorStatus !== undefined
    ) {
      hasSignal = true;
    }

    if (isActiveInvestor) {
      count += 1;
    }
  }

  return hasSignal ? count : null;
}

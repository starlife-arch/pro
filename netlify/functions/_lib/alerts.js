const { admin } = require('./firebase');

async function createAlertIfNotExists({
  db,
  collectionName = 'risk_alerts',
  alertKey,
  alertType,
  payload
}) {
  const existing = await db
    .collection(collectionName)
    .where('alertKey', '==', alertKey)
    .where('resolved', '==', false)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { created: false, id: existing.docs[0].id };
  }

  const doc = {
    ...payload,
    type: alertType,
    alertKey,
    resolved: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const ref = await db.collection(collectionName).add(doc);
  return { created: true, id: ref.id };
}

function timestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

module.exports = {
  createAlertIfNotExists,
  timestampToDate
};

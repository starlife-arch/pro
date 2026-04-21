const nodemailer = require('nodemailer');
const { getDb, admin } = require('./_lib/firebase');

const DAILY_LIMIT = 300;
const RATE_LIMIT_MS = 300;
const FROM = process.env.MAIL_FROM || 'Starlife Advert <noreply@example.com>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'support@example.com';

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS
  }
});

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  return email;
}

function memberIdFromUid(uid) {
  if (!uid || typeof uid !== 'string') return '';
  return uid.substring(0, 8).toUpperCase();
}

function uniqueRecipients(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: row.name || 'Member' });
  }
  return out;
}

async function resolveUserByIdentifier(db, identifier) {
  const lookup = String(identifier || '').trim();
  if (!lookup) throw new Error('User identifier is empty');

  const docSnap = await db.collection('users').doc(lookup).get();
  if (docSnap.exists) {
    const data = docSnap.data() || {};
    return { id: docSnap.id, ...data };
  }

  const byMemberId = await db.collection('users').where('memberId', '==', lookup.toUpperCase()).limit(1).get();
  if (!byMemberId.empty) {
    const d = byMemberId.docs[0];
    return { id: d.id, ...(d.data() || {}) };
  }

  const allUsers = await db.collection('users').get();
  const prefixMatch = allUsers.docs.find((doc) => {
    const docMemberId = String(doc.data()?.memberId || '').toUpperCase();
    return docMemberId === lookup.toUpperCase() || memberIdFromUid(doc.id) === lookup.toUpperCase();
  });

  if (!prefixMatch) throw new Error(`User not found: ${lookup}`);
  return { id: prefixMatch.id, ...(prefixMatch.data() || {}) };
}

async function resolveRecipient(db, item) {
  const email = normalizeEmail(item);
  if (email) {
    return { email, name: email.split('@')[0] || 'Member' };
  }

  const user = await resolveUserByIdentifier(db, item);
  const userEmail = normalizeEmail(user.email);
  if (!userEmail) throw new Error(`User has no valid email: ${item}`);
  return { email: userEmail, name: user.name || 'Member' };
}

async function getRecipientList(db, recipientsParam) {
  if (recipientsParam === 'all') {
    const usersSnap = await db.collection('users').get();
    return uniqueRecipients(
      usersSnap.docs.map((doc) => {
        const data = doc.data() || {};
        return { email: data.email, name: data.name || data.fullName || 'Member' };
      })
    );
  }

  if (Array.isArray(recipientsParam)) {
    const resolved = [];
    for (const item of recipientsParam) {
      resolved.push(await resolveRecipient(db, item));
    }
    return uniqueRecipients(resolved);
  }

  if (typeof recipientsParam === 'string' && recipientsParam.startsWith('single:')) {
    const identifier = recipientsParam.slice('single:'.length).trim();
    const one = await resolveRecipient(db, identifier);
    return uniqueRecipients([one]);
  }

  throw new Error('Invalid recipients parameter');
}

async function getTodayCount(db) {
  const today = new Date().toISOString().slice(0, 10);
  const docRef = db.collection('broadcastStats').doc(today);
  const snap = await docRef.get();
  const count = Number(snap.data()?.count || 0);
  return Number.isFinite(count) ? count : 0;
}

async function incrementTodayCount(db, amount = 1) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('broadcastStats').doc(today).set({
    count: admin.firestore.FieldValue.increment(amount),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const token = event.headers['x-api-token'] || event.headers['X-API-TOKEN'];
  if (!process.env.EMAIL_API_TOKEN || token !== process.env.EMAIL_API_TOKEN) {
    return json(401, { error: 'Unauthorized' });
  }

  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    return json(500, { error: 'Missing BREVO_SMTP_USER or BREVO_SMTP_PASS' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { error: 'Invalid JSON' });
  }

  const { subject, message, recipients } = body;
  if (!subject || !message || !recipients) {
    return json(400, { error: 'Missing subject, message, or recipients' });
  }

  try {
    const db = getDb();
    const recipientList = await getRecipientList(db, recipients);
    const todayCount = await getTodayCount(db);
    const remaining = DAILY_LIMIT - todayCount;

    if (recipientList.length === 0) {
      return json(400, { error: 'No valid recipients found' });
    }

    if (recipientList.length > remaining) {
      return json(429, {
        error: `Daily limit (${DAILY_LIMIT}) would be exceeded. Only ${remaining} emails left.`,
        totalRecipients: recipientList.length,
        remaining
      });
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const rec of recipientList) {
      try {
        await transporter.sendMail({
          from: FROM,
          to: rec.email,
          subject,
          text: `Dear ${rec.name},\n\n${message}\n\nBest regards,\nStarlife Advert Team`,
          replyTo: REPLY_TO
        });

        sent += 1;
        await incrementTodayCount(db, 1);
        await delay(RATE_LIMIT_MS);
      } catch (error) {
        failed += 1;
        errors.push({ email: rec.email, error: error.message });
      }
    }

    return json(200, {
      totalRecipients: recipientList.length,
      sent,
      failed,
      errors
    });
  } catch (error) {
    return json(500, { error: error.message || 'Failed to process broadcast email' });
  }
};

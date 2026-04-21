// netlify/functions/broadcast-email.js
// Uses Nodemailer + Brevo SMTP (bulk/admin emails)

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  // 1. Security – verify the token sent by the proxy
  const token = event.headers['x-api-token'];
  if (token !== process.env.EMAIL_API_TOKEN) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const { subject, message, recipients } = JSON.parse(event.body || '{}');
  if (!subject || !message) {
    return { statusCode: 400, body: 'Missing subject or message' };
  }

  // 2. Create SMTP transporter (same as send-email)
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS,
    },
  });

  // 3. Determine recipient email addresses
  let emails = [];

  if (recipients === 'all') {
    // Fetch all user emails from Firestore
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    const db = admin.firestore();
    const usersSnap = await db.collection('users').get();
    emails = usersSnap.docs.map(doc => doc.data().email).filter(Boolean);
  } 
  else if (Array.isArray(recipients)) {
    emails = recipients;
  } 
  else if (typeof recipients === 'string' && recipients.startsWith('single:')) {
    const memberIdOrUid = recipients.split(':')[1];
    // Fetch user by memberId (first 8 chars of UID) or direct UID
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    const db = admin.firestore();
    let userSnap;
    // Try by UID first
    userSnap = await db.collection('users').doc(memberIdOrUid).get();
    if (!userSnap.exists) {
      // Try by memberId (first 8 uppercase of UID)
      const allUsers = await db.collection('users').get();
      const match = allUsers.docs.find(doc => doc.id.substring(0, 8).toUpperCase() === memberIdOrUid.toUpperCase());
      if (match) userSnap = match;
    }
    if (userSnap && userSnap.exists) {
      emails = [userSnap.data().email];
    } else {
      return { statusCode: 404, body: 'User not found' };
    }
  } 
  else {
    return { statusCode: 400, body: 'Invalid recipients format' };
  }

  if (!emails.length) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, failed: 0, errors: [] }) };
  }

  // 4. Send emails one by one (Brevo SMTP allows 300/day free)
  let sent = 0, failed = 0, errors = [];
  const fromEmail = `"Starlife Advert" <${process.env.MAIL_FROM || 'noreply@starlifeadvert.com'}>`;

  for (const email of emails) {
    try {
      await transporter.sendMail({
        from: fromEmail,
        to: email,
        subject,
        html: `<p>${message}</p>`,
      });
      sent++;
    } catch (err) {
      failed++;
      errors.push({ email, error: err.message });
      console.error(`Failed to send to ${email}:`, err.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ sent, failed, errors, totalRecipients: emails.length }),
  };
};

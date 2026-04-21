// netlify/functions/broadcast-email.js
// Sends personalized broadcast emails + Telegram alert to admin

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  // 1. Security check
  const token = event.headers['x-api-token'];
  if (token !== process.env.EMAIL_API_TOKEN) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const { subject, message, recipients } = JSON.parse(event.body || '{}');
  if (!subject || !message) {
    return { statusCode: 400, body: 'Missing subject or message' };
  }

  // 2. Setup email transporter (Brevo SMTP)
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS,
    },
  });

  // 3. Get list of recipients with names
  let recipientsList = [];

  if (recipients === 'all') {
    // Fetch all users with email + name from Firestore
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    const db = admin.firestore();
    const usersSnap = await db.collection('users').get();
    recipientsList = usersSnap.docs
      .map(doc => ({
        email: doc.data().email,
        name: doc.data().name || doc.data().displayName || 'Member',
      }))
      .filter(r => r.email);
  } 
  else if (Array.isArray(recipients)) {
    recipientsList = recipients.map(email => ({ email, name: 'Member' }));
  } 
  else if (typeof recipients === 'string' && recipients.startsWith('single:')) {
    const memberIdOrUid = recipients.split(':')[1];
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    const db = admin.firestore();
    let userSnap = await db.collection('users').doc(memberIdOrUid).get();
    if (!userSnap.exists) {
      const allUsers = await db.collection('users').get();
      const match = allUsers.docs.find(doc => doc.id.substring(0, 8).toUpperCase() === memberIdOrUid.toUpperCase());
      if (match) userSnap = match;
    }
    if (userSnap && userSnap.exists) {
      recipientsList = [{
        email: userSnap.data().email,
        name: userSnap.data().name || userSnap.data().displayName || 'Member',
      }];
    } else {
      return { statusCode: 404, body: 'User not found' };
    }
  } 
  else {
    return { statusCode: 400, body: 'Invalid recipients format' };
  }

  if (!recipientsList.length) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, failed: 0, errors: [] }) };
  }

  // 4. Send personalized emails
  let sent = 0, failed = 0, errors = [];
  const fromEmail = `"Starlife Advert" <${process.env.MAIL_FROM || 'noreply@starlifeadvert.com'}>`;

  for (const { email, name } of recipientsList) {
    // Personalize message – replace "Dear Member" with user's name
    let personalizedMessage = message;
    personalizedMessage = personalizedMessage.replace(/Dear Member/gi, `Dear ${name}`);
    if (!personalizedMessage.includes(`Dear ${name}`) && !personalizedMessage.includes(name)) {
      personalizedMessage = `<p>Dear ${name},</p>\n${personalizedMessage}`;
    }

    try {
      await transporter.sendMail({
        from: fromEmail,
        to: email,
        subject,
        html: personalizedMessage,
      });
      sent++;
    } catch (err) {
      failed++;
      errors.push({ email, error: err.message });
      console.error(`Failed to send to ${email}:`, err.message);
    }
  }

  // 5. Send Telegram alert to admin
  const siteUrl = process.env.URL || `https://${process.env.SITE_NAME}.netlify.app`;
  try {
    await fetch(`${siteUrl}/.netlify/functions/send-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `📢 *Broadcast Sent*\nSubject: ${subject}\nRecipients: ${recipientsList.length}\nSent: ${sent}\nFailed: ${failed}`,
      }),
    });
  } catch (tgErr) {
    console.error('Telegram alert failed:', tgErr);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ sent, failed, errors, totalRecipients: recipientsList.length }),
  };
};

// netlify/functions/broadcast-email.js
const Brevo = require('@getbrevo/brevo');

exports.handler = async (event) => {
  const token = event.headers['x-api-token'];
  if (token !== process.env.EMAIL_API_TOKEN) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const { subject, message, recipients } = JSON.parse(event.body || '{}');
  if (!subject || !message) {
    return { statusCode: 400, body: 'Missing subject or message' };
  }

  // recipients can be: 'all', an array of email addresses, or 'single:memberId'
  let emails = [];
  if (recipients === 'all') {
    // Fetch all user emails from Firestore (implement this part)
    // For simplicity, we assume you have a way to get all user emails
    // You can query Firestore inside this function.
    // I'll provide a placeholder – you'll need to replace with actual DB fetch.
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
    const db = admin.firestore();
    const usersSnap = await db.collection('users').get();
    emails = usersSnap.docs.map(doc => doc.data().email).filter(Boolean);
  } else if (Array.isArray(recipients)) {
    emails = recipients;
  } else if (typeof recipients === 'string' && recipients.startsWith('single:')) {
    const memberId = recipients.split(':')[1];
    // Fetch user email by memberId – implement as needed
    emails = [memberId]; // placeholder
  } else {
    return { statusCode: 400, body: 'Invalid recipients format' };
  }

  if (!emails.length) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, failed: 0, errors: [] }) };
  }

  const apiInstance = new Brevo.TransactionalEmailsApi();
  apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

  let sent = 0, failed = 0, errors = [];
  for (const email of emails) {
    try {
      const sendSmtpEmail = new Brevo.SendSmtpEmail();
      sendSmtpEmail.subject = subject;
      sendSmtpEmail.htmlContent = `<p>${message}</p>`;
      sendSmtpEmail.sender = { name: 'Starlife Advert', email: process.env.BREVO_SENDER_EMAIL };
      sendSmtpEmail.to = [{ email }];
      await apiInstance.sendTransacEmail(sendSmtpEmail);
      sent++;
    } catch (err) {
      failed++;
      errors.push({ email, error: err.message });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ sent, failed, errors, totalRecipients: emails.length }),
  };
};

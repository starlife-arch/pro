// netlify/functions/send-email.js
const Brevo = require('@getbrevo/brevo');

exports.handler = async (event) => {
  // 1. Security – verify the token sent by the proxy
  const token = event.headers['x-api-token'];
  if (token !== process.env.EMAIL_API_TOKEN) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const { type, to, data } = JSON.parse(event.body || '{}');
  if (!to) {
    return { statusCode: 400, body: 'Missing recipient' };
  }

  // 2. Define email subject and HTML content based on type
  let subject = '';
  let html = '';

  switch (type) {
    case 'welcome':
      subject = 'Welcome to Starlife Advert!';
      html = `<h2>Welcome ${data.name}!</h2>
              <p>Thank you for joining Starlife Advert. Your account is ready.</p>
              <p>Start investing today and earn 2% daily profit.</p>
              <a href="https://starlifeadvert.netlify.app">Go to Dashboard →</a>`;
      break;
    case 'deposit_pending':
      subject = 'Deposit Confirmation – Pending Approval';
      html = `<p>Hi ${data.name},</p>
              <p>We received your deposit of <strong>$${data.amount}</strong> via ${data.method}.</p>
              <p>Reference: ${data.transactionId}</p>
              <p>We will notify you once it is approved.</p>`;
      break;
    case 'deposit_approved':
      subject = 'Deposit Approved!';
      html = `<p>Hi ${data.name},</p>
              <p>Your deposit of <strong>$${data.amount}</strong> has been approved and added to your balance.</p>
              <p>You can now invest or withdraw.</p>`;
      break;
    case 'withdrawal_pending':
      subject = 'Withdrawal Request Received';
      html = `<p>Hi ${data.name},</p>
              <p>We received your withdrawal request of <strong>$${data.amount}</strong> via ${data.method}.</p>
              <p>Reference: ${data.transactionId}</p>
              <p>We will process it shortly.</p>`;
      break;
    case 'withdrawal_approved':
      subject = 'Withdrawal Processed';
      html = `<p>Hi ${data.name},</p>
              <p>Your withdrawal of <strong>$${data.amount}</strong> has been sent to your ${data.method} account.</p>
              <p>Thank you for trusting Starlife.</p>`;
      break;
    case 'withdrawal_rejected':
      subject = 'Withdrawal Update';
      html = `<p>Hi ${data.name},</p>
              <p>Your withdrawal request of <strong>$${data.amount}</strong> was rejected.</p>
              <p>Reason: ${data.reason || 'Please contact support.'}</p>`;
      break;
    case 'account_suspended':
      subject = 'Account Suspended';
      html = `<p>Hi ${data.name},</p>
              <p>Your account has been suspended. Reason: ${data.reason || 'Policy violation'}.</p>
              <p>Please contact support for assistance.</p>`;
      break;
    case 'account_unsuspended':
      subject = 'Account Restored';
      html = `<p>Hi ${data.name},</p>
              <p>Your account has been restored. You can now log in again.</p>`;
      break;
    default:
      subject = 'Update from Starlife';
      html = `<p>${data.message || 'Please check your Starlife dashboard for updates.'}</p>`;
  }

  // 3. Configure Brevo API client
  const apiInstance = new Brevo.TransactionalEmailsApi();
  apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

  const sendSmtpEmail = new Brevo.SendSmtpEmail();
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = html;
  sendSmtpEmail.sender = { name: 'Starlife Advert', email: process.env.BREVO_SENDER_EMAIL };
  sendSmtpEmail.to = [{ email: to, name: data.name || 'Member' }];

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Brevo error:', err.body || err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

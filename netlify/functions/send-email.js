const nodemailer = require('nodemailer');

const FROM = process.env.MAIL_FROM || 'Starlife Advert <noreply@example.com>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'support@example.com';
const API_TOKEN = process.env.EMAIL_API_TOKEN;

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

function templateWelcome(data) {
  const name = data.name || 'Valued Member';
  return {
    subject: 'Welcome to Starlife Advert',
    text:
`Dear ${name},

Welcome to Starlife Advert. Your account has been created successfully and is now active.

You may now sign in to your dashboard to review available investment options and approved payment channels.

For your security and convenience, please complete your profile and keep your account credentials confidential.

Best regards,
Starlife Advert Team`
  };
}

function templateAccountSuspended(data) {
  const name = data.name || 'Valued Member';
  const reason = String(data.reason || '').trim();
  const reasonLine = reason ? `Reason provided: ${reason}\n\n` : '';
  return {
    subject: 'Important Notice: Account Suspension',
    text:
`Dear ${name},

Your Starlife Advert account has been temporarily suspended.

${reasonLine}If you believe this action was taken in error, please submit an appeal through the website support section or contact support@example.com for further assistance.

Best regards,
Starlife Advert Team`
  };
}

function templateAccountUnsuspended(data) {
  const name = data.name || 'Valued Member';
  return {
    subject: 'Account Reactivated',
    text:
`Dear ${name},

Your Starlife Advert account has been reactivated successfully.

You may now sign in and continue using platform services as normal.

Thank you for your patience and welcome back.

Best regards,
Starlife Advert Team`
  };
}

function templateDepositStatus(data, statusLabel, nextStep) {
  const name = data.name || 'Valued Member';
  const amount = data.amount ?? 'N/A';
  const method = data.method || 'N/A';
  const reference = data.transactionId || data.reference || 'N/A';
  return {
    subject: `Deposit Update: ${statusLabel}`,
    text:
`Dear ${name},

This is an update regarding your recent deposit request.

Amount: ${amount}
Payment Method: ${method}
Transaction Reference: ${reference}
Status: ${statusLabel}

${nextStep}

Best regards,
Starlife Advert Team`
  };
}

function templateWithdrawalStatus(data, statusLabel, nextStep) {
  const name = data.name || 'Valued Member';
  const amount = data.amount ?? 'N/A';
  const method = data.method || 'N/A';
  const reference = data.transactionId || data.reference || 'N/A';
  return {
    subject: `Withdrawal Update: ${statusLabel}`,
    text:
`Dear ${name},

This is an update regarding your withdrawal request.

Amount: ${amount}
Payment Method: ${method}
Transaction Reference: ${reference}
Status: ${statusLabel}

${nextStep}

Best regards,
Starlife Advert Team`
  };
}

function buildTemplate(type, data) {
  switch (type) {
    case 'welcome':
      return templateWelcome(data);
    case 'account_suspended':
      return templateAccountSuspended(data);
    case 'account_unsuspended':
      return templateAccountUnsuspended(data);
    case 'deposit_pending':
      return templateDepositStatus(data, 'Pending Review', 'Our finance team is currently reviewing your submission. No further action is required at this time.');
    case 'deposit_approved':
      return templateDepositStatus(data, 'Approved', 'Your deposit has been approved and reflected in your account balance.');
    case 'deposit_rejected':
      return templateDepositStatus(data, 'Rejected', 'Your deposit could not be approved. Please review your submission details and contact support if you need assistance.');
    case 'withdrawal_pending':
      return templateWithdrawalStatus(data, 'Pending Review', 'Your request is being processed by our finance team. We will notify you once processing is complete.');
    case 'withdrawal_approved':
      return templateWithdrawalStatus(data, 'Approved', 'Your withdrawal has been approved and marked for payout processing.');
    case 'withdrawal_rejected':
      return templateWithdrawalStatus(data, 'Rejected', 'Your withdrawal request was not approved. Please contact support if you would like a review of this decision.');
    default:
      throw new Error(`Unsupported email type: ${type}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { Allow: 'POST, OPTIONS' }, body: '' };
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const token = event.headers['x-api-token'] || event.headers['X-API-TOKEN'];
  if (!token || token !== API_TOKEN) {
    return json(401, { error: 'Unauthorized' });
  }

  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    return json(500, { error: 'Missing BREVO_SMTP_USER or BREVO_SMTP_PASS' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { error: 'Invalid JSON payload' });
  }

  const type = String(body.type || '').trim();
  const to = normalizeEmail(body.to);
  if (!type || !to) {
    return json(400, { error: 'Missing required fields: type and to' });
  }

  try {
    const template = buildTemplate(type, body);
    await transporter.sendMail({
      from: FROM,
      to,
      subject: template.subject,
      text: template.text,
      replyTo: REPLY_TO
    });

    return json(200, { ok: true, type, to });
  } catch (error) {
    return json(500, { error: error.message || 'Failed to send email' });
  }
};

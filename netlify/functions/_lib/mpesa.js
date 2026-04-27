const MPESA_ENV = (process.env.MPESA_ENV || 'sandbox').toLowerCase();

function getMpesaBaseUrl() {
  return MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function assertEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function timestampNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function normalizeKenyanPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^254\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `254${digits}`;
  throw new Error('Invalid phone number. Use 0712345678 or 254712345678.');
}

async function getAccessToken() {
  const consumerKey = assertEnv('MPESA_CONSUMER_KEY');
  const consumerSecret = assertEnv('MPESA_CONSUMER_SECRET');
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(`${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.errorMessage || data.error_description || 'Failed to get M-Pesa token');
  }
  return data.access_token;
}

function buildStkPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

module.exports = {
  getMpesaBaseUrl,
  assertEnv,
  timestampNow,
  normalizeKenyanPhone,
  getAccessToken,
  buildStkPassword,
  MPESA_ENV
};

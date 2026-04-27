const fetch = require('node-fetch'); // FIX: was missing — bare fetch doesn't exist in Node < 18
const { getAccessToken, assertEnv, getMpesaBaseUrl, timestampNow, buildStkPassword } = require('./_lib/mpesa');

exports.handler = async (event) => {
  // ── Input validation ──────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { checkoutId } = body;
  if (!checkoutId || typeof checkoutId !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: checkoutId' }) };
  }

  // ── Build query ───────────────────────────────────────────────────────────
  const shortcode = assertEnv('MPESA_SHORTCODE');
  const passkey = assertEnv('MPESA_PASSKEY');
  const timestamp = timestampNow();
  const password = buildStkPassword(shortcode, passkey, timestamp);
  const token = await getAccessToken();
  const baseUrl = getMpesaBaseUrl();

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutId
  };

  try {
    const res = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    console.error('STK query error:', e);
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};

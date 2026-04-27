const { getAccessToken, assertEnv, getMpesaBaseUrl } = require('./_lib/mpesa');

exports.handler = async (event) => {
  const { checkoutId } = JSON.parse(event.body);
  const shortcode = assertEnv('MPESA_SHORTCODE');
  const passkey = assertEnv('MPESA_PASSKEY');
  const timestamp = require('./_lib/mpesa').timestampNow();
  const password = require('./_lib/mpesa').buildStkPassword(shortcode, passkey, timestamp);
  const token = await getAccessToken();
  const baseUrl = getMpesaBaseUrl();

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutId
  };

  const res = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  return { statusCode: 200, body: JSON.stringify(data) };
};

// netlify/functions/send-email-proxy.js
// Frontend calls this endpoint — no token needed from the browser.
// This function adds the token server-side before forwarding to send-email.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // Forward to the internal send-email function with the real token
    const response = await fetch(
      `${process.env.URL}/.netlify/functions/send-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-token': process.env.EMAIL_API_TOKEN
        },
        body: JSON.stringify(body)
      }
    );

    const text = await response.text();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: text
    };
  } catch (err) {
    console.error('send-email-proxy error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

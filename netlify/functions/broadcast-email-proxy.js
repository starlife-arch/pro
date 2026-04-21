// netlify/functions/broadcast-email-proxy.js
// Called by the admin broadcast UI — injects the token server-side.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const siteUrl = process.env.URL || 'http://localhost:8888';

    const response = await fetch(
      `${siteUrl}/.netlify/functions/broadcast-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-token': process.env.EMAIL_API_TOKEN || ''
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
    console.error('broadcast-email-proxy error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

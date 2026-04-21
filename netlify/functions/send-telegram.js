// netlify/functions/send-telegram.js
// Sends a message to the admin Telegram chat

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse the message from the request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const message = body.message;
  if (!message) {
    return { statusCode: 400, body: 'Missing message' };
  }

  // Get Telegram credentials from environment variables
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('Telegram credentials missing');
    return { statusCode: 500, body: 'Telegram not configured' };
  }

  // Send message to Telegram
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',  // allows bold, italic, etc.
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram error:', data);
      return { statusCode: 500, body: JSON.stringify(data) };
    }
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Telegram request failed:', err);
    return { statusCode: 500, body: err.message };
  }
};

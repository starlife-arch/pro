const { getDb, admin } = require('./_lib/firebase');
const { sendTelegramMessage } = require('./_lib/telegram');

// ========== CONVERSATION MEMORY FUNCTIONS ==========
async function getConversationHistory(userId, limit = 5) {
  if (!userId || userId === 'anonymous') return [];
  try {
    const db = getDb();
    const historyRef = db.collection('conversation_memory')
      .doc(userId)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(limit);
    const snapshot = await historyRef.get();
    const messages = [];
    snapshot.forEach(doc => {
      messages.unshift(doc.data());
    });
    return messages;
  } catch (error) {
    console.error('[memory] failed to get history', error);
    return [];
  }
}

async function saveConversationTurn(userId, userMessage, assistantReply) {
  if (!userId || userId === 'anonymous') return;
  try {
    const db = getDb();
    const turnRef = db.collection('conversation_memory')
      .doc(userId)
      .collection('messages')
      .doc();
    await turnRef.set({
      userMessage,
      assistantReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    // keep only last 20 messages per user
    const allMessages = await db.collection('conversation_memory')
      .doc(userId)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .get();
    if (allMessages.size > 20) {
      const batch = db.batch();
      let count = 0;
      allMessages.forEach(doc => {
        count++;
        if (count > 20) batch.delete(doc.ref);
      });
      await batch.commit();
    }
  } catch (error) {
    console.error('[memory] failed to save turn', error);
  }
}

async function clearConversationMemory(userId) {
  if (!userId || userId === 'anonymous') return;
  try {
    const db = getDb();
    const batch = db.batch();
    const snapshot = await db.collection('conversation_memory')
      .doc(userId)
      .collection('messages')
      .get();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (error) {
    console.error('[memory] failed to clear memory', error);
  }
}
// =================================================

// ========== FUN CONTENT ==========
const JOKES = [
  "😂 Why don't scientists trust atoms? Because they make up everything!",
  "🤣 What do you call a fake noodle? An impasta!",
  "😆 Why did the scarecrow win an award? He was outstanding in his field!",
  "😊 How does the moon cut his hair? Eclipse it!",
  "😁 Why did the computer go to the doctor? It had a virus!"
];

const FACTS = [
  "💡 Did you know? Starlife pays 2% DAILY profit on every active investment! That means $100 earns $2 every single day.",
  "🎉 Fun fact: Starlife's shareholder program distributes $2 MILLION annually to stakeholders!",
  "🌟 Starlife has served over 35,000 members and paid out more than $30 million in profits!",
  "💎 The Starlife referral program gives you 10% of your referral's first investment, plus 5% and 2% for second and third levels!"
];

const QUOTES = [
  "✨ 'The only way to do great work is to love what you do.' – Steve Jobs",
  "💫 'Your time is limited, don't waste it living someone else's life.' – Steve Jobs",
  "🚀 'The future belongs to those who believe in the beauty of their dreams.' – Eleanor Roosevelt",
  "🌱 'The only impossible journey is the one you never begin.' – Tony Robbins"
];
// =================================

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON body' });
  }

  const userMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!userMessage) {
    return json(400, { ok: false, error: 'message is required' });
  }

  const userId = payload.userId || payload.uid || 'anonymous';
  const memberId = payload.memberId || null;
  let db = null;
  try {
    db = getDb();
  } catch (error) {
    console.error('[ai-support-assistant] firestore unavailable', error);
  }

  console.log('[ai-support-assistant] request received', { userId, messagePreview: userMessage.slice(0, 140) });

  // ========== FUN COMMANDS ==========
  const lowerMsg = userMessage.toLowerCase();
  if (lowerMsg.includes('joke') || lowerMsg === 'tell me a joke') {
    const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
    if (userId !== 'anonymous') await saveConversationTurn(userId, userMessage, joke);
    return json(200, { ok: true, reply: joke });
  }
  if (lowerMsg.includes('fact') || lowerMsg === 'tell me a fact') {
    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
    if (userId !== 'anonymous') await saveConversationTurn(userId, userMessage, fact);
    return json(200, { ok: true, reply: fact });
  }
  if (lowerMsg.includes('quote') || lowerMsg === 'inspire me') {
    const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    if (userId !== 'anonymous') await saveConversationTurn(userId, userMessage, quote);
    return json(200, { ok: true, reply: quote });
  }

  // ========== HANDLE "TALK TO HUMAN" / CREATE TICKET ==========
  const isExplicitHandover = /(talk to human|human agent|speak to human|transfer to human|create a support ticket|create ticket|i need a human)/i.test(lowerMsg);
  if (isExplicitHandover) {
    console.log('[ai-support-assistant] explicit handover requested', { userId, memberId, userMessage });
    const ticketId = `TK-${Date.now().toString(36).toUpperCase()}`;
    let ticketDocId = null;
    if (db) {
      try {
        const baseTicketPayload = {
          userId,
          memberId,
          ticketId,
          category: 'support',
          severity: 'medium',
          source: 'ai_support_assistant_explicit',
          status: 'open',
          highRiskMatches: [],
          forceHuman: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const ticketRef = await db.collection('tickets').add({
          ...baseTicketPayload,
          uid: userId,
          subject: 'Human support requested',
          messages: [
            { from: 'user', name: memberId || userId, text: userMessage, time: new Date().toISOString() },
            { from: 'ai', name: 'Starlife AI', text: 'User requested human support. Ticket created.', time: new Date().toISOString() }
          ],
          aiReply: 'User requested human support.'
        });
        ticketDocId = ticketRef.id;
        // Notify admins via Telegram
        const adminIds = (process.env.ADMIN_IDS || '').split(',').filter(id => id.trim());
        for (const adminId of adminIds) {
          try {
            await sendTelegramMessage(
              `🆘 *HUMAN SUPPORT REQUESTED*\n\n` +
              `User: ${memberId || userId}\n` +
              `Message: ${userMessage}\n` +
              `Ticket ID: ${ticketId}\n` +
              `Action: Use /reply ${userId} <message> to respond.`
            );
          } catch (err) {
            console.error('[telegram] failed to notify admin', err);
          }
        }
      } catch (err) {
        console.error('[ticket] failed to create ticket', err);
      }
    }
    const reply = `✅ I've created a support ticket (${ticketId}) for you. A human agent will review your request and get back to you shortly. You can track your ticket status in "My Tickets". Thank you for your patience. 🙏`;
    if (userId !== 'anonymous') await saveConversationTurn(userId, userMessage, reply);
    return json(200, { ok: true, reply, ticketCreated: true, ticketId });
  }

  // ========== HANDLE /clear COMMAND ==========
  if (userMessage.toLowerCase() === '/clear') {
    await clearConversationMemory(userId);
    return json(200, {
      ok: true,
      reply: "🧹 I've cleared our conversation history. Let's start fresh! How can I help you today? 😊"
    });
  }

  // ========== LOAD CONVERSATION HISTORY ==========
  let conversationHistory = [];
  if (userId !== 'anonymous') {
    conversationHistory = await getConversationHistory(userId, 5);
    console.log(`[memory] loaded ${conversationHistory.length} previous turns for ${userId}`);
  }

  // ========== GENERATE AI RESPONSE ==========
  let aiResult = null;
  let providerUsed = 'groq';
  try {
    aiResult = await generateSupportReply({ userMessage, conversationHistory });
  } catch (error) {
    console.error('[ai-support-assistant] provider failure', error);
    providerUsed = 'rule_based_fallback';
    aiResult = getFallbackReply(userMessage);
  }

  const safeReply = aiResult.reply;

  // ========== SAVE TO MEMORY ==========
  if (userId !== 'anonymous') {
    await saveConversationTurn(userId, userMessage, safeReply);
  }

  // ========== LOG TO FIRESTORE (optional) ==========
  if (db && userId !== 'anonymous') {
    try {
      await db.collection('ai_support_logs').add({
        userId,
        memberId,
        userMessage,
        aiReply: safeReply,
        providerUsed,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('[ai-support-assistant] failed to write log', error);
    }
  }

  return json(200, {
    ok: true,
    reply: safeReply,
    category: aiResult.category || 'general_guidance',
    severity: 'low',
    providerUsed,
    defaultGreeting: "🌟 Hi! I'm Emy, your Starlife AI assistant! I'm here to help with investments, withdrawals, shareholder program, loans, savings, referrals, and more. What can I do for you today? 💫"
  });
};

async function generateSupportReply({ userMessage, conversationHistory }) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const baseUrl = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is missing');
  }

  // Build conversation history string
  let historyText = '';
  if (conversationHistory && conversationHistory.length > 0) {
    historyText = '\n\nPREVIOUS CONVERSATION:\n';
    for (const turn of conversationHistory) {
      historyText += `User: ${turn.userMessage}\nEmy: ${turn.assistantReply}\n`;
    }
    historyText += '\nNow continue naturally based on the above conversation.\n';
  }

  const knowledgeBase = `
STARLIFE KNOWLEDGE BASE (UPDATED DEC 2024):

=== INVESTMENTS ===
- Minimum investment: $10 USD, Maximum: $800,000 USD
- Daily profit: 2% of active investment (credited daily)
- Example: $100 investment earns $2 every day
- Investments approved by admin within 24 hours

=== WITHDRAWALS ===
- Minimum withdrawal: $10 USD, Processing fee: 10%
- Requires KYC verification and 6-digit PIN
- Processing time: within 24 hours after admin approval

=== SHAREHOLDER PROGRAM ===
- Minimum stake: $25 USD
- Annual profit pool: $2,000,000
- Lock period: 6 months from first stake

=== REFERRAL PROGRAM ===
- Level 1: 10% of referral's first investment
- Level 2: 5%, Level 3: 2%

=== SAVINGS WALLET ===
- Minimum deposit: $10, Lock: 30 days, Daily profit: 3%
- Savings Vault: 30/60/90 days with 5%/8%/12% bonuses

=== LOANS ===
- Loan limit: total invested + shareholder stake
- Terms: 7d (10% interest), 14d (20%), 30d (30%)
- Late fee: 5% every 7 days overdue

=== DEPOSIT METHODS ===
- M-Pesa: Till 6034186, PayPal: starlife.payment@starlifeadvert.com
- USDT: contact support for address

=== KYC ===
- Required before first withdrawal
- Upload ID photo, admin reviews within 24h

=== REWARDS ===
- Daily Check-in: +5 points, Spin Wheel, Scratch Card, Lucky Draw, Prize Codes

=== SUPPORT ===
- Email: support@example.com
- Ticket system in Support tab
`;

  const systemPrompt = `You are Emy, a warm, enthusiastic, and highly engaging AI assistant for Starlife Advert.

PERSONALITY:
- Be cheerful, encouraging, and conversational – like a close friend.
- Use occasional emojis 😊 (1-2 per response).
- Ask one relevant follow-up question naturally.
- Keep responses under 3-4 sentences unless the user asks for details.
- If the user seems frustrated, apologize and offer to create a support ticket.
- For support questions, give clear step-by-step guidance but keep it friendly.
- NEVER promise to change balances, approve loans, or process withdrawals.

KNOWLEDGE BASE:
${knowledgeBase}
${historyText}

USER QUESTION: ${userMessage}

Now respond naturally, helpfully, and warmly.`;

  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.8,
        max_tokens: 500
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Groq API error: ${response.status}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq did not return content');
  }

  return { reply: content, category: 'general_guidance' };
}

function getFallbackReply(userMessage) {
  const lower = userMessage.toLowerCase();
  if (lower.includes('invest')) {
    return { reply: "📈 To invest in Starlife, go to the Invest tab, enter an amount ($10–$800,000), choose your payment method, and submit your transaction reference. Admin approves within 24 hours, then you earn 2% daily! Would you like me to explain the daily profit calculation? 💰", category: 'invest' };
  }
  if (lower.includes('withdraw')) {
    return { reply: "💳 To withdraw, first complete KYC verification and set your 6-digit PIN in Profile. Then go to Withdraw tab, enter amount ($10+), choose method, and provide payment details. There's a 10% fee. Need help setting up your PIN or KYC? 🔐", category: 'withdraw' };
  }
  if (lower.includes('shareholder') || lower.includes('stake')) {
    return { reply: "💎 The Shareholder Program requires a minimum stake of $25 from your main balance. You'll earn from the $2 million annual profit pool based on your stake proportion. Earnings are locked for 6 months. Want to know how the pool is distributed daily? 🌟", category: 'shareholder' };
  }
  if (lower.includes('referral') || lower.includes('refer')) {
    return { reply: "👥 Our referral program gives you 10% of your friend's first investment, plus 5% for level 2 and 2% for level 3! Share your unique code from the Referral tab. Each new member earns you passive income. Ready to invite someone? 🚀", category: 'referral' };
  }
  if (lower.includes('loan')) {
    return { reply: "💰 You can borrow up to your total invested + shareholder stake. Choose 7, 14, or 30 days with interest rates 10%, 20%, or 30% deducted upfront. Repay on time to avoid 5% late fees every 7 days. Want to check your loan limit? 📊", category: 'loan' };
  }
  if (lower.includes('savings') || lower.includes('vault')) {
    return { reply: "🏦 Savings Wallet locks your funds for 30 days but earns 3% daily – higher than regular investments! You can also use Vault for 30/60/90 days with 5-12% bonuses. Would you like to see a comparison of the options? 💡", category: 'savings' };
  }
  if (lower.includes('kyc') || lower.includes('verify') || lower.includes('id')) {
    return { reply: "🪪 KYC verification is required before your first withdrawal. Go to Profile → Identity Verification, upload a clear photo of your National ID, Passport, or Driver's License. Admin reviews within 24 hours. Need help with the upload? 📸", category: 'kyc' };
  }
  if (lower.includes('points') || lower.includes('survey')) {
    return { reply: "📝 Complete surveys to earn points! Go to Surveys tab, answer questions, and get points. Redeem 1000 points for $1.00 cash, 2000 for $2, or 5000 for $5. Want to see available surveys? 🎯", category: 'survey' };
  }
  if (lower.includes('transfer') || lower.includes('gift') || lower.includes('send')) {
    return { reply: "💸 You can send cash (5% fee deducted from receiver) or points (free) to any member. Go to More → Transfer / Gift, enter their Member ID, amount, and optional message. Requires your withdrawal PIN. Who would you like to send to? 🎁", category: 'transfer' };
  }
  if (lower.includes('spin') || lower.includes('wheel')) {
    return { reply: "🎰 The Daily Spin Wheel gives you a chance to win points or cash! One spin per day. Go to Rewards tab and click Spin Now. Want to know the prize odds? ✨", category: 'rewards' };
  }
  if (lower.includes('scratch')) {
    return { reply: "🃏 Scratch Card is a daily game – tap each box to reveal symbols. Match all 3 to win points or cash! One card per day, completely free. Ready to play? 🎁", category: 'rewards' };
  }
  if (lower.includes('check-in') || lower.includes('checkin')) {
    return { reply: "📅 Daily Check-in gives you +5 points every day! Keep a streak for 7 days (bonus +5) and 30 days (bonus +10). Have you checked in today? 🔥", category: 'rewards' };
  }
  if (lower.includes('agent')) {
    return { reply: "⭐ Our Agent Program offers monthly salary, secretary allowance, and a company-sponsored office! Performance ranks: Bronze, Silver, Gold, Elite. Interested in becoming an agent? Contact support@example.com 🚀", category: 'agent' };
  }
  if (lower.includes('contact') || lower.includes('support') || lower.includes('help')) {
    return { reply: "📧 Need human support? Email support@example.com or open a ticket from the Support tab. We typically respond within 24 hours. For urgent issues, mention 'urgent' in your message. How can I help you today? 🎧", category: 'support' };
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return { reply: "🌟 Hello there! I'm Emy, your Starlife AI assistant. I'm here to help with investments, withdrawals, shareholder program, loans, and more! What brings you here today? 😊", category: 'greeting' };
  }
  return { reply: "🌟 Hi! I'm Emy, your Starlife AI assistant. I can help with investments (2% daily profit), withdrawals, shareholder program ($2M annual pool), loans, savings, referrals, and more. What would you like to know about Starlife today? 💫", category: 'general_guidance' };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

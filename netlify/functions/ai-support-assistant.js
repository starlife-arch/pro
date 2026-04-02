const { getDb, admin } = require('./_lib/firebase');
const { sendTelegramMessage } = require('./_lib/telegram');

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

  // Check for fun commands first (jokes, facts, quotes)
  const lowerMsg = userMessage.toLowerCase();
  if (lowerMsg.includes('joke') || lowerMsg.includes('tell me a joke')) {
    const jokes = [
      "😂 Why don't scientists trust atoms? Because they make up everything!",
      "🤣 What do you call a fake noodle? An impasta!",
      "😆 Why did the scarecrow win an award? He was outstanding in his field!",
      "😊 How does the moon cut his hair? Eclipse it!",
      "😁 Why did the computer go to the doctor? It had a virus!"
    ];
    return json(200, { ok: true, reply: jokes[Math.floor(Math.random() * jokes.length)] });
  }
  if (lowerMsg.includes('fact') || lowerMsg.includes('tell me a fact')) {
    const facts = [
      "💡 Did you know? Starlife pays 2% DAILY profit on every active investment! That means $100 earns $2 every single day.",
      "🎉 Fun fact: Starlife's shareholder program distributes $2 MILLION annually to stakeholders!",
      "🌟 Starlife has served over 35,000 members and paid out more than $30 million in profits!",
      "💎 The Starlife referral program gives you 10% of your referral's first investment, plus 5% and 2% for second and third levels!"
    ];
    return json(200, { ok: true, reply: facts[Math.floor(Math.random() * facts.length)] });
  }
  if (lowerMsg.includes('quote') || lowerMsg.includes('inspire me')) {
    const quotes = [
      "✨ 'The only way to do great work is to love what you do.' – Steve Jobs",
      "💫 'Your time is limited, don't waste it living someone else's life.' – Steve Jobs",
      "🚀 'The future belongs to those who believe in the beauty of their dreams.' – Eleanor Roosevelt",
      "🌱 'The only impossible journey is the one you never begin.' – Tony Robbins"
    ];
    return json(200, { ok: true, reply: quotes[Math.floor(Math.random() * quotes.length)] });
  }

  // Generate AI response using Groq
  let aiResult = null;
  let providerUsed = 'groq';
  try {
    aiResult = await generateSupportReply({ userMessage, userId });
  } catch (error) {
    console.error('[ai-support-assistant] provider failure', error);
    providerUsed = 'rule_based_fallback';
    aiResult = getFallbackReply(userMessage);
  }

  const safeReply = aiResult.reply;

  // Log to Firestore if available
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

async function generateSupportReply({ userMessage, userId }) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const baseUrl = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is missing');
  }

  // Comprehensive Starlife knowledge base
  const knowledgeBase = `
STARLIFE KNOWLEDGE BASE (UPDATED DEC 2024):

=== INVESTMENTS ===
- Minimum investment: $10 USD
- Maximum investment: $800,000 USD
- Daily profit: 2% of active investment (credited daily)
- Example: $100 investment earns $2 every day
- Investments are approved by admin within 24 hours
- Auto-reinvest feature: automatically reinvest a percentage of daily profits

=== WITHDRAWALS ===
- Minimum withdrawal: $10 USD
- Processing fee: 10%
- Example: withdrawing $100 → $10 fee, you receive $90
- Withdrawals require KYC verification (submit ID photo)
- Withdrawals require 6-digit PIN (set in Profile)
- Processing time: within 24 hours after admin approval

=== SHAREHOLDER PROGRAM ===
- Minimum stake: $25 USD
- Annual profit pool: $2,000,000
- Earnings: proportional to your stake ÷ total stake × daily pool
- Lock period: 6 months from first stake (cannot withdraw earnings before lock expires)
- Stake from main balance, approved by admin

=== REFERRAL PROGRAM ===
- Level 1: 10% of referral's first investment
- Level 2: 5% of referral's first investment (referral's referrer)
- Level 3: 2% of referral's first investment
- Bonus paid only on the FIRST investment of each referred user
- Share your referral code or link: https://starlifeadvert.netlify.app/?ref=YOUR_CODE

=== SAVINGS WALLET ===
- Minimum deposit: $10
- Lock period: 30 days (cannot withdraw early)
- Daily profit: 3% (higher than regular investments)
- After 30 days: withdraw principal + profit
- Savings Vault: lock for 30/60/90 days with bonus (5%/8%/12%)

=== LOANS ===
- Loan limit: total invested + shareholder stake
- Terms: 7 days (10% interest), 14 days (20% interest), 30 days (30% interest)
- Interest deducted upfront from loan amount
- Late fee: 5% every 7 days overdue
- Default limit: after 3 defaults, loan access restricted

=== DEPOSIT METHODS ===
- M-Pesa: Till Number 6034186 (Business: Starlife Advert Us Agency)
- PayPal: starlife.payment@starlifeadvert.com
- USDT: Contact support for wallet address
- Bank Transfer: Contact support for details
- Promo codes available (apply before deposit)

=== KYC VERIFICATION ===
- Required before first withdrawal
- Upload national ID, passport, or driver's license photo
- Processing time: within 24 hours
- Status: pending → approved/rejected
- Rejected: resubmit clearer photo

=== VERIFICATION BADGE ===
- Blue verified badge benefits
- Free: invest $100+ OR refer 50+ active members
- Paid: $10/month (auto-deducted from balance)
- Cancel anytime from Profile

=== REWARDS & GAMES ===
- Daily Check-in: +5 points (streak bonuses at 7 and 30 days)
- Spin Wheel: win points or cash (one spin per day)
- Scratch Card: 3 boxes, match all 3 to win (one per day)
- Lucky Draw: buy tickets with points or $0.50 each, 80% goes to prize pool
- Prize Codes: redeem for cash (shared by admin)

=== SURVEY POINTS ===
- Earn points by completing surveys
- Redeem: 1000pts = $1.00, 2000pts = $2.00, 5000pts = $5.00
- Redemption requests approved by admin within 24 hours

=== TRANSFER / GIFT ===
- Send cash (5% fee deducted from receiver) or points (free)
- Minimum: $1 cash or 10 points
- Requires recipient's Member ID (first 8 characters of UID)
- Requires withdrawal PIN for confirmation

=== P2P TRADING ===
- Post ads to buy or sell USD
- 5% fee on seller's USD
- 15-minute payment window
- Dispute resolution by admin

=== COMMUNITY ===
- Anonymous posts and comments
- Groups: create or join, chat with members
- Posts and groups require admin approval first

=== AGENT PROGRAM ===
- Monthly salary + secretary allowance
- Company-sponsored office in your region
- Higher referral commissions
- Performance ranks: Bronze, Silver, Gold, Elite

=== SUPPORT ===
- Email: support@starlifeadvert.com
- Ticket system: create ticket from Support tab
- Response time: within 24 hours
- Urgent issues escalated to admin

=== BIRTHDAY BONUS ===
- Set your birthday in Profile
- Get $5 bonus every year on your birthday

=== MINIMUMS & LIMITS ===
- Investment: $10 - $800,000
- Withdrawal: $10
- Stake: $25
- Savings: $10
- Loan: $1 (up to your limit)
- Transfer cash: $1
- Transfer points: 10 pts

=== CONTACT INFO ===
- Support email: support@starlifeadvert.com
- Payment email: starlife.payment@starlifeadvert.com
- M-Pesa Till: 6034186
`;

  const systemPrompt = `You are Emy, a warm, enthusiastic, and highly engaging AI assistant for Starlife Advert.

PERSONALITY RULES:
- Be cheerful, encouraging, and conversational – like a close friend helping a family member
- Use occasional emojis 😊, but not too many (1-2 per response max)
- Always ask one relevant follow-up question naturally (e.g., "Would you like me to walk you through that?")
- Never sound robotic, formal, or rushed
- Keep responses friendly and under 3-4 sentences unless the user asks for details
- If the user seems frustrated, apologize warmly and offer to create a support ticket
- If the user is just chatting (hello, how are you, tell me a joke), respond playfully
- For support questions (deposit, withdraw, invest, KYC, loans, referrals), give clear step-by-step guidance but keep it friendly
- NEVER claim to directly change balances, approve loans, process withdrawals, or close sensitive cases
- For risky/account-specific complaints, reply carefully, recommend human review, and avoid promises

KNOWLEDGE BASE (Starlife platform):
${knowledgeBase}

USER QUESTION: ${userMessage}

Now respond to the user's message naturally, helpfully, and warmly. Remember to be human-like and engaging!`;

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
    return { reply: "⭐ Our Agent Program offers monthly salary, secretary allowance, and a company-sponsored office! Performance ranks: Bronze, Silver, Gold, Elite. Interested in becoming an agent? Contact support@starlifeadvert.com 🚀", category: 'agent' };
  }
  if (lower.includes('contact') || lower.includes('support') || lower.includes('help')) {
    return { reply: "📧 Need human support? Email support@starlifeadvert.com or open a ticket from the Support tab. We typically respond within 24 hours. For urgent issues, mention 'urgent' in your message. How can I help you today? 🎧", category: 'support' };
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

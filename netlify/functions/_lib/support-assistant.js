const KB_TOPICS = {
  what_is_starlife: {
    title: 'What is Starlife',
    guidance: 'Starlife is a financial platform where members can fund wallets, invest in available plans, earn points, use referrals, and request loans when eligible.'
  },
  deposit: {
    title: 'How to deposit',
    guidance: 'Deposit flow: open Wallet/Deposit page, choose a payment channel, confirm amount, make payment, then wait for confirmation and balance update.'
  },
  withdraw: {
    title: 'How to withdraw',
    guidance: 'Withdrawal flow: ensure KYC and withdrawal details are complete, open Withdraw, enter amount, confirm, and monitor withdrawal status/history.'
  },
  invest: {
    title: 'How to invest',
    guidance: 'Investment flow: review available plan details, confirm amount and duration/terms, submit investment, and track active/completed investments.'
  },
  referrals: {
    title: 'How referrals work',
    guidance: 'Referral rewards are earned when invited users register and complete eligible activities as defined by platform rules.'
  },
  loans: {
    title: 'How loans work',
    guidance: 'Loan eligibility, limits, repayment schedules, and penalties are controlled by platform policy and account eligibility checks.'
  },
  points: {
    title: 'How points work',
    guidance: 'Points are earned through platform activity and can impact rank, rewards, or eligibility depending on current Starlife rules.'
  },
  kyc: {
    title: 'KYC and identity help',
    guidance: 'KYC requires valid identity/profile details. Mismatched data can delay transactions until support verifies and resolves it.'
  },
  support: {
    title: 'Agent/support help',
    guidance: 'Users can contact support for account-specific issues. Sensitive actions are handled by human support/admin only.'
  },
  official_support: {
    title: 'Official support contacts',
    guidance: 'Official support email is support@starlifeadvert.com. Official payment email shown on platform deposit section is starlife.payment@starlifeadvert.com.'
  },
  deposit_methods: {
    title: 'Configured deposit methods',
    guidance: 'Configured deposit methods shown in platform UI: M-Pesa, PayPal, USDT (BEP20), USDT (TRC20).'
  },
  withdrawal_methods: {
    title: 'Configured withdrawal methods',
    guidance: 'Configured withdrawal methods shown in platform UI: M-Pesa, Bank Transfer, PayPal, USDT (BEP20), USDT (TRC20).'
  },
  security_guidance: {
    title: 'Security guidance',
    guidance: 'Never share password, OTP, seed phrase, PIN, or payment credentials. Report suspicious account activity immediately.'
  },
  ticket_workflow: {
    title: 'Ticket workflow',
    guidance: 'For account-specific issues, Emy can log a ticket. Users can track updates in My Tickets and continue the same conversation with human support.'
  }
};

const EMY_PERSONALITY = {
  identity: 'Emy, Starlife Support Assistant',
  tone: 'warm, calm, professional, helpful, human',
  style: 'short conversational replies, practical next-step guidance, empathetic support when needed'
};

const SMALL_TALK_PATTERNS = {
  hello: "Hi 👋 I’m Emy. How can I help you today?",
  how_are_you: 'I’m good, thanks for asking 😊 How can I help you with Starlife today?',
  thanks: 'You’re welcome 😊',
  bye: 'You’re welcome. Have a great day 👋',
  okay: 'Great 👍 Tell me what you see next and I’ll guide you.'
};

const FAQ_CATEGORY_KEYWORDS = [
  { category: 'what_is_starlife', keywords: ['what is starlife', 'about starlife', 'starlife platform'] },
  { category: 'deposit', keywords: ['deposit', 'fund wallet', 'add money', 'top up'] },
  { category: 'withdraw', keywords: ['withdraw', 'cash out', 'withdrawal'] },
  { category: 'invest', keywords: ['invest', 'investment', 'plan'] },
  { category: 'referrals', keywords: ['referral', 'invite', 'downline'] },
  { category: 'loans', keywords: ['loan', 'borrow', 'repayment'] },
  { category: 'points', keywords: ['point', 'reward point', 'rank points'] },
  { category: 'kyc', keywords: ['kyc', 'verification', 'verify identity', 'id mismatch'] },
  { category: 'support', keywords: ['support', 'agent', 'customer care', 'help desk'] }
];

const HIGH_RISK_TRIGGERS = [
  'missing balance',
  'failed withdrawal',
  'duplicate investment',
  'unauthorized loan',
  'kyc mismatch',
  'security',
  'fraud',
  'repeated deduction',
  'repeated deductions',
  'deducted twice',
  'money disappeared',
  'account hacked'
];

const RESPONSE_STYLES = {
  greeting: 'Hello! Welcome to Starlife Support. I can help with deposits, withdrawals, investments, loans, points, referrals, KYC, and support guidance.',
  faq: 'Use a professional, calm, confident tone. Keep reply short. Structure as: 1) direct answer, 2) key steps, 3) short next action.',
  support_issue: 'Use a calm support tone. Acknowledge issue briefly, give safe checks, and state that support review may be required.',
  high_risk_escalation: 'Use urgent but calm tone. Confirm escalation, avoid promises, ask user to monitor ticket updates.',
  human_handover: 'Use clear handover language. Confirm ticket created and that a human support agent will continue.',
  out_of_scope: 'Politely refuse non-Starlife topics and redirect user to Starlife platform/support questions only.'
};

function normalizeText(value = '') {
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectUserTone(message = '') {
  const normalized = normalizeText(message);
  if (!normalized) return 'friendly';

  const thankful = ['thanks', 'thank you', 'appreciate', 'grateful'];
  const frustrated = ['angry', 'frustrated', 'terrible', 'useless', 'annoyed', 'fed up'];
  const worried = ['worried', 'concerned', 'scared', 'stressed', 'anxious'];
  const upset = ['upset', 'sad'];
  const confused = ['confused', "don't understand", 'not sure', 'how does this work', 'explain'];

  if (thankful.some((x) => normalized.includes(x))) return 'thankful';
  if (frustrated.some((x) => normalized.includes(x)) || /!{2,}/.test(message)) return 'frustrated';
  if (worried.some((x) => normalized.includes(x))) return 'worried';
  if (upset.some((x) => normalized.includes(x))) return 'upset';
  if (confused.some((x) => normalized.includes(x)) || normalized.includes('?')) return 'confused';
  return 'friendly';
}

function detectHighRiskTriggers(message) {
  const normalized = normalizeText(message);
  return HIGH_RISK_TRIGGERS.filter((trigger) => normalized.includes(trigger));
}

function inferFaqCategory(message) {
  const normalized = normalizeText(message);

  for (const item of FAQ_CATEGORY_KEYWORDS) {
    if (item.keywords.some((keyword) => normalized.includes(keyword))) {
      return item.category;
    }
  }

  return 'general_guidance';
}

function buildKnowledgeBaseText() {
  return Object.values(KB_TOPICS)
    .map((topic) => `- ${topic.title}: ${topic.guidance}`)
    .join('\n');
}

function styleForIntent({ inScope, intentType, severity, forceHuman }) {
  if (!inScope) return RESPONSE_STYLES.out_of_scope;
  if (forceHuman) return RESPONSE_STYLES.human_handover;
  if (severity === 'high' || severity === 'critical') return RESPONSE_STYLES.high_risk_escalation;
  if (intentType === 'complaint') return RESPONSE_STYLES.support_issue;
  return RESPONSE_STYLES.faq;
}

module.exports = {
  KB_TOPICS,
  EMY_PERSONALITY,
  SMALL_TALK_PATTERNS,
  HIGH_RISK_TRIGGERS,
  RESPONSE_STYLES,
  detectHighRiskTriggers,
  inferFaqCategory,
  buildKnowledgeBaseText,
  styleForIntent,
  detectUserTone,
  normalizeText
};

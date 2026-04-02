const { getDb, admin } = require('./_lib/firebase');
const { sendTelegramMessage } = require('./_lib/telegram');
const {
  detectHighRiskTriggers,
  inferFaqCategory,
  buildKnowledgeBaseText,
  RESPONSE_STYLES,
  styleForIntent,
  detectUserTone,
  EMY_PERSONALITY,
  SMALL_TALK_PATTERNS
} = require('./_lib/support-assistant');

const SUPPORTED_TOPICS = [
  'what_is_starlife',
  'deposit',
  'withdraw',
  'invest',
  'referrals',
  'loans',
  'points',
  'kyc',
  'support',
  'general_guidance'
];

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
  const db = getDb();
  console.log('[ai-support-assistant] request received', {
    userId,
    memberId,
    forceHuman: Boolean(payload.forceHuman),
    messagePreview: userMessage.slice(0, 140)
  });

  const highRiskMatches = detectHighRiskTriggers(userMessage);
  const fallbackCategory = inferFaqCategory(userMessage);
  const forceHuman = Boolean(payload.forceHuman);
  const userTone = detectUserTone(userMessage);
  const sessionState = sanitizeSessionState(payload.sessionState);

  let aiResult = null;
  let modelFailureReason = null;
  let providerUsed = 'rule_based_fallback';
  const localReply = buildStatefulLocalReply({ userMessage, sessionState, fallbackCategory, highRiskMatches });
  if (localReply) {
    aiResult = localReply;
    providerUsed = 'stateful_local';
    console.log('[ai-support-assistant] local stateful reply selected', {
      category: localReply.category,
      severity: localReply.severity
    });
  } else {
    try {
      aiResult = await generateSupportReply({
        userMessage,
        highRiskMatches,
        fallbackCategory,
        forceHuman,
        userTone,
        sessionState
      });
      providerUsed = 'groq';
    } catch (error) {
      modelFailureReason = error.message;
      console.error('[ai-support-assistant] provider failure', { modelFailureReason });
    }
  }

  const normalizedResult = normalizeAiResult({
    aiResult,
    userMessage,
    fallbackCategory,
    highRiskMatches,
    forceHuman,
    modelFailureReason,
    userTone
  });

  const inScope = normalizedResult.in_scope;
  const initialCategory = sanitizeCategory(normalizedResult.category);
  const isComplaint = normalizedResult.intent_type === 'complaint' || highRiskMatches.length > 0 || forceHuman;

  const category = !inScope
    ? 'out_of_scope'
    : (initialCategory || inferFaqCategory(userMessage));

  const severity = decideSeverity({
    inScope,
    isComplaint,
    modelSeverity: normalizedResult.severity,
    highRiskMatches,
    forceHuman
  });

  const shouldCreateTicket = inScope && (isComplaint || severity !== 'low' || forceHuman || highRiskMatches.length > 0);
  const shouldAlertAdmin = ['high', 'critical'].includes(severity) && highRiskMatches.length > 0;

  const safeReply = inScope
    ? formatResponse({ body: normalizedResult.reply })
    : formatOutOfScopeReply();

  const logDoc = {
    userId,
    memberId,
    userMessage,
    aiReply: safeReply,
    category,
    severity,
    highRiskMatches,
    adminAlertTriggered: shouldAlertAdmin,
    ticketCreated: shouldCreateTicket,
    forceHuman,
    responseStyle: styleForIntent({ inScope, intentType: normalizedResult.intent_type, severity, forceHuman }),
    modelFailureReason,
    userTone,
    intentType: isComplaint ? 'complaint' : 'faq',
    inScope,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const logRef = await db.collection('ai_support_logs').add(logDoc);

  let ticketId = null;
  let ticketDocId = null;
  let supportTicketId = null;
  let telegramAlertError = null;
  if (shouldCreateTicket) {
    ticketId = `TK-${Date.now().toString(36).toUpperCase()}`;
    const baseTicketPayload = {
      userId,
      memberId,
      ticketId,
      category,
      severity,
      source: 'ai_support_assistant',
      logId: logRef.id,
      status: 'open',
      highRiskMatches,
      forceHuman,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const ticketRef = await db.collection('tickets').add({
      ...baseTicketPayload,
      uid: userId,
      subject: `AI Support: ${category.replace(/_/g, ' ')}`,
      messages: [
        { from: 'user', name: memberId || userId, text: userMessage, time: new Date().toISOString() },
        { from: 'ai', name: 'Starlife AI', text: safeReply, time: new Date().toISOString() }
      ],
      aiReply: safeReply
    });
    ticketDocId = ticketRef.id;

    const supportTicketRef = await db.collection('support_tickets').add({
      ...baseTicketPayload,
      userMessage,
      aiReply: safeReply
    });
    supportTicketId = supportTicketRef.id;
  }

  if (shouldAlertAdmin) {
    const alertMessage = [
      '🚨 <b>Starlife AI High-Risk Support Alert</b>',
      `User: <b>${memberId || userId}</b>`,
      `Severity: <b>${severity.toUpperCase()}</b>`,
      `Category: <b>${category}</b>`,
      `Triggers: ${highRiskMatches.join(', ')}`,
      '',
      `<b>Message</b>: ${escapeHtml(userMessage)}`,
      ticketId ? `Ticket ID: <b>${ticketId}</b> (${ticketDocId || 'n/a'})` : ''
    ].filter(Boolean).join('\n');
    try {
      await sendTelegramMessage(alertMessage);
    } catch (error) {
      telegramAlertError = error.message;
<<<<<<< codex/add-ai-support-assistant-for-starlife-2paxar
      console.error('[ai-support-assistant] telegram alert failed', { telegramAlertError });
    }
  }

  console.log('[ai-support-assistant] response summary', {
    providerUsed,
    fallbackUsed: Boolean(modelFailureReason),
    modelFailureReason,
    telegramAlertError,
    replyPreview: safeReply.slice(0, 220),
    category,
    severity,
    ticketId
  });

=======
    }
  }

>>>>>>> main
  return json(200, {
    ok: true,
    reply: safeReply,
    category,
    severity,
    adminAlertTriggered: shouldAlertAdmin,
    ticketId,
    ticketDocId,
    supportTicketId,
    fallbackUsed: Boolean(modelFailureReason),
    modelFailureReason,
    telegramAlertError,
    providerUsed,
    defaultGreeting: "Hi 👋 I’m Emy, Starlife Support Assistant. How can I help you today?",
    supportedTopics: SUPPORTED_TOPICS
    ,
    sessionState: aiResult?.session_state || sessionState
  });
};

function decideSeverity({ inScope, isComplaint, modelSeverity, highRiskMatches, forceHuman }) {
  if (!inScope) return 'low';
  if (highRiskMatches.length > 0) return highRiskMatches.length >= 2 ? 'critical' : 'high';
  if (forceHuman && !['high', 'critical'].includes(modelSeverity)) return 'medium';

  const severity = String(modelSeverity || '').toLowerCase();
  if (['low', 'medium', 'high', 'critical'].includes(severity)) {
    return severity;
  }

  return isComplaint ? 'medium' : 'low';
}

function sanitizeCategory(category) {
  const normalized = String(category || '').toLowerCase().trim();
  if (SUPPORTED_TOPICS.includes(normalized)) return normalized;
  return null;
}

async function generateSupportReply({ userMessage, highRiskMatches, fallbackCategory, userTone, sessionState }) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const baseUrl = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is missing');
  }

  const knowledgeBase = buildKnowledgeBaseText();

  const systemPrompt = [
<<<<<<< codex/add-ai-support-assistant-for-starlife-2paxar
=======
<<<<<<< codex/add-ai-support-assistant-for-starlife-as6mo8
>>>>>>> main
    `You are ${EMY_PERSONALITY.identity}.`,
    `Tone must always be ${EMY_PERSONALITY.tone}.`,
    `Style must be ${EMY_PERSONALITY.style}.`,
    `If user says hi/hello/hey, greet naturally: "${SMALL_TALK_PATTERNS.hello}"`,
<<<<<<< codex/add-ai-support-assistant-for-starlife-2paxar
=======
=======
    'You are Emy, Starlife Support Assistant.',
    'Tone must always be human, warm, calm, professional, and helpful.',
    'If user says hi/hello/hey, greet naturally: "Hi 👋 I’m Emy, Starlife Support Assistant. How can I help you today?"',
>>>>>>> main
>>>>>>> main
    'For platform help requests, guide users step-by-step instead of always giving full instructions at once.',
    'Give the next step, ask what they see on screen, and wait for their response before continuing.',
    'Keep responses short, clear, and conversational.',
    'Adjust tone for friendly, confused, upset, frustrated, or thankful users without sounding fake.',
    'Use polite closings where appropriate: "You’re welcome.", "I’m glad I could help.", "Please check My Tickets for updates.", "Have a great day."',
    'You only answer Starlife platform support and guidance.',
    'Allowed topics: what is starlife, deposits, withdrawals, investments, referrals, loans, points, kyc, support, and general platform guidance.',
    'If user asks unrelated topic, set in_scope=false and provide a brief refusal.',
    'Never claim to directly change balances, approve loans, process withdrawals, modify investments, or close sensitive cases.',
    'For risky/account-specific complaints, reply carefully, recommend human review, and avoid promises.',
    'Output valid JSON only matching the schema.'
  ].join(' ');

  const userPrompt = {
    user_message: userMessage,
    user_tone: userTone,
    session_state: sessionState,
    high_risk_matches: highRiskMatches,
    fallback_category: fallbackCategory,
    knowledge_base: knowledgeBase
  };

  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPrompt) }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'starlife_support_result',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              in_scope: { type: 'boolean' },
              intent_type: { type: 'string', enum: ['faq', 'complaint'] },
              category: {
                type: 'string',
                enum: [...SUPPORTED_TOPICS, 'out_of_scope']
              },
              severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              reply: { type: 'string' },
              session_state: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  activeTask: { type: ['string', 'null'], enum: ['deposit', 'withdraw', 'invest', 'kyc', 'referrals', 'loans', null] },
                  step: { type: 'integer' },
                  lastInstruction: { type: 'string' },
                  status: { type: 'string', enum: ['idle', 'guiding', 'stuck'] }
                },
                required: ['activeTask', 'step', 'lastInstruction', 'status']
              }
            },
            required: ['in_scope', 'intent_type', 'category', 'severity', 'reply']
          }
        }
      }
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Groq API error: ${response.status}`);
  }

  const content = data.output_text;
  if (!content) {
    throw new Error('OpenAI did not return output_text');
  }

  return JSON.parse(content);
}

function normalizeAiResult({ aiResult, userMessage, fallbackCategory, highRiskMatches, forceHuman, modelFailureReason, userTone }) {
  if (!aiResult || typeof aiResult !== 'object') {
    return buildFallbackModelResult({ userMessage, fallbackCategory, highRiskMatches, forceHuman, modelFailureReason, userTone });
  }

  const inScope = typeof aiResult.in_scope === 'boolean'
    ? aiResult.in_scope
    : true;
  const intentType = aiResult.intent_type === 'complaint' || highRiskMatches.length > 0 || forceHuman
    ? 'complaint'
    : 'faq';
  const category = sanitizeCategory(aiResult.category) || fallbackCategory;
  const severity = ['low', 'medium', 'high', 'critical'].includes(String(aiResult.severity || '').toLowerCase())
    ? String(aiResult.severity).toLowerCase()
    : (intentType === 'complaint' ? 'medium' : 'low');
  const reply = String(aiResult.reply || '').trim() || buildFallbackReply({
    userMessage,
    inScope,
    intentType,
    forceHuman,
    modelFailureReason,
    fallbackCategory: category,
    highRiskMatches,
    userTone
  });

  return {
    in_scope: inScope,
    intent_type: intentType,
    category,
    severity,
    reply,
    session_state: sanitizeSessionState(aiResult.session_state)
  };
}

function buildFallbackModelResult({ userMessage, fallbackCategory, highRiskMatches, forceHuman, modelFailureReason, userTone }) {
  const normalized = String(userMessage || '').toLowerCase();
  const inScope = normalized.includes('starlife') || fallbackCategory !== 'general_guidance' || highRiskMatches.length > 0 || forceHuman;
  const complaintHints = ['issue', 'problem', 'failed', 'error', 'pending', 'not working', 'help', 'deducted', 'missing', 'hacked'];
  const hasComplaintHint = complaintHints.some((hint) => normalized.includes(hint));
  const intentType = highRiskMatches.length > 0 || forceHuman || hasComplaintHint ? 'complaint' : 'faq';
  return {
    in_scope: inScope,
    intent_type: intentType,
    category: inScope ? fallbackCategory : 'out_of_scope',
    severity: highRiskMatches.length > 0 ? 'high' : (intentType === 'complaint' ? 'medium' : 'low'),
    reply: buildFallbackReply({
      userMessage,
      inScope,
      intentType,
      forceHuman,
      modelFailureReason,
      fallbackCategory,
      highRiskMatches,
      userTone
    }),
    session_state: sanitizeSessionState(null)
  };
}

function buildFallbackReply({
  userMessage,
  inScope,
  intentType,
  forceHuman,
  modelFailureReason,
  fallbackCategory,
  highRiskMatches,
  userTone
}) {
  const category = sanitizeCategory(fallbackCategory) || 'general_guidance';
  const highRisk = Array.isArray(highRiskMatches) && highRiskMatches.length > 0;
  const tonePrefix = tonePrefixFor(userTone);
  const trimmed = String(userMessage || '').trim();
  const isGreetingOnly = /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(trimmed);
  const asksHowAreYou = /\b(how are you|how're you|how r u)\b/i.test(trimmed);
  const guidedRequest = isGuidedSupportRequest(category, trimmed);

  if (!inScope) return formatOutOfScopeReply();
  if (isGreetingOnly) {
    return "Hi 👋 I’m Emy, Starlife Support Assistant. How can I help you today?";
  }
  if (asksHowAreYou) {
<<<<<<< codex/add-ai-support-assistant-for-starlife-2paxar
    return SMALL_TALK_PATTERNS.how_are_you;
=======
<<<<<<< codex/add-ai-support-assistant-for-starlife-as6mo8
    return SMALL_TALK_PATTERNS.how_are_you;
=======
    return 'I’m doing well, thank you 😊 I’m here and ready to help with your Starlife account. What would you like to do first?';
>>>>>>> main
>>>>>>> main
  }
  if (forceHuman) {
    return `${tonePrefix}I’ve handed this over to a human support agent. A support ticket has been created. Please check My Tickets for updates.`;
  }
  if (highRisk) {
    return `${tonePrefix}I understand why this feels serious, and I’m treating it as urgent. A support ticket has been created and our team will review it as quickly as possible. Please check My Tickets for updates.`;
  }
  if (intentType === 'complaint') {
    const reason = modelFailureReason ? ' (AI is temporarily unavailable)' : '';
    return `${tonePrefix}I understand your concern. I’ve logged this for support review${reason}. Please check My Tickets for updates and share any transaction ID or screenshot so we can resolve it faster.`;
  }
  if (guidedRequest) {
    return `${tonePrefix}${buildGuidedSupportReply(category, trimmed)}`;
  }

  const faqAnswer = getRuleBasedFaqFallback(category, userMessage);
  if (faqAnswer) return `${tonePrefix}${faqAnswer}`;

<<<<<<< codex/add-ai-support-assistant-for-starlife-2paxar
  return `${tonePrefix}I’m here to help with Starlife support. Tell me what you’re trying to do, and I’ll guide you step by step.`;
=======
<<<<<<< codex/add-ai-support-assistant-for-starlife-as6mo8
  return `${tonePrefix}I’m here to help with Starlife support. Tell me what you’re trying to do, and I’ll guide you step by step.`;
=======
  return `${tonePrefix}I can assist with Starlife support and platform guidance. Please ask about deposits, withdrawals, investments, referrals, loans, points, KYC, or support.`;
>>>>>>> main
>>>>>>> main
}

function getRuleBasedFaqFallback(category, userMessage) {
  const normalized = String(userMessage || '').toLowerCase();
  const categoryResponses = {
    what_is_starlife: 'Starlife is a platform where users can fund wallets, invest, earn points, use referrals, and access support features based on platform rules.',
    deposit: 'To deposit, go to the Deposit section, choose your payment method, enter the amount, and follow the instructions shown.',
    withdraw: 'To withdraw, open the Withdraw section, enter the amount, confirm the request, and wait for processing.',
    invest: 'To invest, open the Invest section, choose a package, and confirm the amount.',
    referrals: 'Use your referral link or code to invite others. Referral rewards apply according to the platform rules.',
    loans: 'To request a loan, open the Loan section, check eligibility, choose your preferred term, and submit your request.',
    points: 'Points are earned from platform activities and can affect rewards or eligibility based on current Starlife rules.',
    kyc: 'KYC review may take some time. Make sure your submitted documents are clear, valid, and match your account details.',
<<<<<<< codex/add-ai-support-assistant-for-starlife-2paxar
    support: 'For support, open the Support page or use Talk to human. You can track replies in My Tickets. Official support email is support@starlifeadvert.com.',
    general_guidance: 'I can help with Starlife deposits, withdrawals, investments, referrals, loans, points, KYC, security, and support tickets.'
=======
<<<<<<< codex/add-ai-support-assistant-for-starlife-as6mo8
    support: 'For support, open the Support page or use Talk to human. You can track replies in My Tickets. Official support email is support@starlifeadvert.com.',
    general_guidance: 'I can help with Starlife deposits, withdrawals, investments, referrals, loans, points, KYC, security, and support tickets.'
=======
    support: 'For support, open the Support page or use Talk to human. You can track responses in My Tickets. Official support email is support@starlifeadvert.com.',
    general_guidance: 'I can help with Starlife deposits, withdrawals, investments, referrals, loans, points, KYC, and support guidance.'
>>>>>>> main
>>>>>>> main
  };

  if (categoryResponses[category]) return categoryResponses[category];

  if (normalized.includes('kyc') || normalized.includes('verify')) return categoryResponses.kyc;
  if (normalized.includes('deposit') || normalized.includes('fund')) return categoryResponses.deposit;
  if (normalized.includes('withdraw')) return categoryResponses.withdraw;
  if (normalized.includes('invest')) return categoryResponses.invest;
  if (normalized.includes('referral') || normalized.includes('invite')) return categoryResponses.referrals;
  if (normalized.includes('loan')) return categoryResponses.loans;
  if (normalized.includes('point')) return categoryResponses.points;
  if (normalized.includes('support') || normalized.includes('agent')) return categoryResponses.support;
  if (normalized.includes('official email') || normalized.includes('support email')) return 'Official Starlife support email is support@starlifeadvert.com. For payment email on deposit page, use starlife.payment@starlifeadvert.com.';
  if (normalized.includes('deposit method') || normalized.includes('how to deposit')) return 'Deposit methods currently shown in Starlife are M-Pesa, PayPal, USDT (BEP20), and USDT (TRC20).';
  if (normalized.includes('withdrawal method') || normalized.includes('how to withdraw')) return 'Withdrawal methods currently shown in Starlife are M-Pesa, Bank Transfer, PayPal, USDT (BEP20), and USDT (TRC20).';
  if (normalized.includes('security') || normalized.includes('hacked') || normalized.includes('fraud')) return 'For security, never share your password, OTP, PIN, or seed phrase. Report suspicious activity immediately through Support so it can be escalated.';
  if (normalized.includes('what is starlife') || normalized.includes('about starlife')) return categoryResponses.what_is_starlife;

  return categoryResponses.general_guidance;
}

function formatResponse({ body }) {
  const conciseBody = String(body || '').trim();
  if (!conciseBody) return 'Thanks for reaching out. Please share your Starlife question and I will guide you.';
  return conciseBody;
}

function formatOutOfScopeReply() {
  return 'Hi, I’m Emy 👋 I mostly handle Starlife support and platform guidance. If you want, I can help with deposits, withdrawals, investments, referrals, loans, points, KYC, or support tickets.';
}

function tonePrefixFor(userTone) {
  const tone = String(userTone || 'friendly');
  if (tone === 'thankful') return 'You’re welcome. ';
  if (tone === 'frustrated') return 'I understand this is frustrating. ';
  if (tone === 'upset') return 'I’m sorry you’re dealing with this. ';
  if (tone === 'worried') return 'I understand this can feel worrying. ';
  if (tone === 'confused') return 'No worries — I can clarify this. ';
  return '';
}

function sanitizeSessionState(raw) {
  const allowedTasks = new Set(['deposit', 'withdraw', 'invest', 'kyc', 'referrals', 'loans']);
  const base = {
    activeTask: null,
    step: 0,
    lastInstruction: '',
    status: 'idle'
  };
  if (!raw || typeof raw !== 'object') return base;
  const task = allowedTasks.has(raw.activeTask) ? raw.activeTask : null;
  const step = Number.isFinite(Number(raw.step)) ? Math.max(0, Math.min(10, Number(raw.step))) : 0;
  const status = ['idle', 'guiding', 'stuck'].includes(raw.status) ? raw.status : 'idle';
  return {
    activeTask: task,
    step,
    lastInstruction: String(raw.lastInstruction || ''),
    status
  };
}

function buildStatefulLocalReply({ userMessage, sessionState, fallbackCategory, highRiskMatches }) {
  const text = String(userMessage || '').trim();
  const normalized = text.toLowerCase();
  const isHighRisk = highRiskMatches.length > 0;
  if (isHighRisk) return null;

  const smallTalk = handleSmallTalk(normalized);
  if (smallTalk) {
    return {
      in_scope: true,
      intent_type: 'faq',
      category: 'support',
      severity: 'low',
      reply: smallTalk,
      session_state: sessionState
    };
  }

  const activeTask = sessionState.activeTask;
  const shortFollowUp = /^(yes|no|done|next|what now|ok|okay|i can't see it|cant see it|i cannot see it)$/i.test(normalized);
  if (activeTask && (shortFollowUp || normalized.startsWith('i see'))) {
    const progress = nextGuidedStep(activeTask, sessionState.step, normalized);
    return {
      in_scope: true,
      intent_type: 'faq',
      category: activeTask,
      severity: 'low',
      reply: progress.reply,
      session_state: progress.sessionState
    };
  }

  const guidedTask = detectGuidedTask(normalized, fallbackCategory);
  if (guidedTask) {
    const start = startGuidedFlow(guidedTask);
    return {
      in_scope: true,
      intent_type: 'faq',
      category: guidedTask,
      severity: 'low',
      reply: start.reply,
      session_state: start.sessionState
    };
  }

  return null;
}

function handleSmallTalk(normalized) {
<<<<<<< codex/add-ai-support-assistant-for-starlife-2paxar
=======
<<<<<<< codex/add-ai-support-assistant-for-starlife-as6mo8
>>>>>>> main
  if (/^(hi|hello|hey)\b/.test(normalized)) return SMALL_TALK_PATTERNS.hello;
  if (/\b(how are you|how're you|how r u)\b/.test(normalized)) return SMALL_TALK_PATTERNS.how_are_you;
  if (/^(thanks|thank you|thx)\b/.test(normalized)) return SMALL_TALK_PATTERNS.thanks;
  if (/^(bye|goodbye|see you)\b/.test(normalized)) return SMALL_TALK_PATTERNS.bye;
  if (/^(ok|okay|alright)$/.test(normalized)) return SMALL_TALK_PATTERNS.okay;
<<<<<<< codex/add-ai-support-assistant-for-starlife-2paxar
=======
=======
  if (/^(hi|hello|hey)\b/.test(normalized)) return "Hi 👋 I’m Emy. How can I help you today?";
  if (/\b(how are you|how're you|how r u)\b/.test(normalized)) return 'I’m doing well, thank you 😊 How can I help you with Starlife today?';
  if (/^(thanks|thank you|thx)\b/.test(normalized)) return 'You’re welcome 😊 I’m glad I could help.';
  if (/^(bye|goodbye|see you)\b/.test(normalized)) return 'You’re welcome. Have a great day 👋';
  if (/^(ok|okay|alright)$/.test(normalized)) return 'Great 👍 Tell me what you want to do next in Starlife, and I’ll guide you.';
>>>>>>> main
>>>>>>> main
  return null;
}

function detectGuidedTask(normalized, fallbackCategory) {
  if (/\b(guide|walk me|step by step|how do i|help me)\b/.test(normalized) || fallbackCategory !== 'general_guidance') {
    const taskMap = [
      ['deposit', /\bdeposit|top up|fund\b/],
      ['withdraw', /\bwithdraw|cash out\b/],
      ['invest', /\binvest|investment\b/],
      ['kyc', /\bkyc|verify|verification\b/],
      ['referrals', /\breferral|invite\b/],
      ['loans', /\bloan|borrow\b/]
    ];
    for (const [task, pattern] of taskMap) {
      if (pattern.test(normalized) || fallbackCategory === task) return task;
    }
  }
  return null;
}

function startGuidedFlow(task) {
  const starts = {
    deposit: 'Sure 👋 Open the Deposit tab first. Tell me what you see there.',
    withdraw: 'Sure 👋 Open the Withdraw tab first. Tell me what withdrawal methods you can see.',
    invest: 'Sure 👋 Open the Invest tab first and tell me what package options you see.',
    kyc: 'Sure 👋 Open the KYC/Verification section first. Tell me what fields or document prompts are shown.',
    referrals: 'Sure 👋 Open the Referral tab first. Tell me if you can see your referral link/code.',
    loans: 'Sure 👋 Open the Loan tab first and tell me what eligibility or limit you see.'
  };
  return {
    reply: starts[task] || 'Sure 👋 Tell me which screen you are on and I’ll guide you.',
    sessionState: { activeTask: task, step: 1, lastInstruction: starts[task] || '', status: 'guiding' }
  };
}

function nextGuidedStep(task, step, normalized) {
  const cantSee = normalized.includes("can't see") || normalized.includes('cannot see') || normalized.includes('cant see') || normalized === 'no';
  if (cantSee) {
    if (task === 'deposit' && step <= 1) {
      const reply = 'No worries. Look for the row with buttons like Invest, Withdraw, Deposit, and Spin. Do you see the Deposit button there?';
      return { reply, sessionState: { activeTask: 'deposit', step: 1, lastInstruction: reply, status: 'stuck' } };
    }
    const reply = 'No worries — you’re close. Please tell me exactly what buttons or labels you can see now, and I’ll guide you from there.';
    return { reply, sessionState: { activeTask: task, step, lastInstruction: reply, status: 'stuck' } };
  }

  if (normalized === 'yes' || normalized === 'done' || normalized === 'next' || normalized === 'what now' || normalized === 'ok' || normalized === 'okay') {
    if (task === 'deposit' && step <= 1) {
      const reply = 'Great. Tap Deposit, then tell me which payment methods appear.';
      return { reply, sessionState: { activeTask: 'deposit', step: 2, lastInstruction: reply, status: 'guiding' } };
    }
    const reply = 'Perfect. Follow the next on-screen step, then tell me what you see next.';
    return { reply, sessionState: { activeTask: task, step: step + 1, lastInstruction: reply, status: 'guiding' } };
  }

  if (normalized.startsWith('i see')) {
    const reply = 'Perfect. Choose the option you want to use, then tell me what the next screen shows.';
    return { reply, sessionState: { activeTask: task, step: step + 1, lastInstruction: reply, status: 'guiding' } };
  }

  const reply = 'Great progress. Tell me what you see next, and I’ll guide you step by step.';
  return { reply, sessionState: { activeTask: task, step: step + 1, lastInstruction: reply, status: 'guiding' } };
}

function isGuidedSupportRequest(category, message) {
  const normalized = String(message || '').toLowerCase();
  const guidedCategories = new Set(['deposit', 'withdraw', 'invest', 'kyc', 'referrals', 'loans']);
  const asksGuide = /\b(guide|walk me|step by step|how do i|help me)\b/.test(normalized);
  const progressSignals = /\b(i see|i opened|i have opened|done|next|what now|i chose|i selected)\b/.test(normalized);
  return (guidedCategories.has(category) && (asksGuide || progressSignals));
}

function buildGuidedSupportReply(category, message) {
  const normalized = String(message || '').toLowerCase();

  if (/\b(i see|i opened|done|next|what now|i chose|i selected)\b/.test(normalized)) {
    return 'Great — you’re doing well. Follow the next on-screen step and tell me exactly what you see next, then I’ll guide you from there.';
  }

  const flows = {
    deposit: 'Sure 👋 First, open the Deposit tab. Tell me which payment options you can see (for example M-Pesa, PayPal, or USDT).',
    withdraw: 'Sure 👋 First, open the Withdraw tab and enter the amount you want to withdraw. Tell me what withdrawal methods are shown.',
    invest: 'Sure 👋 First, open the Invest tab and choose the package or amount you want. Tell me what options you see next.',
    kyc: 'Sure 👋 First, open the KYC/Verification section. Upload clear, valid documents that match your profile details. Tell me what status appears after submission.',
    referrals: 'Sure 👋 First, open the Referral section and copy your referral link/code. Tell me once you can see it, and I’ll guide you on sharing it correctly.',
    loans: 'Sure 👋 First, open the Loan section and check your eligibility/limit. Tell me what limit or term options you can see next.'
  };

  return flows[category] || 'Sure 👋 Tell me what screen you are on now, and I’ll guide you step by step.';
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

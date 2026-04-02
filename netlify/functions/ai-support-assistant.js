const { getDb, admin } = require('./_lib/firebase');
const { sendTelegramMessage } = require('./_lib/telegram');
const {
  detectHighRiskTriggers,
  inferFaqCategory,
  buildKnowledgeBaseText,
  RESPONSE_STYLES,
  styleForIntent
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

  const highRiskMatches = detectHighRiskTriggers(userMessage);
  const fallbackCategory = inferFaqCategory(userMessage);
  const forceHuman = Boolean(payload.forceHuman);

  let aiResult = null;
  let modelFailureReason = null;
  try {
    aiResult = await generateSupportReply({
      userMessage,
      highRiskMatches,
      fallbackCategory,
      forceHuman
    });
  } catch (error) {
    modelFailureReason = error.message;
  }

  const normalizedResult = normalizeAiResult({
    aiResult,
    userMessage,
    fallbackCategory,
    highRiskMatches,
    forceHuman,
    modelFailureReason
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
    intentType: isComplaint ? 'complaint' : 'faq',
    inScope,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const logRef = await db.collection('ai_support_logs').add(logDoc);

  let ticketId = null;
  let ticketDocId = null;
  let supportTicketId = null;
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

    await sendTelegramMessage(alertMessage);
  }

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
    defaultGreeting: RESPONSE_STYLES.greeting,
    supportedTopics: SUPPORTED_TOPICS
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

async function generateSupportReply({ userMessage, highRiskMatches, fallbackCategory }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const knowledgeBase = buildKnowledgeBaseText();

  const systemPrompt = [
    'You are Starlife AI Support Assistant.',
    `Default greeting to use naturally for first contact: "${RESPONSE_STYLES.greeting}"`,
    'Tone must always be professional, calm, and confident.',
    'Keep responses short, clear, and structured in 2-4 bullet points or numbered steps when useful.',
    'You only answer Starlife platform support and guidance.',
    'Allowed topics: what is starlife, deposits, withdrawals, investments, referrals, loans, points, kyc, support, and general platform guidance.',
    'If user asks unrelated topic, set in_scope=false and provide a brief refusal.',
    'Never claim to directly change balances, approve loans, process withdrawals, modify investments, or close sensitive cases.',
    'For risky/account-specific complaints, reply carefully, recommend human review, and avoid promises.',
    'Output valid JSON only matching the schema.'
  ].join(' ');

  const userPrompt = {
    user_message: userMessage,
    high_risk_matches: highRiskMatches,
    fallback_category: fallbackCategory,
    knowledge_base: knowledgeBase
  };

  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
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
              reply: { type: 'string' }
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
    throw new Error(data.error?.message || `OpenAI API error: ${response.status}`);
  }

  const content = data.output_text;
  if (!content) {
    throw new Error('OpenAI did not return output_text');
  }

  return JSON.parse(content);
}

function normalizeAiResult({ aiResult, userMessage, fallbackCategory, highRiskMatches, forceHuman, modelFailureReason }) {
  if (!aiResult || typeof aiResult !== 'object') {
    return buildFallbackModelResult({ userMessage, fallbackCategory, highRiskMatches, forceHuman, modelFailureReason });
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
  const reply = String(aiResult.reply || '').trim() || buildFallbackReply({ inScope, intentType, forceHuman, modelFailureReason });

  return {
    in_scope: inScope,
    intent_type: intentType,
    category,
    severity,
    reply
  };
}

function buildFallbackModelResult({ userMessage, fallbackCategory, highRiskMatches, forceHuman, modelFailureReason }) {
  const normalized = String(userMessage || '').toLowerCase();
  const inScope = normalized.includes('starlife') || fallbackCategory !== 'general_guidance' || highRiskMatches.length > 0 || forceHuman;
  const intentType = highRiskMatches.length > 0 || forceHuman ? 'complaint' : 'faq';
  return {
    in_scope: inScope,
    intent_type: intentType,
    category: inScope ? fallbackCategory : 'out_of_scope',
    severity: highRiskMatches.length > 0 ? 'high' : (intentType === 'complaint' ? 'medium' : 'low'),
    reply: buildFallbackReply({ inScope, intentType, forceHuman, modelFailureReason })
  };
}

function buildFallbackReply({ inScope, intentType, forceHuman, modelFailureReason }) {
  if (!inScope) return formatOutOfScopeReply();
  if (forceHuman) {
    return 'I have handed this over to a human support agent. Please continue in your support ticket.';
  }
  if (intentType === 'complaint') {
    return `I understand this issue. I have logged it for support review${modelFailureReason ? ' while AI response is temporarily limited' : ''}. Please share any transaction ID or screenshot in your ticket.`;
  }
  return `I can help with Starlife support. Please ask your question again in short form${modelFailureReason ? ' (AI is temporarily limited)' : ''}.`;
}

function formatResponse({ body }) {
  const conciseBody = String(body || '').trim();
  if (!conciseBody) return 'Thanks for reaching out. Please share your Starlife question and I will guide you.';
  return conciseBody;
}

function formatOutOfScopeReply() {
  return 'I can only help with Starlife support and platform guidance (deposits, withdrawals, investments, referrals, loans, points, KYC, and support). Please ask a Starlife-related question.';
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

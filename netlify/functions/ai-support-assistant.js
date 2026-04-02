const { getDb, admin } = require('./_lib/firebase');
const { sendTelegramMessage } = require('./_lib/telegram');
const {
  detectHighRiskTriggers,
  inferFaqCategory,
  buildKnowledgeBaseText
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

  let aiResult;
  try {
    aiResult = await generateSupportReply({
      userMessage,
      highRiskMatches,
      fallbackCategory: inferFaqCategory(userMessage)
    });
  } catch (error) {
    return json(502, { ok: false, error: `OpenAI request failed: ${error.message}` });
  }

  const inScope = Boolean(aiResult.in_scope);
  const initialCategory = sanitizeCategory(aiResult.category);
  const isComplaint = aiResult.intent_type === 'complaint' || highRiskMatches.length > 0;

  const category = !inScope
    ? 'out_of_scope'
    : (initialCategory || inferFaqCategory(userMessage));

  const severity = decideSeverity({
    inScope,
    isComplaint,
    modelSeverity: aiResult.severity,
    highRiskMatches
  });

  const shouldCreateTicket = inScope && (isComplaint || severity !== 'low');
  const shouldAlertAdmin = ['high', 'critical'].includes(severity) && highRiskMatches.length > 0;

  const safeReply = inScope
    ? aiResult.reply
    : 'I can only help with Starlife support and platform guidance (deposits, withdrawals, investments, referrals, loans, points, KYC, and account support). Please ask a Starlife-related question.';

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
    intentType: isComplaint ? 'complaint' : 'faq',
    inScope,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const logRef = await db.collection('ai_support_logs').add(logDoc);

  let ticketId = null;
  if (shouldCreateTicket) {
    const ticketRef = await db.collection('support_tickets').add({
      source: 'ai_support_assistant',
      logId: logRef.id,
      userId,
      memberId,
      message: userMessage,
      category,
      severity,
      status: 'open',
      highRiskMatches,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    ticketId = ticketRef.id;
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
      ticketId ? `Ticket ID: <b>${ticketId}</b>` : ''
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
    supportedTopics: SUPPORTED_TOPICS
  });
};

function decideSeverity({ inScope, isComplaint, modelSeverity, highRiskMatches }) {
  if (!inScope) return 'low';
  if (highRiskMatches.length > 0) return highRiskMatches.length >= 2 ? 'critical' : 'high';

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

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
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

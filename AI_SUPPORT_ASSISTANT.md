# Starlife AI Support Assistant

## Endpoint
- Netlify Function: `/.netlify/functions/ai-support-assistant`
- Method: `POST`
- Body:

```json
{
  "userId": "u123",
  "memberId": "SL-1001",
  "message": "How do I withdraw?"
}
```

## What it does
1. Uses OpenAI to classify and generate a support reply.
2. Restricts assistant scope to Starlife-related support only.
3. Distinguishes FAQ vs complaint/risk intent.
4. Stores every interaction in Firestore `ai_support_logs` with:
   - `userMessage`
   - `aiReply`
   - `category`
   - `severity`
   - `adminAlertTriggered`
5. Creates/updates Firestore `tickets` (shared support backend) for complaint/higher-risk issues.
6. Sends Telegram alert for high-risk sensitive triggers.

## UI integration
- Floating AI chat can answer directly and, for serious issues, create a shared `tickets` record.
- The same ticket thread is visible from Support page (`My Tickets`) with AI, user, and human replies in one conversation.

5. Creates Firestore `support_tickets` for complaint/higher-risk issues.
6. Sends Telegram alert for high-risk sensitive triggers.

## Supported topic categories
- `what_is_starlife`
- `deposit`
- `withdraw`
- `invest`
- `referrals`
- `loans`
- `points`
- `kyc`
- `support`
- `general_guidance`

## High-risk triggers (Telegram alert candidates)
- missing balance
- failed withdrawal
- duplicate investment
- unauthorized loan
- kyc mismatch
- security
- fraud
- repeated deduction(s)
- deducted twice
- money disappeared
- account hacked

## Environment variables
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional, defaults to `gpt-4.1-mini`)
- `OPENAI_TIMEOUT_MS` (optional, defaults to `15000`)
- `FIREBASE_SERVICE_ACCOUNT_JSON` or Firebase split credentials
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (needed for alerts)

## Firestore writes
- `ai_support_logs`: `userId`, `memberId`, `userMessage`, `aiReply`, `category`, `severity`, `highRiskMatches`, `adminAlertTriggered`, `ticketCreated`, `forceHuman`, `responseStyle`, `modelFailureReason`, `intentType`, `inScope`, `createdAt`.
- `support_tickets`: `userId`, `memberId`, `ticketId`, `category`, `severity`, `source`, `logId`, `status`, `highRiskMatches`, `forceHuman`, `userMessage`, `aiReply`, `createdAt`, `updatedAt`.

- `FIREBASE_SERVICE_ACCOUNT_JSON` or Firebase split credentials
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (needed for alerts)

## Manual test examples

### 1) FAQ test
```bash
curl -X POST http://localhost:8888/.netlify/functions/ai-support-assistant \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u1","memberId":"SL-1","message":"How do I deposit on Starlife?"}'
```
Expected: direct answer, category `deposit`, low severity, no Telegram alert.

### 2) Complaint (non-high-risk) test
```bash
curl -X POST http://localhost:8888/.netlify/functions/ai-support-assistant \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u2","memberId":"SL-2","message":"My KYC status has been pending for days. Please help."}'
```
Expected: careful support response, ticket likely created, usually medium severity.

### 3) High-risk alert test
```bash
curl -X POST http://localhost:8888/.netlify/functions/ai-support-assistant \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u3","memberId":"SL-3","message":"I have a failed withdrawal and missing balance. I think my account was hacked."}'
```
Expected: careful response, support ticket created, high/critical severity, Telegram alert sent.

### 4) Out-of-scope test
```bash
curl -X POST http://localhost:8888/.netlify/functions/ai-support-assistant \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u4","memberId":"SL-4","message":"Who won last night\'s football game?"}'
```
Expected: refusal that assistant only handles Starlife support topics.

// Visitor chat assistant ("Wiwi"), grounded in the opportunities catalog.
// Uses a Flash *Lite* Gemini model on purpose: the free-tier Lite quota is
// 500 requests/day vs only 20/day for the full Flash models, which stay
// reserved for the admin AI import (server/importer.js, gemini.js).
const ASSISTANT_MODEL = process.env.GEMINI_ASSISTANT_MODEL || 'gemini-3.5-flash-lite';
const ASSISTANT_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${ASSISTANT_MODEL}:generateContent`;
const ASSISTANT_TIMEOUT_MS = 30000;

const MAX_MESSAGE_LENGTH = 600;
const MAX_HISTORY_MESSAGES = 8;
const MAX_CATALOG_ENTRIES = 120;
const MAX_DESCRIPTION_CHARS = 280;
const MAX_MATCHED_IDS = 4;

// The model must answer from the catalog only and return matching ids so the
// widget can render real cards (never model-invented links).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    opportunityIds: { type: 'array', items: { type: 'integer' } },
  },
  required: ['reply'],
};

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Compact one-line-per-opportunity catalog injected in the system prompt.
function buildCatalog(opportunities) {
  return opportunities.slice(0, MAX_CATALOG_ENTRIES).map((o) => ({
    id: o.id,
    title: truncate(o.title, 120),
    organization: truncate(o.organization, 80),
    country: o.country || '',
    city: o.city || '',
    type: o.type || '',
    funding: o.funding || '',
    domain: o.domain || '',
    deadline: o.deadline || '',
    duration: truncate(o.duration, 60),
    tags: Array.isArray(o.tags) ? o.tags.slice(0, 8) : [],
    description: truncate(o.description, MAX_DESCRIPTION_CHARS),
  }));
}

function buildSystemPrompt({ catalog, lang, today }) {
  const language = lang === 'en' ? 'English' : 'French';
  return [
    'You are "Wiwi", the friendly virtual assistant of "Opportunities by Wiem", a platform listing international opportunities (internships, scholarships, studies, volunteering, jobs) for young people from the MENA region.',
    `Always answer ENTIRELY in ${language} — every sentence, never mix languages (informal "tu" when French). Warm, concise tone. Plain text only — no markdown, no bullets with asterisks, no links.`,
    `Today's date is ${today}.`,
    'You may ONLY recommend opportunities from the catalog below. Never invent opportunities, organizations, deadlines or links.',
    `When opportunities match the question, mention them briefly by title and put their ids in opportunityIds (max ${MAX_MATCHED_IDS}, best matches first) — the website renders clickable cards for them, so do not repeat all details in the text.`,
    'If nothing in the catalog matches, say so honestly and suggest subscribing to the newsletter or checking back later. If a question is unrelated to international opportunities or the platform, politely steer back to the topic.',
    'For questions about the platform itself: accounts and favorites are free (heart icon), listings are hand-checked, and the contact page is available for anything else.',
    '',
    `CATALOG (JSON, ${catalog.length} active opportunities):`,
    JSON.stringify(catalog),
  ].join('\n');
}

// Keep only well-formed {role, text} turns so a tampered client payload cannot
// inject arbitrary structures into the Gemini request.
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.text === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: truncate(entry.text, MAX_MESSAGE_LENGTH) }],
    }));
}

async function chat({ message, history, lang, opportunities, today }) {
  if (!isConfigured()) {
    const err = new Error('GEMINI_API_KEY is not set');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const catalog = buildCatalog(opportunities);
  const contents = [...sanitizeHistory(history), { role: 'user', parts: [{ text: truncate(message, MAX_MESSAGE_LENGTH) }] }];

  const response = await fetch(ASSISTANT_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt({ catalog, lang, today }) }] },
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && payload.error && payload.error.message ? payload.error.message : `HTTP ${response.status}`;
    const err = new Error(`Gemini API error: ${detail}`);
    err.code = response.status === 429 ? 'QUOTA' : 'UPSTREAM';
    throw err;
  }

  const text =
    payload &&
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts &&
    payload.candidates[0].content.parts.map((part) => part.text || '').join('');
  if (!text) {
    const err = new Error('Gemini API returned no content');
    err.code = 'UPSTREAM';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('Gemini API returned invalid JSON');
    err.code = 'UPSTREAM';
    throw err;
  }

  const knownIds = new Set(catalog.map((entry) => entry.id));
  const ids = (Array.isArray(parsed.opportunityIds) ? parsed.opportunityIds : [])
    .map(Number)
    .filter((id) => knownIds.has(id))
    .slice(0, MAX_MATCHED_IDS);

  return { reply: String(parsed.reply || '').trim(), ids };
}

module.exports = { chat, isConfigured, MAX_MESSAGE_LENGTH };

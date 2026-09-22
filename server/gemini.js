// Minimal Gemini API client (free tier) shared by the AI import and the
// image-suggestion features. Structured output only: every call gets a
// response schema and returns parsed JSON.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 60000;

// Overload (503) and rate-limit (429) answers from Gemini are transient: the API
// says so in the error body ("experiencing high demand ... try again later").
// Retrying a couple of times turns most of them into a successful import.
// Overload answers come back in well under a second, so 3 attempts used to give
// up after ~12s with most of the budget untouched. The budget, not the attempt
// count, is meant to be the binding constraint.
const MAX_ATTEMPTS = 6;
const BASE_RETRY_DELAY_MS = 700;
// The admin form gives up after 90s and the page fetch takes a second or two, so
// never spend the whole budget retrying: a new attempt starts only if there is
// room left for it. Worst case here is ~22s of backoff plus the calls themselves.
const RETRY_BUDGET_MS = 70000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff with jitter, so parallel imports do not retry in lockstep.
function backoffDelay(attempt, baseDelayMs) {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  return Math.round(exponential * (1 + Math.random() * 0.25));
}

// One HTTP round trip. Throws Error with `retryable: true` when it is worth
// trying again (transient server states and network/timeout failures).
async function requestGemini(parts, responseSchema) {
  let response;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0.2,
        },
      }),
    });
  } catch (err) {
    // Network error or the 60s timeout firing: the request never got an answer.
    throw Object.assign(new Error(`Gemini API error: ${err.message}`), { retryable: true });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message ? payload.error.message : `HTTP ${response.status}`;
    throw Object.assign(new Error(`Gemini API error: ${message}`), {
      retryable: RETRYABLE_STATUS.has(response.status),
      status: response.status,
    });
  }
  const text =
    payload &&
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts &&
    payload.candidates[0].content.parts.map((part) => part.text || '').join('');
  if (!text) {
    // An empty candidate list usually means the model dropped the turn (safety
    // filter, truncation): a fresh attempt often returns proper content.
    throw Object.assign(new Error('Gemini API returned no content'), { retryable: true });
  }
  return JSON.parse(text);
}

async function callGemini(parts, responseSchema, options = {}) {
  const maxAttempts = options.maxAttempts || MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs === undefined ? BASE_RETRY_DELAY_MS : options.baseDelayMs;
  const budgetMs = options.budgetMs === undefined ? RETRY_BUDGET_MS : options.budgetMs;
  const startedAt = Date.now();

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestGemini(parts, responseSchema);
    } catch (err) {
      const delay = backoffDelay(attempt, baseDelayMs);
      const outOfBudget = Date.now() - startedAt + delay >= budgetMs;
      if (!err.retryable || attempt >= maxAttempts || outOfBudget) throw err;
      console.warn(`[gemini] attempt ${attempt}/${maxAttempts} failed (${err.message}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

module.exports = { callGemini, isConfigured };

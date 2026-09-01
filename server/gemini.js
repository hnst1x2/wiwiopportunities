// Minimal Gemini API client (free tier) shared by the AI import and the
// image-suggestion features. Structured output only: every call gets a
// response schema and returns parsed JSON.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 60000;

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function callGemini(parts, responseSchema) {
  const response = await fetch(GEMINI_ENDPOINT, {
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
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message ? payload.error.message : `HTTP ${response.status}`;
    throw new Error(`Gemini API error: ${message}`);
  }
  const text =
    payload &&
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts &&
    payload.candidates[0].content.parts.map((part) => part.text || '').join('');
  if (!text) {
    throw new Error('Gemini API returned no content');
  }
  return JSON.parse(text);
}

module.exports = { callGemini, isConfigured };

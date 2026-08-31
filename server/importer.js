// AI import: fetch an opportunity page and extract the platform fields with the
// Gemini API (free tier). Used by the admin "Import from URL" feature — the result
// pre-fills the create form, it is never published without human review.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const FETCH_TIMEOUT_MS = 15000;
const GEMINI_TIMEOUT_MS = 60000;
const MAX_PAGE_CHARS = 18000;
const MAX_TAGS = 5;

const TYPE_VALUES = ['Stage', 'Bourse', 'Volontariat', 'Job', 'Études'];
const FUNDING_VALUES = ['fully', 'partial', 'none'];
const DOMAIN_VALUES = ['it', 'marketing', 'business', 'studies', 'humanitarian'];

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Only public http(s) targets: the URL comes from the admin, but the server should
// still refuse to fetch itself or anything on the local network (SSRF guard).
function isSafePublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return false;
    }
  }
  if (host === '[::1]' || host.startsWith('[')) return false;
  return true;
}

// Crude but dependency-free HTML → text: drop non-content blocks and tags,
// decode the common entities, collapse whitespace.
function htmlToText(html) {
  const withoutBlocks = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return withoutBlocks
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_PAGE_CHARS);
}

async function fetchPageText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr,en;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`page fetch failed with HTTP ${response.status}`);
  }
  const text = htmlToText(await response.text());
  if (text.length < 200) {
    throw new Error('page content too thin to extract from (likely JS-rendered)');
  }
  return text;
}

function buildPrompt(pageText, sourceUrl, today) {
  return `Tu extrais UNE opportunité (stage, bourse, études, volontariat, job, camp, fellowship, événement jeunesse) depuis le texte d'une page web, pour le catalogue "Opportunities by Wiem" (public : jeunes de la région MENA, catalogue en français).

Règles STRICTES :
- Écris "description", "extra" et "tags" en FRANÇAIS. Garde les noms propres (événement, organisation) tels quels.
- "country" : nom du pays en FRANÇAIS (ex : Turquie, États-Unis, Allemagne, Émirats arabes unis, Royaume-Uni…).
- "type" : EXACTEMENT une valeur parmi : Stage (stage), Bourse (bourse/subvention), Volontariat (bénévolat), Job (emploi), Études (programme d'études, formation, camp, sommet, conférence, fellowship, échange).
- "funding" : "fully" (tout est pris en charge, ou s'il existe une option fully funded), "partial" (prise en charge partielle), "none" (autofinancé / participant paie). Si inconnu : "none".
- "domain" : "it" (tech/logiciel), "marketing" (marketing/communication/médias), "business" (management/entrepreneuriat), "studies" (académique/recherche), "humanitarian" (leadership, jeunesse, social, ONG).
- "deadline" : la date limite de CANDIDATURE ("apply by") au format YYYY-MM-DD — PAS les dates de l'événement. Si elle n'est pas indiquée sur la page, mets null. Aujourd'hui : ${today}.
- "duration" : ex "3 jours", "2 semaines", "6 mois". Sinon null.
- "description" : 1 à 2 phrases claires en français résumant l'opportunité.
- "extra" : éligibilité / profil recherché / conditions (âge, pays éligibles, exigences) en français. Plusieurs lignes possibles.
- "tags" : 2 à ${MAX_TAGS} mots-clés courts en français.
- N'INVENTE RIEN. Si une information n'est pas sur la page, mets null. Ne devine jamais une deadline ni un niveau de financement.
- Si le titre, le pays ou le type ne peuvent pas être déterminés depuis la page, mets null pour ce champ.

URL source : ${sourceUrl}

TEXTE DE LA PAGE :
${pageText}`;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', nullable: true },
    organization: { type: 'STRING', nullable: true },
    country: { type: 'STRING', nullable: true },
    city: { type: 'STRING', nullable: true },
    type: { type: 'STRING', enum: TYPE_VALUES, nullable: true },
    funding: { type: 'STRING', enum: FUNDING_VALUES, nullable: true },
    domain: { type: 'STRING', enum: DOMAIN_VALUES, nullable: true },
    deadline: { type: 'STRING', nullable: true },
    duration: { type: 'STRING', nullable: true },
    description: { type: 'STRING', nullable: true },
    extra: { type: 'STRING', nullable: true },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['title', 'country', 'type'],
};

async function callGemini(prompt) {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
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

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

// Model output is external data: re-validate every field against the platform
// vocabularies before it reaches the admin form.
function normalizeExtraction(raw, sourceUrl) {
  const type = cleanString(raw.type, 60);
  const funding = cleanString(raw.funding, 20).toLowerCase();
  const domain = cleanString(raw.domain, 20).toLowerCase();
  const deadline = cleanString(raw.deadline, 10);
  return {
    title: cleanString(raw.title, 200),
    organization: cleanString(raw.organization, 200),
    country: cleanString(raw.country, 80),
    city: cleanString(raw.city, 80),
    type, // a value outside TYPE_VALUES survives — the admin form has an "Other…" option for it
    funding: FUNDING_VALUES.includes(funding) ? funding : '',
    domain: DOMAIN_VALUES.includes(domain) ? domain : '',
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : '',
    duration: cleanString(raw.duration, 100),
    link: sourceUrl,
    description: cleanString(raw.description, 1000),
    extra: cleanString(raw.extra, 2000),
    tags: (Array.isArray(raw.tags) ? raw.tags : [])
      .map((tag) => cleanString(tag, 40))
      .filter(Boolean)
      .slice(0, MAX_TAGS),
  };
}

// Full pipeline: fetch the page, extract with Gemini, normalize.
// Throws Error with a `code` in {NOT_CONFIGURED, INVALID_URL, FETCH_FAILED, EXTRACT_FAILED}.
async function importFromUrl(rawUrl) {
  if (!isConfigured()) {
    throw Object.assign(new Error('GEMINI_API_KEY is not configured'), { code: 'NOT_CONFIGURED' });
  }
  const url = cleanString(rawUrl, 600);
  if (!isSafePublicUrl(url)) {
    throw Object.assign(new Error('invalid or disallowed URL'), { code: 'INVALID_URL' });
  }

  let pageText;
  try {
    pageText = await fetchPageText(url);
  } catch (err) {
    throw Object.assign(new Error(`could not read the page: ${err.message}`), { code: 'FETCH_FAILED' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = await callGemini(buildPrompt(pageText, url, today));
    return normalizeExtraction(raw || {}, url);
  } catch (err) {
    throw Object.assign(new Error(`extraction failed: ${err.message}`), { code: 'EXTRACT_FAILED' });
  }
}

module.exports = { importFromUrl, isConfigured };

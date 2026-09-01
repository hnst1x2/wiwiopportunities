// Carousel image suggestions for an opportunity's destination (city/country).
// Real photo URLs come from the Wikimedia Commons search API (free, hotlink
// allowed); Gemini only CURATES the candidate list (drops maps, flags, logos,
// same-name places in other countries) so no URL is ever invented by the model.
const { callGemini, isConfigured } = require('./gemini');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_TIMEOUT_MS = 10000;
const CANDIDATES_PER_QUERY = 12;
const MAX_SUGGESTIONS = 6;
const MAX_URL_LENGTH = 600;
const THUMB_WIDTH = 1024;
const USER_AGENT = 'WiwiOpportunity/1.0 (https://opportunities.wiemibncheikh.com)';

// Titles that are almost never a usable destination photo, used as the
// no-Gemini fallback filter (and as a cheap pre-filter before curation).
const JUNK_TITLE = /\b(map|carte|flag|drapeau|coat|blason|logo|locator|blank|diagram|seal|emblem|escudo|karte)\b/i;

function normalizeCommonsUrl(url) {
  if (typeof url !== 'string') return '';
  const clean = url.split('?')[0].replace('//thumb.wikimedia.org/', '//upload.wikimedia.org/');
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(clean)) return '';
  if (clean.length > MAX_URL_LENGTH) return '';
  if (/\.(svg|gif|tiff?|pdf|djvu)(\/|$)/i.test(clean)) return '';
  return clean;
}

async function searchCommons(query) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(CANDIDATES_PER_QUERY),
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: String(THUMB_WIDTH),
    format: 'json',
  });
  const response = await fetch(`${COMMONS_API}?${params}`, {
    signal: AbortSignal.timeout(COMMONS_TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Commons API HTTP ${response.status}`);
  const payload = await response.json();
  const pages = payload && payload.query && payload.query.pages ? Object.values(payload.query.pages) : [];
  return pages
    .map((page) => {
      const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      const url = normalizeCommonsUrl(info && (info.thumburl || info.url));
      const title = String(page.title || '').replace(/^File:/, '');
      return url && title ? { title, url } : null;
    })
    .filter(Boolean);
}

const CURATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    indices: { type: 'ARRAY', items: { type: 'INTEGER' } },
  },
  required: ['indices'],
};

// Ask Gemini which candidates actually look like destination photos, judging
// from the Commons file titles alone (cheap text-only call).
async function curateWithGemini(candidates, city, country) {
  const place = [city, country].filter(Boolean).join(', ');
  const list = candidates.map((c, i) => `${i}. ${c.title}`).join('\n');
  const prompt = `Voici des noms de fichiers photo issus de Wikimedia Commons. Sélectionne au maximum ${MAX_SUGGESTIONS} photos qui illustrent bien la destination "${place}" pour un carrousel (paysages, monuments, vues de la ville, campus).

Exclus impérativement : cartes, drapeaux, blasons, logos, sceaux, diagrammes, documents scannés, photos d'un lieu homonyme situé dans un autre pays, portraits de personnes.

Réponds avec les indices des photos retenues, du plus représentatif au moins représentatif. Si rien ne convient, renvoie une liste vide.

${list}`;
  const result = await callGemini([{ text: prompt }], CURATION_SCHEMA);
  const indices = Array.isArray(result && result.indices) ? result.indices : [];
  return indices
    .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
    .slice(0, MAX_SUGGESTIONS)
    .map((i) => candidates[i]);
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

// Returns up to MAX_SUGGESTIONS {title, url} entries, or [] when nothing usable
// is found. Never throws on curation problems — falls back to the junk filter.
async function suggestImages(city, country) {
  const queries = [];
  if (city && country) queries.push(`${city} ${country}`);
  else if (city) queries.push(city);
  if (country) queries.push(country);
  if (!queries.length) return [];

  const results = await Promise.allSettled(queries.map((q) => searchCommons(q)));
  const candidates = dedupeByUrl(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))).filter(
    (c) => !JUNK_TITLE.test(c.title)
  );
  if (!candidates.length) return [];

  if (isConfigured()) {
    try {
      return await curateWithGemini(candidates, city, country);
    } catch (err) {
      console.error(`[image-suggestions] curation failed, using raw results: ${err.message}`);
    }
  }
  return candidates.slice(0, MAX_SUGGESTIONS);
}

module.exports = { suggestImages };

// Baseline HTTP security headers for every response.
// HSTS is deliberately NOT set here: the host-level Caddy already owns it
// (see deploy/Caddyfile.wiwiopportunity) and the app also runs over plain HTTP locally.
const crypto = require('crypto');

// jQuery is the only third-party script; everything else (CSS, fonts, JS) is served
// from this origin. Opportunity covers can point at any https image host, hence the
// permissive img-src.
const JQUERY_ORIGIN = 'https://code.jquery.com';

// Optional Google Analytics 4 (GA_MEASUREMENT_ID): the gtag loader and its
// collection endpoints are only allowed when the tag is actually configured.
const GA_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;
const rawGaId = (process.env.GA_MEASUREMENT_ID || '').trim();
if (rawGaId && !GA_ID_PATTERN.test(rawGaId)) {
  console.warn('[security] GA_MEASUREMENT_ID does not look like a GA4 id (G-XXXXXXXX): ignored.');
}
const GA_MEASUREMENT_ID = GA_ID_PATTERN.test(rawGaId) ? rawGaId : '';
const GA_SCRIPT_ORIGINS = 'https://www.googletagmanager.com';
const GA_CONNECT_ORIGINS = 'https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com';

function buildContentSecurityPolicy(nonce) {
  const gaScript = GA_MEASUREMENT_ID ? ` ${GA_SCRIPT_ORIGINS}` : '';
  const gaConnect = GA_MEASUREMENT_ID ? ` ${GA_CONNECT_ORIGINS}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' ${JQUERY_ORIGIN}${gaScript} 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self'${gaConnect}`,
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // Clickjacking: nothing may frame the site (X-Frame-Options is the legacy twin).
    "frame-ancestors 'none'",
  ].join('; ');
}

// Per-request nonce: the few inline <script> blocks in the views carry
// nonce="<%= cspNonce %>", so injected inline script stays blocked.
function securityHeaders(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy(nonce));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  next();
}

module.exports = { securityHeaders, buildContentSecurityPolicy, GA_MEASUREMENT_ID };

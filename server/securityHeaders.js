// Baseline HTTP security headers for every response.
// HSTS is deliberately NOT set here: the host-level Caddy already owns it
// (see deploy/Caddyfile.wiwiopportunity) and the app also runs over plain HTTP locally.
const crypto = require('crypto');

// jQuery is the only third-party script; everything else (CSS, fonts, JS) is served
// from this origin. Opportunity covers can point at any https image host, hence the
// permissive img-src.
const JQUERY_ORIGIN = 'https://code.jquery.com';

function buildContentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' ${JQUERY_ORIGIN} 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
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

module.exports = { securityHeaders, buildContentSecurityPolicy };

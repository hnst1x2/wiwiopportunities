// Email sending via Brevo SMTP relay (nodemailer) — same mechanism as ChatFlow.
// Config (reuse ChatFlow's Brevo credentials): SMTP_HOST=smtp-relay.brevo.com, SMTP_PORT=587,
// SMTP_SECURE=false (STARTTLS), SMTP_USER, SMTP_PASSWORD, MAIL_FROM.
// If SMTP is not configured, sends are skipped (a warning is logged) so local/dev still works.

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const MAIL_FROM = process.env.MAIL_FROM || 'WiwiOpportunity <contact@wiemibncheikh.com>';
const SITE_URL = process.env.PUBLIC_BASE_URL || 'https://opportunities.wiemibncheikh.com';

let transporter = null;

function isConfigured() {
  return Boolean(SMTP_HOST);
}

function getTransporter() {
  if (!isConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE, // false on 587 => STARTTLS upgrade
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

// Verifies SMTP connectivity at startup (non-fatal — logs status only).
async function verify() {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured (SMTP_HOST unset) — newsletter emails will be skipped.');
    return false;
  }
  try {
    await t.verify();
    console.log(`[mailer] Brevo SMTP ready (${SMTP_HOST}:${SMTP_PORT})`);
    return true;
  } catch (err) {
    console.error(`[mailer] SMTP verify failed: ${err.message}`);
    return false;
  }
}

const WELCOME = {
  fr: {
    subject: 'Bienvenue sur WiwiOpportunity ✨',
    heading: 'Bienvenue !',
    lead: 'Merci de ton inscription à la newsletter WiwiOpportunity.',
    body:
      "Tu recevras une sélection d'opportunités internationales — stages, bourses, études et volontariats — vérifiées à la main pour les jeunes de la région MENA.",
    cta: 'Voir les opportunités',
    signoff: "À très vite,\nL'équipe WiwiOpportunity",
    footer: 'Tu reçois cet email car tu t\'es inscrit·e sur WiwiOpportunity.',
  },
  en: {
    subject: 'Welcome to WiwiOpportunity ✨',
    heading: 'Welcome!',
    lead: 'Thanks for subscribing to the WiwiOpportunity newsletter.',
    body:
      'You\'ll receive a hand-picked selection of international opportunities — internships, scholarships, studies and volunteering — for young people across the MENA region.',
    cta: 'Browse opportunities',
    signoff: 'See you soon,\nThe WiwiOpportunity team',
    footer: 'You are receiving this email because you subscribed on WiwiOpportunity.',
  },
};

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function buildWelcomeMessage({ email, lang }) {
  const t = WELCOME[lang === 'en' ? 'en' : 'fr'];
  const text = `${t.lead}\n\n${t.body}\n\n${t.cta} : ${SITE_URL}\n\n${t.signoff}\n\n—\n${t.footer}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f7fa;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#2e1451">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#7a80f7,#2e1451);border-radius:20px;padding:28px;color:#fff;text-align:center">
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">Wiwi<span style="color:#d1baf6">Opportunity</span></div>
      <h1 style="margin:16px 0 6px;font-size:24px;font-weight:800">${esc(t.heading)}</h1>
      <p style="margin:0;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.6">${esc(t.lead)}</p>
    </div>
    <div style="background:#fff;border:1px solid rgba(46,20,81,0.1);border-radius:16px;padding:24px;margin-top:14px">
      <p style="margin:0 0 18px;font-size:15px;line-height:1.7">${esc(t.body)}</p>
      <a href="${esc(SITE_URL)}" style="display:inline-block;background:#2e1451;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:999px">${esc(t.cta)} →</a>
      <p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:rgba(46,20,81,0.75);white-space:pre-line">${esc(t.signoff)}</p>
    </div>
    <p style="margin:14px 4px 0;font-size:12px;color:rgba(46,20,81,0.5)">${esc(t.footer)}</p>
  </div></body></html>`;
  return { from: MAIL_FROM, to: email, subject: t.subject, text, html };
}

async function sendWelcomeEmail({ email, lang }) {
  const t = getTransporter();
  if (!t) return { sent: false, skipped: true };
  const info = await t.sendMail(buildWelcomeMessage({ email, lang }));
  return { sent: true, messageId: info.messageId };
}

module.exports = { isConfigured, verify, buildWelcomeMessage, sendWelcomeEmail };

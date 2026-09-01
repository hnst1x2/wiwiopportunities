// Member area: register / login / account (profile + preferences) / favorites.
// Everything a member changes is their own data; opportunities stay admin-only.
const express = require('express');
const db = require('./db');
const usersDb = require('./usersDb');
const { hashPassword, verifyPassword } = require('./passwords');

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 200;
const MAX_PREF_ITEMS = 20;
const MAX_PREF_LENGTH = 60;

const PREF_TYPES = ['Stage', 'Bourse', 'Volontariat', 'Job', 'Études'];
const PREF_DOMAINS = ['it', 'marketing', 'business', 'studies', 'humanitarian'];

// --- tiny in-memory rate limiter (login/register bruteforce protection) --------
const RATE_MAX_ATTEMPTS = 20;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const rateBuckets = new Map();

function rateLimit(req, res, next) {
  const key = `${req.ip}|${req.path}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX_ATTEMPTS) {
    return res.status(429).render(req.path === '/register' ? 'register' : 'login', {
      page: 'account',
      title: res.locals.t('meta.loginTitle'),
      baseUrl: process.env.PUBLIC_BASE_URL || '',
      error: res.locals.t('account.errors.tooMany'),
      values: {},
      next: safeNext(req.body && req.body.next),
    });
  }
  next();
}

// --- helpers --------------------------------------------------------------------

// Only same-site paths may be used as a post-login redirect target.
function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') ? next : '';
}

function requireUser(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireUserApi(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ success: false, error: 'auth required' });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
}

function cleanName(value) {
  return String(value || '').trim().slice(0, MAX_NAME_LENGTH);
}

// Checkbox groups arrive as string | string[]; free-text lists as "a, b, c".
function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',');
  return [];
}

function cleanPrefList(value, allowed) {
  const items = toArray(value)
    .map((v) => String(v).trim().slice(0, MAX_PREF_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_PREF_ITEMS);
  if (!allowed) return [...new Set(items)];
  return [...new Set(items.filter((v) => allowed.includes(v)))];
}

function renderAuthPage(res, view, options) {
  res.render(view, {
    page: 'account',
    baseUrl: process.env.PUBLIC_BASE_URL || '',
    error: null,
    values: {},
    next: '',
    ...options,
  });
}

function renderAccount(res, user, options) {
  res.render('account', {
    page: 'account',
    baseUrl: process.env.PUBLIC_BASE_URL || '',
    title: res.locals.t('meta.accountTitle'),
    account: user,
    prefTypes: PREF_TYPES,
    prefDomains: PREF_DOMAINS,
    saved: false,
    passwordChanged: false,
    error: null,
    passwordError: null,
    deleteError: null,
    ...options,
  });
}

// --- register / login / logout ---------------------------------------------------

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/account');
  renderAuthPage(res, 'register', { title: res.locals.t('meta.registerTitle'), next: safeNext(req.query.next) });
});

router.post('/register', rateLimit, (req, res) => {
  const email = normalizeEmail(req.body.email);
  const name = cleanName(req.body.name);
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);
  const t = res.locals.t;

  const fail = (error) =>
    res.status(400).render('register', {
      page: 'account',
      baseUrl: process.env.PUBLIC_BASE_URL || '',
      title: t('meta.registerTitle'),
      error,
      values: { email, name },
      next,
    });

  if (!EMAIL_PATTERN.test(email)) return fail(t('account.errors.invalidEmail'));
  if (password.length < PASSWORD_MIN_LENGTH) return fail(t('account.errors.passwordTooShort'));
  if (usersDb.emailExists(email)) return fail(t('account.errors.emailTaken'));

  const userId = usersDb.createUser({ email, passwordHash: hashPassword(password), name });
  req.session.regenerate((err) => {
    if (err) return fail(t('account.errors.generic'));
    req.session.userId = userId;
    res.redirect(next || '/account');
  });
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/account');
  renderAuthPage(res, 'login', { title: res.locals.t('meta.loginTitle'), next: safeNext(req.query.next) });
});

router.post('/login', rateLimit, (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);
  const t = res.locals.t;

  const auth = usersDb.getAuthByEmail(email);
  if (!auth || !verifyPassword(password, auth.password_hash)) {
    // Same message whether the email exists or not (no account enumeration).
    return res.status(401).render('login', {
      page: 'account',
      baseUrl: process.env.PUBLIC_BASE_URL || '',
      title: t('meta.loginTitle'),
      error: t('account.errors.invalidCredentials'),
      values: { email },
      next,
    });
  }

  // New session id on login (prevents session fixation).
  req.session.regenerate((err) => {
    if (err) return res.status(500).send(t('account.errors.generic'));
    req.session.userId = auth.id;
    res.redirect(next || '/account');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- account page (profile + preferences + password + delete) --------------------

router.get('/account', requireUser, (req, res) => {
  renderAccount(res, res.locals.user);
});

router.post('/account', requireUser, (req, res) => {
  const updated = {
    name: cleanName(req.body.name),
    prefCountries: cleanPrefList(req.body.prefCountries, null),
    prefDomains: cleanPrefList(req.body.prefDomains, PREF_DOMAINS),
    prefTypes: cleanPrefList(req.body.prefTypes, PREF_TYPES),
  };
  usersDb.updateProfile(req.session.userId, updated);
  renderAccount(res, usersDb.getUserById(req.session.userId), { saved: true });
});

router.post('/account/password', requireUser, (req, res) => {
  const t = res.locals.t;
  const current = String(req.body.currentPassword || '');
  const nextPassword = String(req.body.newPassword || '');
  const user = res.locals.user;

  if (!verifyPassword(current, usersDb.getPasswordHash(user.id))) {
    res.status(400);
    return renderAccount(res, user, { passwordError: t('account.errors.wrongPassword') });
  }
  if (nextPassword.length < PASSWORD_MIN_LENGTH) {
    res.status(400);
    return renderAccount(res, user, { passwordError: t('account.errors.passwordTooShort') });
  }
  usersDb.updatePassword(user.id, hashPassword(nextPassword));
  renderAccount(res, user, { passwordChanged: true });
});

router.post('/account/delete', requireUser, (req, res) => {
  const t = res.locals.t;
  const user = res.locals.user;
  if (!verifyPassword(String(req.body.password || ''), usersDb.getPasswordHash(user.id))) {
    res.status(400);
    return renderAccount(res, user, { deleteError: t('account.errors.wrongPassword') });
  }
  usersDb.deleteUser(user.id);
  req.session.destroy(() => res.redirect('/'));
});

// --- favorites --------------------------------------------------------------------

router.get('/favorites', requireUser, (req, res) => {
  res.render('favorites', {
    page: 'favorites',
    baseUrl: process.env.PUBLIC_BASE_URL || '',
    title: res.locals.t('meta.favoritesTitle'),
  });
});

// Who am I + my favorites/preferences — used by the client to draw hearts and "For you".
router.get('/api/me', (req, res) => {
  const user = res.locals.user;
  if (!user) return res.json({ user: null, favorites: [] });
  res.json({
    user: {
      name: user.name,
      email: user.email,
      prefCountries: user.prefCountries,
      prefDomains: user.prefDomains,
      prefTypes: user.prefTypes,
    },
    favorites: usersDb.listFavoriteIds(user.id),
  });
});

router.get('/api/favorites', requireUserApi, (req, res) => {
  res.json({ success: true, items: usersDb.listFavoriteOpportunities(req.session.userId) });
});

router.post('/api/favorites/:id', requireUserApi, (req, res) => {
  const id = Number(req.params.id);
  if (!db.getOpportunity(id)) {
    return res.status(404).json({ success: false, error: 'not found' });
  }
  const favorited = usersDb.toggleFavorite(req.session.userId, id);
  res.json({ success: true, favorited });
});

module.exports = router;

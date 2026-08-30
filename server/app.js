const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const site = require('./config/site');
const translations = require('./i18n/translations');
const db = require('./db');
const mailer = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_LANG = 'fr';

// --- Middlewares globaux ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// --- Session (pour admin login) ---
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'wiwiopportunity-secret',
    resave: false,
    saveUninitialized: false,
  })
);

// --- Vues EJS ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.locals.site = site;

function getCookieLang(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)wiwi_lang=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return translations[value] ? value : null;
}

function getTranslation(lang, key) {
  const parts = key.split('.');
  let current = translations[lang];
  for (const part of parts) {
    if (!current || typeof current !== 'object') return key;
    current = current[part];
  }
  return current || key;
}

app.use((req, res, next) => {
  const lang = getCookieLang(req) || DEFAULT_LANG;
  res.locals.lang = lang;
  res.locals.t = (key) => getTranslation(lang, key);
  res.locals.i18n = translations[lang];
  next();
});

// --- Static ---
app.use(express.static(path.join(__dirname, '../public')));

// --- Helpers ---
function getTodayString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isActiveOpportunity(o) {
  if (!o || !o.deadline) return true;
  const today = getTodayString();
  return String(o.deadline) >= today;
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function isFeatured(value) {
  return value === '1' || value === 'on' || value === 'true' || value === true;
}

// --- Middleware d'auth admin (simple) ---
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.redirect('/admin/login');
}

// --- Pages publiques ---
// Home
app.get('/', (req, res) => {
  res.render('index', {
    page: 'home',
    title: res.locals.t('meta.homeTitle'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
  });
});

// Détail d'une opportunité (le contenu vient de l'API via JS)
app.get('/detail', (req, res) => {
  res.render('detail', {
    page: 'detail',
    title: res.locals.t('meta.detailTitle'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
  });
});

// À propos
app.get('/about', (req, res) => {
  res.render('about', {
    page: 'about',
    title: res.locals.t('meta.aboutTitle'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
  });
});

// Contact
app.get('/contact', (req, res) => {
  res.render('contact', {
    page: 'contact',
    title: res.locals.t('meta.contactTitle'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
  });
});

// Archives
app.get('/archive', (req, res) => {
  res.render('archive', {
    page: 'archive',
    title: res.locals.t('meta.archiveTitle'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
  });
});

// Newsletter (POST) — store the email first, then send a Brevo confirmation to new subscribers.
app.post('/newsletter', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: res.locals.t('errors.emailRequired') });
  }
  // Persist first so a subscription is never lost even if the email send fails.
  const isNew = db.addNewsletter(email);
  if (isNew) {
    const lang = getCookieLang(req) || DEFAULT_LANG;
    try {
      await mailer.sendWelcomeEmail({ email, lang });
    } catch (err) {
      // Email captured in the DB; log the delivery failure for follow-up rather than failing the request.
      console.error(`[newsletter] confirmation email failed for ${email}: ${err.message}`);
    }
  }
  res.json({ success: true });
});

// --- Auth admin simple ---
// Page login admin
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin');
  }
  res.render('admin-login', {
    page: 'admin-login',
    title: res.locals.t('meta.adminLoginTitle'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
    error: null,
  });
});

// POST login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'changeme';

  if (username === adminUser && password === adminPass) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }

  return res.status(401).render('admin-login', {
    page: 'admin-login',
    title: res.locals.t('meta.adminLoginTitle'),
    error: res.locals.t('admin.invalidCredentials'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
  });
});

// Logout
app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// --- Pages admin (protégées) ---
// Liste des opportunités
app.get('/admin', requireAdmin, (req, res) => {
  res.render('admin-list', {
    page: 'admin',
    title: res.locals.t('meta.adminListTitle'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
    opportunities: db.listOpportunities(),
  });
});

// Formulaire création
app.get('/admin/new', requireAdmin, (req, res) => {
  res.render('admin-new', {
    page: 'admin',
    baseUrl: process.env.PUBLIC_BASE_URL || '',
    title: res.locals.t('meta.adminNewTitle'),
  });
});

// POST création
app.post('/admin/new', requireAdmin, (req, res) => {
  const { title, organization, country, city, type, funding, domain, deadline, duration, link, description, extra, tags, featured } =
    req.body;

  if (!title || !country || !type) {
    return res.status(400).send(res.locals.t('errors.requiredFields'));
  }

  db.insertOpportunity({
    id: Date.now(),
    title,
    organization,
    country,
    city,
    type,
    funding,
    domain,
    deadline,
    duration,
    link,
    description,
    extra,
    tags: parseTags(tags),
    featured: isFeatured(featured),
  });

  res.redirect('/admin');
});

// Formulaire édition
app.get('/admin/edit/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const opp = db.getOpportunity(id);
  if (!opp) {
    return res.status(404).send(res.locals.t('errors.notFound'));
  }
  res.render('admin-edit', {
    page: 'admin',
    baseUrl: process.env.PUBLIC_BASE_URL || '',
    title: res.locals.t('meta.adminEditTitle'),
    opp,
  });
});

// POST édition
app.post('/admin/edit/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.getOpportunity(id)) {
    return res.status(404).send(res.locals.t('errors.notFound'));
  }

  const { title, organization, country, city, type, funding, domain, deadline, duration, link, description, extra, tags, featured } =
    req.body;

  db.updateOpportunity(id, {
    title,
    organization,
    country,
    city,
    type,
    funding,
    domain,
    deadline,
    duration,
    link,
    description,
    extra,
    tags: parseTags(tags),
    featured: isFeatured(featured),
  });

  res.redirect('/admin');
});

// Suppression
app.post('/admin/delete/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.deleteOpportunity(id);
  res.redirect('/admin');
});

// --- API ---
// GET /api/opportunities avec filtres + tags
app.get('/api/opportunities', (req, res) => {
  const { country, type, funding, search, tag, status } = req.query;
  let data = db.listOpportunities();

  if (status === 'archived') {
    data = data.filter((o) => !isActiveOpportunity(o));
  } else if (status !== 'all') {
    data = data.filter((o) => isActiveOpportunity(o));
  }

  if (country) {
    data = data.filter((o) => (o.country || '').toLowerCase() === country.toLowerCase());
  }
  if (type) {
    data = data.filter((o) => (o.type || '').toLowerCase() === type.toLowerCase());
  }
  if (funding) {
    data = data.filter((o) => (o.funding || '').toLowerCase() === funding.toLowerCase());
  }
  if (tag) {
    const t = tag.toLowerCase();
    data = data.filter(
      (o) =>
        Array.isArray(o.tags) &&
        o.tags.some((tg) => (tg || '').toLowerCase() === t || (tg || '').toLowerCase().includes(t))
    );
  }
  if (search) {
    const s = search.toLowerCase();
    data = data.filter(
      (o) =>
        (o.title || '').toLowerCase().includes(s) ||
        (o.organization || '').toLowerCase().includes(s) ||
        (o.description || '').toLowerCase().includes(s) ||
        (Array.isArray(o.tags) && o.tags.join(' ').toLowerCase().includes(s))
    );
  }

  res.json(data);
});

// GET /api/opportunities/:id
app.get('/api/opportunities/:id', (req, res) => {
  const id = Number(req.params.id);
  const opp = db.getOpportunity(id);

  if (!opp) return res.status(404).json({ error: res.locals.t('errors.notFound') });
  res.json(opp);
});

// POST /api/opportunities (API publique d'ajout - à sécuriser si nécessaire)
app.post('/api/opportunities', (req, res) => {
  const body = req.body || {};
  if (!body.title || !body.country || !body.type) {
    return res.status(400).json({ error: res.locals.t('errors.apiRequired') });
  }
  const id = Date.now();
  db.insertOpportunity({
    id,
    title: body.title,
    organization: body.organization,
    country: body.country,
    city: body.city,
    type: body.type,
    funding: body.funding,
    domain: body.domain,
    deadline: body.deadline,
    duration: body.duration,
    link: body.link,
    description: body.description,
    extra: body.extra,
    tags: parseTags(body.tags),
    featured: isFeatured(body.featured),
  });
  res.status(201).json(db.getOpportunity(id));
});

app.listen(PORT, () => {
  console.log(`Opportunities by Wiem app running on http://localhost:${PORT}`);
  mailer.verify();
});

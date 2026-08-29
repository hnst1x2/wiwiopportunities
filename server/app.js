const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const site = require('./config/site');
const translations = require('./i18n/translations');

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

// --- Helpers data ---
const oppFilePath = path.join(__dirname, 'opportunities.json');
const newsletterFilePath = path.join(__dirname, 'newsletter.json');

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

function getOpportunities() {
  if (!fs.existsSync(oppFilePath)) return [];
  const raw = fs.readFileSync(oppFilePath, 'utf-8') || '[]';
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveOpportunities(data) {
  fs.writeFileSync(oppFilePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getNewsletterList() {
  if (!fs.existsSync(newsletterFilePath)) return [];
  const raw = fs.readFileSync(newsletterFilePath, 'utf-8') || '[]';
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveNewsletterList(list) {
  fs.writeFileSync(newsletterFilePath, JSON.stringify(list, null, 2), 'utf-8');
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

// Newsletter (POST)
app.post('/newsletter', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ success: false, message: res.locals.t('errors.emailRequired') });
  }
  const list = getNewsletterList();
  if (!list.includes(email)) {
    list.push(email);
    saveNewsletterList(list);
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
  const data = getOpportunities();
  res.render('admin-list', {
    page: 'admin',
    title: res.locals.t('meta.adminListTitle'),
    baseUrl: process.env.PUBLIC_BASE_URL || '',
    opportunities: data,
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

  const data = getOpportunities();
  const newOpp = {
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
    tags: tags
      ? tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    featured: featured === '1' || featured === 'on' || featured === 'true',
  };

  data.push(newOpp);
  saveOpportunities(data);

  res.redirect('/admin');
});

// Formulaire édition
app.get('/admin/edit/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const data = getOpportunities();
  const opp = data.find((o) => o.id === id);
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
  const data = getOpportunities();
  const index = data.findIndex((o) => o.id === id);
  if (index === -1) {
    return res.status(404).send(res.locals.t('errors.notFound'));
  }

  const { title, organization, country, city, type, funding, domain, deadline, duration, link, description, extra, tags, featured } =
    req.body;

  data[index] = {
    ...data[index],
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
    tags: tags
      ? tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    featured: featured === '1' || featured === 'on' || featured === 'true',
  };

  saveOpportunities(data);
  res.redirect('/admin');
});

// Suppression
app.post('/admin/delete/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  let data = getOpportunities();
  data = data.filter((o) => o.id !== id);
  saveOpportunities(data);
  res.redirect('/admin');
});

// --- API ---
// GET /api/opportunities avec filtres + tags
app.get('/api/opportunities', (req, res) => {
  const { country, type, funding, search, tag, status } = req.query;
  let data = getOpportunities();

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
  const data = getOpportunities();
  const opp = data.find((o) => o.id === id);

  if (!opp) return res.status(404).json({ error: res.locals.t('errors.notFound') });
  res.json(opp);
});

// POST /api/opportunities (API publique d'ajout - à sécuriser si nécessaire)
app.post('/api/opportunities', (req, res) => {
  const newOpp = req.body;
  if (!newOpp.title || !newOpp.country || !newOpp.type) {
    return res.status(400).json({ error: res.locals.t('errors.apiRequired') });
  }
  const data = getOpportunities();
  newOpp.id = Date.now();
  if (newOpp.tags && typeof newOpp.tags === 'string') {
    newOpp.tags = newOpp.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  data.push(newOpp);
  saveOpportunities(data);
  res.status(201).json(newOpp);
});

app.listen(PORT, () => {
  console.log(`WiwiOpportunity app running on http://localhost:${PORT}`);
});

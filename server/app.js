const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const session = require('express-session');
const site = require('./config/site');
const translations = require('./i18n/translations');
const db = require('./db');
const mailer = require('./mailer');
const importer = require('./importer');
const imageSuggestions = require('./imageSuggestions');
const usersDb = require('./usersDb');
const userRoutes = require('./userRoutes');
const SQLiteSessionStore = require('./sessionStore');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_LANG = 'fr';

// --- Middlewares globaux ---
// Behind the host-level Caddy reverse proxy in production: trust X-Forwarded-* so
// req.secure reflects the real client protocol (needed for the secure session cookie).
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
// --- Session (admin + comptes membres) ---
// Persisted in SQLite so logins survive restarts/redeploys (no MemoryStore).
app.use(
  session({
    store: new SQLiteSessionStore(),
    secret: process.env.SESSION_SECRET || 'wiwiopportunity-secret',
    resave: false,
    saveUninitialized: false,
    // sameSite=lax blocks cross-site POSTs (CSRF) on the session-protected routes;
    // secure:'auto' marks the cookie Secure whenever the request came over HTTPS.
    cookie: { sameSite: 'lax', secure: 'auto', httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 },
  })
);

// Logged-in member (or null) for every view; a stale session pointing at a
// deleted account is cleaned up on the way.
app.use((req, res, next) => {
  res.locals.user = null;
  if (req.session && req.session.userId) {
    res.locals.user = usersDb.getUserById(req.session.userId);
    if (!res.locals.user) delete req.session.userId;
  }
  next();
});

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

function getTranslation(lang, key, vars) {
  const parts = key.split('.');
  let current = translations[lang];
  for (const part of parts) {
    if (!current || typeof current !== 'object') return key;
    current = current[part];
  }
  const value = current || key;
  // {placeholder} interpolation, mirroring the client-side t() in shared.js.
  if (typeof value === 'string' && vars) {
    return value.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    );
  }
  return value;
}

app.use((req, res, next) => {
  const lang = getCookieLang(req) || DEFAULT_LANG;
  res.locals.lang = lang;
  res.locals.t = (key, vars) => getTranslation(lang, key, vars);
  res.locals.i18n = translations[lang];
  next();
});

// --- Static ---
app.use(express.static(path.join(__dirname, '../public')));

// Uploaded images live next to the SQLite file (DATA_DIR = mounted volume in production),
// so they survive image rebuilds just like the database.
const UPLOADS_DIR = path.join(process.env.DATA_DIR || __dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', immutable: true }));

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

// Admin form selects post '__custom__' when the admin typed a free-text value
// in the companion input (type_custom / funding_custom / domain_custom).
const CUSTOM_CHOICE = '__custom__';
const MAX_CHOICE_LENGTH = 60;

function resolveChoice(value, customValue) {
  const selected = String(value || '').trim();
  const resolved = selected === CUSTOM_CHOICE ? String(customValue || '').trim() : selected;
  return resolved.slice(0, MAX_CHOICE_LENGTH);
}

const MAX_IMAGES = 10;
const MAX_IMAGE_URL_LENGTH = 600;

// Accepts an array (API JSON), a JSON-array string (admin form hidden field) or a
// newline-separated list. Only absolute http(s) URLs and local /uploads/ paths survive.
function parseImages(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      list = value.split(/\r?\n/);
    }
  }
  return list
    .map((entry) => String(entry).trim())
    .filter(
      (url) =>
        url.length > 0 &&
        url.length <= MAX_IMAGE_URL_LENGTH &&
        (/^https?:\/\//i.test(url) || /^\/uploads\/[\w.-]+$/.test(url))
    )
    .slice(0, MAX_IMAGES);
}

// --- Upload d'images (admin) ---
const IMAGE_MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// The multipart Content-Type is client-controlled: after saving, verify the file
// actually starts with the magic bytes of the claimed image format.
const IMAGE_SIGNATURES = {
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  '.gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  '.webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  '.avif': (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, // ISO BMFF "ftyp" box
};

function hasValidImageSignature(filePath) {
  const matches = IMAGE_SIGNATURES[path.extname(filePath).toLowerCase()];
  if (!matches) return false;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, 12, 0);
    return bytesRead === 12 && matches(header);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Delete uploaded files that no opportunity references any more (called after edit/delete
// with the record's previous image list) so the volume doesn't fill with orphans.
function removeUnreferencedUploads(candidateUrls) {
  const candidates = (candidateUrls || []).filter((url) => /^\/uploads\/[\w.-]+$/.test(url));
  if (!candidates.length) return;
  const referenced = new Set();
  for (const opp of db.listOpportunities()) {
    for (const url of opp.images || []) referenced.add(url);
  }
  for (const url of candidates) {
    if (referenced.has(url)) continue;
    fs.unlink(path.join(UPLOADS_DIR, path.basename(url)), (err) => {
      if (err && err.code !== 'ENOENT') console.error(`[uploads] failed to remove orphan ${url}: ${err.message}`);
    });
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    // Never trust the client filename: random name + extension derived from the mimetype.
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${IMAGE_MIME_EXTENSIONS[file.mimetype]}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIME_EXTENSIONS[file.mimetype]) return cb(null, true);
    cb(new Error('UNSUPPORTED_TYPE'));
  },
});

// --- Middleware d'auth admin (simple) ---
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.redirect('/admin/login');
}

// --- Espace membre (inscription, connexion, compte, favoris) ---
app.use(userRoutes);

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
    importEnabled: importer.isConfigured(),
  });
});

// Import IA : extrait les champs d'une page web (lien) ou d'une image (affiche, scan)
// via Gemini pour pré-remplir le formulaire. Le résultat est TOUJOURS revu par l'admin
// avant enregistrement — rien n'est publié ici. L'image reste en mémoire (jamais sur disque).
const IMPORT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMPORT_IMAGE_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error('UNSUPPORTED_TYPE'));
  },
});

app.post('/admin/import', requireAdmin, (req, res) => {
  const t = res.locals.t;
  const errorMessages = {
    NOT_CONFIGURED: t('admin.importer.notConfigured'),
    INVALID_URL: t('admin.importer.invalidUrl'),
    FETCH_FAILED: t('admin.importer.fetchFailed'),
    EXTRACT_FAILED: t('admin.importer.extractFailed'),
  };

  // Multer only parses multipart bodies; JSON {url} requests pass through untouched.
  importUpload.single('image')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const message =
        uploadErr.message === 'UNSUPPORTED_TYPE'
          ? t('admin.importer.unsupportedImage')
          : uploadErr.code === 'LIMIT_FILE_SIZE'
            ? t('admin.images.tooLarge')
            : t('admin.importer.extractFailed');
      return res.status(400).json({ success: false, error: message });
    }
    try {
      const data = req.file
        ? await importer.importFromImage(req.file.buffer, req.file.mimetype)
        : await importer.importFromUrl((req.body && req.body.url) || '');
      res.json({ success: true, data });
    } catch (err) {
      console.error(`[import] ${err.message}`);
      res.status(err.code === 'NOT_CONFIGURED' ? 503 : 400).json({
        success: false,
        error: errorMessages[err.code] || t('admin.importer.extractFailed'),
      });
    }
  });
});

// POST création
app.post('/admin/new', requireAdmin, (req, res) => {
  const { title, organization, country, city, deadline, duration, link, description, extra, tags, featured, images } = req.body;
  const type = resolveChoice(req.body.type, req.body.type_custom);
  const funding = resolveChoice(req.body.funding, req.body.funding_custom);
  const domain = resolveChoice(req.body.domain, req.body.domain_custom);

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
    images: parseImages(images),
  });

  res.redirect('/admin');
});

// Suggestions d'images de destination (Wikimedia Commons, filtrées par Gemini).
// Appelé par le formulaire après un import réussi ; l'admin choisit ce qu'il ajoute.
app.get('/admin/image-suggestions', requireAdmin, async (req, res) => {
  const city = String(req.query.city || '').trim().slice(0, 80);
  const country = String(req.query.country || '').trim().slice(0, 80);
  if (!city && !country) {
    return res.status(400).json({ success: false, images: [] });
  }
  try {
    const images = await imageSuggestions.suggestImages(city, country);
    res.json({ success: true, images });
  } catch (err) {
    console.error(`[image-suggestions] ${err.message}`);
    // Suggestions are a convenience: report an empty list rather than an error state.
    res.json({ success: true, images: [] });
  }
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
  const previous = db.getOpportunity(id);
  if (!previous) {
    return res.status(404).send(res.locals.t('errors.notFound'));
  }

  const { title, organization, country, city, deadline, duration, link, description, extra, tags, featured, images } = req.body;
  const type = resolveChoice(req.body.type, req.body.type_custom);
  const funding = resolveChoice(req.body.funding, req.body.funding_custom);
  const domain = resolveChoice(req.body.domain, req.body.domain_custom);

  if (!title || !country || !type) {
    return res.status(400).send(res.locals.t('errors.requiredFields'));
  }

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
    images: parseImages(images),
  });

  removeUnreferencedUploads(previous.images);
  res.redirect('/admin');
});

// Upload d'une image (utilisé par le gestionnaire d'images du formulaire admin)
app.post('/admin/upload', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const message =
        err.message === 'UNSUPPORTED_TYPE'
          ? res.locals.t('admin.images.unsupportedType')
          : err.code === 'LIMIT_FILE_SIZE'
            ? res.locals.t('admin.images.tooLarge')
            : res.locals.t('admin.images.uploadError');
      return res.status(400).json({ success: false, error: message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: res.locals.t('admin.images.uploadError') });
    }
    if (!hasValidImageSignature(req.file.path)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, error: res.locals.t('admin.images.unsupportedType') });
    }
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
  });
});

// Suppression
app.post('/admin/delete/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const previous = db.getOpportunity(id);
  db.deleteOpportunity(id);
  if (previous) removeUnreferencedUploads(previous.images);
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
    images: parseImages(body.images),
  });
  res.status(201).json(db.getOpportunity(id));
});

app.listen(PORT, () => {
  console.log(`Opportunities by Wiem app running on http://localhost:${PORT}`);
  mailer.verify();
});

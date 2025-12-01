const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(express.urlencoded({ extended: true }));


// --- Vues EJS ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// --- Static ---
app.use(express.static(path.join(__dirname, '../public')));

// --- Data ---
const getOpportunities = () => {
  const filePath = path.join(__dirname, 'opportunities.json');
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
};

// --- Pages HTML ---
app.get('/', (req, res) => {
  res.render('index', { page: 'home', title: "WiwiOpportunity – Opportunités à l'international" });
});

app.get('/detail', (req, res) => {
  res.render('detail', { page: 'detail', title: "Détail de l'opportunité – WiwiOpportunity" });
});

// --- API ---
app.get('/api/opportunities', (req, res) => {
  const { country, type, funding, search } = req.query;
  let data = getOpportunities();

  if (country) {
    data = data.filter(o => (o.country || '').toLowerCase() === country.toLowerCase());
  }
  if (type) {
    data = data.filter(o => (o.type || '').toLowerCase() === type.toLowerCase());
  }
  if (funding) {
    data = data.filter(o => (o.funding || '').toLowerCase() === funding.toLowerCase());
  }
  if (search) {
    const s = search.toLowerCase();
    data = data.filter(o =>
      (o.title || '').toLowerCase().includes(s) ||
      (o.organization || '').toLowerCase().includes(s) ||
      (o.description || '').toLowerCase().includes(s)
    );
  }

  res.json(data);
});

app.get('/api/opportunities/:id', (req, res) => {
  const id = Number(req.params.id);
  const data = getOpportunities();
  const opp = data.find(o => o.id === id);

  if (!opp) return res.status(404).json({ error: 'Opportunité non trouvée' });
  res.json(opp);
});

app.post('/api/opportunities', (req, res) => {
  const newOpp = req.body;
  if (!newOpp.title || !newOpp.country || !newOpp.type) {
    return res.status(400).json({ error: 'title, country, type sont obligatoires' });
  }
  const filePath = path.join(__dirname, 'opportunities.json');
  const data = getOpportunities();
  newOpp.id = Date.now();
  data.push(newOpp);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  res.status(201).json(newOpp);
});



// --- Page admin : formulaire ajout opportunité ---
app.get('/admin/new', (req, res) => {
  res.render('admin-new', {
    page: 'admin',
    title: 'Ajouter une opportunité – WiwiOpportunity'
  });
});

app.post('/admin/new', (req, res) => {
  const { title, organization, country, city, type, funding, deadline, duration, link, description, extra } = req.body;

  if (!title || !country || !type) {
    return res.status(400).send("Les champs 'Titre', 'Pays' et 'Type' sont obligatoires.");
  }

  const filePath = path.join(__dirname, 'opportunities.json');
  const data = getOpportunities();

  const newOpp = {
    id: Date.now(),
    title,
    organization,
    country,
    city,
    type,
    funding,
    deadline,
    duration,
    link,
    description,
    extra
  };

  data.push(newOpp);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

  // Redirection vers la home après ajout
  res.redirect('/');
});


app.listen(PORT, () => {
  console.log(`WiwiOpportunity app running on http://localhost:${PORT}`);
});

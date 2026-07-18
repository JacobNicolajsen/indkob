require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const app     = express();

app.use(express.json());

// Strip mount prefix — LiteSpeed sends full path including /indkob to Node
app.use((req, res, next) => {
  const mount = '/indkob';
  if (req.url.startsWith(mount + '/') || req.url === mount) {
    req.url = req.url.slice(mount.length) || '/';
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Adgangskode på API'et — aktiveres ved at sætte APP_PASSWORD i .env
const APP_PASSWORD = process.env.APP_PASSWORD || '';
app.use('/api', (req, res, next) => {
  if (!APP_PASSWORD) return next();
  const given = Buffer.from(String(req.get('X-App-Key') || ''));
  const want  = Buffer.from(APP_PASSWORD);
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
  res.status(401).json({ error: 'Adgangskode påkrævet' });
});

app.use('/api/products',     require('./server/routes/products'));
app.use('/api/recipes',      require('./server/routes/recipes'));
app.use('/api/mealplan',     require('./server/routes/mealplan'));
app.use('/api/shoppinglist', require('./server/routes/shoppinglist'));
app.use('/api/ai',           require('./server/routes/ai'));
app.use('/api/notes',        require('./server/routes/notes'));
app.use('/api/settings',     require('./server/routes/settings'));
app.use('/api/ics',          require('./server/routes/ics'));
app.use('/api/staples',      require('./server/routes/staples'));

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Indkøbsassistent kører på port ${PORT}`));

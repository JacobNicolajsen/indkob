const express = require('express');
const path    = require('path');
const fs      = require('fs');
const app     = express();

app.use(express.json());

// Debug: log every request URL to file so we can see what LiteSpeed sends
app.use((req, res, next) => {
  fs.appendFileSync(
    path.join(__dirname, 'access.log'),
    `${new Date().toISOString()} ${req.method} "${req.url}"\n`
  );
  next();
});

// Debug endpoint — returns the raw URL before any stripping
app.get('/_debug', (req, res) => res.json({ url: req.url, pid: process.pid }));
app.get('/indkob/_debug', (req, res) => res.json({ url: req.url, pid: process.pid }));

// Strip mount prefix when deployed at a subpath (e.g. /indkob via cPanel Passenger)
app.use((req, res, next) => {
  const mount = '/indkob';
  if (req.url.startsWith(mount + '/') || req.url === mount) {
    req.url = req.url.slice(mount.length) || '/';
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/products',     require('./server/routes/products'));
app.use('/api/recipes',      require('./server/routes/recipes'));
app.use('/api/mealplan',     require('./server/routes/mealplan'));
app.use('/api/shoppinglist', require('./server/routes/shoppinglist'));

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Indkøbsassistent kører på port ${PORT}`));

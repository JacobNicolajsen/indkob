require('dotenv').config();
const express = require('express');
const path    = require('path');
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

app.use('/api/products',     require('./server/routes/products'));
app.use('/api/recipes',      require('./server/routes/recipes'));
app.use('/api/mealplan',     require('./server/routes/mealplan'));
app.use('/api/shoppinglist', require('./server/routes/shoppinglist'));
app.use('/api/ai',           require('./server/routes/ai'));

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Indkøbsassistent kører på port ${PORT}`));

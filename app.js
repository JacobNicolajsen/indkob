const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json());

// Strip mount prefix when deployed at a subpath (e.g. /indkob via cPanel Passenger)
app.use((req, res, next) => {
  const mount = process.env.MOUNT_PATH || '';
  if (mount && req.url.startsWith(mount)) {
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

import { renderMealplan }     from './views/mealplan.js';
import { renderRecipes }      from './views/recipes.js';
import { renderShoppinglist } from './views/shoppinglist.js';
import { renderCatalog }      from './views/catalog.js';
import { renderMore }         from './views/more.js';
import { renderStaples }      from './views/staples.js';

export const state = { view: 'mealplan' };

// Katalog er sub-side under "Mere" — ingen egen nav-knap
const views = {
  mealplan:     { title: 'Madplan',     render: renderMealplan,     navKey: 'mealplan' },
  recipes:      { title: 'Opskrifter',  render: renderRecipes,      navKey: 'recipes' },
  staples:      { title: 'Basisvarer',  render: renderStaples,      navKey: 'staples' },
  shoppinglist: { title: 'Indkøb',      render: renderShoppinglist, navKey: 'shoppinglist' },
  catalog:      { title: 'Varekatalog', render: renderCatalog,      navKey: 'more' },
  more:         { title: 'Mere',        render: renderMore,          navKey: 'more' },
};

export function navigate(viewKey, opts = {}) {
  const def = views[viewKey];
  if (!def) return;

  state.view = viewKey;

  // Nav-bar aktiv state
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === def.navKey);
  });

  document.getElementById('page-title').textContent = def.title;
  document.getElementById('top-actions').innerHTML = '';

  // Back-knap til sub-sider
  const topLeft = document.getElementById('top-left');
  if (opts.backTo) {
    topLeft.innerHTML = `<button class="top-action" id="btn-back" style="font-size:1.7rem;padding:2px 6px" title="Tilbage">‹</button>`;
    topLeft.querySelector('#btn-back').addEventListener('click', () => navigate(opts.backTo));
  } else {
    topLeft.innerHTML = '';
  }

  const container = document.getElementById('view-container');
  container.innerHTML = '';
  container.scrollTop = 0;
  def.render(container);
}

// ── Modal / Bottom Sheet ─────────────────────────────────────────

export function openSheet(title, content, onClose) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">${title}</div>
        <div id="sheet-body" style="padding:0 20px"></div>
      </div>
    </div>`;

  document.getElementById('sheet-body').appendChild(content);

  const close = () => { root.innerHTML = ''; onClose?.(); };
  document.getElementById('overlay').addEventListener('click', e => {
    if (e.target.id === 'overlay') close();
  });
  return close;
}

export function closeSheet() {
  document.getElementById('modal-root').innerHTML = '';
}

// ── Lag 2 — picker oven på en eksisterende sheet ─────────────────

export function openSheet2(title, content, onClose) {
  const root = document.getElementById('modal-root2');
  root.innerHTML = `
    <div class="overlay" id="overlay2">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">${title}</div>
        <div id="sheet-body2" style="padding:0 20px"></div>
      </div>
    </div>`;

  document.getElementById('sheet-body2').appendChild(content);

  const close = () => { root.innerHTML = ''; onClose?.(); };
  document.getElementById('overlay2').addEventListener('click', e => {
    if (e.target.id === 'overlay2') close();
  });
  return close;
}

export function closeSheet2() {
  document.getElementById('modal-root2').innerHTML = '';
}

// ── Toast ────────────────────────────────────────────────────────

export function toast(msg, duration = 2500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── Top-bar helpers ──────────────────────────────────────────────

export function setTopActions(html) {
  document.getElementById('top-actions').innerHTML = html;
}

// ── Print via Blob-URL — virker i PWA/webapp på iOS ─────────────
// Navigerer samme tab til en blob: HTML-side med toolbar.
// Brugeren trykker Print eller bruger Del-knappen i Safari.

export function printHtml(bodyHtml) {
  const fullHtml = `<!DOCTYPE html><html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Print</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    .ptb{
      position:fixed;top:0;left:0;right:0;
      background:#1E1410;color:#fff;
      display:flex;align-items:center;gap:10px;
      padding:12px 16px;z-index:100;
    }
    .ptb button{
      background:none;border:1px solid rgba(255,255,255,.35);
      color:#fff;border-radius:8px;padding:7px 14px;
      font-size:.9rem;cursor:pointer;
    }
    .ptb .pbtn{background:#B85C38;border-color:#B85C38;font-weight:600}
    body{padding-top:56px}
    @media print{.ptb{display:none}body{padding-top:0}}
  </style>
</head>
<body>
  <div class="ptb">
    <button onclick="history.back()">‹ Tilbage</button>
    <button class="pbtn" onclick="window.print()">🖨️ Print</button>
  </div>
  ${bodyHtml}
</body>
</html>`;

  const blob = new Blob([fullHtml], { type: 'text/html' });
  window.location.href = URL.createObjectURL(blob);
}

// ── Init ─────────────────────────────────────────────────────────

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(console.warn);
}

navigate('mealplan');

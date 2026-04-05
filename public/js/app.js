import { renderMealplan }     from './views/mealplan.js';
import { renderRecipes }      from './views/recipes.js';
import { renderShoppinglist } from './views/shoppinglist.js';
import { renderCatalog }      from './views/catalog.js';
import { renderMore }         from './views/more.js';

export const state = { view: 'mealplan' };

// Katalog er en sub-side under "Mere" — ingen egen nav-knap
const views = {
  mealplan:     { title: 'Madplan',     render: renderMealplan,     navKey: 'mealplan' },
  recipes:      { title: 'Opskrifter',  render: renderRecipes,      navKey: 'recipes' },
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

// ── Init ─────────────────────────────────────────────────────────

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(console.warn);
}

navigate('mealplan');

import { shoppinglist as api } from '../api.js';
import { openSheet, closeSheet, toast, setTopActions } from '../app.js';
import { UNITS } from '../constants.js';

const SHOP_CATEGORIES = [
  'Frugt & Grønt', 'Kød & Fisk', 'Mejeri & Æg', 'Brød & Bageri',
  'Kolonial', 'Frost', 'Drikkevarer', 'Husholdning', 'Andet'
];

const CAT_ICONS = {
  'Frugt & Grønt': '🥕', 'Kød & Fisk': '🥩', 'Mejeri & Æg': '🥛',
  'Brød & Bageri': '🍞', 'Kolonial': '🥫', 'Frost': '❄️',
  'Drikkevarer': '🍺', 'Husholdning': '🧴', 'Andet': '📦'
};

let items = [];

export async function renderShoppinglist(container) {
  container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-muted)">Henter indkøbsliste…</div>';

  setTopActions(`
    <button class="top-action" id="btn-shop-menu" title="Muligheder">⋯</button>
  `);

  try {
    items = await api.list();
  } catch (e) {
    container.innerHTML = `<div class="card" style="color:red">${e.message}</div>`;
    return;
  }

  renderList(container);

  document.getElementById('btn-shop-menu')?.addEventListener('click', () => {
    showMenu(container);
  });
}

function renderList(container) {
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--ink-muted)">
        <div style="font-size:3.5rem;margin-bottom:16px">🛒</div>
        <div style="font-weight:600;font-size:1.05rem;margin-bottom:6px">Indkøbslisten er tom</div>
        <div style="font-size:0.9rem">Generer fra madplanen eller tilføj varer manuelt</div>
      </div>`;
  } else {
    // Gruppér
    const groups = {};
    for (const item of items) {
      const cat = item.shop_category || 'Andet';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }

    const unchecked = items.filter(i => !i.checked).length;
    const summary = document.createElement('div');
    summary.style.cssText = 'padding:12px 16px 4px;font-size:0.85rem;color:#6B7280';
    summary.textContent = `${unchecked} af ${items.length} varer mangler`;
    container.appendChild(summary);

    for (const cat of SHOP_CATEGORIES) {
      if (!groups[cat]) continue;
      const section = document.createElement('div');
      section.innerHTML = `<div class="section-header">${CAT_ICONS[cat] || '📦'} ${cat}</div>`;

      const listEl = document.createElement('div');
      listEl.style.cssText = 'background:#fff;border-radius:12px;margin:0 16px 8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)';

      for (const item of groups[cat]) {
        listEl.appendChild(buildShopItem(item, container));
      }

      section.appendChild(listEl);
      container.appendChild(section);
    }
  }

  // FAB — tilføj vare
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = 'Tilføj vare';
  fab.textContent = '+';
  fab.addEventListener('click', () => openAddItemSheet(container));
  container.appendChild(fab);

  // Bund-padding
  const spacer = document.createElement('div');
  spacer.style.height = '80px';
  container.appendChild(spacer);
}

function buildShopItem(item, container) {
  const el = document.createElement('div');
  el.className = `shop-item ${item.checked ? 'checked' : ''}`;
  el.dataset.id = item.id;

  const amountText = item.amount
    ? `${Number(item.amount) % 1 === 0 ? item.amount : item.amount} ${item.unit || ''}`.trim()
    : item.unit || '';

  el.innerHTML = `
    <div class="shop-check" title="Marker"></div>
    <span class="shop-name">${item.name}</span>
    ${amountText ? `<span class="shop-amount">${amountText}</span>` : ''}
    <button class="shop-delete" title="Fjern">🗑</button>
  `;

  el.querySelector('.shop-check').addEventListener('click', async (e) => {
    e.stopPropagation();
    const newVal = !item.checked;
    item.checked = newVal;
    el.classList.toggle('checked', newVal);
    try {
      await api.toggleCheck(item.id, newVal);
    } catch { item.checked = !newVal; el.classList.toggle('checked', !newVal); }
  });

  el.querySelector('.shop-delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    await api.deleteItem(item.id);
    items = items.filter(i => i.id !== item.id);
    renderList(container);
  });

  return el;
}

function openAddItemSheet(container) {
  const frag = document.createElement('div');

  const catOptions = SHOP_CATEGORIES.map(c =>
    `<option value="${c}">${CAT_ICONS[c]} ${c}</option>`
  ).join('');

  frag.innerHTML = `
    <div class="form-group">
      <label class="form-label">Varenavn *</label>
      <input class="form-input" id="item-name" placeholder="fx Mælk" autocomplete="off">
      <div id="item-suggestions" style="margin-top:4px"></div>
    </div>
    <div style="display:flex;gap:10px">
      <div class="form-group" style="flex:1">
        <label class="form-label">Mængde</label>
        <input class="form-input" id="item-amount" type="number" step="any" placeholder="2">
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Enhed</label>
        <input class="form-input" id="item-unit" placeholder="stk / L / kg">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Kategori</label>
      <select class="form-select" id="item-category">${catOptions}</select>
    </div>
    <button class="btn btn-primary btn-full" id="btn-add-item">Tilføj vare</button>
    <div style="height:12px"></div>
  `;

  openSheet('Tilføj vare', frag);

  // Auto-komplet fra bibliotek
  let library = [];
  api.library.list().then(lib => { library = lib; }).catch(() => {});

  let suggestTimeout;
  frag.querySelector('#item-name').addEventListener('input', e => {
    clearTimeout(suggestTimeout);
    suggestTimeout = setTimeout(() => {
      const q = e.target.value.toLowerCase();
      const sugg = frag.querySelector('#item-suggestions');
      if (!q || library.length === 0) { sugg.innerHTML = ''; return; }
      const matches = library.filter(i => i.name.toLowerCase().includes(q)).slice(0, 5);
      sugg.innerHTML = matches.map(m =>
        `<div class="list-item" style="border-radius:8px;padding:10px 12px;font-size:0.9rem" data-id="${m.id}" data-name="${m.name}" data-unit="${m.unit}" data-cat="${m.shop_category}">
          ${CAT_ICONS[m.shop_category] || '📦'} ${m.name} <span style="color:var(--ink-muted);font-size:0.8rem">${m.unit}</span>
        </div>`
      ).join('');

      sugg.querySelectorAll('.list-item').forEach(el => {
        el.addEventListener('click', () => {
          frag.querySelector('#item-name').value = el.dataset.name;
          frag.querySelector('#item-unit').value = el.dataset.unit;
          const sel = frag.querySelector('#item-category');
          [...sel.options].forEach(o => { if (o.value === el.dataset.cat) o.selected = true; });
          sugg.innerHTML = '';
        });
      });
    }, 200);
  });

  frag.querySelector('#btn-add-item').addEventListener('click', async () => {
    const name = frag.querySelector('#item-name').value.trim();
    if (!name) { toast('Navn er påkrævet'); return; }
    try {
      const newItem = await api.addItem({
        name,
        amount:        parseFloat(frag.querySelector('#item-amount').value) || null,
        unit:          frag.querySelector('#item-unit').value.trim(),
        shop_category: frag.querySelector('#item-category').value,
      });
      items.push({
        id:            newItem.id,
        name,
        amount:        parseFloat(frag.querySelector('#item-amount').value) || null,
        unit:          frag.querySelector('#item-unit').value.trim(),
        shop_category: frag.querySelector('#item-category').value,
        checked:       false,
        source:        'custom'
      });
      closeSheet();
      renderList(container);
      toast(`${name} tilføjet`);
    } catch (e) {
      toast('Fejl: ' + e.message);
    }
  });
}

function showMenu(container) {
  const frag = document.createElement('div');
  frag.innerHTML = `
    <div style="padding-bottom:8px">
      <div class="list-item" id="m-clear-checked">
        <span style="font-size:1.3rem">✓</span>
        <div>
          <div style="font-weight:600">Fjern afkrydsede varer</div>
          <div style="font-size:0.8rem;color:var(--ink-muted)">Beholder ikke-afkrydsede</div>
        </div>
      </div>
      <div class="list-item" id="m-clear-all" style="color:#B71C1C">
        <span style="font-size:1.3rem">🗑</span>
        <div>
          <div style="font-weight:600">Ryd hele listen</div>
          <div style="font-size:0.8rem;color:var(--ink-muted)">Sletter alle varer</div>
        </div>
      </div>
      <div class="list-item" id="m-library">
        <span style="font-size:1.3rem">📚</span>
        <div>
          <div style="font-weight:600">Varebiblotek</div>
          <div style="font-size:0.8rem;color:var(--ink-muted)">Administrer faste varer</div>
        </div>
      </div>
    </div>
  `;

  openSheet('Indkøbsliste — muligheder', frag);

  frag.querySelector('#m-clear-checked').addEventListener('click', async () => {
    await api.clear(true);
    items = items.filter(i => !i.checked);
    closeSheet();
    renderList(container);
    toast('Afkrydsede varer fjernet');
  });

  frag.querySelector('#m-clear-all').addEventListener('click', async () => {
    if (!confirm('Ryd hele indkøbslisten?')) return;
    await api.clear(false);
    items = [];
    closeSheet();
    renderList(container);
    toast('Listen er ryddet');
  });

  frag.querySelector('#m-library').addEventListener('click', () => {
    closeSheet();
    openLibrarySheet(container);
  });
}

async function openLibrarySheet(container) {
  let library = [];
  try { library = await api.library.list(); } catch { library = []; }

  const frag = document.createElement('div');

  const renderLib = () => {
    const list = frag.querySelector('#lib-list');
    list.innerHTML = library.length === 0
      ? '<p style="color:var(--ink-muted);text-align:center;padding:16px">Biblioteket er tomt</p>'
      : library.map(item => `
          <div class="list-item" style="gap:10px">
            <span>${CAT_ICONS[item.shop_category] || '📦'}</span>
            <div style="flex:1">
              <div style="font-weight:500">${item.name}</div>
              <div style="font-size:0.8rem;color:var(--ink-muted)">${item.shop_category}${item.unit ? ' · ' + item.unit : ''}</div>
            </div>
            <button class="btn btn-sm btn-danger lib-del" data-id="${item.id}">✕</button>
          </div>`
        ).join('');

    list.querySelectorAll('.lib-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.library.delete(btn.dataset.id);
        library = library.filter(i => i.id != btn.dataset.id);
        renderLib();
      });
    });
  };

  const catOptions = SHOP_CATEGORIES.map(c =>
    `<option value="${c}">${CAT_ICONS[c]} ${c}</option>`
  ).join('');

  frag.innerHTML = `
    <div style="background:#f4f6f4;border-radius:12px;padding:14px;margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:10px">Tilføj til bibliotek</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="form-input" id="lib-name" placeholder="Varenavn" style="flex:2;min-width:120px">
        <input class="form-input" id="lib-unit" placeholder="Enhed" style="flex:1;min-width:70px">
        <select class="form-select" id="lib-cat" style="flex:2;min-width:120px">${catOptions}</select>
        <button class="btn btn-primary" id="lib-add">Tilføj</button>
      </div>
    </div>
    <div id="lib-list"></div>
    <div style="height:12px"></div>
  `;

  openSheet('Varebiblotek', frag);
  renderLib();

  frag.querySelector('#lib-add').addEventListener('click', async () => {
    const name = frag.querySelector('#lib-name').value.trim();
    if (!name) { toast('Navn er påkrævet'); return; }
    try {
      await api.library.add({
        name,
        unit:          frag.querySelector('#lib-unit').value.trim(),
        shop_category: frag.querySelector('#lib-cat').value,
      });
      library = await api.library.list();
      frag.querySelector('#lib-name').value = '';
      frag.querySelector('#lib-unit').value = '';
      renderLib();
      toast(`${name} tilføjet til bibliotek`);
    } catch (e) {
      toast(e.message);
    }
  });
}

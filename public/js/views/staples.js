import { staples as api, products as productsApi } from '../api.js';
import { openSheet, closeSheet, toast, setTopActions } from '../app.js';

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
let editMode = false;

export async function renderStaples(container) {
  container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-muted)">Henter basisvarer…</div>';

  editMode = false;

  function updateTopActions() {
    setTopActions(`
      <button class="top-action${editMode ? ' top-action--active' : ''}" id="btn-edit-staples" title="Rediger">✏️</button>
      <button class="top-action" id="btn-add-staple" title="Tilføj basisvare">＋</button>
    `);
    document.getElementById('btn-edit-staples')?.addEventListener('click', () => {
      editMode = !editMode;
      updateTopActions();
      renderList(container);
    });
    document.getElementById('btn-add-staple')?.addEventListener('click', () => {
      openAddSheet(container);
    });
  }

  try {
    items = await api.list();
  } catch (e) {
    container.innerHTML = `<div class="card" style="color:red">${e.message}</div>`;
    return;
  }

  updateTopActions();
  renderList(container);
}

function renderList(container) {
  container.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:48px 20px;color:var(--ink-muted)';
    empty.innerHTML = `
      <div style="font-size:3rem;margin-bottom:14px">📦</div>
      <div style="font-weight:600;font-size:1.05rem;margin-bottom:6px">Ingen basisvarer endnu</div>
      <div style="font-size:0.9rem">Tryk + for at tilføje faste varer</div>`;
    container.appendChild(empty);
  } else {
    // Gruppér pr. kategori
    const groups = {};
    for (const item of items) {
      const cat = item.shop_category || 'Andet';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }

    for (const cat of SHOP_CATEGORIES) {
      if (!groups[cat]) continue;
      const section = document.createElement('div');
      section.innerHTML = `<div class="section-header">${CAT_ICONS[cat] || '📦'} ${cat}</div>`;

      const listEl = document.createElement('div');
      listEl.style.cssText = 'background:#fff;border-radius:12px;margin:0 16px 8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)';

      for (const item of groups[cat]) {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.style.cursor = 'pointer';
        const amt = item.amount ? `${item.amount} ${item.unit || ''}`.trim() : (item.unit || '');
        row.innerHTML = `
          <span style="font-size:1.2rem;color:var(--sage)">🛒</span>
          <div style="flex:1">
            <div style="font-weight:500">${item.name}</div>
            ${amt ? `<div style="font-size:0.8rem;color:var(--ink-muted)">${amt}</div>` : ''}
          </div>
          <button class="btn btn-sm btn-danger staple-del" data-id="${item.id}" title="Fjern"
            style="display:${editMode ? 'inline-flex' : 'none'}">✕</button>`;

        row.addEventListener('click', async () => {
          try {
            await api.addToList([item.id]);
            toast(`${item.name} tilføjet`);
          } catch (e) {
            toast('Fejl: ' + e.message);
          }
        });

        listEl.appendChild(row);
      }

      section.appendChild(listEl);
      container.appendChild(section);
    }
  }

  const spacer = document.createElement('div');
  spacer.style.height = '80px';
  container.appendChild(spacer);

  container.querySelectorAll('.staple-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.delete(btn.dataset.id);
      items = items.filter(i => i.id != btn.dataset.id);
      renderList(container);
    });
  });
}

function openAddSheet(container) {
  const catOptions = SHOP_CATEGORIES.map(c =>
    `<option value="${c}">${CAT_ICONS[c]} ${c}</option>`
  ).join('');

  const frag = document.createElement('div');
  frag.innerHTML = `
    <div class="form-group">
      <label class="form-label">Varenavn *</label>
      <input class="form-input" id="st-name" placeholder="fx Mælk" autocomplete="off">
      <div id="st-suggestions" style="margin-top:4px"></div>
    </div>
    <div style="display:flex;gap:10px">
      <div class="form-group" style="flex:1">
        <label class="form-label">Mængde</label>
        <input class="form-input" id="st-amount" type="number" step="any" placeholder="2">
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Enhed</label>
        <input class="form-input" id="st-unit" placeholder="stk / L / kg">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Kategori</label>
      <select class="form-select" id="st-category">${catOptions}</select>
    </div>
    <button class="btn btn-primary btn-full" id="btn-save-staple">Gem basisvare</button>
    <div style="height:12px"></div>
  `;

  openSheet('Ny basisvare', frag);

  // Produktsøgning
  let suggestTimeout;
  frag.querySelector('#st-name').addEventListener('input', e => {
    clearTimeout(suggestTimeout);
    const q = e.target.value.trim();
    const sugg = frag.querySelector('#st-suggestions');
    if (!q) { sugg.innerHTML = ''; return; }

    suggestTimeout = setTimeout(async () => {
      let matches = [];
      try { matches = await productsApi.list({ search: q }); } catch { return; }
      matches = matches.slice(0, 6);
      sugg.innerHTML = matches.map(m =>
        `<div class="list-item" style="border-radius:8px;padding:10px 12px;font-size:0.9rem"
              data-name="${m.name}" data-unit="${m.default_unit}" data-cat="${m.shop_category}">
          ${CAT_ICONS[m.shop_category] || '📦'} ${m.name}
          <span style="color:var(--ink-muted);font-size:0.8rem">${m.default_unit}</span>
        </div>`
      ).join('');

      sugg.querySelectorAll('.list-item').forEach(el => {
        el.addEventListener('click', () => {
          frag.querySelector('#st-name').value = el.dataset.name;
          frag.querySelector('#st-unit').value = el.dataset.unit;
          const sel = frag.querySelector('#st-category');
          [...sel.options].forEach(o => { if (o.value === el.dataset.cat) o.selected = true; });
          sugg.innerHTML = '';
        });
      });
    }, 250);
  });

  frag.querySelector('#btn-save-staple').addEventListener('click', async () => {
    const name = frag.querySelector('#st-name').value.trim();
    if (!name) { toast('Navn er påkrævet'); return; }

    try {
      await api.add({
        name,
        amount:        parseFloat(frag.querySelector('#st-amount').value) || null,
        unit:          frag.querySelector('#st-unit').value.trim(),
        shop_category: frag.querySelector('#st-category').value,
      });
      items = await api.list();
      closeSheet();
      renderList(container);
      toast(`${name} tilføjet`);
    } catch (e) {
      toast('Fejl: ' + e.message);
    }
  });
}

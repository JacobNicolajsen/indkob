import { shoppinglist as api, products as productsApi, settings as settingsApi, ai } from '../api.js';
import { openSheet, closeSheet, toast, setTopActions, printHtml, esc } from '../app.js';
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
let categoryOrder = null; // brugerdefineret butik-rækkefølge (fra settings)

/** Kategorier i brugerens rækkefølge; nye kategorier havner bagerst */
function orderedCategories() {
  if (!categoryOrder) return SHOP_CATEGORIES;
  return [...categoryOrder.filter(c => SHOP_CATEGORIES.includes(c)),
          ...SHOP_CATEGORIES.filter(c => !categoryOrder.includes(c))];
}

export async function renderShoppinglist(container) {
  container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-muted)">Henter indkøbsliste…</div>';

  setTopActions(`
    <button class="top-action" id="btn-shop-print" title="Print indkøbsliste">🖨️</button>
    <button class="top-action" id="btn-shop-menu"  title="Muligheder">⋯</button>
  `);

  try {
    items = await api.list();
  } catch (e) {
    container.innerHTML = `<div class="card" style="color:red">${esc(e.message)}</div>`;
    return;
  }

  // Hent butik-rækkefølge (én gang pr. session er nok, men billigt at opdatere)
  try {
    const s = await settingsApi.getAll();
    categoryOrder = s.category_order ? JSON.parse(s.category_order) : null;
  } catch { /* behold default */ }

  renderList(container);

  document.getElementById('btn-shop-print')?.addEventListener('click', () => {
    printShoppingList();
  });
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

    for (const cat of orderedCategories()) {
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

  // Kilde-labels (hvilke retter + datoer)
  let sourcesHtml = '';
  if (item.source === 'recipe' && item.sources) {
    try {
      const srcs = typeof item.sources === 'string' ? JSON.parse(item.sources) : item.sources;
      if (srcs?.length) {
        const DAY = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
        const labels = srcs.map(s => {
          const d   = new Date(s.date + 'T00:00:00');
          const day = DAY[d.getDay()];
          const dt  = d.toLocaleDateString('da-DK', { day:'numeric', month:'numeric' });
          return esc(`${s.recipe_name} · ${day} ${dt}`);
        });
        sourcesHtml = `<span class="shop-sources">${labels.join(' &nbsp;·&nbsp; ')}</span>`;
      }
    } catch { /* ignorer parse-fejl */ }
  }

  el.innerHTML = `
    <div class="shop-check" title="Marker"></div>
    <div class="shop-name-wrap">
      <span class="shop-name">${esc(item.name)}</span>
      ${sourcesHtml}
    </div>
    ${amountText ? `<span class="shop-amount">${esc(amountText)}</span>` : ''}
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
    <button class="btn btn-outline btn-sm btn-full" id="btn-quick-toggle" style="margin-top:10px">
      ✨ Skriv flere varer på én gang
    </button>
    <div id="quick-wrap" style="display:none;margin-top:10px">
      <textarea class="form-textarea" id="quick-text" rows="3"
        placeholder="fx 2 L mælk, rugbrød og 400 g hakket oksekød"></textarea>
      <button class="btn btn-primary btn-full" id="btn-quick-go" style="margin-top:8px">Tilføj varer</button>
      <div id="quick-status" style="margin-top:8px;font-size:0.85rem;color:var(--ink-muted)"></div>
    </div>
    <div style="height:12px"></div>
  `;

  openSheet('Tilføj vare', frag);

  // ── AI hurtig-tilføj: fritekst → varer ──────────────────────────
  frag.querySelector('#btn-quick-toggle').addEventListener('click', () => {
    const wrap = frag.querySelector('#quick-wrap');
    wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    if (wrap.style.display === 'block') frag.querySelector('#quick-text').focus();
  });

  frag.querySelector('#btn-quick-go').addEventListener('click', async () => {
    const text = frag.querySelector('#quick-text').value.trim();
    if (!text) { toast('Skriv hvad du mangler'); return; }

    const goBtn  = frag.querySelector('#btn-quick-go');
    const status = frag.querySelector('#quick-status');
    goBtn.disabled = true;
    status.textContent = 'Claude læser din tekst…';

    try {
      const { items: parsed } = await ai.parseItems(text);
      for (const it of parsed) await api.addItem(it);
      closeSheet();
      toast(`${parsed.length} varer tilføjet`);
      renderShoppinglist(container);
    } catch (e) {
      status.textContent = '⚠️ ' + e.message;
      goBtn.disabled = false;
    }
  });

  // Auto-komplet fra produktkatalog
  let suggestTimeout;
  frag.querySelector('#item-name').addEventListener('input', e => {
    clearTimeout(suggestTimeout);
    const q = e.target.value.trim();
    const sugg = frag.querySelector('#item-suggestions');
    if (!q) { sugg.innerHTML = ''; return; }

    suggestTimeout = setTimeout(async () => {
      let matches = [];
      try { matches = await productsApi.list({ search: q }); } catch { return; }
      matches = matches.slice(0, 6);
      sugg.innerHTML = matches.map(m =>
        `<div class="list-item" style="border-radius:8px;padding:10px 12px;font-size:0.9rem"
              data-name="${esc(m.name)}" data-unit="${esc(m.default_unit)}" data-cat="${esc(m.shop_category)}">
          ${CAT_ICONS[m.shop_category] || '📦'} ${esc(m.name)}
          <span style="color:var(--ink-muted);font-size:0.8rem">${esc(m.default_unit)}</span>
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
    }, 250);
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
      <div class="list-item" id="m-share">
        <span style="font-size:1.3rem">📤</span>
        <div>
          <div style="font-weight:600">Del liste</div>
          <div style="font-size:0.8rem;color:var(--ink-muted)">Send som tekst til fx Beskeder</div>
        </div>
      </div>
      <div class="list-item" id="m-order">
        <span style="font-size:1.3rem">🔀</span>
        <div>
          <div style="font-weight:600">Butik-rækkefølge</div>
          <div style="font-size:0.8rem;color:var(--ink-muted)">Sortér kategorier efter din rute i butikken</div>
        </div>
      </div>
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

  frag.querySelector('#m-share').addEventListener('click', async () => {
    closeSheet();
    await shareList();
  });

  frag.querySelector('#m-order').addEventListener('click', () => {
    closeSheet();
    openOrderSheet(container);
  });

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

// ── Del liste som tekst (Web Share API med clipboard-fallback) ────
async function shareList() {
  const unchecked = items.filter(i => !i.checked);
  if (unchecked.length === 0) { toast('Ingen varer at dele'); return; }

  const groups = {};
  for (const item of unchecked) {
    const cat = item.shop_category || 'Andet';
    (groups[cat] ||= []).push(item);
  }

  const lines = [`🛒 Indkøbsliste ${new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'numeric' })}`];
  for (const cat of orderedCategories()) {
    if (!groups[cat]) continue;
    lines.push('', `${CAT_ICONS[cat] || '📦'} ${cat}:`);
    for (const item of groups[cat]) {
      const amt = item.amount ? ` — ${item.amount} ${item.unit || ''}`.trimEnd() : (item.unit ? ` — ${item.unit}` : '');
      lines.push(`• ${item.name}${amt}`);
    }
  }
  const text = lines.join('\n');

  if (navigator.share) {
    try { await navigator.share({ text }); return; }
    catch (e) { if (e.name === 'AbortError') return; /* ellers fallback */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Listen er kopieret til udklipsholderen');
  } catch {
    toast('Kunne ikke dele listen');
  }
}

// ── Butik-rækkefølge: sortér kategorier med ▲▼ ────────────────────
function openOrderSheet(container) {
  const order = [...orderedCategories()];
  const frag  = document.createElement('div');

  const save = async () => {
    categoryOrder = [...order];
    try { await settingsApi.set('category_order', JSON.stringify(order)); }
    catch (e) { toast('Kunne ikke gemme rækkefølgen: ' + e.message); }
  };

  const renderRows = () => {
    const list = frag.querySelector('#order-list');
    list.innerHTML = '';
    order.forEach((cat, idx) => {
      const row = document.createElement('div');
      row.className = 'list-item';
      row.style.cursor = 'default';
      row.innerHTML = `
        <span style="font-size:1.2rem;width:26px;text-align:center">${CAT_ICONS[cat] || '📦'}</span>
        <span style="flex:1;font-weight:500">${esc(cat)}</span>
        <button class="btn btn-sm btn-outline ord-up"   ${idx === 0 ? 'disabled' : ''} style="padding:4px 10px">▲</button>
        <button class="btn btn-sm btn-outline ord-down" ${idx === order.length - 1 ? 'disabled' : ''} style="padding:4px 10px">▼</button>`;

      row.querySelector('.ord-up').addEventListener('click', async () => {
        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        renderRows(); await save();
      });
      row.querySelector('.ord-down').addEventListener('click', async () => {
        [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
        renderRows(); await save();
      });
      list.appendChild(row);
    });
  };

  frag.innerHTML = `
    <p style="font-size:0.85rem;color:var(--ink-muted);margin-bottom:12px;line-height:1.5">
      Flyt kategorierne så de matcher din rute gennem butikken. Rækkefølgen bruges i listen og ved print.
    </p>
    <div id="order-list" style="background:var(--bg);border-radius:12px;overflow:hidden;margin-bottom:12px"></div>
    <div style="height:8px"></div>`;

  openSheet('Butik-rækkefølge', frag, () => renderList(container));
  renderRows();
}

function printShoppingList() {
  if (items.length === 0) { toast('Indkøbslisten er tom'); return; }

  const groups = {};
  for (const item of items) {
    const cat = item.shop_category || 'Andet';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  const activeCats = orderedCategories().filter(c => groups[c]);

  const makeCatHtml = cat => {
    const rowsHtml = groups[cat].map(item => {
      const amt = item.amount
        ? `${item.amount} ${item.unit || ''}`.trim()
        : (item.unit || '');
      return `<div class="item${item.checked ? ' done' : ''}">
        <span class="chk">${item.checked ? '☑' : '☐'}</span>
        <span class="nm">${esc(item.name)}</span>
        ${amt ? `<span class="am">${esc(amt)}</span>` : ''}
      </div>`;
    }).join('');
    return `<div class="cat">
      <div class="ch">${CAT_ICONS[cat] || '📦'} ${cat}</div>
      ${rowsHtml}
    </div>`;
  };

  // Split manuelt i to kolonner så iOS print-renderer respekterer layoutet
  const mid = Math.ceil(activeCats.length / 2);
  const leftHtml  = activeCats.slice(0, mid).map(makeCatHtml).join('');
  const rightHtml = activeCats.slice(mid).map(makeCatHtml).join('');

  const unchecked = items.filter(i => !i.checked).length;
  const dateStr   = new Date().toLocaleDateString('da-DK', { weekday:'long', day:'numeric', month:'long' });

  const html = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
body,#print-overlay{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:13px}
.pr-wrap{max-width:900px;margin:0 auto;padding:20px 24px}
h1{font-size:1.4rem;font-weight:700;margin-bottom:2px}
.sub{font-size:.85rem;color:#555;margin-bottom:16px}
.cols{display:table;width:100%;table-layout:fixed}.col{display:table-cell;width:50%;vertical-align:top;padding-right:20px}.col+.col{padding-right:0;padding-left:12px}
.cat{margin-bottom:16px;break-inside:avoid}
.ch{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:5px;padding-bottom:4px;border-bottom:2px solid #ccc}
.item{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid #eee}
.chk{font-size:.95rem;flex-shrink:0;color:#444;width:16px}
.nm{flex:1;font-size:.92rem;line-height:1.3}
.am{font-size:.88rem;color:#444;font-weight:600;text-align:right;flex-shrink:0;white-space:nowrap}
.done .nm{text-decoration:line-through;opacity:.35}
.foot{margin-top:20px;font-size:.7rem;color:#aaa;border-top:1px solid #eee;padding-top:8px}
</style>
<div class="pr-wrap">
<h1>🛒 Indkøbsliste</h1>
<p class="sub">${unchecked} af ${items.length} varer mangler · ${dateStr}</p>
<div class="cols"><div class="col">${leftHtml}</div><div class="col">${rightHtml}</div></div>
<p class="foot">Udskrevet ${new Date().toLocaleDateString('da-DK', {weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
</div>`;

  printHtml(html);
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
              <div style="font-weight:500">${esc(item.name)}</div>
              <div style="font-size:0.8rem;color:var(--ink-muted)">${esc(item.shop_category)}${item.unit ? ' · ' + esc(item.unit) : ''}</div>
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

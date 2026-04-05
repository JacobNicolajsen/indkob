import { products as api } from '../api.js';
import { openSheet, closeSheet, openSheet2, closeSheet2, toast, setTopActions } from '../app.js';
import { UNITS, SHOP_CATEGORIES, CAT_ICONS, unitOptions, catOptions } from '../constants.js';

export async function renderCatalog(container) {
  setTopActions(`<button class="top-action" id="btn-add-product" title="Nyt produkt">＋</button>`);

  container.innerHTML = `
    <div class="search-bar" style="margin:14px 16px 8px">
      <span class="search-icon">🔍</span>
      <input type="text" id="cat-search" placeholder="Søg i kataloget…">
    </div>
    <div id="cat-list" style="padding-bottom:90px"></div>`;

  const listEl = container.querySelector('#cat-list');
  let allProducts = [];

  const load = async (search = '') => {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--ink-muted);font-style:italic">Henter…</div>`;
    try {
      allProducts = await api.list(search ? { search } : {});
    } catch (e) {
      listEl.innerHTML = `<div style="padding:16px;color:#9B2E1A">${e.message}</div>`;
      return;
    }
    renderList(allProducts);
  };

  const renderList = (items) => {
    listEl.innerHTML = '';

    if (items.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:50px 20px;color:var(--ink-muted)">
          <div style="font-size:3rem;margin-bottom:12px">📦</div>
          <div style="font-family:var(--serif);font-size:1.1rem;font-weight:600;margin-bottom:6px">Kataloget er tomt</div>
          <div style="font-size:0.85rem">Tryk + for at tilføje dit første produkt</div>
        </div>`;
      return;
    }

    // Gruppér efter shop_category
    const groups = {};
    for (const p of items) {
      const cat = p.shop_category || 'Andet';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }

    for (const cat of SHOP_CATEGORIES) {
      if (!groups[cat]) continue;

      const section = document.createElement('div');
      section.innerHTML = `<div class="section-header">${CAT_ICONS[cat] || '📦'} ${cat}</div>`;

      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border-radius:14px;margin:0 16px 8px;overflow:hidden;box-shadow:0 2px 10px var(--shadow-warm)';

      for (const p of groups[cat]) {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.innerHTML = `
          <span style="font-size:1.4rem;width:30px;text-align:center">${CAT_ICONS[p.shop_category] || '📦'}</span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:0.95rem">${p.name}</div>
            <div style="font-size:0.72rem;color:var(--ink-muted);font-weight:500;text-transform:uppercase;letter-spacing:.04em">${p.default_unit}</div>
          </div>
          <span style="font-size:0.7rem;color:var(--ink-muted);padding:3px 8px;background:var(--bg);border-radius:6px">
            ${UNITS.find(u => u.value === p.default_unit)?.label || p.default_unit}
          </span>
        `;
        row.addEventListener('click', () => openProductForm(p, () => load()));
        card.appendChild(row);
      }

      section.appendChild(card);
      listEl.appendChild(section);
    }
  };

  // Søg
  let searchTimer;
  container.querySelector('#cat-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(e.target.value), 280);
  });

  document.getElementById('btn-add-product')?.addEventListener('click', () => {
    openProductForm(null, () => load());
  });

  await load();

  // FAB
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = 'Nyt produkt';
  fab.textContent = '+';
  fab.addEventListener('click', () => openProductForm(null, () => load()));
  container.appendChild(fab);
}

function openProductForm(product, onSave) {
  const isEdit = !!product;
  const frag   = document.createElement('div');

  frag.innerHTML = `
    <div class="form-group">
      <label class="form-label">Produktnavn *</label>
      <input class="form-input" id="p-name" value="${product?.name || ''}" placeholder="fx Hakkede tomater" autocomplete="off">
    </div>
    <div class="form-group">
      <label class="form-label">Standardenhed</label>
      <select class="form-select" id="p-unit">${unitOptions(product?.default_unit || 'stk')}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Kategori</label>
      <select class="form-select" id="p-cat">${catOptions(product?.shop_category || 'Andet')}</select>
    </div>
    <button class="btn btn-primary btn-full" id="btn-save-product">
      ${isEdit ? 'Gem ændringer' : 'Tilføj til katalog'}
    </button>
    ${isEdit ? `
    <button class="btn btn-danger btn-full" id="btn-delete-product" style="margin-top:10px">
      Slet produkt
    </button>` : ''}
    <div style="height:12px"></div>
  `;

  openSheet(isEdit ? 'Rediger produkt' : 'Nyt produkt', frag);

  frag.querySelector('#btn-save-product').addEventListener('click', async () => {
    const name          = frag.querySelector('#p-name').value.trim();
    const default_unit  = frag.querySelector('#p-unit').value;
    const shop_category = frag.querySelector('#p-cat').value;

    if (!name) { toast('Navn er påkrævet'); return; }

    try {
      if (isEdit) {
        await api.update(product.id, { name, default_unit, shop_category });
        toast('Produkt gemt');
      } else {
        await api.create({ name, default_unit, shop_category });
        toast(`${name} tilføjet til katalog`);
      }
      closeSheet();
      onSave();
    } catch (e) {
      toast(e.message);
    }
  });

  frag.querySelector('#btn-delete-product')?.addEventListener('click', async () => {
    if (!confirm(`Slet "${product.name}" fra kataloget?`)) return;
    try {
      await api.delete(product.id);
      closeSheet();
      toast('Produkt slettet');
      onSave();
    } catch (e) {
      toast(e.message);
    }
  });
}

/**
 * Åbner et produkt-picker-sheet til brug i opskrift-formularen.
 * @param {Function} onSelect  — kaldes med { product_id, name, shop_category, unit: default_unit }
 * @param {number}   [currentProductId]  — markerer allerede valgt produkt
 */
export async function openProductPicker(onSelect, currentProductId) {
  let allProducts = [];
  try { allProducts = await api.list(); } catch { allProducts = []; }

  const frag = document.createElement('div');
  frag.innerHTML = `
    <div class="search-bar" style="margin:4px 0 8px">
      <span class="search-icon">🔍</span>
      <input type="text" id="picker-search" placeholder="Søg produkt…" autocomplete="off">
    </div>
    <div id="picker-list"></div>
    <div style="padding:4px 0 8px">
      <button class="btn btn-outline btn-full btn-sm" id="btn-new-product">+ Opret nyt produkt</button>
    </div>
  `;

  // Bruger openSheet2 så den liggende recipe-formular ikke ødelægges
  openSheet2('Vælg produkt', frag);

  const listEl = frag.querySelector('#picker-list');

  const render = (filter = '') => {
    listEl.innerHTML = '';
    const filtered = allProducts.filter(p =>
      p.name.toLowerCase().includes(filter.toLowerCase())
    );

    if (filtered.length === 0) {
      listEl.innerHTML = `<p style="color:var(--ink-muted);text-align:center;padding:12px;font-style:italic">Ingen resultater</p>`;
      return;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:var(--surface);border-radius:12px;overflow:hidden;margin-bottom:8px;box-shadow:0 2px 8px var(--shadow-warm)';

    for (const p of filtered) {
      const row = document.createElement('div');
      row.className = 'list-item';
      row.innerHTML = `
        <span style="font-size:1.3rem;width:28px;text-align:center">${CAT_ICONS[p.shop_category] || '📦'}</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:0.95rem">${p.name}</div>
          <div style="font-size:0.72rem;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em">${p.shop_category}</div>
        </div>
        ${p.id === currentProductId ? '<span style="color:var(--sage);font-size:1.1rem">✓</span>' : ''}
      `;
      row.addEventListener('click', () => {
        closeSheet2();
        onSelect({ product_id: p.id, name: p.name, shop_category: p.shop_category, unit: p.default_unit });
      });
      wrap.appendChild(row);
    }
    listEl.appendChild(wrap);
  };

  render();

  frag.querySelector('#picker-search').addEventListener('input', e => render(e.target.value));

  frag.querySelector('#btn-new-product').addEventListener('click', () => {
    // Luk picker (lag 2) og åbn oprettelsesform på lag 2
    closeSheet2();
    const createFrag = document.createElement('div');
    createFrag.innerHTML = `
      <div class="form-group">
        <label class="form-label">Produktnavn *</label>
        <input class="form-input" id="np-name" placeholder="fx Parmesan" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Standardenhed</label>
        <select class="form-select" id="np-unit">${unitOptions('stk')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Kategori</label>
        <select class="form-select" id="np-cat">${catOptions('Andet')}</select>
      </div>
      <button class="btn btn-primary btn-full" id="btn-create-and-select">Opret og vælg</button>
      <div style="height:12px"></div>
    `;
    openSheet2('Nyt produkt', createFrag);

    createFrag.querySelector('#btn-create-and-select').addEventListener('click', async () => {
      const name          = createFrag.querySelector('#np-name').value.trim();
      const default_unit  = createFrag.querySelector('#np-unit').value;
      const shop_category = createFrag.querySelector('#np-cat').value;
      if (!name) { toast('Navn er påkrævet'); return; }
      try {
        const result = await api.create({ name, default_unit, shop_category });
        closeSheet2();
        onSelect({ product_id: result.id, name, shop_category, unit: default_unit });
        toast(`${name} oprettet`);
      } catch (e) {
        toast(e.message);
      }
    });
  });
}

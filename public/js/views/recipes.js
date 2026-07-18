import { recipes as api, ai } from '../api.js';
import { openSheet, closeSheet, toast, setTopActions, esc, safeUrl } from '../app.js';
import { openProductPicker } from './catalog.js';
import { UNITS, RECIPE_CATEGORIES, CAT_ICONS, unitOptions, catOptions } from '../constants.js';

let searchTimeout = null;
let currentSearch = '';

/**
 * Læser en billedfil og skalerer den ned client-side (canvas → JPEG),
 * så upload og AI-analyse ikke sender kæmpe filer.
 * Returnerer { base64, media_type }.
 */
export async function fileToResizedImage(file, maxDim = 1400, quality = 0.82) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error('Kunne ikke læse filen'));
    r.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload  = () => resolve(i);
    i.onerror = () => reject(new Error('Ugyldig billedfil'));
    i.src = dataUrl;
  });

  const scale  = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

  const jpeg = canvas.toDataURL('image/jpeg', quality);
  return { base64: jpeg.split(',')[1], media_type: 'image/jpeg' };
}

export async function renderRecipes(container) {
  setTopActions(`
    <button class="top-action" id="btn-ai-import" title="Importer fra link">✨</button>
    <button class="top-action" id="btn-add-recipe" title="Ny opskrift">＋</button>
  `);
  container.innerHTML = '';

  // Søgebar
  const searchBar = document.createElement('div');
  searchBar.innerHTML = `
    <div class="search-bar">
      <span class="search-icon">🔍</span>
      <input type="text" id="recipe-search" placeholder="Søg i opskrifter…" value="${esc(currentSearch)}" autocomplete="off">
      ${currentSearch ? '<button id="clear-search" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--ink-muted)">✕</button>' : ''}
    </div>`;
  container.appendChild(searchBar);

  const grid = document.createElement('div');
  grid.className = 'recipe-grid';
  container.appendChild(grid);

  const load = async (search = '') => {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--ink-muted);font-style:italic">Henter…</div>`;
    try {
      renderGrid(grid, await api.list(search ? { search } : {}), container);
    } catch (e) {
      grid.innerHTML = `<div style="grid-column:1/-1;padding:16px;color:#9B2E1A">${esc(e.message)}</div>`;
    }
  };

  searchBar.querySelector('#recipe-search').addEventListener('input', e => {
    currentSearch = e.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => load(currentSearch), 300);
    // toggle clear-knap
    const clr = searchBar.querySelector('#clear-search');
    if (currentSearch && !clr) {
      const btn = document.createElement('button');
      btn.id = 'clear-search';
      btn.style.cssText = 'background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--ink-muted)';
      btn.textContent = '✕';
      btn.addEventListener('click', () => { currentSearch = ''; renderRecipes(container); });
      searchBar.querySelector('.search-bar').appendChild(btn);
    } else if (!currentSearch && clr) clr.remove();
  });

  searchBar.querySelector('#clear-search')?.addEventListener('click', () => {
    currentSearch = '';
    renderRecipes(container);
  });

  document.getElementById('btn-ai-import')?.addEventListener('click', () => {
    openAiImport(() => renderRecipes(container));
  });
  document.getElementById('btn-add-recipe')?.addEventListener('click', () => {
    openRecipeForm(null, () => renderRecipes(container));
  });

  await load(currentSearch);
}

function renderGrid(grid, list, container) {
  grid.innerHTML = '';
  if (list.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--ink-muted)">
        <div style="font-size:3rem;margin-bottom:14px">📖</div>
        <div style="font-family:var(--serif);font-size:1.1rem;font-weight:600;margin-bottom:6px">Ingen opskrifter endnu</div>
        <div style="font-size:0.85rem">Tryk + for at tilføje din første opskrift</div>
      </div>`;
    return;
  }
  for (const r of list) {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    const emoji   = r.image || '🍽️';
    const isEmoji = /^\p{Emoji}/u.test(emoji);
    card.innerHTML = `
      <div class="recipe-card-img">${isEmoji
        ? esc(emoji)
        : `<img src="${safeUrl(emoji)}" style="width:100%;height:100%;object-fit:cover">`}</div>
      <div class="recipe-card-body">
        <div class="recipe-card-name">${esc(r.name)}</div>
        <div class="recipe-card-meta">${esc(r.category || 'Ingen kategori')} · ${esc(r.servings)} pers.</div>
      </div>`;
    card.addEventListener('click', () => openRecipeDetail(r.id, container));
    grid.appendChild(card);
  }
}

async function openRecipeDetail(id, container) {
  let recipe;
  try { recipe = await api.get(id); } catch (e) { toast(e.message); return; }

  // Hvor ofte har retten været på madplanen?
  let timesCooked = 0;
  try {
    const stats = await api.stats();
    timesCooked = stats.find(s => s.recipe_id === recipe.id)?.times || 0;
  } catch { /* badge udelades */ }

  const frag  = document.createElement('div');
  const emoji = recipe.image || '🍽️';
  const isEmoji = /^\p{Emoji}/u.test(emoji);

  frag.innerHTML = `
    <div style="text-align:center;font-size:4rem;padding:4px 0 8px">
      ${isEmoji ? esc(emoji) : `<img src="${safeUrl(emoji)}" style="width:100%;border-radius:12px;max-height:180px;object-fit:cover">`}
    </div>
    ${recipe.description
      ? `<p style="color:var(--ink-muted);margin:0 0 14px;line-height:1.6;font-size:0.95rem">${esc(recipe.description)}</p>`
      : ''}
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <span class="badge badge-terra">${esc(recipe.category || 'Ingen kategori')}</span>
      <span class="badge badge-sage">👥 ${esc(recipe.servings)} pers.</span>
      ${timesCooked > 0 ? `<span class="badge badge-sage">🍳 Lavet ${timesCooked} gang${timesCooked === 1 ? '' : 'e'}</span>` : ''}
    </div>
    ${safeUrl(recipe.source_url) ? `
      <a href="${safeUrl(recipe.source_url)}" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;color:var(--terra);text-decoration:none;margin-bottom:14px;word-break:break-all">
        🔗 Originalopskrift
      </a>` : ''}
    <div style="font-family:var(--serif);font-size:1.05rem;font-weight:600;margin-bottom:8px">Ingredienser</div>
    <div id="ing-list" style="margin-bottom:20px"></div>
    <div style="display:flex;gap:10px;padding-bottom:8px">
      <button class="btn btn-outline" id="btn-edit-recipe" style="flex:1">Rediger</button>
      <button class="btn btn-danger"  id="btn-delete-recipe" style="flex:1">Slet</button>
    </div>`;

  const ingList = frag.querySelector('#ing-list');
  if (recipe.ingredients?.length) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:var(--bg);border-radius:10px;overflow:hidden';
    for (const ing of recipe.ingredients) {
      const unit  = UNITS.find(u => u.value === ing.unit)?.label || ing.unit;
      const row   = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border)';
      row.innerHTML = `
        <span style="font-size:1.1rem;width:24px;text-align:center">${CAT_ICONS[ing.shop_category] || '📦'}</span>
        <span style="flex:1;font-size:0.93rem">${esc(ing.name)}</span>
        <span style="font-size:0.85rem;color:var(--ink-muted);font-weight:500">
          ${esc(ing.amount != null ? ing.amount + ' ' + unit : unit)}
        </span>`;
      wrap.appendChild(row);
    }
    // Fjern border på sidste row
    if (wrap.lastChild) wrap.lastChild.style.borderBottom = 'none';
    ingList.appendChild(wrap);
  } else {
    ingList.innerHTML = `<p style="color:var(--ink-muted);font-style:italic;font-size:0.9rem">Ingen ingredienser registreret</p>`;
  }

  openSheet(recipe.name, frag);

  frag.querySelector('#btn-edit-recipe').addEventListener('click', () => {
    closeSheet();
    openRecipeForm(recipe, () => renderRecipes(container));
  });
  frag.querySelector('#btn-delete-recipe').addEventListener('click', async () => {
    if (!confirm(`Slet "${recipe.name}"?`)) return;
    await api.delete(id);
    closeSheet();
    toast('Opskrift slettet');
    renderRecipes(container);
  });
}

function openAiImport(onDone) {
  const frag = document.createElement('div');
  frag.innerHTML = `
    <div class="ai-import-hero">
      <div class="ai-import-icon">✨</div>
      <p class="ai-import-desc">
        Indsæt et link til en opskrift — Claude læser siden og opretter opskriften
        i dit katalog inkl. fremgangsmåde. Manglende varer oprettes automatisk.
      </p>
    </div>
    <div class="form-group">
      <label class="form-label">Link til opskrift</label>
      <input class="form-input" id="ai-url" type="url"
        placeholder="https://mad.dk/opskrift/…" autocomplete="off" autocorrect="off">
    </div>
    <button class="btn btn-primary btn-full" id="btn-ai-go">
      Importer opskrift
    </button>
    <div style="display:flex;align-items:center;gap:10px;margin:14px 0 10px">
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <span style="font-size:0.8rem;color:var(--ink-muted)">eller</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>
    <button class="btn btn-outline btn-full" id="btn-ai-photo">
      📷 Importer fra foto
    </button>
    <input type="file" id="ai-photo-file" accept="image/*" style="display:none">
    <div id="ai-status" style="display:none"></div>
    <div style="height:8px"></div>
  `;

  openSheet('Importer fra link', frag);

  const urlInput = frag.querySelector('#ai-url');
  const goBtn    = frag.querySelector('#btn-ai-go');
  const status   = frag.querySelector('#ai-status');

  // Indsæt URL fra clipboard kun når brugeren fokuserer feltet
  urlInput.addEventListener('focus', () => {
    if (urlInput.value) return;
    navigator.clipboard?.readText?.().then(text => {
      if (text?.startsWith('http') && !urlInput.value) urlInput.value = text;
    }).catch(() => {});
  }, { once: true });

  const setStatus = (html, type = 'info') => {
    status.style.display = 'block';
    status.className = `ai-status ai-status--${type}`;
    status.innerHTML = html;
  };

  const photoBtn  = frag.querySelector('#btn-ai-photo');
  const photoFile = frag.querySelector('#ai-photo-file');

  const setLoading = (msg) => setStatus(`
    <div class="ai-loading">
      <span class="ai-spinner"></span>
      <span>${esc(msg)}</span>
    </div>`, 'info');

  const showSuccess = (result) => {
    const newProds = result.new_products?.length
      ? `<div class="ai-new-prods">
           <strong>${result.new_products.length} nye varer oprettet i kataloget:</strong>
           <span>${esc(result.new_products.join(', '))}</span>
         </div>`
      : '';

    setStatus(`
      <div class="ai-success-card">
        <div class="ai-success-title">✅ ${esc(result.name)}</div>
        <div class="ai-success-meta">${esc(result.ingredients_count)} ingredienser importeret</div>
        ${newProds}
      </div>`, 'success');

    toast(`"${result.name}" oprettet`);
    onDone();
  };

  goBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url.startsWith('http')) { toast('Indsæt et gyldigt link (starter med http)'); return; }

    goBtn.disabled = true;
    goBtn.textContent = 'Analyserer…';
    setLoading('Claude læser opskriften — det tager 10–20 sekunder…');

    try {
      showSuccess(await ai.importRecipe(url));
      goBtn.textContent = 'Importer endnu en';
      urlInput.value = '';
    } catch (e) {
      setStatus(`<div class="ai-error">⚠️ ${esc(e.message)}</div>`, 'error');
      goBtn.textContent = 'Prøv igen';
    }
    goBtn.disabled = false;
  });

  // ── Foto-import: kogebogsside eller håndskrevet opskrift ────────
  photoBtn.addEventListener('click', () => photoFile.click());

  photoFile.addEventListener('change', async () => {
    const file = photoFile.files?.[0];
    if (!file) return;
    photoFile.value = '';

    photoBtn.disabled = true;
    photoBtn.textContent = 'Analyserer foto…';
    setLoading('Claude læser billedet — det tager 10–20 sekunder…');

    try {
      const { base64, media_type } = await fileToResizedImage(file, 1600);
      showSuccess(await ai.importRecipePhoto(base64, media_type));
    } catch (e) {
      setStatus(`<div class="ai-error">⚠️ ${esc(e.message)}</div>`, 'error');
    }
    photoBtn.disabled = false;
    photoBtn.textContent = '📷 Importer fra foto';
  });
}

function openRecipeForm(recipe, onSave) {
  const isEdit = !!recipe;

  // Lokal kopi af ingredienser (med produkt-info)
  // Format: { product_id, name, shop_category, amount, unit }
  const ingredients = (recipe?.ingredients || []).map(i => ({
    product_id:    i.product_id,
    name:          i.name,
    shop_category: i.shop_category,
    amount:        i.amount,
    unit:          i.unit || i.default_unit || 'stk',
  }));

  const frag = document.createElement('div');

  const catOpts = RECIPE_CATEGORIES.map(c =>
    `<option value="${c}" ${recipe?.category === c ? 'selected' : ''}>${c}</option>`
  ).join('');

  frag.innerHTML = `
    <div class="form-group">
      <label class="form-label">Navn *</label>
      <input class="form-input" id="f-name" value="${esc(recipe?.name || '')}" placeholder="fx Spaghetti Bolognese" autocomplete="off">
    </div>
    <div class="form-group">
      <label class="form-label">Emoji / Billede</label>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="f-image" value="${esc(recipe?.image || '')}" placeholder="🍝 eller https://…" style="flex:1">
        <button class="btn btn-outline" id="btn-upload-img" title="Upload foto" style="padding:0 14px">📷</button>
        <input type="file" id="f-image-file" accept="image/*" style="display:none">
      </div>
    </div>
    <div style="display:flex;gap:10px">
      <div class="form-group" style="flex:1">
        <label class="form-label">Kategori</label>
        <select class="form-select" id="f-category"><option value="">—</option>${catOpts}</select>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Portioner</label>
        <input class="form-input" id="f-servings" type="number" min="1" max="20" value="${recipe?.servings || 4}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Beskrivelse</label>
      <textarea class="form-textarea" id="f-desc" placeholder="Kort beskrivelse…">${esc(recipe?.description || '')}</textarea>
    </div>
    <div style="font-family:var(--serif);font-size:1.05rem;font-weight:600;margin-bottom:10px">Ingredienser</div>
    <div id="ing-rows"></div>
    <button class="btn btn-outline btn-sm btn-full" id="btn-add-ing" style="margin-bottom:18px">
      + Tilføj ingrediens fra katalog
    </button>
    <button class="btn btn-primary btn-full" id="btn-save">
      ${isEdit ? 'Gem ændringer' : 'Opret opskrift'}
    </button>
    <div style="height:12px"></div>`;

  openSheet(isEdit ? 'Rediger opskrift' : 'Ny opskrift', frag);

  // ── Upload foto til opskriften ──────────────────────────────────
  const imgFile = frag.querySelector('#f-image-file');
  frag.querySelector('#btn-upload-img').addEventListener('click', e => {
    e.preventDefault();
    imgFile.click();
  });
  imgFile.addEventListener('change', async () => {
    const file = imgFile.files?.[0];
    if (!file) return;
    imgFile.value = '';
    const btn = frag.querySelector('#btn-upload-img');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const { base64, media_type } = await fileToResizedImage(file, 1200);
      const { url } = await api.uploadImage(base64, media_type);
      frag.querySelector('#f-image').value = url;
      toast('Billede uploadet');
    } catch (e) {
      toast('Fejl: ' + e.message);
    }
    btn.disabled = false;
    btn.textContent = '📷';
  });

  const rowsEl = frag.querySelector('#ing-rows');

  const renderIngRows = () => {
    rowsEl.innerHTML = '';
    if (ingredients.length === 0) {
      rowsEl.innerHTML = `<p style="color:var(--ink-muted);font-size:0.85rem;margin-bottom:12px;font-style:italic">Ingen ingredienser endnu</p>`;
      return;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:var(--bg);border-radius:12px;overflow:hidden;margin-bottom:12px';

    ingredients.forEach((ing, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)';

      row.innerHTML = `
        <span style="font-size:1.1rem;width:24px;text-align:center;flex-shrink:0">${CAT_ICONS[ing.shop_category] || '📦'}</span>
        <button class="ing-name-btn" data-idx="${idx}" style="flex:2;text-align:left;background:none;border:none;cursor:pointer;font-size:0.9rem;font-weight:600;color:var(--ink);padding:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ing.name)}</button>
        <input type="number" step="any" min="0" class="form-input ing-amount" data-idx="${idx}"
          value="${ing.amount ?? ''}" placeholder="Mgl."
          style="flex:1;min-width:0;padding:8px 8px;font-size:0.88rem">
        <select class="form-select ing-unit" data-idx="${idx}" style="flex:1.4;min-width:0;padding:8px 8px;font-size:0.82rem">
          ${unitOptions(ing.unit)}
        </select>
        <button class="ing-delete" data-idx="${idx}" style="flex-shrink:0;background:none;border:none;color:#C0392B;font-size:1.1rem;cursor:pointer;padding:4px;opacity:0.6">✕</button>`;

      // Events
      row.querySelector('.ing-name-btn').addEventListener('click', () => {
        openProductPicker(selected => {
          ingredients[idx] = { ...ingredients[idx], ...selected };
          renderIngRows();
        }, ing.product_id);
      });

      row.querySelector('.ing-amount').addEventListener('input', e => {
        ingredients[idx].amount = parseFloat(e.target.value) || null;
      });

      row.querySelector('.ing-unit').addEventListener('change', e => {
        ingredients[idx].unit = e.target.value;
      });

      row.querySelector('.ing-delete').addEventListener('click', () => {
        ingredients.splice(idx, 1);
        renderIngRows();
      });

      wrap.appendChild(row);
    });

    if (wrap.lastChild) wrap.lastChild.style.borderBottom = 'none';
    rowsEl.appendChild(wrap);
  };

  renderIngRows();

  frag.querySelector('#btn-add-ing').addEventListener('click', () => {
    openProductPicker(selected => {
      ingredients.push({ ...selected, amount: null });
      renderIngRows();
    });
  });

  frag.querySelector('#btn-save').addEventListener('click', async () => {
    const name = frag.querySelector('#f-name').value.trim();
    if (!name) { toast('Navn er påkrævet'); return; }

    const data = {
      name,
      image:       frag.querySelector('#f-image').value.trim(),
      category:    frag.querySelector('#f-category').value,
      servings:    parseInt(frag.querySelector('#f-servings').value) || 4,
      description: frag.querySelector('#f-desc').value.trim(),
      ingredients: ingredients.filter(i => i.product_id).map(i => ({
        product_id: i.product_id,
        amount:     i.amount ?? null,
        unit:       i.unit || 'stk',
      })),
    };

    try {
      if (isEdit) {
        await api.update(recipe.id, data);
        toast('Opskrift gemt');
      } else {
        await api.create(data);
        toast('Opskrift oprettet');
      }
      closeSheet();
      onSave();
    } catch (e) {
      toast('Fejl: ' + e.message);
    }
  });
}

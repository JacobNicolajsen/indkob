const BASE = `${new URL('.', document.baseURI).pathname}api`;

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch {
    throw new Error('Kan ikke nå serveren — er den startet? (npm start)');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Serverfejl');
  }
  return res.json();
}

// ── Varekatalog ──────────────────────────────────────────────────
export const products = {
  list:   (params = {}) => req('GET', '/products?' + new URLSearchParams(params)),
  get:    (id)          => req('GET', `/products/${id}`),
  create: (data)        => req('POST', '/products', data),
  update: (id, data)    => req('PUT', `/products/${id}`, data),
  delete: (id)          => req('DELETE', `/products/${id}`),
};

// ── Opskrifter ───────────────────────────────────────────────────
export const recipes = {
  list:       (params = {}) => req('GET', '/recipes?' + new URLSearchParams(params)),
  get:        (id)          => req('GET', `/recipes/${id}`),
  create:     (data)        => req('POST', '/recipes', data),
  update:     (id, data)    => req('PUT', `/recipes/${id}`, data),
  delete:     (id)          => req('DELETE', `/recipes/${id}`),
  categories: ()            => req('GET', '/recipes/categories/list'),
};

// ── Madplan ──────────────────────────────────────────────────────
export const mealplan = {
  list:       (from, to)                       => req('GET', `/mealplan?from=${from}&to=${to}`),
  set:        (date, meal_type, recipe_id, servings) =>
                req('POST', '/mealplan', { date, meal_type, recipe_id, servings }),
  remove:     (id)                             => req('DELETE', `/mealplan/${id}`),
  removeSlot: (date, meal_type)                => req('DELETE', `/mealplan/slot/${date}/${meal_type}`),
};

// ── Indkøbsliste ─────────────────────────────────────────────────
export const shoppinglist = {
  list:         ()            => req('GET', '/shoppinglist'),
  recalculate:  ()            => req('POST', '/shoppinglist/recalculate', {}),
  addItem:      (data)        => req('POST', '/shoppinglist/items', data),
  toggleCheck:  (id, checked) => req('PUT', `/shoppinglist/items/${id}`, { checked }),
  deleteItem:   (id)          => req('DELETE', `/shoppinglist/items/${id}`),
  clear:        (onlyChecked) =>
                  req('DELETE', '/shoppinglist' + (onlyChecked ? '?only_checked=true' : '')),
  library: {
    list:   ()     => req('GET', '/shoppinglist/library'),
    add:    (data) => req('POST', '/shoppinglist/library', data),
    delete: (id)   => req('DELETE', `/shoppinglist/library/${id}`),
  },
};

// ── Claude AI ────────────────────────────────────────────────────
export const ai = {
  importRecipe: (url) => req('POST', '/ai/import-recipe', { url }),
};

// ── Dagnoter ─────────────────────────────────────────────────────
export const notes = {
  get:  (date)        => req('GET',  `/notes/${date}`),
  save: (date, note)  => req('PUT',  `/notes/${date}`, { note }),
};

// ── Indstillinger ─────────────────────────────────────────────────
export const settings = {
  getAll: ()           => req('GET', '/settings'),
  set:    (key, value) => req('PUT', `/settings/${key}`, { value }),
};

// ── ICS kalender ──────────────────────────────────────────────────
export const ics = {
  events:  (date) => req('GET', `/ics?date=${date}`),
  refresh: ()     => req('POST', '/ics/refresh', {}),
};

// ── Basisvarer ────────────────────────────────────────────────────
export const staples = {
  list:      ()        => req('GET',    '/staples'),
  add:       (data)    => req('POST',   '/staples', data),
  delete:    (id)      => req('DELETE', `/staples/${id}`),
  addToList: (ids)     => req('POST',   '/staples/add-to-list', { ids }),
};

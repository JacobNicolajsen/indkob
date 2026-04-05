// Delt konstanter — bruges i både katalog, opskrifter og indkøbsliste

export const UNITS = [
  { value: 'stk',     label: 'stk.' },
  { value: 'g',       label: 'gram' },
  { value: 'kg',      label: 'kg' },
  { value: 'ml',      label: 'ml' },
  { value: 'dl',      label: 'dl' },
  { value: 'L',       label: 'liter' },
  { value: 'tsk',     label: 'teskefuld' },
  { value: 'spsk',    label: 'spiseskefuld' },
  { value: 'fed',     label: 'fed' },
  { value: 'bundt',   label: 'bundt' },
  { value: 'dåse',    label: 'dåse' },
  { value: 'pose',    label: 'pose' },
  { value: 'pakke',   label: 'pakke' },
  { value: 'portion', label: 'portion' },
  { value: 'knsp',    label: 'knivspids' },
  { value: 'sk',      label: 'skive' },
];

export const SHOP_CATEGORIES = [
  'Frugt & Grønt',
  'Kød & Fisk',
  'Mejeri & Æg',
  'Brød & Bageri',
  'Kolonial',
  'Frost',
  'Drikkevarer',
  'Husholdning',
  'Andet',
];

export const CAT_ICONS = {
  'Frugt & Grønt': '🥕',
  'Kød & Fisk':    '🥩',
  'Mejeri & Æg':   '🥛',
  'Brød & Bageri': '🍞',
  'Kolonial':      '🥫',
  'Frost':         '❄️',
  'Drikkevarer':   '🍺',
  'Husholdning':   '🧴',
  'Andet':         '📦',
};

export const RECIPE_CATEGORIES = [
  'Kød', 'Fjerkræ', 'Fisk', 'Vegetar', 'Pasta',
  'Suppe', 'Salat', 'Tilbehør', 'Dessert', 'Morgenmad', 'Andet',
];

/** Bygger en <select>-options-streng for UNITS */
export function unitOptions(selected = 'stk') {
  return UNITS.map(u =>
    `<option value="${u.value}" ${u.value === selected ? 'selected' : ''}>${u.label}</option>`
  ).join('');
}

/** Bygger en <select>-options-streng for SHOP_CATEGORIES */
export function catOptions(selected = 'Andet') {
  return SHOP_CATEGORIES.map(c =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${CAT_ICONS[c]} ${c}</option>`
  ).join('');
}

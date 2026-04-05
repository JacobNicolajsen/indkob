import { mealplan, recipes as recipesApi } from '../api.js';
import { openSheet, closeSheet, toast, setTopActions } from '../app.js';

const EXTRA_MEAL_TYPES = [
  { key: 'breakfast', label: 'Morgenmad' },
  { key: 'lunch',     label: 'Frokost' },
];
const DINNER = { key: 'dinner', label: 'Aftensmad' };

const DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function getMonday(offset = 0) {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day) + offset * 7;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateStr(d) { return d.toISOString().slice(0, 10); }

function formatDate(d) {
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
}

function getWeekNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

let weekOffset = 0;

// Dage der har morgenmad/frokost udvidet (persisteres i sessionStorage)
const STORAGE_KEY = 'expanded_days';
function getExpanded() {
  try { return new Set(JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveExpanded(set) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export async function renderMealplan(container) {
  container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--ink-muted);font-family:var(--serif);font-style:italic;font-size:1.1rem">Henter madplan…</div>';

  setTopActions('');

  const monday = getMonday(weekOffset);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  let entries = [];
  try {
    entries = await mealplan.list(dateStr(monday), dateStr(sunday));
  } catch (e) {
    container.innerHTML = `<div class="card" style="color:#9B2E1A">${e.message}</div>`;
    return;
  }

  const lookup = {};
  for (const e of entries) lookup[`${e.date}|${e.meal_type}`] = e;

  const expandedDays = getExpanded();

  // Auto-udvidelse: hvis en dag allerede har morgenmad/frokost, vis dem
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = dateStr(d);
    if (lookup[`${ds}|breakfast`] || lookup[`${ds}|lunch`]) {
      expandedDays.add(ds);
    }
  }

  container.innerHTML = '';

  // ---- Uge-navigation ----
  const weekNo = getWeekNumber(monday);
  const nav = document.createElement('div');
  nav.className = 'week-nav';
  nav.innerHTML = `
    <button class="week-nav-btn" id="btn-prev">‹</button>
    <div class="week-label">
      ${formatDate(monday)} – ${formatDate(sunday)}
      <span class="week-num">Uge ${weekNo}</span>
    </div>
    <button class="week-nav-btn" id="btn-next">›</button>
  `;
  container.appendChild(nav);

  const today = dateStr(new Date());

  // ---- Render dag-kort ----
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = dateStr(d);
    const isToday = ds === today;
    const isExpanded = expandedDays.has(ds);

    const card = buildDayCard(ds, i, d, isToday, isExpanded, lookup, expandedDays, container);
    card.style.animationDelay = `${i * 40}ms`;
    container.appendChild(card);
  }

  const spacer = document.createElement('div');
  spacer.style.height = '28px';
  container.appendChild(spacer);

  nav.querySelector('#btn-prev').addEventListener('click', () => { weekOffset--; renderMealplan(container); });
  nav.querySelector('#btn-next').addEventListener('click', () => { weekOffset++; renderMealplan(container); });
}

function buildDayCard(ds, dayIndex, dateObj, isToday, isExpanded, lookup, expandedDays, container) {
  const card = document.createElement('div');
  card.className = 'day-card';

  // ---- Dag-header ----
  const header = document.createElement('div');
  header.className = `day-header${isToday ? ' is-today' : ''}`;
  header.innerHTML = `
    <span class="day-name">${DAY_NAMES[dayIndex]}</span>
    <span class="date-chip">${isToday ? 'I dag · ' : ''}${formatDate(dateObj)}</span>
  `;
  card.appendChild(header);

  // ---- Morgenmad + frokost (kollapsible) ----
  const extraWrap = document.createElement('div');
  extraWrap.className = `extra-meals-wrap${isExpanded ? ' open' : ''}`;

  for (const mt of EXTRA_MEAL_TYPES) {
    extraWrap.appendChild(buildMealSlot(ds, mt, lookup[`${ds}|${mt.key}`], expandedDays, container));
  }
  card.appendChild(extraWrap);

  // ---- Aftensmad (altid synlig) ----
  card.appendChild(buildMealSlot(ds, DINNER, lookup[`${ds}|${DINNER.key}`], expandedDays, container));

  // ---- Toggle morgenmad/frokost ----
  const toggleBtn = document.createElement('button');
  toggleBtn.className = `toggle-extra-meals${isExpanded ? ' open' : ''}`;
  toggleBtn.innerHTML = `<span class="toggle-icon">+</span>${isExpanded ? 'Skjul morgenmad & frokost' : 'Tilføj morgenmad & frokost'}`;

  toggleBtn.addEventListener('click', () => {
    const opening = !extraWrap.classList.contains('open');
    extraWrap.classList.toggle('open', opening);
    toggleBtn.classList.toggle('open', opening);
    toggleBtn.innerHTML = `<span class="toggle-icon">+</span>${opening ? 'Skjul morgenmad & frokost' : 'Tilføj morgenmad & frokost'}`;

    if (opening) {
      expandedDays.add(ds);
    } else {
      expandedDays.delete(ds);
    }
    saveExpanded(expandedDays);
  });

  card.appendChild(toggleBtn);
  return card;
}

function buildMealSlot(ds, mt, entry, expandedDays, container) {
  const slot = document.createElement('div');
  slot.className = 'meal-slot';
  slot.innerHTML = `
    <span class="meal-type-label">${mt.label}</span>
    <span class="meal-recipe ${entry ? '' : 'empty'}">${entry ? entry.recipe_name : 'Tilføj ret…'}</span>
    ${entry ? `
      <div class="servings-stepper">
        <button class="step-btn step-minus" aria-label="Færre portioner">−</button>
        <span class="step-count">${entry.servings} pers.</span>
        <button class="step-btn step-plus" aria-label="Flere portioner">+</button>
      </div>
      <button class="meal-remove" data-id="${entry.id}" title="Fjern ret">✕</button>
    ` : ''}
  `;

  if (entry) {
    const stepper  = slot.querySelector('.servings-stepper');
    const countEl  = stepper.querySelector('.step-count');
    let servings   = entry.servings || 4;

    // Stop propagation så klik på stepper ikke åbner opskriftsvælger
    stepper.addEventListener('click', e => e.stopPropagation());

    const applyServings = async (newVal) => {
      countEl.textContent = `${newVal} pers.`;
      try {
        await mealplan.set(ds, mt.key, entry.recipe_id, newVal);
      } catch {
        toast('Kunne ikke opdatere portioner');
        countEl.textContent = `${servings} pers.`;
        return;
      }
      servings = newVal;
    };

    stepper.querySelector('.step-minus').addEventListener('click', () => {
      if (servings > 1) applyServings(servings - 1);
    });
    stepper.querySelector('.step-plus').addEventListener('click', () => {
      applyServings(servings + 1);
    });
  }

  slot.addEventListener('click', async (e) => {
    if (e.target.classList.contains('meal-remove')) {
      await mealplan.remove(e.target.dataset.id);
      renderMealplan(container);
      return;
    }
    openRecipePicker(ds, mt.key, entry?.id, () => renderMealplan(container));
  });

  return slot;
}

async function openRecipePicker(date, mealType, currentId, onDone) {
  let allRecipes = [];
  try { allRecipes = await recipesApi.list(); } catch { allRecipes = []; }

  const frag = document.createElement('div');

  if (allRecipes.length === 0) {
    frag.innerHTML = `
      <div style="text-align:center;padding:28px 20px;color:var(--ink-muted)">
        <div style="font-size:2.5rem;margin-bottom:12px">📖</div>
        <div style="font-family:var(--serif);font-size:1.05rem;font-weight:600;margin-bottom:6px">Ingen opskrifter endnu</div>
        <div style="font-size:0.85rem">Gå til Opskrifter og tilføj din første</div>
      </div>`;
  } else {
    const searchWrap = document.createElement('div');
    searchWrap.innerHTML = `
      <div class="search-bar" style="margin:4px 0 10px">
        <span class="search-icon">🔍</span>
        <input type="text" placeholder="Søg opskrift…" id="picker-search">
      </div>`;
    frag.appendChild(searchWrap);

    const list = document.createElement('div');
    list.style.paddingBottom = '8px';

    const renderList = (filter = '') => {
      list.innerHTML = '';
      const filtered = allRecipes.filter(r =>
        r.name.toLowerCase().includes(filter.toLowerCase())
      );
      for (const r of filtered) {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.innerHTML = `
          <span style="font-size:1.5rem;width:32px;text-align:center">${r.image || '🍽️'}</span>
          <div style="flex:1">
            <div style="font-family:var(--serif);font-size:1rem;font-weight:600">${r.name}</div>
            <div style="font-size:0.75rem;color:var(--ink-muted)">${r.category || ''}${r.category ? ' · ' : ''}${r.servings} pers.</div>
          </div>
          ${r.id == currentId ? '<span style="color:var(--sage);font-size:1.1rem">✓</span>' : ''}
        `;
        row.addEventListener('click', async () => {
          await mealplan.set(date, mealType, r.id, r.servings);
          closeSheet();
          onDone();
        });
        list.appendChild(row);
      }
      if (filtered.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--ink-muted);padding:16px;font-style:italic">Ingen resultater</p>';
      }
    };

    renderList();
    frag.appendChild(list);
    searchWrap.querySelector('#picker-search').addEventListener('input', e => renderList(e.target.value));
  }

  const labels = { breakfast: 'Morgenmad', lunch: 'Frokost', dinner: 'Aftensmad' };
  openSheet(`Vælg ${labels[mealType]}`, frag);
}


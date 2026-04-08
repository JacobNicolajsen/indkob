import { mealplan, recipes as recipesApi, notes as notesApi, ics as icsApi } from '../api.js';
import { openSheet, closeSheet, toast, setTopActions, printHtml } from '../app.js';

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Brug altid lokal tid — toISOString() giver UTC og forskydes en dag i CEST
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const EXTRA_MEAL_TYPES = [
  { key: 'breakfast', label: 'Morgenmad' },
  { key: 'lunch',     label: 'Frokost' },
];
const DINNER = { key: 'dinner', label: 'Aftensmad' };

// Uge starter søndag (JS getDay() = 0)
const DAY_NAMES = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

function getSunday(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + offset * 7); // gå tilbage til søndag
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateStr(d) { return localDateStr(d); }

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

  setTopActions(`<button class="top-action" id="btn-mp-print" title="Print madplan">🖨️</button>`);

  const sunday   = getSunday(weekOffset);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);

  let entries = [];
  try {
    entries = await mealplan.list(dateStr(sunday), dateStr(saturday));
  } catch (e) {
    container.innerHTML = `<div class="card" style="color:#9B2E1A">${e.message}</div>`;
    return;
  }

  const lookup = {};
  for (const e of entries) lookup[`${e.date}|${e.meal_type}`] = e;

  const expandedDays = getExpanded();

  // Auto-udvidelse: hvis en dag allerede har morgenmad/frokost, vis dem
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    const ds = dateStr(d);
    if (lookup[`${ds}|breakfast`] || lookup[`${ds}|lunch`]) {
      expandedDays.add(ds);
    }
  }

  container.innerHTML = '';

  // ---- Uge-navigation ----
  const mondayOfWeek = new Date(sunday); mondayOfWeek.setDate(sunday.getDate() + 1);
  const weekNo = getWeekNumber(mondayOfWeek);
  const nav = document.createElement('div');
  nav.className = 'week-nav';
  nav.innerHTML = `
    <button class="week-nav-btn" id="btn-prev">‹</button>
    <div class="week-label">
      ${formatDate(sunday)} – ${formatDate(saturday)}
      <span class="week-num">Uge ${weekNo}</span>
    </div>
    <button class="week-nav-btn" id="btn-next">›</button>
  `;
  container.appendChild(nav);

  const today = dateStr(new Date());

  // ---- Render dag-kort ----
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
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

  document.getElementById('btn-mp-print')?.addEventListener('click', () => {
    openMealplanPrintSheet(sunday, saturday);
  });
}

function buildDayCard(ds, dayIndex, dateObj, isToday, isExpanded, lookup, expandedDays, container) {
  const card = document.createElement('div');
  card.className = 'day-card';

  // ---- Dag-header med + knap ----
  const header = document.createElement('div');
  header.className = `day-header${isToday ? ' is-today' : ''}`;
  header.innerHTML = `
    <div class="day-header-left">
      <span class="day-name">${DAY_NAMES[dayIndex]}</span>
      <span class="date-chip">${isToday ? 'I dag · ' : ''}${formatDate(dateObj)}</span>
    </div>
    <button class="day-expand-btn${isExpanded ? ' open' : ''}" title="Morgenmad & frokost">+</button>
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

  // ---- Notelinje + ICS events ----
  const noteWrap = document.createElement('div');
  noteWrap.className = 'day-note-wrap';
  noteWrap.innerHTML = `
    <div class="day-note-row">
      <div class="day-cal-events" id="cal-${ds}"></div>
      <textarea class="day-note-input" id="note-${ds}" placeholder="Note til dagen…" rows="1"></textarea>
    </div>`;
  card.appendChild(noteWrap);

  // Hent note og kalender-events asynkront (ikke-blokerende)
  const noteEl = noteWrap.querySelector(`#note-${ds}`);
  const calEl  = noteWrap.querySelector(`#cal-${ds}`);

  notesApi.get(ds).then(r => {
    noteEl.value = r.note || '';
    autoResizeTextarea(noteEl);
  }).catch(() => {});

  icsApi.events(ds).then(r => {
    if (r.events?.length) {
      calEl.innerHTML = r.events.map(e =>
        `<span class="day-cal-event">${e.time ? e.time + ' ' : ''}${e.summary}</span>`
      ).join('');
    }
  }).catch(() => {});

  // Auto-gem note ved ændring (debounced)
  let noteTimeout;
  noteEl.addEventListener('input', () => {
    autoResizeTextarea(noteEl);
    clearTimeout(noteTimeout);
    noteTimeout = setTimeout(() => {
      notesApi.save(ds, noteEl.value).catch(() => {});
    }, 800);
  });

  // ---- Toggle via + knap i headeren ----
  header.querySelector('.day-expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !extraWrap.classList.contains('open');
    extraWrap.classList.toggle('open', opening);
    e.currentTarget.classList.toggle('open', opening);
    if (opening) expandedDays.add(ds);
    else         expandedDays.delete(ds);
    saveExpanded(expandedDays);
  });
  return card;
}

function buildMealSlot(ds, mt, entry, expandedDays, container) {
  const slot = document.createElement('div');
  slot.className = 'meal-slot';
  slot.innerHTML = `
    <span class="meal-type-label">${mt.label}</span>
    <span class="meal-recipe ${entry ? '' : 'empty'}">${entry ? entry.recipe_name : 'Tilføj ret…'}</span>
    ${entry ? `
      <div class="servings-stepper" title="Antal portioner">
        <button class="step-btn step-minus" aria-label="Færre portioner">−</button>
        <span class="step-count">${entry.servings}</span>
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

// ── Print madplan ────────────────────────────────────────────────
function openMealplanPrintSheet(monday, sunday) {
  const frag = document.createElement('div');
  frag.innerHTML = `
    <p style="font-size:0.88rem;color:var(--ink-muted);margin-bottom:18px;line-height:1.5">
      Vælg periode og tryk print. Siden åbner i et nyt vindue.
    </p>
    <div style="display:flex;gap:10px;margin-bottom:18px">
      <div class="form-group" style="flex:1">
        <label class="form-label">Fra</label>
        <input class="form-input" id="pr-from" type="date" value="${dateStr(monday)}">
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Til</label>
        <input class="form-input" id="pr-to" type="date" value="${dateStr(sunday)}">
      </div>
    </div>
    <button class="btn btn-primary btn-full" id="btn-do-print">🖨️ Åbn og print</button>
    <div style="height:12px"></div>
  `;

  openSheet('Print madplan', frag);

  frag.querySelector('#btn-do-print').addEventListener('click', async () => {
    const from = frag.querySelector('#pr-from').value;
    const to   = frag.querySelector('#pr-to').value;
    if (!from || !to || from > to) { toast('Vælg gyldige datoer'); return; }

    const btn = frag.querySelector('#btn-do-print');
    btn.disabled = true;
    btn.textContent = 'Henter…';

    try {
      const entries = await mealplan.list(from, to);
      await execMealplanPrint(from, to, entries);
      closeSheet();
    } catch (e) {
      toast('Fejl: ' + e.message);
      btn.disabled = false;
      btn.innerHTML = '🖨️ Åbn og print';
    }
  });
}

async function execMealplanPrint(from, to, entries) {
  const lookup = {};
  for (const e of entries) {
    if (!lookup[e.date]) lookup[e.date] = {};
    lookup[e.date][e.meal_type] = e;
  }

  const days = [];
  const cur  = new Date(from + 'T00:00:00');
  const end  = new Date(to   + 'T00:00:00');
  while (cur <= end) { days.push(localDateStr(cur)); cur.setDate(cur.getDate() + 1); }

  // Hent noter og kalenderevents for alle dage parallelt
  const [notesResults, icsResults] = await Promise.all([
    Promise.all(days.map(ds => notesApi.get(ds).catch(() => ({ note: '' })))),
    Promise.all(days.map(ds => icsApi.events(ds).catch(() => ({ events: [] })))),
  ]);

  const notesByDate = {};
  const icsByDate   = {};
  days.forEach((ds, i) => {
    notesByDate[ds] = notesResults[i]?.note || '';
    icsByDate[ds]   = icsResults[i]?.events  || [];
  });

  const DAY_FULL   = ['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag'];
  const MEAL_LABEL = { breakfast:'Morgenmad', lunch:'Frokost', dinner:'Aftensmad' };
  const MEAL_ORDER = ['breakfast','lunch','dinner'];

  const daysHtml = days.map(ds => {
    const d       = new Date(ds + 'T00:00:00');
    const dayName = DAY_FULL[d.getDay()];
    const dateLbl = d.toLocaleDateString('da-DK', { day:'numeric', month:'long' });
    const dayData = lookup[ds] || {};

    const mealsHtml = MEAL_ORDER.map(mt => {
      const e = dayData[mt];
      if (!e) return '';
      return `<div class="meal-row">
        <span class="mt">${MEAL_LABEL[mt]}</span>
        <span class="mn">${e.recipe_name}</span>
        <span class="ms">${e.servings} pers.</span>
      </div>`;
    }).join('');

    const calEvents = icsByDate[ds];
    const calHtml = calEvents.length
      ? `<div class="cal-row">${calEvents.map(ev =>
          `<span class="cal-chip">${ev.time ? ev.time + ' ' : ''}${ev.summary}</span>`
        ).join('')}</div>`
      : '';

    const note = notesByDate[ds];
    const noteHtml = note
      ? `<div class="note-row">${note.replace(/\n/g, '<br>')}</div>`
      : '';

    const extra = calHtml || noteHtml
      ? `<div class="day-extra">${calHtml}${noteHtml}</div>`
      : '';

    return `<div class="day">
      <div class="dh">${dayName} <span class="dl">${dateLbl}</span></div>
      ${mealsHtml || '<div class="empty">Ingen retter</div>'}
      ${extra}
    </div>`;
  }).join('');

  const fromLbl = new Date(from+'T00:00:00').toLocaleDateString('da-DK',{day:'numeric',month:'long'});
  const toLbl   = new Date(to  +'T00:00:00').toLocaleDateString('da-DK',{day:'numeric',month:'long'});

  const html = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
body,#print-overlay{font-family:-apple-system,Arial,sans-serif;color:#111}
.pr-wrap{max-width:680px;margin:0 auto;padding:28px 36px}
h1{font-size:1.5rem;font-weight:700;margin-bottom:2px}
.sub{font-size:.9rem;color:#777;margin-bottom:24px}
.day{margin-bottom:14px;border:1px solid #ddd;border-radius:8px;overflow:hidden}
.dh{background:#f4f4f4;padding:8px 14px;font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:8px}
.dl{font-weight:400;color:#888;text-transform:none;letter-spacing:0;font-size:.88rem}
.meal-row{display:flex;align-items:center;padding:9px 14px;border-top:1px solid #f0f0f0;gap:12px}
.mt{font-size:.68rem;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.05em;width:80px;flex-shrink:0}
.mn{flex:1;font-size:.93rem}
.ms{font-size:.8rem;color:#999;flex-shrink:0}
.empty{padding:9px 14px;color:#bbb;font-size:.85rem;font-style:italic;border-top:1px solid #f0f0f0}
.day-extra{padding:7px 14px;border-top:1px solid #f0f0f0;background:#fafafa}
.cal-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}
.cal-chip{font-size:.74rem;background:#FDF3DC;color:#555;border-radius:4px;padding:2px 7px;font-weight:500}
.note-row{font-size:.82rem;color:#555;font-style:italic;line-height:1.4}
.foot{margin-top:20px;font-size:.72rem;color:#bbb}
</style>
<div class="pr-wrap">
<h1>📅 Madplan</h1>
<p class="sub">${fromLbl} – ${toLbl}</p>
${daysHtml}
<p class="foot">Udskrevet ${new Date().toLocaleDateString('da-DK')}</p>
</div>`;

  printHtml(html);
}


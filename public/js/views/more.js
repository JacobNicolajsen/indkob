import { setTopActions, navigate } from '../app.js';
import { settings as settingsApi, ics as icsApi } from '../api.js';

export async function renderMore(container) {
  setTopActions('');

  // Hent evt. gemt ICS-URL
  let icsUrl = '';
  try {
    const s = await settingsApi.getAll();
    icsUrl = s.ics_url || '';
  } catch { /* ignorer */ }

  container.innerHTML = `
    <div class="section-header">Katalog & Data</div>
    <div style="background:var(--surface);border-radius:14px;margin:0 16px;overflow:hidden;box-shadow:0 2px 10px var(--shadow-warm)">
      <div class="list-item" id="go-catalog">
        <span style="font-size:1.4rem;width:28px;text-align:center">📦</span>
        <div style="flex:1">
          <div style="font-weight:600">Varekatalog</div>
          <div style="font-size:0.78rem;color:var(--ink-muted)">Administrer produkter og enheder</div>
        </div>
        <span style="color:var(--ink-muted);font-size:1.1rem">›</span>
      </div>
    </div>

    <div class="section-header">Kalenderabonnement</div>
    <div style="background:var(--surface);border-radius:14px;margin:0 16px;overflow:hidden;box-shadow:0 2px 10px var(--shadow-warm);padding:14px 16px">
      <div style="font-size:0.85rem;color:var(--ink-muted);margin-bottom:10px;line-height:1.5">
        ICS-link fra iOS Kalender viser begivenheder under hver dag i madplanen.
      </div>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="ics-url-input" type="url"
          placeholder="https://…/kalender.ics" value="${icsUrl}"
          style="flex:1;font-size:0.85rem">
        <button class="btn btn-primary" id="btn-ics-save">Gem</button>
      </div>
    </div>

    <div class="section-header">Om appen</div>
    <div style="background:var(--surface);border-radius:14px;margin:0 16px;overflow:hidden;box-shadow:0 2px 10px var(--shadow-warm)">
      <div class="list-item" style="cursor:default">
        <span style="font-size:1.3rem">🥘</span>
        <div>
          <div style="font-family:var(--serif);font-size:1.05rem;font-weight:600">Indkøbsassistent</div>
          <div style="font-size:0.78rem;color:var(--ink-muted)">Version 1.2.0</div>
        </div>
      </div>
      <div class="list-item" style="cursor:default">
        <span style="font-size:1.3rem">📲</span>
        <div>
          <div style="font-weight:600">Installer på iPhone</div>
          <div style="font-size:0.78rem;color:var(--ink-muted)">Safari → Del → Føj til hjemmeskærm</div>
        </div>
      </div>
    </div>

    <div class="section-header">Varekategorier</div>
    <div style="background:var(--surface);border-radius:14px;margin:0 16px 32px;overflow:hidden;box-shadow:0 2px 10px var(--shadow-warm)">
      ${[['🥕','Frugt & Grønt'],['🥩','Kød & Fisk'],['🥛','Mejeri & Æg'],['🍞','Brød & Bageri'],
         ['🥫','Kolonial'],['❄️','Frost'],['🍺','Drikkevarer'],['🧴','Husholdning'],['📦','Andet']]
        .map(([icon, name]) => `
          <div class="list-item" style="cursor:default">
            <span style="font-size:1.3rem;width:28px;text-align:center">${icon}</span>
            <span style="font-size:0.95rem">${name}</span>
          </div>`).join('')}
    </div>`;

  container.querySelector('#go-catalog').addEventListener('click', () => {
    navigate('catalog', { backTo: 'more' });
  });

  container.querySelector('#btn-ics-save').addEventListener('click', async () => {
    const url = container.querySelector('#ics-url-input').value.trim();
    try {
      await settingsApi.set('ics_url', url);
      await icsApi.refresh();
      const btn = container.querySelector('#btn-ics-save');
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = 'Gem'; }, 2000);
    } catch (e) {
      alert('Fejl: ' + e.message);
    }
  });
}

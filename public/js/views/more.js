import { setTopActions, navigate } from '../app.js';

export function renderMore(container) {
  setTopActions('');

  container.innerHTML = `
    <div class="ai-banner">
      <div class="ai-banner-icon">🤖</div>
      <div>
        <div class="ai-banner-title">Claude AI Assistent</div>
        <div class="ai-banner-sub">Lad AI foreslå madplan og finde opskrifter</div>
      </div>
      <button class="ai-banner-btn" disabled title="Kommer snart">Snart</button>
    </div>

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

    <div class="section-header">Om appen</div>
    <div style="background:var(--surface);border-radius:14px;margin:0 16px;overflow:hidden;box-shadow:0 2px 10px var(--shadow-warm)">
      <div class="list-item" style="cursor:default">
        <span style="font-size:1.3rem">🥘</span>
        <div>
          <div style="font-family:var(--serif);font-size:1.05rem;font-weight:600">Indkøbsassistent</div>
          <div style="font-size:0.78rem;color:var(--ink-muted)">Version 1.1.0</div>
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
}

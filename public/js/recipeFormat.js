import { esc } from './app.js';

/**
 * Opskriftsformat for fremgangsmåden (kolonnen recipes.description).
 * Ren tekst med få, simple markeringer — én blok pr. linje:
 *
 *   ## Sauce             → afsnitsoverskrift
 *   1. Brun kødet …      → nummereret trin (nummereringen starter forfra ved "1.")
 *   - Server med ris     → punkt
 *   Tip: …               → tip-boks
 *   (alt andet)          → almindeligt afsnit, fx en kort intro
 *
 * Inde i en linje:
 *   **løg**              → fremhævet ingrediens
 *   10 min, 1 time       → tid (automatisk)
 *   200 grader, 180 °C   → temperatur (automatisk)
 *   400 g, 2 dl, 1 spsk  → mængde (automatisk)
 *
 * Al tekst sendes gennem esc(), og kun vores egne tags indsættes,
 * så HTML i opskriften vises som tekst og aldrig køres.
 */

const NUM  = String.raw`\d+(?:[.,]\d+)?(?:\s*½)?|[½¼¾]`;
const SPAN = String.raw`(?:${NUM})(?:\s*(?:-|–|til)\s*(?:${NUM}))?`;
const UNIT = 'kg|g|ml|cl|dl|l|L|tsk|spsk|knsp|fed|stk|dåser?|poser?|pakker?|bundter?|bdt';

const INLINE = new RegExp([
  String.raw`\*\*(?<bold>[^*]+?)\*\*`,
  String.raw`(?<temp>(?:${SPAN})\s*(?:°\s*C?|grader)(?:\s+varmluft)?)`,
  String.raw`(?<time>(?:${SPAN})\s*(?:minutter|minut|min|sekunder|sek|timer|time))(?![\p{L}])`,
  String.raw`(?<qty>(?:${SPAN})\s*(?:${UNIT}))(?![\p{L}])`,
].join('|'), 'gu');

/** Renderer én linjes tekst med fremhævninger — altid HTML-sikkert */
export function formatInline(raw) {
  const text = String(raw ?? '');
  let out  = '';
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    // Tal midt i et ord eller en entitet ("B12", "#3") er ikke mængder
    const prev = text[m.index - 1];
    if (!m.groups.bold && prev && /[\p{L}\d#&]/u.test(prev)) continue;

    out += esc(text.slice(last, m.index));
    const g = m.groups;
    if (g.bold)      out += `<strong class="rx-ing">${esc(g.bold)}</strong>`;
    else if (g.temp) out += `<span class="rx-chip rx-temp">🌡 ${esc(g.temp)}</span>`;
    else if (g.time) out += `<span class="rx-chip rx-time">⏱ ${esc(g.time)}</span>`;
    else             out += `<span class="rx-qty">${esc(g.qty)}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

/** Opdeler fremgangsmåden i blokke: { type: 'heading'|'step'|'bullet'|'tip'|'para', text, n? } */
export function parseRecipeText(src) {
  const blocks = [];
  let n = 0;
  for (const raw of String(src ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^#{1,3}\s+(.+)$/))) {
      blocks.push({ type: 'heading', text: m[1] });
    } else if ((m = line.match(/^(\d{1,2})[.)]\s+(.+)$/))) {
      n = Number(m[1]) === 1 ? 1 : n + 1;
      blocks.push({ type: 'step', n, text: m[2] });
    } else if ((m = line.match(/^[-•*]\s+(.+)$/))) {
      blocks.push({ type: 'bullet', text: m[1] });
    } else if ((m = line.match(/^tips?\s*:\s*(.+)$/i))) {
      blocks.push({ type: 'tip', text: m[1] });
    } else {
      blocks.push({ type: 'para', text: line });
    }
  }
  return blocks;
}

/** Hele fremgangsmåden som HTML */
export function renderRecipeText(src) {
  const blocks = parseRecipeText(src);
  let html = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'step' || b.type === 'bullet') {
      // Saml på hinanden følgende trin/punkter i én liste
      const items = [];
      while (blocks[i]?.type === b.type) items.push(blocks[i++]);
      i--;
      html += b.type === 'step'
        ? `<ol class="rx-steps">${items.map(s => `
            <li class="rx-step"><span class="rx-step-n">${s.n}</span><div class="rx-step-text">${formatInline(s.text)}</div></li>`).join('')}
          </ol>`
        : `<ul class="rx-bullets">${items.map(s => `<li>${formatInline(s.text)}</li>`).join('')}</ul>`;
    } else if (b.type === 'heading') {
      html += `<div class="rx-heading">${formatInline(b.text)}</div>`;
    } else if (b.type === 'tip') {
      html += `<div class="rx-tip"><span class="rx-tip-label">💡 Tip</span> ${formatInline(b.text)}</div>`;
    } else {
      html += `<p class="rx-para">${formatInline(b.text)}</p>`;
    }
  }
  return html;
}

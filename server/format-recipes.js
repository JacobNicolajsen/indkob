// Omskriver opskrifternes fremgangsmåde til opskriftsformatet
// (se public/js/recipeFormat.js): ét nummereret trin pr. linje,
// "## Overskrift" for dele af opskriften, "Tip: …" og **ingredienser**.
//
//   node server/format-recipes.js            → tørkørsel: viser før/efter, ændrer intet
//   node server/format-recipes.js --id 12    → kun opskrift #12
//   node server/format-recipes.js --apply    → tager backup af databasen og gemmer
//
// Scriptet kan køres flere gange — allerede formaterede opskrifter
// giver samme resultat og springes over.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// Ord der optræder i næsten alle opskrifter og bare ville støje som fremhævning
const NO_HIGHLIGHT = new Set(['vand', 'salt', 'peber', 'salt og peber', 'is']);

// Forkortelser der slutter med punktum uden at afslutte sætningen
const ABBREV = /\b(?:ca|evt|fx|bl\.a|dvs|osv|nr|pkt)\.$/i;

const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Deler en tekst i sætninger uden at splitte efter "ca.", "fx." osv. */
function sentences(text) {
  const parts = text.split(/(?<=[.!?])\s+(?=[\p{Lu}\d])/u);
  const out = [];
  for (const p of parts) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

/**
 * Splitter en linje med indlejret nummerering ("1. Kog pasta. 2. Steg kød")
 * i separate trin. Kræver at numrene kommer i rækkefølge fra 1, så
 * "Bag i 2. omgang" eller "brug 3 æg" ikke splittes.
 */
function splitInlineNumbers(line) {
  const re = /(?:^|\s)(?:trin\s+)?(\d{1,2})[.):]\s+(?=[\p{Lu}])/giu;
  const cuts = [];
  let expect = 1;
  for (const m of line.matchAll(re)) {
    if (Number(m[1]) !== expect) continue;
    cuts.push(m.index + (m[0].match(/^\s/) ? 1 : 0));
    expect++;
  }
  if (cuts.length < 2 && !(cuts.length === 1 && cuts[0] === 0)) return [line];
  const out = [];
  if (cuts[0] > 0) out.push(line.slice(0, cuts[0]).trim());
  cuts.forEach((c, i) => out.push(line.slice(c, cuts[i + 1]).trim()));
  return out.filter(Boolean);
}

/** Markerer første forekomst af hver ingrediens i en linje med **…** */
function highlightIngredients(text, names) {
  // Del i stykker uden for og inden for eksisterende **…**, så vi
  // aldrig fremhæver noget to gange
  const segments = text.split(/(\*\*[^*]+?\*\*)/);
  const done = new Set(
    segments.filter(s => s.startsWith('**')).map(s => s.slice(2, -2).toLocaleLowerCase('da-DK'))
  );
  for (const name of names) {
    if (done.has(name)) continue;
    const re = new RegExp(`(?<![\\p{L}*])${reEscape(name)}(?:erne|ene|en|et|ne|er|e|r|n)?(?![\\p{L}*])`, 'iu');
    for (let i = 0; i < segments.length; i += 2) {
      const m = segments[i].match(re);
      if (!m) continue;
      const s = segments[i];
      segments.splice(i, 1, s.slice(0, m.index), `**${m[0]}**`, s.slice(m.index + m[0].length));
      done.add(name);
      break;
    }
  }
  return segments.join('');
}

/** Normaliserer ingrediensnavne til søgeord: "Ost, revet" → "ost" */
function ingredientKeys(names) {
  return [...new Set(names
    .map(n => String(n).split(/[,(]/)[0].trim().toLocaleLowerCase('da-DK'))
    .filter(n => n.length >= 3 && !NO_HIGHLIGHT.has(n)))]
    .sort((a, b) => b.length - a.length);   // længste først: "hakkede tomater" før "tomater"
}

/**
 * Omskriver en fremgangsmåde til opskriftsformatet.
 * ingredientNames: navnene på opskriftens ingredienser (til fremhævning).
 */
function toRecipeFormat(desc, ingredientNames = []) {
  const src = String(desc ?? '').replace(/\r\n?/g, '\n').trim();
  if (!src) return '';

  // Kort beskrivelse på én sætning ("Hurtig hverdagsret") er en intro, ikke et trin
  if (!src.includes('\n') && src.length < 100 && sentences(src).length <= 1 &&
      !/^\s*(?:trin\s+)?1[.):]\s/i.test(src)) {
    return src;
  }

  // 1. Linjer — og indlejret nummerering splittet ud på egne linjer
  const lines = src.split('\n')
    .map(l => l.trim()).filter(Boolean)
    .flatMap(splitInlineNumbers);

  // 2. Klassificér
  const items = [];   // { type: 'heading'|'step'|'bullet'|'tip'|'para', text, numbered? }
  for (const line of lines) {
    let m;
    if ((m = line.match(/^#{1,3}\s*(.+?):?$/))) {
      items.push({ type: 'heading', text: m[1] });
    } else if ((m = line.match(/^(?:trin\s+)?\d{1,2}\s*[.):]\s*(.+)$/i))) {
      items.push({ type: 'step', text: m[1], numbered: true });
    } else if ((m = line.match(/^tips?\s*[:.-]\s*(.+)$/i))) {
      items.push({ type: 'tip', text: m[1] });
    } else if ((m = line.match(/^[-•*–]\s+(.+)$/))) {
      items.push({ type: 'bullet', text: m[1] });
    } else if (line.length <= 40 && /:$/.test(line)) {
      // "Sauce:", "Til dressingen:" → afsnitsoverskrift
      items.push({ type: 'heading', text: line.replace(/:$/, '').replace(/^\*\*(.+)\*\*$/, '$1') });
    } else {
      items.push({ type: 'para', text: line });
    }
  }

  // 3. Løs tekst bliver til trin. Har opskriften allerede nummererede
  //    trin, beholdes tekst før første trin som intro; ellers deles
  //    teksten i sætninger, og korte sætninger slås sammen til ét trin.
  const hasNumbered = items.some(i => i.numbered);
  const firstStep   = items.findIndex(i => i.type === 'step' || i.type === 'heading');
  const result = [];
  items.forEach((it, idx) => {
    if (it.type !== 'para') { result.push(it); return; }
    if (hasNumbered) {
      result.push(idx < firstStep ? it : { type: 'step', text: it.text });
      return;
    }
    let cur = '';
    for (const s of sentences(it.text)) {
      cur = cur ? `${cur} ${s}` : s;
      if (cur.length >= 60) { result.push({ type: 'step', text: cur }); cur = ''; }
    }
    if (cur) {
      const prev = result[result.length - 1];
      if (prev?.type === 'step' && cur.length < 30) prev.text += ' ' + cur;
      else result.push({ type: 'step', text: cur });
    }
  });

  // 4. Fremhæv ingredienser og skriv ud med fortløbende numre
  //    (starter forfra efter hver overskrift)
  const keys = ingredientKeys(ingredientNames);
  const out  = [];
  let n = 0;
  for (const it of result) {
    const text = it.type === 'heading' ? it.text : highlightIngredients(it.text, keys);
    if (it.type === 'heading') { n = 0; out.push(`## ${text}`); }
    else if (it.type === 'step')   out.push(`${++n}. ${text}`);
    else if (it.type === 'bullet') out.push(`- ${text}`);
    else if (it.type === 'tip')    out.push(`Tip: ${text}`);
    else                           out.push(text);
  }
  return out.join('\n');
}

module.exports = { toRecipeFormat };
if (require.main !== module) return;

// ── Kør mod databasen ─────────────────────────────────────────────
const dataDir = process.env.DB_DIR || path.join(__dirname, '../data');
const dbPath  = path.join(dataDir, 'indkob.db');
const db = new DatabaseSync(dbPath);

const APPLY = process.argv.includes('--apply');
const idArg = process.argv.indexOf('--id');
const onlyId = idArg > -1 ? Number(process.argv[idArg + 1]) : null;

const recipes = db.prepare(
  `SELECT id, name, description FROM recipes ${onlyId ? 'WHERE id = ?' : ''} ORDER BY id`
).all(...(onlyId ? [onlyId] : []));
const ingStmt = db.prepare(`
  SELECT p.name FROM recipe_ingredients ri JOIN products p ON p.id = ri.product_id
  WHERE ri.recipe_id = ? ORDER BY ri.id
`);

const changes = [];
for (const r of recipes) {
  const after = toRecipeFormat(r.description, ingStmt.all(r.id).map(i => i.name));
  if (after !== (r.description ?? '').trim()) changes.push({ ...r, after });
}

for (const c of changes) {
  console.log(`\n══ #${c.id} ${c.name} ══`);
  console.log('── FØR ──');
  console.log(c.description);
  console.log('── EFTER ──');
  console.log(c.after);
}

console.log(`\n${recipes.length} opskrifter gennemgået, ${changes.length} omskrives.`);

if (!APPLY) {
  console.log('Tørkørsel — intet er ændret. Kør med --apply for at gennemføre.\n');
  process.exit(0);
}
if (!changes.length) process.exit(0);

// Backup før ændringer — VACUUM INTO giver en konsistent kopi selv i WAL-mode
const stamp  = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const backup = path.join(dataDir, `indkob-backup-${stamp}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`Backup gemt: ${backup}`);

db.exec('BEGIN');
try {
  const upd = db.prepare('UPDATE recipes SET description = ? WHERE id = ?');
  for (const c of changes) upd.run(c.after, c.id);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nFejlede — intet er ændret:', e.message);
  process.exit(1);
}
console.log(`Færdig: ${changes.length} opskrifter omskrevet.\n`);

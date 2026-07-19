// Rydder op i produktkataloget.
//
//   node server/cleanup-products.js          → tørkørsel, ændrer intet
//   node server/cleanup-products.js --apply  → gennemfører ændringerne
//
// 1. Fjerner tilberedningsbeskrivelser fra navne
//    ("Gulerødder, skåret i skiver" → "Gulerødder")
// 2. Slår dubletter sammen og flytter opskrift-ingredienser over på
//    den bevarede vare, så ingen opskrift mister en ingrediens.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// ── Tilberedningsfraser ───────────────────────────────────────────
// Kun haleteksten efter et komma (eller i parentes) kan fjernes, og
// kun hvis HELE halen består af tilberedningsord. Derfor overlever
// varianter som "Druer, røde", "Mel, fuldkornsmel" og "Ost, revet
// blanding" ("blanding" er ikke et tilberedningsord).

// Stærke ord: nok i sig selv til at halen er en tilberedning.
const STRONG = new Set([
  'skåret', 'opskåret', 'udskåret', 'skiveskåret',
  'hakket', 'hakkede', 'finthakket', 'finthakkede', 'grofthakket',
  'fintklippet', 'fintklippede', 'friskrevet', 'friskkværnet', 'friskværnet',
  'kværnet', 'kværnede', 'snittet', 'snittede',
  'skrællet', 'skrællede', 'skrælt', 'skalet', 'skalede',
  'pillet', 'pillede', 'smuttet', 'smuttede',
  'udstenet', 'udstenede', 'renset', 'rensede', 'skyllet', 'skyllede',
  'drænet', 'drænede', 'afdryppet', 'afdryppede',
  'delt', 'halveret', 'halverede', 'kvarteret', 'kvartet',
  'knust', 'knuste', 'presset', 'pressede', 'moset', 'mosede',
  'blendet', 'blendede', 'optøet', 'optøede',
]);

// Svage ord: tæller kun med i en længere tilberedningshale.
// Alene er de produktvarianter — "Skinke, kogt" og "Ost, revet"
// er ægte varer på linje med "Skinke, røget".
const WEAK = new Set([
  'kogt', 'kogte', 'ristet', 'ristede', 'revet', 'revne', 'bagt', 'bagte',
]);

// Fyldord: tilladt i halen, men aldrig nok i sig selv.
const FILLER = new Set([
  'i', 'og', 'samt', 'med', 'til', 'lidt',
  'fint', 'fine', 'groft', 'grove', 'små', 'store', 'tynde', 'tykke',
  'sprødt', 'sprød', 'sprøde', 'let', 'mindre', 'mundrette', 'grofte',
  'skiver', 'tern', 'terninger', 'buketter', 'strimler', 'ringe', 'stave',
  'stykker', 'både', 'bidder', 'kvarte', 'halve', 'skær', 'både',
]);

// "i skiver", "i tern" osv. er en tilberedning; bare "skiver" er en
// salgsform ("Bacon, skiver"), så formordet kræver et foranstillet "i".
const SHAPE = new Set([
  'skiver', 'tern', 'terninger', 'buketter', 'strimler', 'ringe',
  'stave', 'stykker', 'både', 'bidder', 'kvarte', 'halve', 'skær',
]);

function isPrepTail(tail) {
  const words = tail.toLocaleLowerCase('da-DK').split(/[\s.]+/).filter(Boolean);
  if (!words.length) return false;
  if (!words.every(w => STRONG.has(w) || WEAK.has(w) || FILLER.has(w))) return false;
  return words.some((w, i) =>
    STRONG.has(w) || (SHAPE.has(w) && words[i - 1] === 'i')
  );
}

function cleanName(raw) {
  let name = String(raw).trim();

  // Parentes: "Gulerødder (skåret i skiver)"
  name = name.replace(/\s*\(([^)]*)\)\s*$/, (m, inner) =>
    isPrepTail(inner) ? '' : m
  );

  // Komma-hale — kan gentages: "Broccoli, skyllet, skåret i små buketter"
  let prev;
  do {
    prev = name;
    name = name.replace(/,\s*([^,]+)$/, (m, tail) => (isPrepTail(tail) ? '' : m));
  } while (name !== prev);

  return name.replace(/\s+/g, ' ').replace(/[\s,;-]+$/, '').trim();
}

const key = s => s.toLocaleLowerCase('da-DK').replace(/\s+/g, ' ').trim();

module.exports = { cleanName, key };
if (require.main !== module) return;

const dataDir = process.env.DB_DIR || path.join(__dirname, '../data');
const db = new DatabaseSync(path.join(dataDir, 'indkob.db'));
db.exec('PRAGMA foreign_keys = ON');

const APPLY = process.argv.includes('--apply');

// ── Analysér ──────────────────────────────────────────────────────
const products = db.prepare('SELECT id, name FROM products ORDER BY id').all();

const usage = new Map(
  db.prepare('SELECT product_id, COUNT(*) n FROM recipe_ingredients GROUP BY product_id')
    .all().map(r => [r.product_id, r.n])
);

const renames = [];   // { id, from, to }
const groups  = new Map();   // key → [{ id, name, cleaned }]

for (const p of products) {
  const cleaned = cleanName(p.name);
  if (cleaned && cleaned !== p.name) renames.push({ id: p.id, from: p.name, to: cleaned });
  const final = cleaned || p.name;
  if (!groups.has(key(final))) groups.set(key(final), []);
  groups.get(key(final)).push({ id: p.id, name: p.name, cleaned: final });
}

// Dubletgrupper: behold den mest brugte, ellers den ældste (laveste id).
const merges = [];
for (const [, members] of groups) {
  if (members.length < 2) continue;
  const sorted = members.slice().sort((a, b) =>
    (usage.get(b.id) || 0) - (usage.get(a.id) || 0) || a.id - b.id
  );
  merges.push({ keep: sorted[0], drop: sorted.slice(1) });
}

// Samme ord i anden rækkefølge, fx "Frisk mynte" vs "Mynte, frisk".
// Kun rapport — det kræver et menneske at afgøre hvilket navn der er rigtigt.
const byWords = new Map();
for (const [k, members] of groups) {
  const w = k.split(/[\s,]+/).filter(Boolean).sort().join(' ');
  if (!byWords.has(w)) byWords.set(w, []);
  byWords.get(w).push(members[0].cleaned);
}
const nearDupes = [...byWords.values()].filter(g => g.length > 1);

// ── Rapport ───────────────────────────────────────────────────────
console.log(`\n${products.length} varer i kataloget.\n`);

console.log(`── Navne der renses (${renames.length}) ──`);
for (const r of renames) console.log(`  "${r.from}"  →  "${r.to}"`);

const opskrifter = n => `${n} opskrift${n === 1 ? '' : 'er'}`;

console.log(`\n── Dubletter der slås sammen (${merges.length}) ──`);
for (const m of merges) {
  console.log(`  BEHOLD #${m.keep.id} "${m.keep.cleaned}" (${opskrifter(usage.get(m.keep.id) || 0)})`);
  for (const d of m.drop) {
    console.log(`    slet #${d.id} "${d.name}" — ${opskrifter(usage.get(d.id) || 0)} flyttes over`);
  }
}

if (nearDupes.length) {
  console.log(`\n── Samme ord, anden rækkefølge — slås IKKE sammen automatisk (${nearDupes.length}) ──`);
  for (const g of nearDupes) console.log(`  ${g.map(n => `"${n}"`).join('  ~  ')}`);
}

if (!APPLY) {
  console.log('\nTørkørsel — intet er ændret. Kør med --apply for at gennemføre.\n');
  process.exit(0);
}

// ── Gennemfør ─────────────────────────────────────────────────────
// Rækkefølgen er vigtig: dubletter fjernes FØR omdøbning, ellers
// kolliderer et renset navn med den dublet der endnu ikke er slettet.
db.exec('BEGIN');
try {
  const repoint = db.prepare('UPDATE recipe_ingredients SET product_id = ? WHERE product_id = ?');
  const del     = db.prepare('DELETE FROM products WHERE id = ?');

  for (const m of merges) {
    for (const d of m.drop) {
      repoint.run(m.keep.id, d.id);
      del.run(d.id);
    }
  }

  // Sammenlægning kan give samme ingrediens to gange i én opskrift.
  db.exec(`
    DELETE FROM recipe_ingredients WHERE id NOT IN (
      SELECT MIN(id) FROM recipe_ingredients
      GROUP BY recipe_id, product_id, IFNULL(amount, -1), unit
    )
  `);

  const rename = db.prepare('UPDATE products SET name = ? WHERE id = ?');
  const dropped = new Set(merges.flatMap(m => m.drop.map(d => d.id)));
  for (const r of renames) {
    if (!dropped.has(r.id)) rename.run(r.to, r.id);
  }

  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nFejlede — intet er ændret:', e.message);
  process.exit(1);
}

console.log(`\nFærdig: ${renames.length} navne renset, ` +
  `${merges.reduce((n, m) => n + m.drop.length, 0)} dubletter fjernet.\n`);

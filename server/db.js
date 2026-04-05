const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DB_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'indkob.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── Schema-version ───────────────────────────────────────────────
const CURRENT_VERSION = 3;
const version = db.prepare('PRAGMA user_version').get()['user_version'];
const recipesExists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'"
).get();

if (version < 1 && !recipesExists) {
  // ── Frisk installation: opret v2-schema direkte ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      servings    INTEGER DEFAULT 4,
      category    TEXT    DEFAULT '',
      image       TEXT    DEFAULT '',
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL UNIQUE,
      default_unit  TEXT    DEFAULT 'stk',
      shop_category TEXT    DEFAULT 'Andet',
      created_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id  INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      amount     REAL,
      unit       TEXT    DEFAULT '',
      FOREIGN KEY (recipe_id)  REFERENCES recipes(id)  ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS meal_plan (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT    NOT NULL,
      meal_type  TEXT    NOT NULL,
      recipe_id  INTEGER NOT NULL,
      servings   INTEGER DEFAULT 4,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_plan_date_type
      ON meal_plan(date, meal_type);

    CREATE TABLE IF NOT EXISTS shopping_list (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      amount        REAL,
      unit          TEXT    DEFAULT '',
      shop_category TEXT    DEFAULT 'Andet',
      checked       INTEGER DEFAULT 0,
      source        TEXT    DEFAULT 'custom',
      created_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_item_library (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL UNIQUE,
      unit          TEXT    DEFAULT '',
      shop_category TEXT    DEFAULT 'Andet'
    );
  `);
  db.exec(`PRAGMA user_version = ${CURRENT_VERSION}`);

} else if (version < 2 && recipesExists) {
  // ── Migration fra v1 → v2: tilføj varekatalog ───────────────────
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    // 1. Opret products-tabel
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL UNIQUE,
        default_unit  TEXT    DEFAULT 'stk',
        shop_category TEXT    DEFAULT 'Andet',
        created_at    TEXT    DEFAULT (datetime('now'))
      );
    `);

    // 2. Populér products fra eksisterende ingredienser (unikke navne)
    const colInfo = db.prepare('PRAGMA table_info(recipe_ingredients)').all();
    const hasProductId = colInfo.some(c => c.name === 'product_id');

    if (!hasProductId) {
      db.prepare(`
        INSERT OR IGNORE INTO products (name, default_unit, shop_category)
        SELECT DISTINCT
          name,
          CASE WHEN unit != '' THEN unit ELSE 'stk' END,
          CASE WHEN shop_category != '' THEN shop_category ELSE 'Andet' END
        FROM recipe_ingredients
      `).run();

      // 3. Ny recipe_ingredients med product_id
      db.exec(`
        CREATE TABLE recipe_ingredients_v2 (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id  INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          amount     REAL,
          unit       TEXT    DEFAULT '',
          FOREIGN KEY (recipe_id)  REFERENCES recipes(id)  ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
        );
      `);

      // 4. Migrer eksisterende ingredienser
      db.prepare(`
        INSERT INTO recipe_ingredients_v2 (id, recipe_id, product_id, amount, unit)
        SELECT ri.id, ri.recipe_id, p.id, ri.amount, ri.unit
        FROM recipe_ingredients ri
        JOIN products p ON LOWER(p.name) = LOWER(ri.name)
      `).run();

      // 5. Udskift tabel
      db.exec('DROP TABLE recipe_ingredients');
      db.exec('ALTER TABLE recipe_ingredients_v2 RENAME TO recipe_ingredients');
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Migration fejlede:', e.message);
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec(`PRAGMA user_version = ${CURRENT_VERSION}`);
}

// ── Migration v2 → v3: sources-kolonne på shopping_list ──────────
if (version < 3) {
  try {
    db.exec(`ALTER TABLE shopping_list ADD COLUMN sources TEXT DEFAULT '[]'`);
  } catch (e) {
    // Kolonnen eksisterer allerede — ignorer
    if (!e.message.includes('duplicate column')) throw e;
  }
  db.exec(`PRAGMA user_version = 3`);
}

module.exports = db;

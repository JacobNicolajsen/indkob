/**
 * Genberegner alle opskrift-baserede varer i indkøbslisten.
 * Kaldes automatisk når madplanen ændres.
 *
 * - Beregner mængder fra ALLE madplan-poster i databasen
 * - Aggregerer varer med samme produkt + enhed på tværs af retter
 * - Bevarer checked-status for varer der allerede er afkrydset
 * - Rører ikke custom-varer (source = 'custom')
 */
function recalculateShoppingList(db) {
  // Husk hvilke produktnavne der allerede er afkrydset
  const checkedNames = new Set(
    db.prepare(
      "SELECT LOWER(name) as n FROM shopping_list WHERE source='recipe' AND checked=1"
    ).all().map(r => r.n)
  );

  // Kun madplan fra dags dato og frem
  const now      = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // Hent madplan-poster fra i dag og frem med opskrift-ingredienser og produktinfo
  const entries = db.prepare(`
    SELECT
      mp.servings  AS mp_servings,
      mp.date      AS mp_date,
      mp.meal_type AS mp_meal_type,
      r.servings   AS r_servings,
      r.name       AS recipe_name,
      p.name       AS product_name,
      p.shop_category,
      ri.amount,
      ri.unit
    FROM meal_plan mp
    JOIN recipes r             ON r.id  = mp.recipe_id
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    JOIN products p            ON p.id  = ri.product_id
    WHERE mp.date >= ?
    ORDER BY mp.date, mp.meal_type
  `).all(todayStr);

  // Aggregér: samme produkt + enhed summeres; kildeinfo samles
  const agg = {};
  for (const e of entries) {
    const ratio = e.mp_servings / (e.r_servings || 4);
    const key   = `${e.product_name.toLowerCase()}||${e.unit}`;

    if (agg[key]) {
      if (e.amount !== null) {
        agg[key].amount = Math.round(((agg[key].amount || 0) + e.amount * ratio) * 100) / 100;
      }
      // Tilføj kilde hvis ikke allerede registreret for denne dato+ret
      const src = { recipe_name: e.recipe_name, date: e.mp_date, meal_type: e.mp_meal_type };
      if (!agg[key].sources.some(s => s.date === src.date && s.meal_type === src.meal_type)) {
        agg[key].sources.push(src);
      }
    } else {
      agg[key] = {
        name:          e.product_name,
        amount:        e.amount !== null ? Math.round(e.amount * ratio * 100) / 100 : null,
        unit:          e.unit,
        shop_category: e.shop_category,
        sources:       [{ recipe_name: e.recipe_name, date: e.mp_date, meal_type: e.mp_meal_type }],
      };
    }
  }

  // Opdater shopping_list atomisk
  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM shopping_list WHERE source = 'recipe'").run();

    const insert = db.prepare(`
      INSERT INTO shopping_list (name, amount, unit, shop_category, source, checked, sources)
      VALUES (?, ?, ?, ?, 'recipe', ?, ?)
    `);

    for (const item of Object.values(agg)) {
      const checked = checkedNames.has(item.name.toLowerCase()) ? 1 : 0;
      insert.run(item.name, item.amount, item.unit, item.shop_category, checked,
        JSON.stringify(item.sources || []));
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Tilføjer én rets ingredienser til indkøbslisten INKREMENTELT.
 * Bruges når en ny ret tilføjes til en tom slot — ingen fuld genberegning.
 * Aggregerer med eksisterende recipe-varer (samme navn + enhed summeres).
 */
function addMealToShoppingList(db, date, meal_type, recipe_id, servings) {
  const recipe = db.prepare('SELECT servings FROM recipes WHERE id = ?').get(recipe_id);
  if (!recipe) return;

  const ratio = servings / (recipe.servings || 4);

  const ingredients = db.prepare(`
    SELECT p.name, p.shop_category, ri.amount, ri.unit
    FROM recipe_ingredients ri
    JOIN products p ON p.id = ri.product_id
    WHERE ri.recipe_id = ?
  `).all(recipe_id);

  const recipeName = db.prepare('SELECT name FROM recipes WHERE id = ?').get(recipe_id)?.name || '';

  db.exec('BEGIN');
  try {
    for (const ing of ingredients) {
      const scaledAmount = ing.amount !== null
        ? Math.round(ing.amount * ratio * 100) / 100
        : null;

      const key = ing.name.toLowerCase();
      const existing = db.prepare(
        "SELECT id, amount, sources FROM shopping_list WHERE LOWER(name) = ? AND unit = ? AND source = 'recipe'"
      ).get(key, ing.unit);

      const newSrc = { recipe_name: recipeName, date, meal_type };

      if (existing) {
        const newAmount = (existing.amount !== null && scaledAmount !== null)
          ? Math.round(((existing.amount || 0) + scaledAmount) * 100) / 100
          : (existing.amount ?? scaledAmount);

        let srcs = [];
        try { srcs = JSON.parse(existing.sources || '[]'); } catch { srcs = []; }
        if (!srcs.some(s => s.date === date && s.meal_type === meal_type)) {
          srcs.push(newSrc);
        }

        db.prepare(
          "UPDATE shopping_list SET amount = ?, sources = ? WHERE id = ?"
        ).run(newAmount, JSON.stringify(srcs), existing.id);
      } else {
        db.prepare(`
          INSERT INTO shopping_list (name, amount, unit, shop_category, source, checked, sources)
          VALUES (?, ?, ?, ?, 'recipe', 0, ?)
        `).run(ing.name, scaledAmount, ing.unit, ing.shop_category, JSON.stringify([newSrc]));
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { recalculateShoppingList, addMealToShoppingList };

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

  // Hent alle madplan-poster med opskrift-ingredienser og produktinfo
  const entries = db.prepare(`
    SELECT
      mp.servings  AS mp_servings,
      r.servings   AS r_servings,
      p.name       AS product_name,
      p.shop_category,
      ri.amount,
      ri.unit
    FROM meal_plan mp
    JOIN recipes r            ON r.id  = mp.recipe_id
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    JOIN products p           ON p.id  = ri.product_id
  `).all();

  // Aggregér: samme produkt + enhed summeres
  const agg = {};
  for (const e of entries) {
    const ratio = e.mp_servings / (e.r_servings || 4);
    const key   = `${e.product_name.toLowerCase()}||${e.unit}`;

    if (agg[key]) {
      if (e.amount !== null) {
        agg[key].amount = Math.round(((agg[key].amount || 0) + e.amount * ratio) * 100) / 100;
      }
    } else {
      agg[key] = {
        name:          e.product_name,
        amount:        e.amount !== null ? Math.round(e.amount * ratio * 100) / 100 : null,
        unit:          e.unit,
        shop_category: e.shop_category,
      };
    }
  }

  // Opdater shopping_list atomisk
  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM shopping_list WHERE source = 'recipe'").run();

    const insert = db.prepare(`
      INSERT INTO shopping_list (name, amount, unit, shop_category, source, checked)
      VALUES (?, ?, ?, ?, 'recipe', ?)
    `);

    for (const item of Object.values(agg)) {
      const checked = checkedNames.has(item.name.toLowerCase()) ? 1 : 0;
      insert.run(item.name, item.amount, item.unit, item.shop_category, checked);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { recalculateShoppingList };

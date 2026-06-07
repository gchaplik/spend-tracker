import { db } from "../db/index.js";

export const getSetting = (key) => {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : null;
};

export const setSetting = (key, value) =>
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").run(key, JSON.stringify(value));

export const getAllSettings = () => {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
};

export const getCatBudgets = () => {
  const rows = db.prepare("SELECT category, budget FROM cat_budgets").all();
  const out = {};
  for (const r of rows) out[r.category] = r.budget;
  return out;
};

export const setCatBudget = (category, budget) =>
  db.prepare("INSERT OR REPLACE INTO cat_budgets(category,budget) VALUES(?,?)").run(category, budget);

export const replaceCatBudgets = (budgets) => {
  db.transaction(() => {
    db.prepare("DELETE FROM cat_budgets").run();
    const stmt = db.prepare("INSERT INTO cat_budgets(category,budget) VALUES(?,?)");
    for (const [cat, budget] of Object.entries(budgets || {})) stmt.run(cat, budget);
  })();
};

export const getGoals = () => db.prepare("SELECT * FROM goals").all();

export const upsertGoal = (goal) => {
  db.prepare(`INSERT OR REPLACE INTO goals
    (id,name,emoji,targetAmount,currentAmount,monthlyTarget,deadline,color,createdAt)
    VALUES (@id,@name,@emoji,@targetAmount,@currentAmount,@monthlyTarget,@deadline,@color,@createdAt)`)
    .run({
      id:goal.id, name:goal.name, emoji:goal.emoji||"🎯",
      targetAmount:goal.targetAmount||0, currentAmount:goal.currentAmount||0,
      monthlyTarget:goal.monthlyTarget||0, deadline:goal.deadline||null,
      color:goal.color||"#0284C7", createdAt:goal.createdAt||null,
    });
};

export const removeGoal = (id) => db.prepare("DELETE FROM goals WHERE id=?").run(id);

export const replaceAllGoals = (goals) => {
  db.transaction(() => {
    db.prepare("DELETE FROM goals").run();
    const stmt = db.prepare(`INSERT INTO goals
      (id,name,emoji,targetAmount,currentAmount,monthlyTarget,deadline,color,createdAt)
      VALUES (@id,@name,@emoji,@targetAmount,@currentAmount,@monthlyTarget,@deadline,@color,@createdAt)`);
    for (const g of goals) {
      stmt.run({
        id:g.id, name:g.name, emoji:g.emoji||"🎯",
        targetAmount:g.targetAmount||0, currentAmount:g.currentAmount||0,
        monthlyTarget:g.monthlyTarget||0, deadline:g.deadline||null,
        color:g.color||"#0284C7", createdAt:g.createdAt||null,
      });
    }
  })();
};

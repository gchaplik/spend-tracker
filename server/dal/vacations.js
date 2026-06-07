import { db } from "../db/index.js";

export const getAll = () => db.prepare("SELECT * FROM vacations ORDER BY startDate DESC").all();
export const getAllTxns = () => db.prepare("SELECT * FROM vacation_txns ORDER BY date DESC").all();

export const upsertVacation = (v) => {
  db.prepare(`INSERT OR REPLACE INTO vacations (id,name,startDate,endDate,budget,notes)
    VALUES (@id,@name,@startDate,@endDate,@budget,@notes)`).run({
    id:v.id, name:v.name, startDate:v.startDate, endDate:v.endDate, budget:v.budget||0, notes:v.notes||null,
  });
};

export const removeVacation = (id) => {
  db.prepare("DELETE FROM vacations WHERE id=?").run(id);
  db.prepare("DELETE FROM vacation_txns WHERE vacationId=?").run(id);
};

export const addTxn = (t) => {
  db.prepare(`INSERT OR REPLACE INTO vacation_txns (id,vacationId,amount,date,merchant,note)
    VALUES (@id,@vacationId,@amount,@date,@merchant,@note)`).run({
    id:t.id, vacationId:t.vacationId, amount:t.amount, date:t.date, merchant:t.merchant||null, note:t.note||null,
  });
};

export const removeTxn = (id) => db.prepare("DELETE FROM vacation_txns WHERE id=?").run(id);

export const replaceAll = (vacations) => {
  db.transaction(() => {
    db.prepare("DELETE FROM vacations").run();
    const stmt = db.prepare(`INSERT INTO vacations (id,name,startDate,endDate,budget,notes)
      VALUES (@id,@name,@startDate,@endDate,@budget,@notes)`);
    for (const v of vacations) stmt.run({ id:v.id, name:v.name, startDate:v.startDate, endDate:v.endDate, budget:v.budget||0, notes:v.notes||null });
  })();
};

export const replaceAllTxns = (txns) => {
  db.transaction(() => {
    db.prepare("DELETE FROM vacation_txns").run();
    const stmt = db.prepare(`INSERT INTO vacation_txns (id,vacationId,amount,date,merchant,note)
      VALUES (@id,@vacationId,@amount,@date,@merchant,@note)`);
    for (const t of txns) stmt.run({ id:t.id, vacationId:t.vacationId, amount:t.amount, date:t.date, merchant:t.merchant||null, note:t.note||null });
  })();
};

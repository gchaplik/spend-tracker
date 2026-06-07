import { db } from "../db/index.js";

export const getAllBills = () =>
  db.prepare("SELECT * FROM bills ORDER BY dueDay ASC").all().map(r => ({ ...r, active: r.active !== 0 }));

export const upsertBill = (bill) => {
  db.prepare(`INSERT OR REPLACE INTO bills (id,name,amount,dueDay,category,active,notes,cadence)
    VALUES (@id,@name,@amount,@dueDay,@category,@active,@notes,@cadence)`).run({
    id: bill.id, name: bill.name, amount: bill.amount, dueDay: bill.dueDay||15,
    category: bill.category||null, active: bill.active!==false?1:0,
    notes: bill.note||bill.notes||null, cadence: bill.cadence||null,
  });
};

export const removeBill = (id) => db.prepare("DELETE FROM bills WHERE id=?").run(id);

export const getPayments = (month) => {
  if (month) return db.prepare("SELECT * FROM bill_payments WHERE month=?").all(month);
  return db.prepare("SELECT * FROM bill_payments ORDER BY month DESC").all();
};

export const addPayment = (payment) => {
  db.prepare(`INSERT OR REPLACE INTO bill_payments (id,billId,month,amount,paidDate)
    VALUES (@id,@billId,@month,@amount,@paidDate)`).run({
    id: payment.id, billId: payment.billId, month: payment.month,
    amount: payment.amount, paidDate: payment.paidDate||null,
  });
};

export const removePayment = (id) => db.prepare("DELETE FROM bill_payments WHERE id=?").run(id);

export const replaceAllBills = (bills) => {
  db.transaction(() => {
    db.prepare("DELETE FROM bills").run();
    const stmt = db.prepare(`INSERT INTO bills (id,name,amount,dueDay,category,active,notes,cadence)
      VALUES (@id,@name,@amount,@dueDay,@category,@active,@notes,@cadence)`);
    for (const b of bills) {
      stmt.run({ id:b.id, name:b.name, amount:b.amount, dueDay:b.dueDay||15,
        category:b.category||null, active:b.active!==false?1:0,
        notes:b.note||b.notes||null, cadence:b.cadence||null });
    }
  })();
};

export const replaceAllPayments = (payments) => {
  db.transaction(() => {
    db.prepare("DELETE FROM bill_payments").run();
    const stmt = db.prepare(`INSERT INTO bill_payments (id,billId,month,amount,paidDate)
      VALUES (@id,@billId,@month,@amount,@paidDate)`);
    for (const p of payments) {
      stmt.run({ id:p.id, billId:p.billId, month:p.month, amount:p.amount, paidDate:p.paidDate||null });
    }
  })();
};

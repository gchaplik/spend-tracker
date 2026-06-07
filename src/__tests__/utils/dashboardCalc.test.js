// Dashboard spending / net calculations extracted as pure functions

const calcSpending = (txns, billPayments, vacationTxns, month) => {
  const mt = txns.filter(t => t.date && t.date.startsWith(month));
  const txnSpending = mt.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const paidBillsTotal = billPayments.filter(p => p.month === month).reduce((s, p) => s + p.amount, 0);
  const vacationSpending = vacationTxns.filter(t => t.date && t.date.startsWith(month)).reduce((s, t) => s + t.amount, 0);
  return txnSpending + paidBillsTotal + vacationSpending;
};

const calcIncome = (txns, month) =>
  txns.filter(t => t.date && t.date.startsWith(month) && t.type === 'income').reduce((s, t) => s + t.amount, 0);

const calcActNet = (income, spending) => income - spending;

const calcProjNet = (income, spending, pendingExp) => (income + pendingExp) - spending;

const delta = (cur, prev) => {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
};

// Fixture
const txns = [
  { type: 'expense', amount: 100, date: '2026-06-01', category: 'A' },
  { type: 'expense', amount:  50, date: '2026-06-02', category: 'B' },
  { type: 'income',  amount: 500, date: '2026-06-01', category: 'I' },
  { type: 'expense', amount:  30, date: '2026-05-15', category: 'A' }, // different month
];
const billPayments = [{ month: '2026-06', amount: 200, billId: 'b1' }];
const vacationTxns = [
  { type: 'expense', amount: 80, date: '2026-06-03' },
  { type: 'expense', amount: 40, date: '2026-05-30' }, // different month
];

describe('Dashboard spending calculation', () => {
  test('sums txn expenses + paid bills + vacation txns for the month', () => {
    const spending = calcSpending(txns, billPayments, vacationTxns, '2026-06');
    expect(spending).toBeCloseTo(100 + 50 + 200 + 80, 2);
  });

  test('vacation txns from other months are excluded', () => {
    const spending = calcSpending(txns, [], [{ type: 'expense', amount: 999, date: '2026-05-01' }], '2026-06');
    expect(spending).toBeCloseTo(150, 2);
  });

  test('paid bills from other months are excluded', () => {
    const spending = calcSpending(txns, [{ month: '2026-05', amount: 500, billId: 'b1' }], [], '2026-06');
    expect(spending).toBeCloseTo(150, 2);
  });

  test('no data returns 0', () => {
    expect(calcSpending([], [], [], '2026-06')).toBe(0);
  });

  test('income transactions do not count as spending', () => {
    const spending = calcSpending(txns, [], [], '2026-06');
    expect(spending).toBeCloseTo(150, 2); // only expenses
  });
});

describe('Dashboard income calculation', () => {
  test('sums income for the month', () => {
    expect(calcIncome(txns, '2026-06')).toBe(500);
  });
  test('expenses do not count as income', () => {
    expect(calcIncome(txns, '2026-06')).toBe(500);
  });
  test('different month returns 0', () => {
    expect(calcIncome(txns, '2025-01')).toBe(0);
  });
});

describe('Net position', () => {
  test('actNet = income - spending', () => {
    const spending = calcSpending(txns, billPayments, vacationTxns, '2026-06');
    const income = calcIncome(txns, '2026-06');
    expect(calcActNet(income, spending)).toBeCloseTo(500 - (150 + 200 + 80), 1);
  });

  test('projNet includes pending expected income', () => {
    const spending = 300;
    const income = 500;
    const pending = 200;
    expect(calcProjNet(income, spending, pending)).toBe(400);
  });

  test('negative net when spending exceeds income', () => {
    expect(calcActNet(100, 500)).toBe(-400);
  });
});

describe('delta() — period-over-period change', () => {
  test('positive growth', () => expect(delta(110, 100)).toBeCloseTo(10.0, 1));
  test('negative change', () => expect(delta(90, 100)).toBeCloseTo(-10.0, 1));
  test('no previous data returns null', () => expect(delta(100, 0)).toBeNull());
  test('100% growth', () => expect(delta(200, 100)).toBeCloseTo(100.0, 1));
  test('zero current', () => expect(delta(0, 100)).toBeCloseTo(-100.0, 1));
});

describe('Vacation spending rolls up to dashboard', () => {
  test('$315.39 vacation in June adds to spending', () => {
    const vTxns = [{ type: 'expense', amount: 315.39, date: '2026-06-05' }];
    const spending = calcSpending([], [], vTxns, '2026-06');
    expect(spending).toBeCloseTo(315.39, 2);
  });

  test('vacation txns outside month date range are excluded', () => {
    const vTxns = [{ type: 'expense', amount: 315.39, date: '2026-07-01' }];
    const spending = calcSpending([], [], vTxns, '2026-06');
    expect(spending).toBe(0);
  });
});

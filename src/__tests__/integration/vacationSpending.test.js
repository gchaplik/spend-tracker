// Integration: vacation transactions count towards dashboard spending

// Inline spending formula (mirrors SpendTracker.jsx dashboard calc)
const calcSpending = (txns, billPayments, vacationTxns, month) => {
  const mt = txns.filter(t => t.date && t.date.startsWith(month));
  const txnSpending = mt.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const paidBillsTotal = billPayments.filter(p => p.month === month).reduce((s, p) => s + p.amount, 0);
  const vacationSpending = vacationTxns.filter(t => t.date && t.date.startsWith(month)).reduce((s, t) => s + t.amount, 0);
  return txnSpending + paidBillsTotal + vacationSpending;
};

// Inline vacationTxns extractor (mirrors app logic)
const getVacationTxns = (txns, vacations) => {
  if (!vacations?.length) return [];
  const allTxns = [];
  for (const v of vacations) {
    if (!v.startDate || !v.endDate) continue;
    const vtxns = txns.filter(t =>
      t.type === 'expense' && t.date && t.date >= v.startDate && t.date <= v.endDate
    );
    allTxns.push(...vtxns);
  }
  return allTxns;
};

describe('Vacation transactions count towards spending', () => {
  const vacations = [{ name: 'Paris', startDate: '2026-06-10', endDate: '2026-06-18', budget: 2000 }];
  const vacationTxns = [
    { type: 'expense', amount: 200, date: '2026-06-12', category: 'Dining', merchant: 'Bistro' },
    { type: 'expense', amount: 115.39, date: '2026-06-14', category: 'Transport', merchant: 'Taxi' },
    { type: 'expense', amount: 50, date: '2026-07-01', category: 'Dining', merchant: 'Cafe' }, // after vacation, different month
  ];

  test('vacation txns in June add to June spending', () => {
    const spending = calcSpending([], [], vacationTxns, '2026-06');
    expect(spending).toBeCloseTo(200 + 115.39, 2);
  });

  test('vacation txn outside month excluded', () => {
    const spending = calcSpending([], [], vacationTxns, '2026-06');
    expect(spending).toBeCloseTo(315.39, 2); // not 365.39
  });

  test('combined: regular + bills + vacation', () => {
    const txns = [{ type: 'expense', amount: 50, date: '2026-06-01', category: 'Groceries' }];
    const bills = [{ month: '2026-06', amount: 100 }];
    const vtxns = [{ type: 'expense', amount: 200, date: '2026-06-12' }];
    const spending = calcSpending(txns, bills, vtxns, '2026-06');
    expect(spending).toBeCloseTo(350, 2);
  });

  test('no vacations means no vacation spending', () => {
    const spending = calcSpending([], [], [], '2026-06');
    expect(spending).toBe(0);
  });

  test('$315.39 real-world scenario', () => {
    const vtxns = [{ type: 'expense', amount: 315.39, date: '2026-06-05' }];
    const spending = calcSpending([], [], vtxns, '2026-06');
    expect(spending).toBeCloseTo(315.39, 2);
  });
});

describe('getVacationTxns helper', () => {
  const txns = [
    { type: 'expense', amount: 100, date: '2026-06-12', category: 'Dining' },
    { type: 'expense', amount: 50, date: '2026-06-20', category: 'Dining' }, // outside vacation window
    { type: 'income', amount: 500, date: '2026-06-12', category: 'Income' }, // income, should be excluded
  ];
  const vacations = [{ name: 'Paris', startDate: '2026-06-10', endDate: '2026-06-18', budget: 2000 }];

  test('returns only txns within vacation date range', () => {
    const result = getVacationTxns(txns, vacations);
    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(100);
  });

  test('excludes income txns', () => {
    const result = getVacationTxns(txns, vacations);
    result.forEach(t => expect(t.type).toBe('expense'));
  });

  test('empty vacations returns empty', () => {
    expect(getVacationTxns(txns, [])).toEqual([]);
  });

  test('handles undefined vacations', () => {
    expect(getVacationTxns(txns, undefined)).toEqual([]);
  });

  test('multiple vacations accumulate txns', () => {
    const multiVacations = [
      { name: 'Paris', startDate: '2026-06-10', endDate: '2026-06-14', budget: 1000 },
      { name: 'London', startDate: '2026-06-15', endDate: '2026-06-20', budget: 1000 },
    ];
    const multiTxns = [
      { type: 'expense', amount: 100, date: '2026-06-12' },
      { type: 'expense', amount: 80, date: '2026-06-18' },
    ];
    const result = getVacationTxns(multiTxns, multiVacations);
    expect(result.length).toBe(2);
  });
});

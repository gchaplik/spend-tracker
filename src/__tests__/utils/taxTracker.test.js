// Unit tests for Tax Tracker — deductible tagging, RRSP/TFSA tracking, summary

// ── Pure helpers ──────────────────────────────────────────────────────────────

function calcDeductibleByCategory(txns, markedItems, year) {
  const result = {};
  markedItems.filter(m => m.type === 'deductible' && (!m.year || m.year === year)).forEach(m => {
    const txn = txns.find(t => t.id === m.txnId);
    if (!txn) return;
    result[m.taxCat] = (result[m.taxCat] || 0) + txn.amount;
  });
  return result;
}

function calcTotalDeductible(deductibleByCategory) {
  return Object.values(deductibleByCategory).reduce((s, v) => s + v, 0);
}

function calcRrspPct(contributed, room) {
  return room > 0 ? +(contributed / room * 100).toFixed(1) : 0;
}

function calcRrspRemaining(contributed, room) {
  return Math.max(0, room - contributed);
}

function calcYearSummary(txns, year) {
  const yearTxns = txns.filter(t => t.date && t.date.startsWith(String(year)));
  const income = yearTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = yearTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { income, expenses, net: income - expenses };
}

// ── calcDeductibleByCategory ──────────────────────────────────────────────────

describe('calcDeductibleByCategory', () => {
  const txns = [
    { id: 't1', type: 'expense', amount: 200,  date: '2026-06-01', merchant: 'Dentist'    },
    { id: 't2', type: 'expense', amount: 100,  date: '2026-06-02', merchant: 'Charity'    },
    { id: 't3', type: 'expense', amount: 50,   date: '2026-06-03', merchant: 'Office'     },
    { id: 't4', type: 'expense', amount: 150,  date: '2025-06-01', merchant: 'Old Dentist' },
  ];

  test('groups deductible amounts by tax category', () => {
    const marked = [
      { type: 'deductible', txnId: 't1', taxCat: 'Medical', year: 2026 },
      { type: 'deductible', txnId: 't2', taxCat: 'Charitable Donation', year: 2026 },
    ];
    const result = calcDeductibleByCategory(txns, marked, 2026);
    expect(result['Medical']).toBe(200);
    expect(result['Charitable Donation']).toBe(100);
  });

  test('sums multiple transactions in same category', () => {
    const marked = [
      { type: 'deductible', txnId: 't1', taxCat: 'Medical', year: 2026 },
      { type: 'deductible', txnId: 't3', taxCat: 'Medical', year: 2026 },
    ];
    const result = calcDeductibleByCategory(txns, marked, 2026);
    expect(result['Medical']).toBe(250);
  });

  test('ignores marked items for different years', () => {
    const marked = [
      { type: 'deductible', txnId: 't4', taxCat: 'Medical', year: 2025 },
    ];
    const result = calcDeductibleByCategory(txns, marked, 2026);
    expect(result['Medical']).toBeUndefined();
  });

  test('orphaned marks (no matching txn) are skipped', () => {
    const marked = [
      { type: 'deductible', txnId: 'missing-id', taxCat: 'Medical', year: 2026 },
    ];
    const result = calcDeductibleByCategory(txns, marked, 2026);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('empty marked list returns empty object', () => {
    expect(calcDeductibleByCategory(txns, [], 2026)).toEqual({});
  });

  test('non-deductible items are ignored', () => {
    const marked = [
      { type: 'rrsp', amount: 5000 },
      { type: 'tfsa', amount: 6000 },
    ];
    const result = calcDeductibleByCategory(txns, marked, 2026);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── calcTotalDeductible ───────────────────────────────────────────────────────

describe('calcTotalDeductible', () => {
  test('sums all category totals', () => {
    const cat = { Medical: 200, 'Charitable Donation': 100, 'Business Expense': 350 };
    expect(calcTotalDeductible(cat)).toBe(650);
  });

  test('empty object returns 0', () => {
    expect(calcTotalDeductible({})).toBe(0);
  });

  test('single category', () => {
    expect(calcTotalDeductible({ Medical: 450 })).toBe(450);
  });
});

// ── RRSP tracking ─────────────────────────────────────────────────────────────

describe('calcRrspPct', () => {
  test('50% contribution of room', () => {
    expect(calcRrspPct(16245, 32490)).toBe(50.0);
  });

  test('100% room used', () => {
    expect(calcRrspPct(32490, 32490)).toBe(100.0);
  });

  test('over-contribution (>100%)', () => {
    expect(calcRrspPct(35000, 32490)).toBeGreaterThan(100);
  });

  test('zero room → 0%', () => {
    expect(calcRrspPct(5000, 0)).toBe(0);
  });

  test('zero contribution → 0%', () => {
    expect(calcRrspPct(0, 32490)).toBe(0);
  });
});

describe('calcRrspRemaining', () => {
  test('partial use of room', () => {
    expect(calcRrspRemaining(10000, 32490)).toBe(22490);
  });

  test('full use of room → 0 remaining', () => {
    expect(calcRrspRemaining(32490, 32490)).toBe(0);
  });

  test('over-contribution clamps to 0', () => {
    expect(calcRrspRemaining(35000, 32490)).toBe(0);
  });

  test('no contribution → full room remaining', () => {
    expect(calcRrspRemaining(0, 32490)).toBe(32490);
  });
});

// ── calcYearSummary ───────────────────────────────────────────────────────────

describe('calcYearSummary', () => {
  const txns = [
    { id: 't1', type: 'income',  amount: 60000, date: '2026-03-01' },
    { id: 't2', type: 'expense', amount: 40000, date: '2026-06-01' },
    { id: 't3', type: 'expense', amount: 5000,  date: '2026-12-01' },
    { id: 't4', type: 'income',  amount: 10000, date: '2025-06-01' }, // different year
  ];

  test('sums income for the correct year', () => {
    const { income } = calcYearSummary(txns, 2026);
    expect(income).toBe(60000);
  });

  test('sums expenses for the correct year', () => {
    const { expenses } = calcYearSummary(txns, 2026);
    expect(expenses).toBe(45000);
  });

  test('net = income - expenses', () => {
    const { net } = calcYearSummary(txns, 2026);
    expect(net).toBe(15000);
  });

  test('excludes transactions from other years', () => {
    const { income } = calcYearSummary(txns, 2025);
    expect(income).toBe(10000);
  });

  test('empty transactions → all zeros', () => {
    const { income, expenses, net } = calcYearSummary([], 2026);
    expect(income).toBe(0);
    expect(expenses).toBe(0);
    expect(net).toBe(0);
  });
});

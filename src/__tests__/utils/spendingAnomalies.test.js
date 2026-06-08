// Unit tests for Spending Anomaly Detection — category comparison and duplicate detection

// ── Pure anomaly detection logic ──────────────────────────────────────────────

function detectCategoryAnomalies(txns, cats, month) {
  const results = [];
  cats.forEach(cat => {
    const curSpend = txns
      .filter(t => t.type === 'expense' && t.category === cat && t.date && t.date.startsWith(month))
      .reduce((s, t) => s + t.amount, 0);
    if (curSpend === 0) return;

    const prev3 = [1, 2, 3].map(i => {
      const d = new Date(month + '-01'); d.setMonth(d.getMonth() - i);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    });

    const prevSpends = prev3.map(m =>
      txns.filter(t => t.type === 'expense' && t.category === cat && t.date && t.date.startsWith(m))
        .reduce((s, t) => s + t.amount, 0)
    );
    const avg = prevSpends.reduce((s, v) => s + v, 0) / 3;
    if (avg < 10) return;

    const ratio = curSpend / avg;
    if (ratio >= 1.5)       results.push({ cat, curSpend, avg, ratio, type: 'high' });
    else if (ratio < 0.3 && avg > 50) results.push({ cat, curSpend, avg, ratio, type: 'low' });
  });
  return results;
}

function detectDuplicates(txns, month) {
  const seen = {};
  txns.filter(t => t.date && t.date.startsWith(month)).forEach(t => {
    const key = `${t.date}|${t.amount}|${(t.merchant || '').toLowerCase()}`;
    seen[key] = (seen[key] || 0) + 1;
  });
  return Object.entries(seen).filter(([, v]) => v > 1).map(([k]) => k);
}

// ── detectCategoryAnomalies ───────────────────────────────────────────────────

describe('detectCategoryAnomalies — high spending', () => {
  test('flags category at 2× the 3-month average', () => {
    const month = '2026-06';
    const txns = [
      // Current month — double normal
      { type: 'expense', category: 'Dining', amount: 400, date: '2026-06-01' },
      // 3 prior months — average 200
      { type: 'expense', category: 'Dining', amount: 200, date: '2026-05-01' },
      { type: 'expense', category: 'Dining', amount: 200, date: '2026-04-01' },
      { type: 'expense', category: 'Dining', amount: 200, date: '2026-03-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['Dining'], month);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('high');
    expect(anomalies[0].cat).toBe('Dining');
  });

  test('flags at exactly 1.5× average (boundary)', () => {
    const month = '2026-06';
    const txns = [
      { type: 'expense', category: 'Groceries', amount: 300, date: '2026-06-01' }, // 1.5× of 200
      { type: 'expense', category: 'Groceries', amount: 200, date: '2026-05-01' },
      { type: 'expense', category: 'Groceries', amount: 200, date: '2026-04-01' },
      { type: 'expense', category: 'Groceries', amount: 200, date: '2026-03-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['Groceries'], month);
    expect(anomalies[0]?.type).toBe('high');
  });

  test('does not flag at 1.4× average (below threshold)', () => {
    const month = '2026-06';
    const txns = [
      { type: 'expense', category: 'Groceries', amount: 280, date: '2026-06-01' }, // 1.4×
      { type: 'expense', category: 'Groceries', amount: 200, date: '2026-05-01' },
      { type: 'expense', category: 'Groceries', amount: 200, date: '2026-04-01' },
      { type: 'expense', category: 'Groceries', amount: 200, date: '2026-03-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['Groceries'], month);
    expect(anomalies.filter(a => a.type === 'high')).toHaveLength(0);
  });
});

describe('detectCategoryAnomalies — low spending', () => {
  test('flags category below 30% of average (when avg > $50)', () => {
    const month = '2026-06';
    const txns = [
      { type: 'expense', category: 'Entertainment', amount: 10, date: '2026-06-01' }, // 10% of 100
      { type: 'expense', category: 'Entertainment', amount: 100, date: '2026-05-01' },
      { type: 'expense', category: 'Entertainment', amount: 100, date: '2026-04-01' },
      { type: 'expense', category: 'Entertainment', amount: 100, date: '2026-03-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['Entertainment'], month);
    expect(anomalies[0]?.type).toBe('low');
  });

  test('does not flag low spending if avg < $10 (noise filter)', () => {
    const month = '2026-06';
    const txns = [
      { type: 'expense', category: 'Entertainment', amount: 1, date: '2026-06-01' },
      { type: 'expense', category: 'Entertainment', amount: 5, date: '2026-05-01' },
      { type: 'expense', category: 'Entertainment', amount: 5, date: '2026-04-01' },
      { type: 'expense', category: 'Entertainment', amount: 5, date: '2026-03-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['Entertainment'], month);
    expect(anomalies).toHaveLength(0);
  });
});

describe('detectCategoryAnomalies — edge cases', () => {
  test('zero spending in current month does not flag', () => {
    const month = '2026-06';
    const txns = [
      { type: 'expense', category: 'Transport', amount: 100, date: '2026-05-01' },
      { type: 'expense', category: 'Transport', amount: 100, date: '2026-04-01' },
      { type: 'expense', category: 'Transport', amount: 100, date: '2026-03-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['Transport'], month);
    expect(anomalies).toHaveLength(0);
  });

  test('no prior history (avg=0) does not flag', () => {
    const month = '2026-06';
    const txns = [
      { type: 'expense', category: 'NewCat', amount: 500, date: '2026-06-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['NewCat'], month);
    expect(anomalies).toHaveLength(0);
  });

  test('income transactions are ignored', () => {
    const month = '2026-06';
    const txns = [
      { type: 'income', category: 'Groceries', amount: 9000, date: '2026-06-01' },
      { type: 'expense', category: 'Groceries', amount: 200, date: '2026-05-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['Groceries'], month);
    expect(anomalies).toHaveLength(0);
  });

  test('multiple anomalous categories are all returned', () => {
    const month = '2026-06';
    const txns = [
      { type: 'expense', category: 'Dining',    amount: 600, date: '2026-06-01' },
      { type: 'expense', category: 'Dining',    amount: 200, date: '2026-05-01' },
      { type: 'expense', category: 'Dining',    amount: 200, date: '2026-04-01' },
      { type: 'expense', category: 'Dining',    amount: 200, date: '2026-03-01' },
      { type: 'expense', category: 'Transport', amount: 500, date: '2026-06-01' },
      { type: 'expense', category: 'Transport', amount: 100, date: '2026-05-01' },
      { type: 'expense', category: 'Transport', amount: 100, date: '2026-04-01' },
      { type: 'expense', category: 'Transport', amount: 100, date: '2026-03-01' },
    ];
    const anomalies = detectCategoryAnomalies(txns, ['Dining', 'Transport'], month);
    expect(anomalies).toHaveLength(2);
  });
});

// ── detectDuplicates ──────────────────────────────────────────────────────────

describe('detectDuplicates', () => {
  const month = '2026-06';

  test('detects two identical transactions (same date, amount, merchant)', () => {
    const txns = [
      { date: '2026-06-01', amount: 50, merchant: 'Walmart', type: 'expense' },
      { date: '2026-06-01', amount: 50, merchant: 'Walmart', type: 'expense' },
    ];
    const dupes = detectDuplicates(txns, month);
    expect(dupes).toHaveLength(1);
  });

  test('does not flag different amounts as duplicate', () => {
    const txns = [
      { date: '2026-06-01', amount: 50, merchant: 'Walmart', type: 'expense' },
      { date: '2026-06-01', amount: 60, merchant: 'Walmart', type: 'expense' },
    ];
    expect(detectDuplicates(txns, month)).toHaveLength(0);
  });

  test('does not flag different dates as duplicate', () => {
    const txns = [
      { date: '2026-06-01', amount: 50, merchant: 'Walmart', type: 'expense' },
      { date: '2026-06-02', amount: 50, merchant: 'Walmart', type: 'expense' },
    ];
    expect(detectDuplicates(txns, month)).toHaveLength(0);
  });

  test('case-insensitive merchant comparison', () => {
    const txns = [
      { date: '2026-06-01', amount: 50, merchant: 'WALMART', type: 'expense' },
      { date: '2026-06-01', amount: 50, merchant: 'walmart', type: 'expense' },
    ];
    expect(detectDuplicates(txns, month)).toHaveLength(1);
  });

  test('transactions from different months are excluded', () => {
    const txns = [
      { date: '2026-06-01', amount: 50, merchant: 'Walmart', type: 'expense' },
      { date: '2026-05-01', amount: 50, merchant: 'Walmart', type: 'expense' },
    ];
    expect(detectDuplicates(txns, month)).toHaveLength(0);
  });

  test('triplicate returns one key (it appeared 3 times)', () => {
    const txns = [
      { date: '2026-06-01', amount: 50, merchant: 'Walmart', type: 'expense' },
      { date: '2026-06-01', amount: 50, merchant: 'Walmart', type: 'expense' },
      { date: '2026-06-01', amount: 50, merchant: 'Walmart', type: 'expense' },
    ];
    const dupes = detectDuplicates(txns, month);
    expect(dupes).toHaveLength(1); // same key, just count > 1
  });

  test('no transactions → no duplicates', () => {
    expect(detectDuplicates([], month)).toHaveLength(0);
  });
});

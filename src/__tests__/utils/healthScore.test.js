// Unit tests for Financial Health Score — sub-score calculations and composite

// ── Pure sub-score calculators (extracted from HealthScore component) ─────────

function calcSavingsScore(income3mo, exp3mo) {
  const savingsRate = income3mo > 0 ? (income3mo - exp3mo) / income3mo * 100 : 0;
  return {
    score: Math.min(100, Math.max(0, (savingsRate / 20) * 100)),
    rate: +savingsRate.toFixed(1),
  };
}

function calcEmergencyScore(cashBalance, monthlyExpenses) {
  const months = monthlyExpenses > 0 ? cashBalance / monthlyExpenses : 0;
  return {
    score: Math.min(100, (months / 3) * 100),
    months: +months.toFixed(1),
  };
}

function calcBudgetAdherenceScore(txns, catBudgets, month) {
  const mt = txns.filter(t => t.type === 'expense' && t.date && t.date.startsWith(month));
  const budgCats = Object.entries(catBudgets).filter(([, v]) => v > 0);
  if (budgCats.length === 0) return 100;
  const under = budgCats.filter(([c, b]) =>
    mt.filter(t => t.category === c).reduce((s, t) => s + t.amount, 0) <= b
  ).length;
  return (under / budgCats.length) * 100;
}

function calcGoalScore(goals) {
  const active = goals.filter(g => g.target > 0);
  if (active.length === 0) return 100;
  return active.reduce((s, g) => s + Math.min(100, ((g.saved || 0) / g.target) * 100), 0) / active.length;
}

function calcCompositeScore(savingsScore, emergencyScore, budgetScore, goalScore, nwScore) {
  return Math.round(
    savingsScore  * 0.30 +
    emergencyScore * 0.25 +
    budgetScore   * 0.20 +
    goalScore     * 0.15 +
    nwScore       * 0.10
  );
}

// ── calcSavingsScore ──────────────────────────────────────────────────────────

describe('calcSavingsScore', () => {
  test('20% savings rate → score of 100', () => {
    const { score } = calcSavingsScore(5000, 4000); // 20%
    expect(score).toBeCloseTo(100, 0);
  });

  test('10% savings rate → score of 50', () => {
    const { score } = calcSavingsScore(5000, 4500); // 10%
    expect(score).toBeCloseTo(50, 0);
  });

  test('0% savings rate → score of 0', () => {
    const { score } = calcSavingsScore(5000, 5000);
    expect(score).toBe(0);
  });

  test('negative savings (overspending) → score of 0', () => {
    const { score } = calcSavingsScore(3000, 5000);
    expect(score).toBe(0);
  });

  test('40%+ savings rate → capped at 100', () => {
    const { score } = calcSavingsScore(5000, 2000); // 60%
    expect(score).toBe(100);
  });

  test('no income → score of 0', () => {
    const { score } = calcSavingsScore(0, 1000);
    expect(score).toBe(0);
  });

  test('returns savings rate as percentage', () => {
    const { rate } = calcSavingsScore(4000, 3000);
    expect(rate).toBeCloseTo(25.0, 1);
  });
});

// ── calcEmergencyScore ────────────────────────────────────────────────────────

describe('calcEmergencyScore', () => {
  test('3 months cash → score of 100', () => {
    const { score } = calcEmergencyScore(9000, 3000);
    expect(score).toBeCloseTo(100, 0);
  });

  test('1.5 months cash → score of 50', () => {
    const { score } = calcEmergencyScore(4500, 3000);
    expect(score).toBeCloseTo(50, 0);
  });

  test('0 cash → score of 0', () => {
    const { score } = calcEmergencyScore(0, 3000);
    expect(score).toBe(0);
  });

  test('6 months cash → capped at 100', () => {
    const { score } = calcEmergencyScore(18000, 3000);
    expect(score).toBe(100);
  });

  test('returns months coverage', () => {
    const { months } = calcEmergencyScore(7500, 2500);
    expect(months).toBe(3.0);
  });

  test('zero monthly expenses → 0 months', () => {
    const { months } = calcEmergencyScore(5000, 0);
    expect(months).toBe(0);
  });
});

// ── calcBudgetAdherenceScore ──────────────────────────────────────────────────

describe('calcBudgetAdherenceScore', () => {
  const month = '2026-06';
  const txns = [
    { type: 'expense', amount: 200, date: '2026-06-01', category: 'Groceries' },
    { type: 'expense', amount: 150, date: '2026-06-02', category: 'Dining'    },
    { type: 'expense', amount:  50, date: '2026-06-03', category: 'Transport' },
  ];

  test('all categories under budget → 100', () => {
    const score = calcBudgetAdherenceScore(txns, { Groceries: 300, Dining: 200, Transport: 100 }, month);
    expect(score).toBe(100);
  });

  test('one category over budget → partial score', () => {
    const score = calcBudgetAdherenceScore(txns, { Groceries: 100, Dining: 200, Transport: 100 }, month);
    // 2 of 3 under budget = 66.7%
    expect(score).toBeCloseTo(66.7, 0);
  });

  test('all categories over budget → 0', () => {
    const score = calcBudgetAdherenceScore(txns, { Groceries: 50, Dining: 50, Transport: 30 }, month);
    expect(score).toBe(0);
  });

  test('no budgets set → returns 100', () => {
    const score = calcBudgetAdherenceScore(txns, {}, month);
    expect(score).toBe(100);
  });

  test('category with 0 budget is excluded from calculation', () => {
    const score = calcBudgetAdherenceScore(txns, { Groceries: 300, Dining: 0 }, month);
    expect(score).toBe(100); // only Groceries (under) counts
  });

  test('different month transactions do not affect score', () => {
    const otherMonthTxns = [
      { type: 'expense', amount: 9999, date: '2026-05-01', category: 'Groceries' },
    ];
    const score = calcBudgetAdherenceScore(otherMonthTxns, { Groceries: 300 }, month);
    expect(score).toBe(100); // nothing spent in June
  });
});

// ── calcGoalScore ─────────────────────────────────────────────────────────────

describe('calcGoalScore', () => {
  test('all goals at 100% → score 100', () => {
    const goals = [
      { id: '1', target: 1000, saved: 1000 },
      { id: '2', target: 500,  saved: 600  },
    ];
    expect(calcGoalScore(goals)).toBe(100);
  });

  test('one goal at 50% → score 50', () => {
    const goals = [{ id: '1', target: 1000, saved: 500 }];
    expect(calcGoalScore(goals)).toBe(50);
  });

  test('averages across multiple goals', () => {
    const goals = [
      { id: '1', target: 1000, saved: 1000 }, // 100%
      { id: '2', target: 1000, saved: 0    }, // 0%
    ];
    expect(calcGoalScore(goals)).toBe(50);
  });

  test('no goals → returns 100', () => {
    expect(calcGoalScore([])).toBe(100);
  });

  test('goal with no target is excluded', () => {
    const goals = [
      { id: '1', target: 0,    saved: 500 },
      { id: '2', target: 1000, saved: 500 },
    ];
    expect(calcGoalScore(goals)).toBe(50);
  });

  test('goal with no saved property defaults to 0', () => {
    const goals = [{ id: '1', target: 1000 }];
    expect(calcGoalScore(goals)).toBe(0);
  });

  test('over-saved goal is capped at 100%', () => {
    const goals = [{ id: '1', target: 500, saved: 2000 }];
    expect(calcGoalScore(goals)).toBe(100);
  });
});

// ── calcCompositeScore ────────────────────────────────────────────────────────

describe('calcCompositeScore — weighted average', () => {
  test('all 100s → composite 100', () => {
    expect(calcCompositeScore(100, 100, 100, 100, 100)).toBe(100);
  });

  test('all 0s → composite 0', () => {
    expect(calcCompositeScore(0, 0, 0, 0, 0)).toBe(0);
  });

  test('weights sum to 1.0 (30+25+20+15+10)', () => {
    // Equal weight check: if all equal X, composite = X
    const x = 60;
    expect(calcCompositeScore(x, x, x, x, x)).toBe(x);
  });

  test('savings rate has the highest weight', () => {
    // Only savings at 100, rest at 0
    const savingsOnly = calcCompositeScore(100, 0, 0, 0, 0);
    const emergencyOnly = calcCompositeScore(0, 100, 0, 0, 0);
    expect(savingsOnly).toBeGreaterThan(emergencyOnly);
  });

  test('rounds to nearest integer', () => {
    const score = calcCompositeScore(75, 80, 60, 90, 50);
    expect(Number.isInteger(score)).toBe(true);
  });

  test('excellent threshold is ≥80', () => {
    const good = calcCompositeScore(90, 85, 80, 90, 80);
    expect(good).toBeGreaterThanOrEqual(80);
  });

  test('poor score when all sub-scores are low', () => {
    const poor = calcCompositeScore(20, 10, 30, 15, 10);
    expect(poor).toBeLessThan(40);
  });
});

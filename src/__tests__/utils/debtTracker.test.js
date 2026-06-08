// Unit tests for Debt Tracker — payoff simulation, avalanche/snowball ordering, interest calc

// ── Pure payoff simulation ────────────────────────────────────────────────────

function simulatePayoff(debt, extraMonthly = 0, maxMonths = 600) {
  const monthlyRate = debt.rate / 100 / 12;
  let bal = debt.balance;
  let totalInterest = 0;
  let months = 0;
  const payment = Math.max(debt.minPayment + extraMonthly, bal * monthlyRate + 0.01);
  while (bal > 0.01 && months < maxMonths) {
    const interest = bal * monthlyRate;
    totalInterest += interest;
    bal = bal + interest - payment;
    if (bal < 0) bal = 0;
    months++;
  }
  return { months, totalInterest: +totalInterest.toFixed(2) };
}

function sortByStrategy(debts, strategy) {
  const copy = [...debts];
  if (strategy === 'avalanche') return copy.sort((a, b) => b.rate - a.rate);
  if (strategy === 'snowball')  return copy.sort((a, b) => a.balance - b.balance);
  return copy;
}

function totalDebt(debts) {
  return debts.reduce((s, d) => s + d.balance, 0);
}

function monthlyMinPayments(debts) {
  return debts.reduce((s, d) => s + (d.minPayment || 0), 0);
}

// ── simulatePayoff ────────────────────────────────────────────────────────────

describe('simulatePayoff — basic calculation', () => {
  test('zero-rate debt pays off in balance/payment months', () => {
    const { months } = simulatePayoff({ balance: 1200, rate: 0, minPayment: 100 });
    expect(months).toBe(12);
  });

  test('higher rate → more total interest paid', () => {
    const low  = simulatePayoff({ balance: 5000, rate: 5,  minPayment: 100 });
    const high = simulatePayoff({ balance: 5000, rate: 20, minPayment: 100 });
    expect(high.totalInterest).toBeGreaterThan(low.totalInterest);
  });

  test('extra monthly payment reduces payoff time', () => {
    const base  = simulatePayoff({ balance: 5000, rate: 19.99, minPayment: 150 }, 0);
    const extra = simulatePayoff({ balance: 5000, rate: 19.99, minPayment: 150 }, 200);
    expect(extra.months).toBeLessThan(base.months);
  });

  test('extra payment reduces total interest', () => {
    const base  = simulatePayoff({ balance: 5000, rate: 19.99, minPayment: 150 }, 0);
    const extra = simulatePayoff({ balance: 5000, rate: 19.99, minPayment: 150 }, 200);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
  });

  test('very small debt pays off in 1 month', () => {
    const { months } = simulatePayoff({ balance: 10, rate: 5, minPayment: 100 });
    expect(months).toBe(1);
  });

  test('returns months and totalInterest', () => {
    const result = simulatePayoff({ balance: 1000, rate: 10, minPayment: 100 });
    expect(result).toHaveProperty('months');
    expect(result).toHaveProperty('totalInterest');
    expect(result.months).toBeGreaterThan(0);
    expect(result.totalInterest).toBeGreaterThan(0);
  });

  test('total interest is 0 for 0% rate debt', () => {
    const { totalInterest } = simulatePayoff({ balance: 1000, rate: 0, minPayment: 200 });
    expect(totalInterest).toBeCloseTo(0, 1);
  });

  test('minimum payment just covering interest extends payoff indefinitely (caps at maxMonths)', () => {
    // $10,000 at 24% = $200/mo interest. minPayment of $201 will eventually pay off.
    const { months } = simulatePayoff({ balance: 10000, rate: 24, minPayment: 201 }, 0, 600);
    expect(months).toBeLessThanOrEqual(600);
    expect(months).toBeGreaterThan(100);
  });
});

// ── sortByStrategy ────────────────────────────────────────────────────────────

describe('sortByStrategy — avalanche vs snowball', () => {
  const debts = [
    { id: '1', name: 'Card A', balance: 5000, rate: 19.99, minPayment: 100 },
    { id: '2', name: 'Card B', balance: 2000, rate: 29.99, minPayment: 60  },
    { id: '3', name: 'Car',    balance: 12000, rate: 5.9,  minPayment: 250 },
  ];

  test('avalanche sorts highest rate first', () => {
    const sorted = sortByStrategy(debts, 'avalanche');
    expect(sorted[0].rate).toBe(29.99);
    expect(sorted[1].rate).toBe(19.99);
    expect(sorted[2].rate).toBe(5.9);
  });

  test('snowball sorts lowest balance first', () => {
    const sorted = sortByStrategy(debts, 'snowball');
    expect(sorted[0].balance).toBe(2000);
    expect(sorted[1].balance).toBe(5000);
    expect(sorted[2].balance).toBe(12000);
  });

  test('avalanche does not modify original array', () => {
    const original = [...debts];
    sortByStrategy(debts, 'avalanche');
    expect(debts[0].id).toBe(original[0].id);
  });

  test('single debt returns same single-item array for both strategies', () => {
    const single = [{ id: '1', balance: 1000, rate: 10, minPayment: 50 }];
    expect(sortByStrategy(single, 'avalanche')).toHaveLength(1);
    expect(sortByStrategy(single, 'snowball')).toHaveLength(1);
  });

  test('empty array returns empty array', () => {
    expect(sortByStrategy([], 'avalanche')).toHaveLength(0);
  });
});

// ── Avalanche vs Snowball total interest comparison ───────────────────────────

describe('Strategy comparison — avalanche saves more interest than snowball', () => {
  const debts = [
    { id: '1', name: 'High Rate', balance: 3000, rate: 25, minPayment: 100 },
    { id: '2', name: 'Low Balance', balance: 500,  rate: 10, minPayment: 30  },
  ];

  const totalInterestForStrategy = (strategy, extra = 200) => {
    const sorted = sortByStrategy(debts, strategy);
    return sorted.reduce((total, d, i) => {
      const { totalInterest } = simulatePayoff(d, i === 0 ? extra : 0);
      return total + totalInterest;
    }, 0);
  };

  test('avalanche total interest ≤ snowball total interest', () => {
    const avalanche = totalInterestForStrategy('avalanche');
    const snowball  = totalInterestForStrategy('snowball');
    expect(avalanche).toBeLessThanOrEqual(snowball);
  });
});

// ── Aggregate helpers ─────────────────────────────────────────────────────────

describe('Debt aggregate helpers', () => {
  const debts = [
    { id: '1', balance: 5000, rate: 19.99, minPayment: 150 },
    { id: '2', balance: 2000, rate: 29.99, minPayment:  60 },
    { id: '3', balance: 12000, rate: 5.9,  minPayment: 250 },
  ];

  test('totalDebt sums all balances', () => {
    expect(totalDebt(debts)).toBe(19000);
  });

  test('monthlyMinPayments sums all minimum payments', () => {
    expect(monthlyMinPayments(debts)).toBe(460);
  });

  test('totalDebt is 0 for empty list', () => {
    expect(totalDebt([])).toBe(0);
  });

  test('debt-to-income ratio calculation', () => {
    const monthlyIncome = 5000;
    const dti = monthlyMinPayments(debts) / monthlyIncome;
    expect(dti).toBeCloseTo(0.092, 2); // 9.2%
  });
});

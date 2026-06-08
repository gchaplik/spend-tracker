// Unit tests for Mortgage Calculator — payment calculation, amortization, extra payment savings

// ── Core mortgage formulas ────────────────────────────────────────────────────

function calcPayment(principal, annualRate, amortYears, periodsPerYear = 12) {
  const totalPeriods = amortYears * periodsPerYear;
  const perRate = annualRate / periodsPerYear;
  if (principal <= 0) return 0;
  if (perRate === 0) return +(principal / totalPeriods).toFixed(2);
  return +(principal * perRate * Math.pow(1 + perRate, totalPeriods) / (Math.pow(1 + perRate, totalPeriods) - 1)).toFixed(2);
}

function calcTotalInterest(principal, payment, amortYears, periodsPerYear = 12) {
  const totalPeriods = amortYears * periodsPerYear;
  return +Math.max(0, payment * totalPeriods - principal).toFixed(2);
}

function calcPayoffPeriods(principal, annualRate, payment, periodsPerYear = 12, maxPeriods = 1200) {
  const perRate = annualRate / periodsPerYear;
  let bal = principal;
  let periods = 0;
  let totalInterest = 0;
  while (bal > 0.01 && periods < maxPeriods) {
    const interest = bal * perRate;
    totalInterest += interest;
    bal = bal + interest - payment;
    if (bal < 0) bal = 0;
    periods++;
  }
  return { periods, totalInterest: +totalInterest.toFixed(2) };
}

function calcDownPaymentPct(down, price) {
  return price > 0 ? +(down / price * 100).toFixed(1) : 0;
}

// ── calcPayment ───────────────────────────────────────────────────────────────

describe('calcPayment — monthly mortgage payment', () => {
  test('standard Canadian mortgage: $400k, 5%, 25yr', () => {
    const payment = calcPayment(400000, 0.05, 25);
    expect(payment).toBeGreaterThan(2300);
    expect(payment).toBeLessThan(2500);
  });

  test('zero principal → payment is 0', () => {
    expect(calcPayment(0, 0.05, 25)).toBe(0);
  });

  test('zero rate → payment is principal / total periods', () => {
    const payment = calcPayment(120000, 0, 10);
    expect(payment).toBeCloseTo(120000 / 120, 2);
  });

  test('higher rate → higher payment (same principal and term)', () => {
    const low  = calcPayment(400000, 0.04, 25);
    const high = calcPayment(400000, 0.08, 25);
    expect(high).toBeGreaterThan(low);
  });

  test('longer amortization → lower payment', () => {
    const short = calcPayment(400000, 0.05, 15);
    const long  = calcPayment(400000, 0.05, 30);
    expect(long).toBeLessThan(short);
  });

  test('bi-weekly payment is roughly half of monthly (within 10%)', () => {
    const monthly  = calcPayment(400000, 0.05, 25, 12);
    const biweekly = calcPayment(400000, 0.05, 25, 26);
    // bi-weekly uses a different per-period rate so it won't be exactly half,
    // but should be within ~10% of monthly/2
    expect(biweekly).toBeGreaterThan(monthly / 2 * 0.90);
    expect(biweekly).toBeLessThan(monthly / 2 * 1.10);
  });

  test('payment covers at least the first month interest', () => {
    const principal = 500000;
    const rate = 0.05;
    const payment = calcPayment(principal, rate, 25);
    const firstInterest = principal * (rate / 12);
    expect(payment).toBeGreaterThan(firstInterest);
  });
});

// ── calcTotalInterest ─────────────────────────────────────────────────────────

describe('calcTotalInterest — total cost over amortization', () => {
  test('total interest is positive', () => {
    const payment = calcPayment(400000, 0.05, 25);
    const interest = calcTotalInterest(400000, payment, 25);
    expect(interest).toBeGreaterThan(0);
  });

  test('total interest decreases with lower rate', () => {
    const p1 = calcPayment(400000, 0.04, 25);
    const p2 = calcPayment(400000, 0.07, 25);
    const i1 = calcTotalInterest(400000, p1, 25);
    const i2 = calcTotalInterest(400000, p2, 25);
    expect(i2).toBeGreaterThan(i1);
  });

  test('total interest decreases with shorter amortization', () => {
    const p25 = calcPayment(400000, 0.05, 25);
    const p15 = calcPayment(400000, 0.05, 15);
    const i25 = calcTotalInterest(400000, p25, 25);
    const i15 = calcTotalInterest(400000, p15, 15);
    expect(i15).toBeLessThan(i25);
  });
});

// ── calcPayoffPeriods — extra payment impact ───────────────────────────────────

describe('calcPayoffPeriods — extra payments reduce term and interest', () => {
  test('extra $200/mo reduces payoff periods', () => {
    const principal = 400000;
    const rate = 0.05;
    const basePayment = calcPayment(principal, rate, 25);
    const base  = calcPayoffPeriods(principal, rate, basePayment);
    const extra = calcPayoffPeriods(principal, rate, basePayment + 200);
    expect(extra.periods).toBeLessThan(base.periods);
  });

  test('extra payment reduces total interest paid', () => {
    const principal = 400000;
    const rate = 0.05;
    const basePayment = calcPayment(principal, rate, 25);
    const base  = calcPayoffPeriods(principal, rate, basePayment);
    const extra = calcPayoffPeriods(principal, rate, basePayment + 500);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
  });

  test('standard payment pays off in exactly amort × 12 periods (approx)', () => {
    const principal = 300000;
    const payment = calcPayment(principal, 0.05, 25);
    const { periods } = calcPayoffPeriods(principal, 0.05, payment);
    expect(periods).toBeGreaterThan(290);
    expect(periods).toBeLessThanOrEqual(302);
  });

  test('returns periods and totalInterest', () => {
    const payment = calcPayment(300000, 0.05, 25);
    const result = calcPayoffPeriods(300000, 0.05, payment);
    expect(result).toHaveProperty('periods');
    expect(result).toHaveProperty('totalInterest');
  });
});

// ── calcDownPaymentPct ────────────────────────────────────────────────────────

describe('calcDownPaymentPct', () => {
  test('20% down payment', () => {
    expect(calcDownPaymentPct(100000, 500000)).toBe(20);
  });

  test('5% down payment (minimum)', () => {
    expect(calcDownPaymentPct(25000, 500000)).toBe(5);
  });

  test('100% down (no mortgage)', () => {
    expect(calcDownPaymentPct(500000, 500000)).toBe(100);
  });

  test('zero price → 0%', () => {
    expect(calcDownPaymentPct(0, 0)).toBe(0);
  });

  test('rounds to 1 decimal', () => {
    expect(calcDownPaymentPct(75000, 499000)).toBe(15.0);
  });
});

// ── Principal vs Interest split ───────────────────────────────────────────────

describe('Principal vs Interest split', () => {
  test('interest portion > principal portion early in amortization', () => {
    const principal = 400000;
    const rate = 0.05 / 12;
    const firstInterest = principal * rate;
    const payment = calcPayment(400000, 0.05, 25);
    const firstPrincipal = payment - firstInterest;
    expect(firstInterest).toBeGreaterThan(firstPrincipal);
  });

  test('principal portion grows over time (amortization effect)', () => {
    const principal = 400000;
    const rate = 0.05 / 12;
    const payment = calcPayment(400000, 0.05, 25);
    // First payment
    const i1 = principal * rate;
    const p1 = payment - i1;
    // After 10 years (120 payments)
    let bal = principal;
    for (let i = 0; i < 120; i++) {
      const interest = bal * rate;
      bal = bal + interest - payment;
    }
    const i120 = bal * rate;
    const p120 = payment - i120;
    expect(p120).toBeGreaterThan(p1);
  });
});

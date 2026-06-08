// Unit tests for Retirement Planner — compound growth, gap analysis, extra contribution

// ── Compound future value formulas ────────────────────────────────────────────

function fvLumpSum(principal, annualRate, years) {
  return principal * Math.pow(1 + annualRate, years);
}

function fvAnnuity(monthlyContrib, annualRate, years) {
  const n = years * 12;
  const r = annualRate / 12;
  if (r === 0) return monthlyContrib * n;
  return monthlyContrib * (Math.pow(1 + r, n) - 1) / r * Math.pow(1 + r, 1);
}

function projectedRetirement(existing, monthlyContrib, annualRate, years) {
  return Math.round(fvLumpSum(existing, annualRate, years) + fvAnnuity(monthlyContrib, annualRate, years));
}

function retirementGap(projected, target) {
  return Math.max(0, target - projected);
}

function extraMonthlyNeeded(gap, annualRate, years) {
  const n = years * 12;
  const r = annualRate / 12;
  if (n === 0 || gap <= 0) return 0;
  if (r === 0) return Math.ceil(gap / n);
  return Math.ceil(gap / ((Math.pow(1 + r, n) - 1) / r * Math.pow(1 + r, 1)));
}

// ── fvLumpSum ─────────────────────────────────────────────────────────────────

describe('fvLumpSum — compound growth on existing balance', () => {
  test('doubles roughly every 12 years at 6% (Rule of 72)', () => {
    const doubled = fvLumpSum(100000, 0.06, 12);
    expect(doubled).toBeCloseTo(201220, -2); // within $100
  });

  test('zero rate → principal unchanged', () => {
    expect(fvLumpSum(50000, 0, 10)).toBe(50000);
  });

  test('zero principal → always 0', () => {
    expect(fvLumpSum(0, 0.08, 30)).toBe(0);
  });

  test('positive rate and years → grows beyond principal', () => {
    expect(fvLumpSum(10000, 0.05, 20)).toBeGreaterThan(10000);
  });

  test('higher rate produces more growth', () => {
    const low  = fvLumpSum(50000, 0.04, 20);
    const high = fvLumpSum(50000, 0.08, 20);
    expect(high).toBeGreaterThan(low);
  });
});

// ── fvAnnuity ─────────────────────────────────────────────────────────────────

describe('fvAnnuity — monthly contribution compounding', () => {
  test('$500/mo for 30 years at 6% → ~$500k', () => {
    const fv = fvAnnuity(500, 0.06, 30);
    expect(fv).toBeGreaterThan(450000);
    expect(fv).toBeLessThan(600000);
  });

  test('zero contribution → 0', () => {
    expect(fvAnnuity(0, 0.06, 30)).toBe(0);
  });

  test('zero rate → simply n * monthly', () => {
    expect(fvAnnuity(100, 0, 10)).toBeCloseTo(100 * 120, 0);
  });

  test('more years → more growth', () => {
    const short = fvAnnuity(500, 0.06, 20);
    const long  = fvAnnuity(500, 0.06, 30);
    expect(long).toBeGreaterThan(short);
  });

  test('higher contribution → proportionally larger FV', () => {
    const base   = fvAnnuity(500, 0.06, 20);
    const double = fvAnnuity(1000, 0.06, 20);
    expect(double).toBeCloseTo(base * 2, -2);
  });
});

// ── projectedRetirement ───────────────────────────────────────────────────────

describe('projectedRetirement — combined projection', () => {
  test('returns integer', () => {
    const p = projectedRetirement(50000, 500, 0.06, 30);
    expect(Number.isInteger(p)).toBe(true);
  });

  test('with zero contributions, equals lump sum growth', () => {
    const p = projectedRetirement(100000, 0, 0.06, 20);
    const lump = Math.round(fvLumpSum(100000, 0.06, 20));
    expect(p).toBe(lump);
  });

  test('with zero existing balance, equals annuity FV', () => {
    const p = projectedRetirement(0, 500, 0.06, 20);
    const annuity = Math.round(fvAnnuity(500, 0.06, 20));
    expect(p).toBe(annuity);
  });

  test('larger contributions lead to higher projection', () => {
    const low  = projectedRetirement(50000, 200, 0.06, 30);
    const high = projectedRetirement(50000, 800, 0.06, 30);
    expect(high).toBeGreaterThan(low);
  });
});

// ── retirementGap ─────────────────────────────────────────────────────────────

describe('retirementGap', () => {
  test('projected exceeds target → gap is 0', () => {
    expect(retirementGap(1200000, 1000000)).toBe(0);
  });

  test('projected equals target → gap is 0', () => {
    expect(retirementGap(1000000, 1000000)).toBe(0);
  });

  test('projected below target → correct gap', () => {
    expect(retirementGap(750000, 1000000)).toBe(250000);
  });

  test('no savings → gap equals full target', () => {
    expect(retirementGap(0, 1000000)).toBe(1000000);
  });
});

// ── extraMonthlyNeeded ────────────────────────────────────────────────────────

describe('extraMonthlyNeeded — close the gap', () => {
  test('no gap → returns 0', () => {
    expect(extraMonthlyNeeded(0, 0.06, 30)).toBe(0);
  });

  test('zero years → returns 0', () => {
    expect(extraMonthlyNeeded(100000, 0.06, 0)).toBe(0);
  });

  test('higher gap needs more monthly contribution', () => {
    const small = extraMonthlyNeeded(100000, 0.06, 20);
    const large = extraMonthlyNeeded(500000, 0.06, 20);
    expect(large).toBeGreaterThan(small);
  });

  test('more years to retirement reduces extra needed', () => {
    const soon = extraMonthlyNeeded(200000, 0.06, 10);
    const late = extraMonthlyNeeded(200000, 0.06, 25);
    expect(late).toBeLessThan(soon);
  });

  test('returns a positive integer', () => {
    const extra = extraMonthlyNeeded(100000, 0.06, 20);
    expect(extra).toBeGreaterThan(0);
    expect(Number.isInteger(extra)).toBe(true);
  });
});

// ── RRSP contribution room ────────────────────────────────────────────────────

describe('RRSP contribution tracking', () => {
  const calcRrspPct = (contributed, room) => room > 0 ? (contributed / room) * 100 : 0;
  const roomRemaining = (contributed, room) => Math.max(0, room - contributed);

  test('calculates % of room used', () => {
    expect(calcRrspPct(10000, 32490)).toBeCloseTo(30.8, 0);
  });

  test('100% room used', () => {
    expect(calcRrspPct(32490, 32490)).toBeCloseTo(100, 1);
  });

  test('over-contribution (>100%) is possible', () => {
    expect(calcRrspPct(35000, 32490)).toBeGreaterThan(100);
  });

  test('zero room → 0%', () => {
    expect(calcRrspPct(5000, 0)).toBe(0);
  });

  test('roomRemaining', () => {
    expect(roomRemaining(10000, 32490)).toBe(22490);
  });

  test('no room remaining when over-contributed', () => {
    expect(roomRemaining(35000, 32490)).toBe(0);
  });
});

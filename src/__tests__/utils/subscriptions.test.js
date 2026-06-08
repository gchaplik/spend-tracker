// Unit tests for Subscription Manager — monthly cost, auto-detect, cadence conversion

// ── Cadence → monthly multiplier ─────────────────────────────────────────────

const SUB_CADENCES = [
  { v: 'weekly',    mo: 4.33  },
  { v: 'monthly',   mo: 1     },
  { v: 'bimonthly', mo: 0.5   },
  { v: 'quarterly', mo: 0.333 },
  { v: 'annually',  mo: 0.0833 },
];

function toMonthlyCost(amount, cadence) {
  const c = SUB_CADENCES.find(x => x.v === cadence) || SUB_CADENCES[1];
  return +(amount * c.mo).toFixed(2);
}

function totalMonthlyCost(subscriptions) {
  return subscriptions
    .filter(s => s.active !== false)
    .reduce((sum, s) => sum + toMonthlyCost(s.amount, s.cadence), 0);
}

// ── Auto-detect logic ─────────────────────────────────────────────────────────

function detectSubscriptions(txns, existing = []) {
  const merchantMap = {};
  txns.filter(t => t.type === 'expense').forEach(t => {
    const m = (t.merchant || '').toLowerCase().trim();
    if (!m) return;
    if (!merchantMap[m]) merchantMap[m] = [];
    merchantMap[m].push(t);
  });

  return Object.entries(merchantMap)
    .filter(([, ts]) => ts.length >= 2)
    .map(([merchant, ts]) => {
      const amounts = ts.map(t => t.amount);
      const avgAmt = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const consistent = amounts.every(a => Math.abs(a - avgAmt) < avgAmt * 0.1 + 1);
      const dates = ts.map(t => t.date).sort();
      const gaps = dates.slice(1).map((d, i) => Math.round((new Date(d) - new Date(dates[i])) / (1000 * 60 * 60 * 24)));
      const avgGap = gaps.reduce((s, v) => s + v, 0) / (gaps.length || 1);
      const isMonthly = avgGap >= 25 && avgGap <= 35;
      const isAnnual  = avgGap >= 330 && avgGap <= 400;
      if (!consistent || (gaps.length > 0 && !isMonthly && !isAnnual)) return null;
      const alreadyTracked = existing.some(s => s.name.toLowerCase() === merchant);
      if (alreadyTracked) return null;
      return {
        merchant: ts[0].merchant,
        amount: +avgAmt.toFixed(2),
        cadence: isAnnual ? 'annually' : 'monthly',
        count: ts.length,
      };
    })
    .filter(Boolean);
}

// ── toMonthlyCost ─────────────────────────────────────────────────────────────

describe('toMonthlyCost — cadence conversion', () => {
  test('monthly subscription — 1× cost', () => {
    expect(toMonthlyCost(15, 'monthly')).toBe(15);
  });

  test('annual subscription — 1/12 cost per month', () => {
    expect(toMonthlyCost(120, 'annually')).toBeCloseTo(10, 1);
  });

  test('quarterly subscription — 1/3 cost per month', () => {
    expect(toMonthlyCost(30, 'quarterly')).toBeCloseTo(10, 1);
  });

  test('bimonthly subscription — 0.5× cost per month', () => {
    expect(toMonthlyCost(40, 'bimonthly')).toBe(20);
  });

  test('weekly subscription — ~4.33× cost per month', () => {
    expect(toMonthlyCost(10, 'weekly')).toBeCloseTo(43.3, 0);
  });

  test('unknown cadence falls back to monthly', () => {
    expect(toMonthlyCost(20, 'unknown-cadence')).toBe(20);
  });
});

// ── totalMonthlyCost ──────────────────────────────────────────────────────────

describe('totalMonthlyCost — portfolio rollup', () => {
  test('sums monthly costs across all active subscriptions', () => {
    const subs = [
      { id: '1', name: 'Netflix',  amount: 18,  cadence: 'monthly',  active: true },
      { id: '2', name: 'Spotify',  amount: 10,  cadence: 'monthly',  active: true },
      { id: '3', name: 'Gym',      amount: 600, cadence: 'annually', active: true },
    ];
    const total = totalMonthlyCost(subs);
    expect(total).toBeCloseTo(18 + 10 + 600 * 0.0833, 0);
  });

  test('inactive subscriptions are excluded', () => {
    const subs = [
      { id: '1', name: 'Netflix', amount: 18, cadence: 'monthly', active: true  },
      { id: '2', name: 'Paused',  amount: 50, cadence: 'monthly', active: false },
    ];
    expect(totalMonthlyCost(subs)).toBe(18);
  });

  test('empty list returns 0', () => {
    expect(totalMonthlyCost([])).toBe(0);
  });

  test('annual cost = monthly * 12', () => {
    const subs = [{ id: '1', name: 'Netflix', amount: 18, cadence: 'monthly', active: true }];
    const monthly = totalMonthlyCost(subs);
    expect(monthly * 12).toBeCloseTo(216, 1);
  });
});

// ── detectSubscriptions ───────────────────────────────────────────────────────

describe('detectSubscriptions — auto-detection from history', () => {
  const makeMonthly = (merchant, amount, months = 3) =>
    Array.from({ length: months }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      return {
        type: 'expense',
        merchant,
        amount,
        date: d.toISOString().split('T')[0],
      };
    });

  test('detects 3 consistent monthly transactions as subscription', () => {
    const txns = makeMonthly('Netflix', 18.99, 3);
    const detected = detectSubscriptions(txns);
    expect(detected.length).toBeGreaterThanOrEqual(1);
    expect(detected[0].merchant).toBe('Netflix');
  });

  test('single transaction is not detected', () => {
    const txns = [{ type: 'expense', merchant: 'One-off Store', amount: 100, date: '2026-06-01' }];
    const detected = detectSubscriptions(txns);
    expect(detected.find(d => d.merchant === 'One-off Store')).toBeUndefined();
  });

  test('already-tracked subscription is excluded from detection', () => {
    const txns = makeMonthly('Netflix', 18.99, 3);
    const existing = [{ id: '1', name: 'netflix', amount: 18.99, cadence: 'monthly' }];
    const detected = detectSubscriptions(txns, existing);
    expect(detected.find(d => d.merchant === 'Netflix')).toBeUndefined();
  });

  test('inconsistent amounts (>10% variance) are not detected as subscriptions', () => {
    const txns = [
      { type: 'expense', merchant: 'Variable Service', amount: 10, date: '2026-01-01' },
      { type: 'expense', merchant: 'Variable Service', amount: 80, date: '2026-02-01' },
      { type: 'expense', merchant: 'Variable Service', amount: 45, date: '2026-03-01' },
    ];
    const detected = detectSubscriptions(txns);
    expect(detected.find(d => d.merchant === 'Variable Service')).toBeUndefined();
  });

  test('income transactions are not detected as subscriptions', () => {
    const txns = Array.from({ length: 3 }, (_, i) => ({
      type: 'income', merchant: 'Employer', amount: 5000,
      date: new Date(2026, i, 1).toISOString().split('T')[0],
    }));
    expect(detectSubscriptions(txns)).toHaveLength(0);
  });

  test('returns merchant, amount, cadence, count', () => {
    const txns = makeMonthly('Spotify', 10.99, 3);
    const detected = detectSubscriptions(txns);
    expect(detected.length).toBeGreaterThanOrEqual(1);
    const found = detected[0];
    expect(found).toHaveProperty('merchant');
    expect(found).toHaveProperty('amount');
    expect(found).toHaveProperty('cadence');
    expect(found).toHaveProperty('count');
    expect(found.count).toBeGreaterThanOrEqual(2);
  });

  test('consistent amounts within 1-dollar tolerance are accepted', () => {
    const txns = [
      { type: 'expense', merchant: 'CloudSVC', amount: 9.99, date: '2026-01-15' },
      { type: 'expense', merchant: 'CloudSVC', amount: 10.00, date: '2026-02-15' },
      { type: 'expense', merchant: 'CloudSVC', amount: 9.98, date: '2026-03-15' },
    ];
    const detected = detectSubscriptions(txns);
    expect(detected.find(d => d.merchant === 'CloudSVC')).toBeDefined();
  });
});

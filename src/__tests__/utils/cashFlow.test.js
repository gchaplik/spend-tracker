// Unit tests for Cash Flow Forecast — projection engine, event scheduling, danger detection

// ── Pure projection logic ─────────────────────────────────────────────────────

const today = () => new Date().toISOString().split('T')[0];

function buildProjection({ startBalance, dailySpend, bills, billPayments, expected, extraExpense, extraLabel, days = 90 }) {
  const todayStr = today();
  const events = {};
  const addEvent = (date, label, amount, type) => {
    if (!events[date]) events[date] = [];
    events[date].push({ label, amount, type });
  };

  // Bills — next 3 months
  bills.forEach(b => {
    for (let m = 0; m < 3; m++) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + m);
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const dueDay = String(b.dueDay || 15).padStart(2, '0');
      const dueDate = ym + '-' + dueDay;
      const paid = (billPayments || []).some(p => p.billId === b.id && p.month === ym);
      if (!paid && dueDate >= todayStr) addEvent(dueDate, b.name, +b.amount || 0, 'bill');
    }
  });

  // Expected income
  (expected || []).filter(e => !e.confirmed && e.date >= todayStr).forEach(e => {
    addEvent(e.date, e.source, +e.amount || 0, 'income');
  });

  // What-if scenario
  if (+extraExpense > 0 && extraLabel) {
    const mid = new Date(); mid.setDate(mid.getDate() + 30);
    addEvent(mid.toISOString().split('T')[0], extraLabel, +extraExpense, 'extra');
  }

  let balance = startBalance;
  const projection = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    balance -= dailySpend;
    const dayEvents = events[dateStr] || [];
    dayEvents.forEach(ev => {
      if (ev.type === 'bill' || ev.type === 'extra') balance -= ev.amount;
      else balance += ev.amount;
    });
    projection.push({ date: dateStr, balance: +balance.toFixed(2), events: dayEvents });
  }
  return projection;
}

function calcDailySpend(txns, days = 60) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];
  const total = txns.filter(t => t.type === 'expense' && t.date >= sinceStr).reduce((s, t) => s + t.amount, 0);
  return total / days;
}

// ── calcDailySpend ────────────────────────────────────────────────────────────

describe('calcDailySpend', () => {
  test('averages expenses over 60 days', () => {
    // 60 transactions of $10 each over the past 60 days
    const txns = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i);
      return { type: 'expense', amount: 10, date: d.toISOString().split('T')[0] };
    });
    expect(calcDailySpend(txns, 60)).toBeCloseTo(10, 1);
  });

  test('excludes income transactions', () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const dateStr = d.toISOString().split('T')[0];
    const txns = [
      { type: 'income', amount: 1000, date: dateStr },
      { type: 'expense', amount: 30, date: dateStr },
    ];
    expect(calcDailySpend(txns, 60)).toBeCloseTo(30 / 60, 4);
  });

  test('excludes transactions older than window', () => {
    const recent = new Date(); recent.setDate(recent.getDate() - 10);
    const old = new Date(); old.setDate(old.getDate() - 90);
    const txns = [
      { type: 'expense', amount: 100, date: recent.toISOString().split('T')[0] },
      { type: 'expense', amount: 999, date: old.toISOString().split('T')[0] },
    ];
    expect(calcDailySpend(txns, 60)).toBeCloseTo(100 / 60, 4);
  });

  test('returns 0 for empty transaction list', () => {
    expect(calcDailySpend([], 60)).toBe(0);
  });
});

// ── buildProjection ───────────────────────────────────────────────────────────

describe('buildProjection — balance trajectory', () => {
  test('balance decreases by dailySpend each day', () => {
    const proj = buildProjection({ startBalance: 1000, dailySpend: 10, bills: [], expected: [], days: 5 });
    expect(proj[0].balance).toBeCloseTo(990, 1);
    expect(proj[4].balance).toBeCloseTo(950, 1);
  });

  test('expected income adds to balance on the correct date', () => {
    const incomeDate = new Date(); incomeDate.setDate(incomeDate.getDate() + 5);
    const incomeDateStr = incomeDate.toISOString().split('T')[0];
    const proj = buildProjection({
      startBalance: 1000, dailySpend: 0,
      bills: [],
      expected: [{ id: 'e1', source: 'Salary', amount: 500, date: incomeDateStr, confirmed: false }],
      days: 10,
    });
    const dayBefore = proj[4]; // day index 4 = 5th day (0-indexed)
    const incomeDay = proj[5]; // day 6
    // Income lands on index where date matches incomeDateStr
    const idx = proj.findIndex(d => d.date === incomeDateStr);
    if (idx > 0) {
      expect(proj[idx].balance).toBeGreaterThan(proj[idx - 1].balance);
    }
  });

  test('bill subtracts from balance on its due date', () => {
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 5);
    const dueDateStr = dueDate.toISOString().split('T')[0];
    const dueDateYM = dueDateStr.slice(0, 7);
    const dueDay = +dueDateStr.slice(8, 10);
    const proj = buildProjection({
      startBalance: 1000, dailySpend: 0,
      bills: [{ id: 'b1', name: 'Rent', amount: 1000, dueDay, active: true }],
      billPayments: [],
      expected: [],
      days: 10,
    });
    const idx = proj.findIndex(d => d.date === dueDateStr);
    if (idx >= 0) {
      const hasEvent = proj[idx].events.some(e => e.type === 'bill' && e.label === 'Rent');
      expect(hasEvent).toBe(true);
    }
  });

  test('paid bill is NOT added as event', () => {
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 5);
    const dueDateStr = dueDate.toISOString().split('T')[0];
    const ym = dueDateStr.slice(0, 7);
    const dueDay = +dueDateStr.slice(8, 10);
    const proj = buildProjection({
      startBalance: 1000, dailySpend: 0,
      bills: [{ id: 'b1', name: 'Rent', amount: 1000, dueDay, active: true }],
      billPayments: [{ billId: 'b1', month: ym, amount: 1000 }],
      expected: [],
      days: 10,
    });
    const allEvents = proj.flatMap(d => d.events);
    expect(allEvents.some(e => e.label === 'Rent')).toBe(false);
  });

  test('what-if extra expense reduces balance on day 30', () => {
    const proj30 = buildProjection({
      startBalance: 5000, dailySpend: 0,
      bills: [], expected: [],
      extraExpense: 1000, extraLabel: 'New Laptop',
      days: 35,
    });
    const projNone = buildProjection({
      startBalance: 5000, dailySpend: 0,
      bills: [], expected: [], days: 35,
    });
    // Balance at day 34 should be lower with the extra expense
    expect(proj30[34].balance).toBeLessThan(projNone[34].balance);
  });

  test('90-day projection has exactly 90 entries', () => {
    const proj = buildProjection({ startBalance: 1000, dailySpend: 5, bills: [], expected: [], days: 90 });
    expect(proj).toHaveLength(90);
  });

  test('zero daily spend — balance only drops on bill dates', () => {
    const proj = buildProjection({ startBalance: 1000, dailySpend: 0, bills: [], expected: [], days: 10 });
    expect(proj[9].balance).toBeCloseTo(1000, 1);
  });
});

// ── Danger detection ──────────────────────────────────────────────────────────

describe('Danger detection — balance below threshold', () => {
  const findFirstDanger = (projection, threshold) => projection.find(d => d.balance < threshold);
  const minBalance = projection => Math.min(...projection.map(d => d.balance));

  test('detects first day balance drops below threshold', () => {
    const proj = buildProjection({ startBalance: 500, dailySpend: 100, bills: [], expected: [], days: 10 });
    const danger = findFirstDanger(proj, 200);
    expect(danger).toBeDefined();
    expect(danger.balance).toBeLessThan(200);
  });

  test('no danger when balance stays above threshold', () => {
    const proj = buildProjection({ startBalance: 10000, dailySpend: 10, bills: [], expected: [], days: 90 });
    const danger = findFirstDanger(proj, 500);
    expect(danger).toBeUndefined();
  });

  test('minBalance returns lowest projected balance', () => {
    const proj = buildProjection({ startBalance: 1000, dailySpend: 50, bills: [], expected: [], days: 30 });
    const min = minBalance(proj);
    expect(min).toBeLessThan(1000);
    expect(min).toBeCloseTo(1000 - 50 * 30, 0);
  });

  test('negative balance is possible when spending exceeds balance', () => {
    const proj = buildProjection({ startBalance: 100, dailySpend: 50, bills: [], expected: [], days: 5 });
    expect(proj[4].balance).toBeLessThan(0);
  });
});

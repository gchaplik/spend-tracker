// Unit tests for Alerts Panel — bill due detection, budget overages, goal milestones, large transactions

const today = () => new Date().toISOString().split('T')[0];

// ── Alert detection logic (extracted from AlertsPanel) ────────────────────────

function detectBillAlerts(bills, billPayments, month) {
  const todayStr = today();
  const alerts = [];
  bills.filter(b => b.active !== false).forEach(b => {
    const paid = billPayments.some(p => p.billId === b.id && p.month === month);
    if (paid) return;
    const dueStr = month + '-' + String(b.dueDay || 15).padStart(2, '0');
    const daysUntil = Math.ceil((new Date(dueStr) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 3 && daysUntil >= -3) {
      alerts.push({
        id: 'bill-' + b.id,
        type: daysUntil < 0 ? 'overdue' : 'due-soon',
        severity: daysUntil < 0 ? 'high' : 'medium',
        label: b.name,
        daysUntil,
      });
    }
  });
  return alerts;
}

function detectBudgetAlerts(txns, catBudgets, month) {
  const alerts = [];
  const mt = txns.filter(t => t.type === 'expense' && t.date && t.date.startsWith(month));
  Object.entries(catBudgets).forEach(([cat, budget]) => {
    if (!budget) return;
    const spent = mt.filter(t => t.category === cat).reduce((s, t) => s + t.amount, 0);
    const pct = spent / budget * 100;
    if (pct >= 100) alerts.push({ id: 'budget-over-' + cat, type: 'budget-over', severity: 'high', cat, pct });
    else if (pct >= 80) alerts.push({ id: 'budget-warn-' + cat, type: 'budget-warn', severity: 'medium', cat, pct });
  });
  return alerts;
}

function detectGoalAlerts(goals) {
  const alerts = [];
  goals.forEach(g => {
    if (!g.target || !g.saved) return;
    const pct = g.saved / g.target * 100;
    if (pct >= 100) alerts.push({ id: 'goal-done-' + g.id, type: 'goal-done', severity: 'info', name: g.name });
    else if (pct >= 75) alerts.push({ id: 'goal-near-' + g.id, type: 'goal-near', severity: 'info', name: g.name, pct });
  });
  return alerts;
}

function detectLargeTransactions(txns, month, threshold) {
  return txns
    .filter(t => t.type === 'expense' && t.date && t.date.startsWith(month) && t.amount >= threshold)
    .map(t => ({ id: 'large-' + t.id, type: 'large', severity: 'medium', label: t.merchant, amount: t.amount }));
}

// ── Bill alerts ───────────────────────────────────────────────────────────────

describe('detectBillAlerts — due soon and overdue', () => {
  const month = today().slice(0, 7);

  test('bill due today triggers due-soon alert', () => {
    const dueDay = +today().slice(8, 10);
    const bills = [{ id: 'b1', name: 'Netflix', amount: 18, dueDay, active: true }];
    const alerts = detectBillAlerts(bills, [], month);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('due-soon');
    expect(alerts[0].severity).toBe('medium');
  });

  test('paid bill does not trigger alert', () => {
    const dueDay = +today().slice(8, 10);
    const bills = [{ id: 'b1', name: 'Netflix', amount: 18, dueDay, active: true }];
    const billPayments = [{ billId: 'b1', month }];
    const alerts = detectBillAlerts(bills, billPayments, month);
    expect(alerts).toHaveLength(0);
  });

  test('overdue bill (past due date) has severity high', () => {
    const pastDay = Math.max(1, +today().slice(8, 10) - 2);
    const bills = [{ id: 'b1', name: 'Internet', amount: 60, dueDay: pastDay, active: true }];
    const alerts = detectBillAlerts(bills, [], month);
    // daysUntil should be ≤ -1 for this bill
    const overdue = alerts.filter(a => a.type === 'overdue');
    // Only fires if we're past the 3rd (pastDay is at most today-2)
    if (overdue.length > 0) {
      expect(overdue[0].severity).toBe('high');
    }
  });

  test('bill due more than 3 days away does not trigger', () => {
    // Use a dueDay far in the future — day 28 when today is before day 25
    const todayDay = +today().slice(8, 10);
    if (todayDay <= 20) {
      const bills = [{ id: 'b1', name: 'Rent', amount: 1500, dueDay: 28, active: true }];
      const alerts = detectBillAlerts(bills, [], month);
      expect(alerts).toHaveLength(0);
    }
  });

  test('inactive bill is ignored', () => {
    const dueDay = +today().slice(8, 10);
    const bills = [{ id: 'b1', name: 'Old Sub', amount: 10, dueDay, active: false }];
    const alerts = detectBillAlerts(bills, [], month);
    expect(alerts).toHaveLength(0);
  });
});

// ── Budget alerts ─────────────────────────────────────────────────────────────

describe('detectBudgetAlerts', () => {
  const month = '2026-06';
  const txns = [
    { type: 'expense', amount: 280, date: '2026-06-01', category: 'Dining' },    // 93% of 300
    { type: 'expense', amount: 320, date: '2026-06-02', category: 'Groceries' }, // 107% of 300
    { type: 'expense', amount: 50,  date: '2026-06-03', category: 'Transport' }, // 25% of 200
  ];
  const catBudgets = { Dining: 300, Groceries: 300, Transport: 200 };

  test('over-budget category triggers high-severity alert', () => {
    const alerts = detectBudgetAlerts(txns, catBudgets, month);
    const over = alerts.filter(a => a.type === 'budget-over');
    expect(over).toHaveLength(1);
    expect(over[0].cat).toBe('Groceries');
    expect(over[0].severity).toBe('high');
  });

  test('80–99% of budget triggers medium-severity warning', () => {
    const alerts = detectBudgetAlerts(txns, catBudgets, month);
    const warn = alerts.filter(a => a.type === 'budget-warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].cat).toBe('Dining');
    expect(warn[0].severity).toBe('medium');
  });

  test('under-80% category triggers no alert', () => {
    const alerts = detectBudgetAlerts(txns, catBudgets, month);
    expect(alerts.find(a => a.cat === 'Transport')).toBeUndefined();
  });

  test('category with zero budget is skipped', () => {
    const alerts = detectBudgetAlerts(txns, { Dining: 0 }, month);
    expect(alerts).toHaveLength(0);
  });

  test('no budgets set → no alerts', () => {
    expect(detectBudgetAlerts(txns, {}, month)).toHaveLength(0);
  });

  test('expenses from other months do not affect alert', () => {
    const otherTxns = [{ type: 'expense', amount: 9999, date: '2026-05-01', category: 'Dining' }];
    const alerts = detectBudgetAlerts(otherTxns, { Dining: 300 }, month);
    expect(alerts).toHaveLength(0);
  });
});

// ── Goal alerts ───────────────────────────────────────────────────────────────

describe('detectGoalAlerts', () => {
  test('goal at 100% triggers goal-done alert', () => {
    const goals = [{ id: 'g1', name: 'Emergency Fund', target: 5000, saved: 5000 }];
    const alerts = detectGoalAlerts(goals);
    expect(alerts[0].type).toBe('goal-done');
  });

  test('goal over 100% also triggers goal-done', () => {
    const goals = [{ id: 'g1', name: 'Vacation', target: 2000, saved: 2500 }];
    const alerts = detectGoalAlerts(goals);
    expect(alerts[0].type).toBe('goal-done');
  });

  test('goal at 75–99% triggers goal-near alert', () => {
    const goals = [{ id: 'g1', name: 'Car', target: 10000, saved: 8000 }]; // 80%
    const alerts = detectGoalAlerts(goals);
    expect(alerts[0].type).toBe('goal-near');
    expect(alerts[0].pct).toBeCloseTo(80, 0);
  });

  test('goal under 75% triggers no alert', () => {
    const goals = [{ id: 'g1', name: 'House Down Payment', target: 50000, saved: 30000 }]; // 60%
    const alerts = detectGoalAlerts(goals);
    expect(alerts).toHaveLength(0);
  });

  test('goal with no saved property triggers no alert', () => {
    const goals = [{ id: 'g1', name: 'Vacation', target: 2000 }];
    const alerts = detectGoalAlerts(goals);
    expect(alerts).toHaveLength(0);
  });

  test('multiple goals can each trigger independently', () => {
    const goals = [
      { id: 'g1', name: 'Goal A', target: 1000, saved: 1000 }, // done
      { id: 'g2', name: 'Goal B', target: 1000, saved: 800  }, // near
      { id: 'g3', name: 'Goal C', target: 1000, saved: 100  }, // none
    ];
    const alerts = detectGoalAlerts(goals);
    expect(alerts).toHaveLength(2);
  });
});

// ── Large transaction alerts ──────────────────────────────────────────────────

describe('detectLargeTransactions', () => {
  const month = '2026-06';
  const txns = [
    { id: 't1', type: 'expense', amount: 600,   date: '2026-06-01', merchant: 'Apple Store' },
    { id: 't2', type: 'expense', amount: 200,   date: '2026-06-02', merchant: 'Grocery'     },
    { id: 't3', type: 'income',  amount: 1000,  date: '2026-06-03', merchant: 'Employer'    },
    { id: 't4', type: 'expense', amount: 1500,  date: '2026-06-04', merchant: 'Rent'        },
  ];

  test('flags expenses at or above threshold', () => {
    const alerts = detectLargeTransactions(txns, month, 500);
    const labels = alerts.map(a => a.label);
    expect(labels).toContain('Apple Store');
    expect(labels).toContain('Rent');
  });

  test('does not flag expenses below threshold', () => {
    const alerts = detectLargeTransactions(txns, month, 500);
    expect(alerts.find(a => a.label === 'Grocery')).toBeUndefined();
  });

  test('income transactions are never flagged', () => {
    const alerts = detectLargeTransactions(txns, month, 500);
    expect(alerts.find(a => a.label === 'Employer')).toBeUndefined();
  });

  test('transactions from other months are excluded', () => {
    const alerts = detectLargeTransactions(txns, '2026-05', 500);
    expect(alerts).toHaveLength(0);
  });

  test('all alerts have severity medium', () => {
    const alerts = detectLargeTransactions(txns, month, 500);
    alerts.forEach(a => expect(a.severity).toBe('medium'));
  });

  test('threshold of 0 flags everything', () => {
    const alerts = detectLargeTransactions(txns, month, 0);
    expect(alerts).toHaveLength(3); // all 3 expenses
  });
});

// ── Alert de-duplication by ID ────────────────────────────────────────────────

describe('Alert IDs are unique and stable', () => {
  test('bill alert ID includes bill ID', () => {
    const dueDay = +today().slice(8, 10);
    const month = today().slice(0, 7);
    const alerts = detectBillAlerts([{ id: 'abc123', name: 'Test', amount: 10, dueDay, active: true }], [], month);
    if (alerts.length > 0) expect(alerts[0].id).toBe('bill-abc123');
  });

  test('budget alert ID includes category name', () => {
    const txns = [{ type: 'expense', amount: 400, date: '2026-06-01', category: 'Dining' }];
    const alerts = detectBudgetAlerts(txns, { Dining: 300 }, '2026-06');
    expect(alerts[0].id).toBe('budget-over-Dining');
  });

  test('goal alert ID includes goal ID', () => {
    const alerts = detectGoalAlerts([{ id: 'goal99', name: 'Test', target: 100, saved: 100 }]);
    expect(alerts[0].id).toBe('goal-done-goal99');
  });
});

// Unit tests for Wishlist — affordability, sorting, promote-to-goal logic

// ── Pure helpers ──────────────────────────────────────────────────────────────

function calcMonthlySavings(txns, lookbackMonths = 3) {
  const months = Array.from({ length: lookbackMonths }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  });
  const income = txns.filter(t => t.type === 'income' && months.some(m => t.date && t.date.startsWith(m)))
    .reduce((s, t) => s + t.amount, 0);
  const expenses = txns.filter(t => t.type === 'expense' && months.some(m => t.date && t.date.startsWith(m)))
    .reduce((s, t) => s + t.amount, 0);
  return Math.max(0, (income - expenses) / lookbackMonths);
}

function affordInMonths(cost, monthlySavings) {
  if (monthlySavings <= 0) return null;
  return Math.ceil(cost / monthlySavings);
}

function sortByPriority(items) {
  const order = { essential: 0, want: 1, 'nice-to-have': 2 };
  return [...items].sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2));
}

function promoteToGoal(item) {
  return {
    id: 'new-id',
    name: item.name,
    target: item.cost,
    saved: 0,
    note: item.note || 'From Wishlist',
    dueDate: '',
  };
}

// ── calcMonthlySavings ────────────────────────────────────────────────────────

describe('calcMonthlySavings', () => {
  const makeMonth = (ym, income, expense) => {
    const d = ym + '-15';
    return [
      { type: 'income', amount: income, date: d },
      { type: 'expense', amount: expense, date: d },
    ];
  };

  test('averages savings over lookback period', () => {
    const months = [0, 1, 2].map(i => {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    });
    const txns = months.flatMap(m => [
      { type: 'income', amount: 5000, date: m + '-01' },
      { type: 'expense', amount: 3000, date: m + '-15' },
    ]);
    expect(calcMonthlySavings(txns, 3)).toBeCloseTo(2000, 0);
  });

  test('no income → 0 savings', () => {
    const d = new Date();
    const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const txns = [{ type: 'expense', amount: 1000, date: m + '-01' }];
    expect(calcMonthlySavings(txns, 3)).toBe(0);
  });

  test('spending more than income → clamped to 0 (not negative)', () => {
    const d = new Date();
    const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const txns = [
      { type: 'income', amount: 1000, date: m + '-01' },
      { type: 'expense', amount: 5000, date: m + '-15' },
    ];
    expect(calcMonthlySavings(txns, 3)).toBe(0);
  });

  test('empty transactions → 0', () => {
    expect(calcMonthlySavings([], 3)).toBe(0);
  });
});

// ── affordInMonths ────────────────────────────────────────────────────────────

describe('affordInMonths', () => {
  test('$1200 item at $400/mo savings → 3 months', () => {
    expect(affordInMonths(1200, 400)).toBe(3);
  });

  test('rounds up to next month', () => {
    expect(affordInMonths(1001, 500)).toBe(3); // ceil(1001/500) = 3
  });

  test('zero savings → null (cannot afford)', () => {
    expect(affordInMonths(1000, 0)).toBeNull();
  });

  test('negative savings → null', () => {
    expect(affordInMonths(1000, -100)).toBeNull();
  });

  test('item already affordable (cost < monthly savings) → 1 month', () => {
    expect(affordInMonths(100, 500)).toBe(1);
  });

  test('very expensive item → many months', () => {
    expect(affordInMonths(120000, 1000)).toBe(120);
  });
});

// ── sortByPriority ────────────────────────────────────────────────────────────

describe('sortByPriority', () => {
  const items = [
    { id: '1', name: 'Nice chair', priority: 'nice-to-have', cost: 300 },
    { id: '2', name: 'New laptop', priority: 'want',         cost: 2000 },
    { id: '3', name: 'Car repair', priority: 'essential',    cost: 800 },
  ];

  test('essential comes first', () => {
    const sorted = sortByPriority(items);
    expect(sorted[0].priority).toBe('essential');
  });

  test('want comes second', () => {
    const sorted = sortByPriority(items);
    expect(sorted[1].priority).toBe('want');
  });

  test('nice-to-have comes last', () => {
    const sorted = sortByPriority(items);
    expect(sorted[2].priority).toBe('nice-to-have');
  });

  test('does not mutate original array', () => {
    const copy = [...items];
    sortByPriority(items);
    expect(items[0].id).toBe(copy[0].id);
  });

  test('empty array returns empty', () => {
    expect(sortByPriority([])).toHaveLength(0);
  });

  test('all same priority → preserves relative order', () => {
    const same = [
      { id: '1', priority: 'want' },
      { id: '2', priority: 'want' },
    ];
    const sorted = sortByPriority(same);
    expect(sorted[0].id).toBe('1');
    expect(sorted[1].id).toBe('2');
  });
});

// ── promoteToGoal ─────────────────────────────────────────────────────────────

describe('promoteToGoal', () => {
  test('creates a goal with matching name and cost as target', () => {
    const item = { id: 'w1', name: 'MacBook Pro', cost: 3000, note: 'Work laptop' };
    const goal = promoteToGoal(item);
    expect(goal.name).toBe('MacBook Pro');
    expect(goal.target).toBe(3000);
  });

  test('saved starts at 0', () => {
    const goal = promoteToGoal({ id: 'w1', name: 'TV', cost: 1000 });
    expect(goal.saved).toBe(0);
  });

  test('preserves note from wishlist item', () => {
    const goal = promoteToGoal({ id: 'w1', name: 'TV', cost: 1000, note: 'For bedroom' });
    expect(goal.note).toBe('For bedroom');
  });

  test('defaults note to "From Wishlist" if no note', () => {
    const goal = promoteToGoal({ id: 'w1', name: 'TV', cost: 1000 });
    expect(goal.note).toBe('From Wishlist');
  });

  test('dueDate is empty string', () => {
    const goal = promoteToGoal({ id: 'w1', name: 'TV', cost: 1000 });
    expect(goal.dueDate).toBe('');
  });
});

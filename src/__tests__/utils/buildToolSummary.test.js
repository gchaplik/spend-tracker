// Inline copy of buildToolSummary
const buildToolSummary = (name, args, result) => {
  const fmt = v => typeof v === 'number' ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? '');
  const period = args.month ? ` for ${args.month}` : args.from ? ` from ${args.from} to ${args.to || 'now'}` : '';
  if (result === null || result === undefined) return 'No data found.';
  if (typeof result === 'number') return `${name === 'expenses' ? 'Total spending' : name === 'income' ? 'Total income' : name === 'net' ? 'Net position' : name === 'bills' ? 'Bills total' : 'Result'}${period}: ${fmt(result)}.`;
  if (name === 'savings_rate') return `Savings rate${period}: ${result.rate ?? 'N/A'}% — saved ${fmt(result.saved)} of ${fmt(result.income)} income.`;
  if (name === 'compare_expenses' || name === 'compare_income' || name === 'compare_net') return `${result.month1}: ${fmt(result.value1)} → ${result.month2}: ${fmt(result.value2)} (${result.change >= 0 ? '+' : ''}${fmt(result.change)}, ${result.changePercent != null ? result.changePercent + '%' : 'N/A'}).`;
  if (name === 'expense_share') return `${result.category} is ${result.percent ?? 'N/A'}% of total spending${period} (${fmt(result.amount)} of ${fmt(result.total)}).`;
  if (name === 'budget_remaining') return `${result.category}: spent ${fmt(result.spent)} of ${fmt(result.budget)} budget, ${fmt(result.remaining)} remaining (${result.percentUsed ?? 0}% used).`;
  if (name === 'account_balance') return result ? `Account balance as of ${result.date}: ${fmt(result.balance)}.` : 'No balance data found.';
  if (name === 'portfolio_gain') return `Portfolio: ${fmt(result.marketValue)} market value, ${result.gain >= 0 ? '+' : ''}${fmt(result.gain)} gain (${result.gainPercent != null ? result.gainPercent + '%' : 'N/A'}).`;
  if (name === 'holding') return result ? `${result.ticker}: ${result.shares} shares, market value ${fmt(result.marketValue)}, gain ${result.gain >= 0 ? '+' : ''}${fmt(result.gain)}.` : 'Ticker not found.';
  if (name === 'top_category') return result ? `Top spending category${period}: ${result.name} at ${fmt(result.value)}.` : 'No spending data found.';
  if ((name === 'pending_income' || name === 'confirmed_income' || name === 'all_expected_income') && typeof result?.total === 'number') {
    const label = name === 'pending_income' ? 'Pending' : name === 'confirmed_income' ? 'Confirmed' : 'Total expected';
    return `${label} income${period}: ${fmt(result.total)} across ${result.items?.length ?? 0} item(s).`;
  }
  if (Array.isArray(result)) {
    if (name === 'bills_due') return result.length ? `${result.length} bill(s) due: ${result.map(b => b.name).join(', ')}.` : 'All bills paid this month.';
    if (name === 'bills_paid') return result.length ? `${result.length} bill(s) paid: ${result.map(b => b.name).join(', ')}.` : 'No bills paid yet this month.';
    if (!result.length) return `No results found${period}.`;
    const top = result[0];
    if (name === 'categories') return `Top spending categories${period}: ${result.slice(0, 3).map(r => `${r.name} (${fmt(r.value)})`).join(', ')}.`;
    if (name === 'over_budget') return `${result.length} categor${result.length === 1 ? 'y' : 'ies'} over budget: ${result.map(r => r.name).join(', ')}.`;
    if (name === 'largest_expenses' || name === 'txns_by_category' || name === 'txns_by_merchant') return `Top result: ${top.name} — ${fmt(top.value)}.`;
    if (name === 'merchants') return `Top merchant${period}: ${top.name} (${fmt(top.value)}).`;
    if (name === 'bills') return `${result.length} active bill(s) totalling ${fmt(result.reduce((s, b) => s + b.value, 0))}.`;
    if (name === 'holdings_detail') return `${result.length} holding(s). Top: ${top.name} worth ${fmt(top.marketValue)}.`;
    if (name === 'transactions') return `${result.length} transaction(s). Latest: ${top.name} — ${fmt(top.value)}.`;
    if (name === 'budget_vs_actual') return `${result.length} budget categor${result.length === 1 ? 'y' : 'ies'}. Highest spend: ${top.name} — ${fmt(top.spent)} of ${fmt(top.budget)} budget.`;
    if (name === 'monthly') return `${result.length} month(s) of data. Latest: ${result[result.length - 1]?.name} — income ${fmt(result[result.length - 1]?.Income)}, expenses ${fmt(result[result.length - 1]?.Expenses)}.`;
    return `${result.length} result(s) found.`;
  }
  return 'Here is the data.';
};

describe('buildToolSummary', () => {
  describe('null / undefined result', () => {
    test('null returns No data found', () => expect(buildToolSummary('expenses', {}, null)).toBe('No data found.'));
    test('undefined returns No data found', () => expect(buildToolSummary('expenses', {}, undefined)).toBe('No data found.'));
  });

  describe('scalar numbers', () => {
    test('expenses scalar with month', () => {
      expect(buildToolSummary('expenses', { month: '2026-06' }, 407.29))
        .toBe('Total spending for 2026-06: $407.29.');
    });
    test('income scalar', () => {
      expect(buildToolSummary('income', { month: '2026-06' }, 1766.50))
        .toBe('Total income for 2026-06: $1,766.50.');
    });
    test('net scalar', () => {
      expect(buildToolSummary('net', {}, 1043.82)).toBe('Net position: $1,043.82.');
    });
    test('unknown scalar uses Result label', () => {
      expect(buildToolSummary('some_tool', {}, 99)).toBe('Result: $99.00.');
    });
  });

  describe('categories array', () => {
    const cats = [
      { name: 'Transport', value: 113.15 },
      { name: 'Personal', value: 133.31 },
      { name: 'Groceries', value: 36.39 },
      { name: 'Dining', value: 13.54 },
    ];
    test('top 3 categories listed', () => {
      const r = buildToolSummary('categories', { month: '2026-06' }, cats);
      expect(r).toContain('Transport');
      expect(r).toContain('Personal');
      expect(r).toContain('Groceries');
      expect(r).not.toContain('Dining'); // 4th, excluded
    });
    test('empty categories array', () => {
      expect(buildToolSummary('categories', {}, [])).toBe('No results found.');
    });
  });

  describe('savings_rate', () => {
    test('returns rate and amounts', () => {
      const r = buildToolSummary('savings_rate', { month: '2026-06' }, { rate: 41.0, saved: 723.82, income: 1766.50 });
      expect(r).toContain('41%');
      expect(r).toContain('$723.82');
      expect(r).toContain('$1,766.50');
    });
    test('null rate shows N/A', () => {
      const r = buildToolSummary('savings_rate', {}, { rate: null, saved: 0, income: 0 });
      expect(r).toContain('N/A%');
    });
  });

  describe('budget_remaining', () => {
    test('formats correctly', () => {
      const r = buildToolSummary('budget_remaining', {}, { category: 'Transport', budget: 400, spent: 113.15, remaining: 286.85, percentUsed: 28.3 });
      expect(r).toContain('Transport');
      expect(r).toContain('$113.15');
      expect(r).toContain('$400.00');
      expect(r).toContain('28.3% used');
    });
  });

  describe('compare_expenses / compare_income / compare_net', () => {
    const cmp = { month1: '2026-05', value1: 0, month2: '2026-06', value2: 407.29, change: 407.29, changePercent: null };
    test('compare_expenses', () => {
      const r = buildToolSummary('compare_expenses', {}, cmp);
      expect(r).toContain('2026-05');
      expect(r).toContain('2026-06');
      expect(r).toContain('$407.29');
      expect(r).toContain('N/A');
    });
    test('positive change gets + prefix', () => {
      const r = buildToolSummary('compare_expenses', {}, { ...cmp, change: 100, changePercent: 10 });
      expect(r).toContain('+$100.00');
    });
    test('negative change no + prefix', () => {
      const r = buildToolSummary('compare_expenses', {}, { ...cmp, change: -50, changePercent: -5 });
      expect(r).toContain('$-50.00');
      expect(r).not.toContain('+$-50.00');
    });
  });

  describe('expense_share', () => {
    test('formats percent and amounts', () => {
      const r = buildToolSummary('expense_share', {}, { category: 'Transport', percent: 15.7, amount: 113.15, total: 722.68 });
      expect(r).toContain('Transport');
      expect(r).toContain('15.7%');
      expect(r).toContain('$113.15');
    });
  });

  describe('pending_income', () => {
    test('formats total and item count', () => {
      const r = buildToolSummary('pending_income', { month: '2026-06' }, { total: 5415.52, items: [1, 2] });
      expect(r).toContain('$5,415.52');
      expect(r).toContain('2 item(s)');
    });
  });

  describe('bills array', () => {
    const bills = [{ name: 'Rent', value: 2400 }, { name: 'Phone', value: 167.45 }];
    test('count and total', () => {
      const r = buildToolSummary('bills', {}, bills);
      expect(r).toContain('2 active bill(s)');
      expect(r).toContain('$2,567.45');
    });
    test('bills_due with items', () => {
      const r = buildToolSummary('bills_due', {}, [{ name: 'Rent' }, { name: 'Phone' }]);
      expect(r).toContain('2 bill(s) due');
      expect(r).toContain('Rent');
    });
    test('bills_due empty = all paid', () => {
      expect(buildToolSummary('bills_due', {}, [])).toBe('All bills paid this month.');
    });
    test('bills_paid empty', () => {
      expect(buildToolSummary('bills_paid', {}, [])).toBe('No bills paid yet this month.');
    });
  });

  describe('largest_expenses / txns_by_category', () => {
    test('shows top result', () => {
      const r = buildToolSummary('largest_expenses', {}, [{ name: 'Rent (2026-06-01)', value: 2400 }]);
      expect(r).toContain('Rent');
      expect(r).toContain('$2,400.00');
    });
  });

  describe('holdings_detail', () => {
    test('shows count and top holding', () => {
      const r = buildToolSummary('holdings_detail', {}, [{ name: 'TSLA', marketValue: 10720.87 }]);
      expect(r).toContain('1 holding(s)');
      expect(r).toContain('TSLA');
    });
  });

  describe('over_budget', () => {
    test('single category', () => {
      expect(buildToolSummary('over_budget', {}, [{ name: 'Personal' }])).toContain('1 category over budget');
    });
    test('multiple categories', () => {
      expect(buildToolSummary('over_budget', {}, [{ name: 'A' }, { name: 'B' }])).toContain('2 categories over budget');
    });
    test('empty = nothing over budget', () => {
      expect(buildToolSummary('over_budget', {}, [])).toBe('No results found.');
    });
  });
});

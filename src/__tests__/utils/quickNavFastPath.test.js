// Tests for QUICK fast-path matching and NAV_TABS routing

const NAV_TABS = {
  dashboard: 'dashboard', home: 'dashboard',
  bills: 'bills', bill: 'bills',
  history: 'history', transactions: 'history', transaction: 'history', 'spending history': 'history',
  stocks: 'stocks', stock: 'stocks', portfolio: 'stocks', holdings: 'stocks',
  'net worth': 'networth', networth: 'networth',
  settings: 'settings', setting: 'settings', preferences: 'settings',
  expected: 'expected', 'expected income': 'expected',
  categories: 'categories', category: 'categories', budget: 'categories', budgets: 'categories',
  vacations: 'vacations', vacation: 'vacations', 'vacation tab': 'vacations', trips: 'vacations',
  goals: 'goals', goal: 'goals', 'savings goals': 'goals',
  insights: 'insights', insight: 'insights',
};

const resolveNav = (text) => {
  const navMatch = text.match(/\bnavigate\s+to\s+([a-z\s]+)/i)
    || text.match(/\bgo\s+to\s+([a-z\s]+)/i)
    || text.match(/\bopen\s+([a-z\s]+)/i);
  if (!navMatch) return null;
  const dest = navMatch[1].trim().toLowerCase();
  return NAV_TABS[dest] || Object.entries(NAV_TABS).find(([k]) => dest.includes(k))?.[1] || null;
};

// QUICK pattern matchers (extracted regexes)
const QUICK_PATTERNS = [
  { regex: /main contributors?|top categor|spending categor|categor.*breakdown|breakdown.*categor|where.*spending|what.*spending on|spending by categor/i, tool: 'categories' },
  { regex: /most expensive in (.+)|top (?:expense|spend) in (.+)|highest.+in (.+)/i, tool: 'txns_by_category' },
  { regex: /top merchant|largest expense|biggest expense|biggest spend|top expense/i, tool: 'largest_expenses' },
  { regex: /pending income|unconfirmed income|income.*pending|income.*not confirmed/i, tool: 'pending_income' },
  { regex: /net position|what.*my net|net this month/i, tool: 'net' },
  { regex: /how much.*spent|total.*spent|how much.*spending|spent this month|spending this month/i, tool: 'expenses' },
  { regex: /income this month|how much.*income|total.*income/i, tool: 'income' },
  { regex: /\bbills?\b.*due|due.*\bbills?\b|monthly bills?|show.*bills?/i, tool: 'bills' },
  { regex: /portfolio.*worth|stock.*value|holdings? value|portfolio total/i, tool: 'portfolio' },
];

const matchQuick = (text) => QUICK_PATTERNS.find(p => p.regex.test(text))?.tool || null;

describe('NAV_TABS routing', () => {
  test('"navigate to bills" → bills', () => expect(resolveNav('navigate to bills')).toBe('bills'));
  test('"navigate to vacations" → vacations', () => expect(resolveNav('navigate to vacations')).toBe('vacations'));
  test('"navigate to the vacation tab" → vacations (fuzzy)', () => expect(resolveNav('navigate to the vacation tab')).toBe('vacations'));
  test('"go to history" → history', () => expect(resolveNav('go to history')).toBe('history'));
  test('"go to stocks" → stocks', () => expect(resolveNav('go to stocks')).toBe('stocks'));
  test('"go to portfolio" → stocks (alias)', () => expect(resolveNav('go to portfolio')).toBe('stocks'));
  test('"navigate to settings" → settings', () => expect(resolveNav('navigate to settings')).toBe('settings'));
  test('"navigate to net worth" → networth', () => expect(resolveNav('navigate to net worth')).toBe('networth'));
  test('"navigate to budget" → categories (alias)', () => expect(resolveNav('navigate to budget')).toBe('categories'));
  test('"navigate to goals" → goals', () => expect(resolveNav('navigate to goals')).toBe('goals'));
  test('"open insights" → insights', () => expect(resolveNav('open insights')).toBe('insights'));
  test('no nav phrase → null', () => expect(resolveNav('how much have I spent?')).toBeNull());
});

describe('QUICK fast-path matching', () => {
  test('"main contributors to my spending" → categories', () => {
    expect(matchQuick('main contributors to my spending')).toBe('categories');
  });
  test('"what are the main contributors to my spending this month" → categories (not expenses)', () => {
    expect(matchQuick('what are the main contributors to my spending this month')).toBe('categories');
  });
  test('"top categories" → categories', () => {
    expect(matchQuick('top categories this month')).toBe('categories');
  });
  test('"spending this month" → expenses', () => {
    expect(matchQuick('spending this month')).toBe('expenses');
  });
  test('"how much have I spent" → expenses', () => {
    expect(matchQuick('how much have I spent this month')).toBe('expenses');
  });
  test('"income this month" → income', () => {
    expect(matchQuick('income this month')).toBe('income');
  });
  test('"net position" → net', () => {
    expect(matchQuick('what is my net position')).toBe('net');
  });
  test('"pending income" → pending_income', () => {
    expect(matchQuick('what is my pending income')).toBe('pending_income');
  });
  test('"monthly bills" → bills', () => {
    expect(matchQuick('show my monthly bills')).toBe('bills');
  });
  test('"portfolio worth" → portfolio', () => {
    expect(matchQuick('what is my portfolio worth')).toBe('portfolio');
  });
  test('"largest expense" → largest_expenses', () => {
    expect(matchQuick('what was my largest expense')).toBe('largest_expenses');
  });
  test('"most expensive in Transport" → txns_by_category', () => {
    expect(matchQuick('most expensive in Transport')).toBe('txns_by_category');
  });
  test('unrecognised query → null', () => {
    expect(matchQuick('what is the weather today')).toBeNull();
  });

  test('categories matches before expenses for "spending categories" phrase', () => {
    // The QUICK array order matters: categories must come before expenses
    const catIdx = QUICK_PATTERNS.findIndex(p => p.tool === 'categories');
    const expIdx = QUICK_PATTERNS.findIndex(p => p.tool === 'expenses');
    expect(catIdx).toBeLessThan(expIdx);
  });
});

describe('txns_by_category args extraction', () => {
  const extractCat = (text) => {
    const m = text.match(/most expensive in (.+)|top (?:expense|spend) in (.+)|highest.+in (.+)/i);
    return (m?.[1] || m?.[2] || m?.[3] || '').replace(/[?.!]/g, '').trim();
  };
  test('extracts "Transport" from "most expensive in Transport"', () => {
    expect(extractCat('most expensive in Transport')).toBe('Transport');
  });
  test('extracts "Groceries" from "top spend in Groceries"', () => {
    expect(extractCat('top spend in Groceries')).toBe('Groceries');
  });
  test('strips trailing punctuation', () => {
    expect(extractCat('most expensive in Dining?')).toBe('Dining');
  });
});

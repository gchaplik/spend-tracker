// Tests for TOOL_LIBRARY — executes generated JS against fixture data

const _df = (args = {}, field = 't.date') => {
  if (args.month) return `${field}&&${field}.slice(0,7)==='${args.month}'`;
  if (args.from || args.to) { const f = args.from || '0000-00', t = args.to || '9999-99'; return `${field}&&${field}.slice(0,7)>='${f}'&&${field}.slice(0,7)<='${t}'`; }
  return 'true';
};
const _label = (args = {}) => {
  if (args.month) return args.month;
  if (args.from && args.to) return `${args.from} – ${args.to}`;
  if (args.from) return `from ${args.from}`;
  if (args.to) return `up to ${args.to}`;
  return 'All Time';
};

const TOOL_LIBRARY = {
  expenses: (a = {}) => { const df = _df(a); return `(function(){return Math.round(data.txns.filter(function(t){return t.type==='expense'&&${df};}).reduce(function(s,t){return s+t.amount;},0)*100)/100;})()` },
  income:   (a = {}) => { const df = _df(a); return `(function(){return Math.round(data.txns.filter(function(t){return t.type==='income'&&${df};}).reduce(function(s,t){return s+t.amount;},0)*100)/100;})()` },
  net:      (a = {}) => { const df = _df(a); return `(function(){var df=function(t){return ${df};};var i=data.txns.filter(function(t){return t.type==='income'&&df(t);}).reduce(function(s,t){return s+t.amount;},0);var e=data.txns.filter(function(t){return t.type==='expense'&&df(t);}).reduce(function(s,t){return s+t.amount;},0);return Math.round((i-e)*100)/100;})()` },
  categories: (a = {}) => { const df = _df(a); return `(function(){var a={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';a[c]=(a[c]||0)+t.amount;});return Object.entries(a).sort(function(x,y){return y[1]-x[1];}).map(function(e){return {name:e[0],value:Math.round(e[1]*100)/100};});})()` },
  largest_expenses: (a = {}) => { const df = _df(a); const n = a.limit || 10; return `data.txns.filter(function(t){return t.type==='expense'&&${df};}).slice().sort(function(a,b){return b.amount-a.amount;}).slice(0,${n}).map(function(t){return {name:(t.merchant||'?')+' ('+t.date+')',value:t.amount,category:t.category};})` },
  bills: (a = {}) => { if (a.type === 'total') return `Math.round(data.bills.filter(function(b){return b.active!==false;}).reduce(function(s,b){return s+b.amount;},0)*100)/100`; return `data.bills.filter(function(b){return b.active!==false;}).map(function(b){return {name:b.name,value:b.amount};}).sort(function(a,b){return b.value-a.value;})` },
  budget_remaining: (a = {}) => { const cat = (a.category || '').replace(/'/g, "\\'"); const df = _df(a); return `(function(){var cat='${cat}';var budget=(data.catBudgets||{})[cat]||0;var spent=data.txns.filter(function(t){return t.type==='expense'&&(t.category||'Other')===cat&&${df};}).reduce(function(s,t){return s+t.amount;},0);var remaining=budget-spent;var pct=budget>0?Math.round((spent/budget)*1000)/10:null;return {category:cat,budget:Math.round(budget*100)/100,spent:Math.round(spent*100)/100,remaining:Math.round(remaining*100)/100,percentUsed:pct};})()` },
  savings_rate: (a = {}) => { const df = _df(a); const label = _label(a); return `(function(){var inc=data.txns.filter(function(t){return t.type==='income'&&${df};}).reduce(function(s,t){return s+t.amount;},0);var exp=data.txns.filter(function(t){return t.type==='expense'&&${df};}).reduce(function(s,t){return s+t.amount;},0);var saved=inc-exp;var rate=inc>0?Math.round((saved/inc)*1000)/10:null;return {period:'${label}',income:Math.round(inc*100)/100,expenses:Math.round(exp*100)/100,saved:Math.round(saved*100)/100,rate:rate};})()` },
  txns_by_category: (a = {}) => { const cat = (a.category || '').replace(/'/g, "\\'"); const df = _df(a); return `(function(){var cat='${cat}';return data.txns.filter(function(t){return t.type==='expense'&&(t.category||'Other')===cat&&${df};}).sort(function(a,b){return b.date.localeCompare(a.date);}).map(function(t){return {name:(t.merchant||'?')+' ('+t.date+')',value:t.amount,category:t.category};});})()` },
  vacation_spending: (a = {}) => { const name = (a.name || '').replace(/'/g, "\\'"); return `(function(){var name='${name}';var v=(data.vacations||[]).find(function(v){return v.name.toLowerCase().includes(name.toLowerCase());});if(!v)return null;var txns=data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date>=v.startDate&&t.date<=v.endDate;});var total=txns.reduce(function(s,t){return s+t.amount;},0);var rem=v.budget-total;return {vacation:v.name,startDate:v.startDate,endDate:v.endDate,budget:v.budget,spent:Math.round(total*100)/100,remaining:Math.round(rem*100)/100,transactions:txns.map(function(t){return {name:t.merchant||'?',value:t.amount,date:t.date};})};})()` },
};

function run(js, data) {
  return new Function('data', `return ${js}`)(data);
}

// Fixture data
const mockData = {
  txns: [
    { type: 'expense', amount: 113.15, date: '2026-06-04', category: 'Transport', merchant: 'Uber' },
    { type: 'expense', amount: 133.31, date: '2026-06-05', category: 'Personal',  merchant: 'Amazon' },
    { type: 'expense', amount:  36.39, date: '2026-06-03', category: 'Groceries', merchant: 'Sobeys' },
    { type: 'expense', amount:  13.54, date: '2026-06-03', category: 'Dining',    merchant: 'Cotti Coffee' },
    { type: 'income',  amount: 1766.50, date: '2026-06-05', category: 'Income',   merchant: 'Employer' },
    { type: 'expense', amount:  50.00, date: '2026-05-15', category: 'Transport', merchant: 'Uber' },
  ],
  bills: [
    { id: 'b1', name: 'Rent',  amount: 2400,   active: true },
    { id: 'b2', name: 'Phone', amount: 167.45, active: true },
    { id: 'b3', name: 'Old',   amount: 100,    active: false },
  ],
  catBudgets: { Transport: 400, Personal: 150, Groceries: 400 },
  vacations: [{ name: 'Montreal', startDate: '2026-06-05', endDate: '2026-06-08', budget: 1000 }],
  expected: [],
  holdings: [],
  accountHistory: [],
  billPayments: [],
};

const JUNE = { month: '2026-06' };

describe('TOOL_LIBRARY — generated JS execution', () => {
  describe('expenses', () => {
    test('sums June expenses correctly', () => {
      const result = run(TOOL_LIBRARY.expenses(JUNE), mockData);
      expect(result).toBeCloseTo(296.39, 2); // 113.15+133.31+36.39+13.54
    });
    test('no args returns all-time total', () => {
      const result = run(TOOL_LIBRARY.expenses({}), mockData);
      expect(result).toBeCloseTo(346.39, 2); // includes May expense
    });
    test('empty month returns 0', () => {
      expect(run(TOOL_LIBRARY.expenses({ month: '2025-01' }), mockData)).toBe(0);
    });
  });

  describe('income', () => {
    test('sums June income', () => {
      expect(run(TOOL_LIBRARY.income(JUNE), mockData)).toBe(1766.50);
    });
    test('different month returns 0', () => {
      expect(run(TOOL_LIBRARY.income({ month: '2026-05' }), mockData)).toBe(0);
    });
  });

  describe('net', () => {
    test('income minus expenses for June', () => {
      const result = run(TOOL_LIBRARY.net(JUNE), mockData);
      expect(result).toBeCloseTo(1766.50 - 296.39, 1);
    });
    test('net is negative when expenses exceed income', () => {
      const heavyData = { txns: [
        { type: 'expense', amount: 2000, date: '2026-06-01', category: 'X' },
        { type: 'income',  amount: 500,  date: '2026-06-01', category: 'Y' },
      ], bills: [], catBudgets: {}, vacations: [], expected: [] };
      expect(run(TOOL_LIBRARY.net(JUNE), heavyData)).toBe(-1500);
    });
  });

  describe('categories', () => {
    test('returns sorted array by value desc', () => {
      const result = run(TOOL_LIBRARY.categories(JUNE), mockData);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].name).toBe('Personal'); // 133.31 is highest
      expect(result[0].value).toBeCloseTo(133.31, 2);
    });
    test('each item has name and value', () => {
      const result = run(TOOL_LIBRARY.categories(JUNE), mockData);
      result.forEach(r => { expect(r).toHaveProperty('name'); expect(r).toHaveProperty('value'); });
    });
    test('empty data returns empty array', () => {
      expect(run(TOOL_LIBRARY.categories(JUNE), { ...mockData, txns: [] })).toEqual([]);
    });
  });

  describe('largest_expenses', () => {
    test('returns sorted by amount desc', () => {
      const result = run(TOOL_LIBRARY.largest_expenses({ ...JUNE, limit: 3 }), mockData);
      expect(result[0].value).toBeGreaterThanOrEqual(result[1].value);
    });
    test('respects limit', () => {
      const result = run(TOOL_LIBRARY.largest_expenses({ ...JUNE, limit: 2 }), mockData);
      expect(result.length).toBeLessThanOrEqual(2);
    });
    test('only expenses (no income rows)', () => {
      const result = run(TOOL_LIBRARY.largest_expenses(JUNE), mockData);
      result.forEach(r => expect(r.value).toBeGreaterThan(0));
    });
  });

  describe('bills', () => {
    test('returns only active bills', () => {
      const result = run(TOOL_LIBRARY.bills({}), mockData);
      expect(result.length).toBe(2); // Old bill excluded
      expect(result.every(b => b.name !== 'Old')).toBe(true);
    });
    test('type=total returns summed amount', () => {
      const result = run(TOOL_LIBRARY.bills({ type: 'total' }), mockData);
      expect(result).toBeCloseTo(2567.45, 1);
    });
  });

  describe('budget_remaining', () => {
    test('correct spent and remaining for Transport', () => {
      const result = run(TOOL_LIBRARY.budget_remaining({ category: 'Transport', ...JUNE }), mockData);
      expect(result.category).toBe('Transport');
      expect(result.spent).toBeCloseTo(113.15, 2);
      expect(result.budget).toBe(400);
      expect(result.remaining).toBeCloseTo(286.85, 1);
      expect(result.percentUsed).toBeCloseTo(28.3, 0);
    });
    test('unknown category returns zero spent', () => {
      const result = run(TOOL_LIBRARY.budget_remaining({ category: 'NonExistent', ...JUNE }), mockData);
      expect(result.spent).toBe(0);
      expect(result.budget).toBe(0);
    });
  });

  describe('savings_rate', () => {
    test('calculates correct rate', () => {
      const result = run(TOOL_LIBRARY.savings_rate(JUNE), mockData);
      expect(result.income).toBe(1766.50);
      expect(result.expenses).toBeCloseTo(296.39, 1);
      expect(result.rate).toBeGreaterThan(0);
      expect(result.rate).toBeLessThan(100);
    });
    test('zero income gives null rate', () => {
      const result = run(TOOL_LIBRARY.savings_rate(JUNE), { ...mockData, txns: [] });
      expect(result.rate).toBeNull();
    });
  });

  describe('txns_by_category', () => {
    test('filters by category', () => {
      const result = run(TOOL_LIBRARY.txns_by_category({ category: 'Transport', ...JUNE }), mockData);
      expect(result.length).toBe(1);
      expect(result[0].value).toBe(113.15);
    });
    test('empty category returns empty array', () => {
      const result = run(TOOL_LIBRARY.txns_by_category({ category: 'Health', ...JUNE }), mockData);
      expect(result).toEqual([]);
    });
  });

  describe('vacation_spending', () => {
    test('finds vacation and sums in-range txns', () => {
      const dataWithVacTxns = { ...mockData, txns: [
        ...mockData.txns,
        { type: 'expense', amount: 89.99, date: '2026-06-06', category: 'Dining', merchant: 'Restaurant' },
      ]};
      const result = run(TOOL_LIBRARY.vacation_spending({ name: 'montreal' }), dataWithVacTxns);
      expect(result.vacation).toBe('Montreal');
      expect(result.spent).toBeGreaterThan(0);
      expect(result.budget).toBe(1000);
    });
    test('unknown vacation returns null', () => {
      const result = run(TOOL_LIBRARY.vacation_spending({ name: 'hawaii' }), mockData);
      expect(result).toBeNull();
    });
  });
});

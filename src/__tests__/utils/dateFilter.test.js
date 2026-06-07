// Re-declare the pure helpers inline (single-file app has no exports)
const _df = (args = {}, field = 't.date') => {
  if (args.month) return `${field}&&${field}.slice(0,7)==='${args.month}'`;
  if (args.from || args.to) {
    const f = args.from || '0000-00', t = args.to || '9999-99';
    return `${field}&&${field}.slice(0,7)>='${f}'&&${field}.slice(0,7)<='${t}'`;
  }
  return 'true';
};

const _label = (args = {}) => {
  if (args.month) return args.month;
  if (args.from && args.to) return `${args.from} – ${args.to}`;
  if (args.from) return `from ${args.from}`;
  if (args.to) return `up to ${args.to}`;
  return 'All Time';
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

describe('_df — date filter generator', () => {
  test('month filter produces correct fragment', () => {
    const result = _df({ month: '2026-06' });
    expect(result).toBe("t.date&&t.date.slice(0,7)==='2026-06'");
  });

  test('month filter uses custom field', () => {
    const result = _df({ month: '2026-06' }, 'e.expectedDate');
    expect(result).toBe("e.expectedDate&&e.expectedDate.slice(0,7)==='2026-06'");
  });

  test('range filter with from and to', () => {
    const result = _df({ from: '2026-01', to: '2026-03' });
    expect(result).toContain("slice(0,7)>='2026-01'");
    expect(result).toContain("slice(0,7)<='2026-03'");
  });

  test('range filter with only from — to defaults to 9999-99', () => {
    const result = _df({ from: '2026-01' });
    expect(result).toContain("'9999-99'");
  });

  test('range filter with only to — from defaults to 0000-00', () => {
    const result = _df({ to: '2026-06' });
    expect(result).toContain("'0000-00'");
  });

  test('no args returns all-time passthrough', () => {
    expect(_df({})).toBe('true');
    expect(_df()).toBe('true');
  });
});

describe('_label — period label formatter', () => {
  test('month returns month string', () => {
    expect(_label({ month: '2026-06' })).toBe('2026-06');
  });

  test('from+to returns range string', () => {
    expect(_label({ from: '2026-01', to: '2026-03' })).toBe('2026-01 – 2026-03');
  });

  test('from only', () => {
    expect(_label({ from: '2026-01' })).toBe('from 2026-01');
  });

  test('to only', () => {
    expect(_label({ to: '2026-06' })).toBe('up to 2026-06');
  });

  test('no args returns All Time', () => {
    expect(_label({})).toBe('All Time');
    expect(_label()).toBe('All Time');
  });
});

describe('uid', () => {
  test('returns a non-empty string', () => {
    expect(typeof uid()).toBe('string');
    expect(uid().length).toBeGreaterThan(0);
  });

  test('two calls produce different values', () => {
    expect(uid()).not.toBe(uid());
  });
});

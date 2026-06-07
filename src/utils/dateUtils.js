// SQL WHERE clause fragment for date filtering
export const _sqlDf = (args = {}, col = 'date') => {
  if (args.month) return `strftime('%Y-%m',${col})='${args.month}'`;
  const p = [];
  if (args.from) p.push(`strftime('%Y-%m',${col})>='${args.from}'`);
  if (args.to)   p.push(`strftime('%Y-%m',${col})<='${args.to}'`);
  return p.length ? p.join(' AND ') : '1=1';
};

export const _df = (args = {}, field = 't.date') => {
  if (args.month) return `${field}&&${field}.slice(0,7)==='${args.month}'`;
  if (args.from || args.to) {
    const f = args.from || '0000-00', t = args.to || '9999-99';
    return `${field}&&${field}.slice(0,7)>='${f}'&&${field}.slice(0,7)<='${t}'`;
  }
  return 'true';
};

export const _label = (args = {}) => {
  if (args.month) return args.month;
  if (args.from && args.to) return `${args.from} – ${args.to}`;
  if (args.from) return `from ${args.from}`;
  if (args.to) return `up to ${args.to}`;
  return 'All Time';
};

export const buildDates = (start, cadence, count) => {
  const out = [start]; let cur = new Date(start + "T12:00:00");
  for (let i = 1; i < count; i++) {
    const n = new Date(cur);
    if (cadence === "weekly") n.setDate(n.getDate() + 7);
    else if (cadence === "biweekly") n.setDate(n.getDate() + 14);
    else if (cadence === "every15") n.setDate(n.getDate() + 15);
    else if (cadence === "monthly") n.setMonth(n.getMonth() + 1);
    else if (cadence === "bimonthly") n.setMonth(n.getMonth() + 2);
    else if (cadence === "quarterly") n.setMonth(n.getMonth() + 3);
    else if (cadence === "annually") n.setFullYear(n.getFullYear() + 1);
    out.push(n.toISOString().split("T")[0]); cur = n;
  }
  return out;
};

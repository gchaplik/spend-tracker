// Jarvis tool library — generates JS queries and schema-driven builders
import { _df, _label, _sqlDf } from "../../utils/dateUtils.js";

// ─── Tool library ──────────────────────────────────────────────────────────────
// Domain query builders: each tool owns its JOIN/UNION logic internally.
// The LLM picks a domain tool + params; tools produce correct SQL always.

// Wrap SQL in the __SQL__: marker that executeTool detects
const _sql=(sqlStr,params=[])=>`__SQL__:${JSON.stringify({sql:sqlStr,params})}`;

// ── Filter parser ─────────────────────────────────────────────────────────────
// Converts a single filter token like "month=2025-06" or "amount>50" into SQL.
const _pf=(tok,dc='date')=>{
  const t=tok.trim(); if(!t||t==='1=1') return null;
  if(/^last\s*30\s*days?$/i.test(t)) return `${dc}>=date('now','-30 days')`;
  if(/^last\s*3\s*months?$/i.test(t)) return `${dc}>=date('now','-3 months')`;
  if(/^last\s*6\s*months?$/i.test(t)) return `${dc}>=date('now','-6 months')`;
  if(/^last\s*12\s*months?$/i.test(t)) return `${dc}>=date('now','-12 months')`;
  if(/^this\s*year$/i.test(t)) return `strftime('%Y',${dc})=strftime('%Y','now')`;
  if(/^last\s*year$/i.test(t)) return `${dc}>=date('now','-1 year')`;
  if(/^this\s*month$/i.test(t)) return `strftime('%Y-%m',${dc})=strftime('%Y-%m','now')`;
  if(/^last\s*month$/i.test(t)) return `strftime('%Y-%m',${dc})=strftime('%Y-%m',date('now','-1 month'))`;
  let m;
  if((m=t.match(/^month=(\d{4}-\d{2})$/i))) return `strftime('%Y-%m',${dc})='${m[1]}'`;
  if((m=t.match(/^year=(\d{4})$/i))) return `strftime('%Y',${dc})='${m[1]}'`;
  if((m=t.match(/^from=(\d{4}-\d{2}(?:-\d{2})?)$/i))) return `${dc}>='${m[1].length===7?m[1]+'-01':m[1]}'`;
  if((m=t.match(/^to=(\d{4}-\d{2}(?:-\d{2})?)$/i))) return `${dc}<='${m[1].length===7?m[1]+'-31':m[1]}'`;
  if((m=t.match(/^amount\s*([><=!]+)\s*(\d+(?:\.\d+)?)$/i))) return `amount${m[1]}${m[2]}`;
  if((m=t.match(/^category=(.+)$/i))) return `LOWER(COALESCE(category,''))='${m[1].toLowerCase().replace(/'/g,"''")}'`;
  if((m=t.match(/^merchant=(.+)$/i))) return `LOWER(COALESCE(merchant,'')) LIKE LOWER('%${m[1].replace(/'/g,"''")}%')`;
  if((m=t.match(/^(?:note|q|search)=(.+)$/i))) return `(LOWER(COALESCE(merchant,''))||' '||LOWER(COALESCE(note,''))||' '||LOWER(COALESCE(category,''))) LIKE LOWER('%${m[1].replace(/'/g,"''")}%')`;
  if((m=t.match(/^type=(\w+)$/i))) return `type='${m[1].toLowerCase()}'`;
  if(/^usd=true$/i.test(t)) return `originalAmountUSD IS NOT NULL`;
  if(/^tax(?:deductible)?=true$/i.test(t)) return `taxDeductible=1`;
  return null;
};

// Parse full filter string (AND-separated) → SQL condition string
const _parseFilter=(filterStr,dc='date')=>{
  if(!filterStr) return '1=1';
  const cs=filterStr.split(/\s+AND\s+/i).map(t=>_pf(t,dc)).filter(Boolean);
  return cs.length?cs.join(' AND '):'1=1';
};

// Split filter into date conditions (safe for both sides of a UNION)
// and column conditions (only apply to transactions, not vacation_txns)
const _splitFilter=(filterStr,dc='date')=>{
  if(!filterStr) return{df:'1=1',cf:'1=1'};
  const IS_DATE=/^(last|this|month=|year=|from=|to=)/i;
  const tokens=filterStr.split(/\s+AND\s+/i);
  const df=tokens.filter(t=>IS_DATE.test(t.trim())).map(t=>_pf(t,dc)).filter(Boolean);
  const cf=tokens.filter(t=>!IS_DATE.test(t.trim())).map(t=>_pf(t,dc)).filter(Boolean);
  return{df:df.length?df.join(' AND '):'1=1',cf:cf.length?cf.join(' AND '):'1=1'};
};

// GroupBy expression → SQL expression
const _gb=(groupBy,dc='date')=>{
  if(!groupBy) return null;
  return{category:`COALESCE(category,'Other')`,merchant:`COALESCE(merchant,'?')`,
    month:`strftime('%Y-%m',${dc})`,week:`strftime('%Y-W%W',${dc})`,
    day:dc,date:dc,year:`strftime('%Y',${dc})`,
    type:'type',source:`COALESCE(source,merchant,'?')`
  }[groupBy.toLowerCase()]||groupBy;
};

// Aggregate expression
const _agg=(agg='sum',col='amount')=>{
  const a=agg.toLowerCase();
  if(a==='avg') return `ROUND(AVG(${col}),2)`;
  if(a==='count') return `COUNT(*)`;
  if(a==='max') return `ROUND(MAX(${col}),2)`;
  if(a==='min') return `ROUND(MIN(${col}),2)`;
  return `ROUND(SUM(${col}),2)`;
};

// All expenses UNION: transactions expenses + vacation_txns
// dateFilter applies to both sides; columnFilter wraps the outer query
const _expUnion=(df='1=1',cf='1=1')=>{
  const inner=
    `SELECT amount,date,COALESCE(category,'Other') as category,COALESCE(merchant,'?') as merchant,`+
    `COALESCE(note,'') as note `+
    `FROM transactions WHERE type='expense' AND ${df} `+
    `UNION ALL `+
    `SELECT amount,date,COALESCE(category,'Vacation') as category,COALESCE(merchant,'?') as merchant,`+
    `'' as note `+
    `FROM vacation_txns WHERE ${df}`;
  return cf==='1=1'?`(${inner})`:`(SELECT * FROM (${inner}) WHERE ${cf})`;
};

// Legacy alias for any tools that still use the old pattern
const _allExp=(df='1=1')=>_expUnion(df);

// ── Schema-driven query builder ────────────────────────────────────────────────
// Takes a schema view object, a measure key, and options.
// Builds FROM from view.baseSQL + UNION ALL joins (or falls back to view.table).
// Substitutes ${TABLE} → alias 't' everywhere.
// Returns a __SQL__: marker or null.
const buildSchemaQuery=(view,measureKey,opts={})=>{
  if(!view) return null;
  const measure=view.measures?.[measureKey];
  if(!measure?.sql) return null;
  const {filter,groupByDim,sort,limit}=opts;
  const alias='t';
  const sub=(s)=>s.replace(/\$\{TABLE\}/g,alias);

  // FROM: baseSQL UNION ALL each join's sql, aliased as 't'
  let fromSQL;
  if(view.baseSQL){
    const parts=[view.baseSQL,...(view.joins||[]).filter(j=>j.type==='UNION ALL').map(j=>j.sql)];
    fromSQL=`(${parts.join(' UNION ALL ')}) AS ${alias}`;
  } else {
    fromSQL=`${view.table} AS ${alias}`;
  }

  // Measure with substitution
  const msrSQL=sub(measure.sql);

  // WHERE from filter (applied to outer query)
  const dc=view.defaultDateField||'date';
  const whereSQL=filter?_parseFilter(filter,dc):null;
  const whereStr=(whereSQL&&whereSQL!=='1=1')?` WHERE ${whereSQL}`:'';

  // Optional GROUP BY from a named dimension key
  const dimDef=groupByDim&&view.dimensions?.[groupByDim];
  const gbExpr=dimDef?sub(dimDef.sql):null;

  let sql;
  if(gbExpr){
    sql=`SELECT ${gbExpr} as name, ${msrSQL} as value, COUNT(*) as count`
      +` FROM ${fromSQL}${whereStr}`
      +` GROUP BY ${gbExpr} ORDER BY ${sort||'value DESC'}`
      +(limit?` LIMIT ${+limit}`:'');
  } else {
    sql=`SELECT ${msrSQL} as value, COUNT(*) as count FROM ${fromSQL}${whereStr}`;
  }
  return `__SQL__:${JSON.stringify({sql})}`;
};

// ── Schema → compact tool-definition list (for Jarvis system prompt) ───────────
// Each schema view with a toolSchema becomes a callable view-query tool.
// The description tells the LLM what params it accepts and what the response looks like.
const schemaToToolDefs=(schema)=>{
  if(!schema?.views) return [];
  return Object.entries(schema.views).map(([viewKey,v])=>{
    if(!v.toolSchema||!v.measures) return null;
    const measureEnum=Object.keys(v.measures).join('|');
    const dimEnum=Object.keys(v.dimensions||{}).join('|');
    const joinDesc=(v.joins||[]).filter(j=>j.type==='UNION ALL').map(j=>j.label).join('+');
    return {
      name:`view_${viewKey}`,
      description:`${v.label}${joinDesc?` (includes ${joinDesc})`:''}. ${v.description}`,
      input_schema:{
        type:"object",
        description:`Available measures: ${measureEnum}. Groupable by: ${dimEnum||'none'}.`,
        properties:{
          measure:{type:"string",enum:Object.keys(v.measures),default:Object.keys(v.measures)[0]},
          filter: {type:"string",description:"Date filter: thismonth|lastmonth|thisyear|last30days|month=YYYY-MM|year=YYYY"},
          groupBy:{type:"string",enum:Object.keys(v.dimensions||{}),description:"Dimension to group results by"},
          limit:  {type:"integer",description:"Max rows when grouping"}
        }
      }
    };
  }).filter(Boolean);
};

const TOOL_LIBRARY={
  // ══════════════════════════════════════════════════════════════════════════
  // DOMAIN TOOLS — each handles its own JOINs and UNIONs internally
  // ══════════════════════════════════════════════════════════════════════════

  // ── expenses ─────────────────────────────────────────────────────────────
  // All spending: regular transactions + vacation purchases (UNION baked in)
  // filter: month=YYYY-MM | year=YYYY | from/to | category=X | merchant=X |
  //         amount>N | last30days | last3months | thisyear | q=text
  // groupBy: category | merchant | month | week | day | year
  // aggregate: sum (default) | avg | count | max | min
  // sort: "value DESC" (default when groupBy set) | "name ASC" | etc
  // limit: number
  expenses:(args={})=>{
    const{df,cf}=_splitFilter(args.filter);
    const src=_expUnion(df,cf);
    const gbExpr=_gb(args.groupBy);
    const aggExpr=_agg(args.aggregate);
    const limit=args.limit?`LIMIT ${+args.limit}`:'';
    const sort=args.sort||(args.groupBy?'value DESC':'');
    if(gbExpr) return _sql(`SELECT ${gbExpr} as name, ${aggExpr} as value, COUNT(*) as count FROM ${src} GROUP BY ${gbExpr} ORDER BY ${sort||'value DESC'} ${limit}`);
    return _sql(`SELECT ${aggExpr} as value, COUNT(*) as count FROM ${src}`);
  },
  // ── income ────────────────────────────────────────────────────────────────
  // filter: same syntax as expenses | groupBy: source | month | merchant | year
  income:(args={})=>{
    const where=_parseFilter(args.filter);
    const gbExpr=_gb(args.groupBy);
    const aggExpr=_agg(args.aggregate);
    const limit=args.limit?`LIMIT ${+args.limit}`:'';
    const src=`transactions WHERE type='income' AND ${where}`;
    if(gbExpr) return _sql(`SELECT ${gbExpr} as name, ${aggExpr} as value, COUNT(*) as count FROM ${src} GROUP BY ${gbExpr} ORDER BY ${args.sort||'value DESC'} ${limit}`);
    return _sql(`SELECT ${aggExpr} as value, COUNT(*) as count FROM ${src}`);
  },

  // ── net ───────────────────────────────────────────────────────────────────
  // Income minus all expenses. groupBy: month | year
  net:(args={})=>{
    const{df,cf}=_splitFilter(args.filter);
    const where=_parseFilter(args.filter);
    if(args.groupBy){
      const gbExpr=_gb(args.groupBy);
      const since=df==='1=1'?'1=1':df;
      return _sql(`SELECT mo as name, ROUND(inc-exp,2) as net, ROUND(inc,2) as income, ROUND(exp,2) as expenses `+
        `FROM (SELECT ${gbExpr} as mo, SUM(amount) as inc, 0 as exp FROM transactions WHERE type='income' AND ${since} GROUP BY mo `+
        `UNION ALL SELECT ${gbExpr} as mo, 0 as inc, SUM(amount) as exp FROM ${_expUnion(df,cf)} GROUP BY mo) GROUP BY mo ORDER BY mo`);
    }
    return _sql(`SELECT ROUND(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),2) as net, `+
      `ROUND(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),2) as income, `+
      `ROUND(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),2) as expenses `+
      `FROM (SELECT amount,'income' as type FROM transactions WHERE type='income' AND ${where} `+
      `UNION ALL SELECT amount,'expense' as type FROM ${_expUnion(df,cf)})`);
  },

  // ── budget ────────────────────────────────────────────────────────────────
  // filter: month=YYYY-MM | from/to | category=X
  // metric: summary (default) | proximity | over | remaining | utilization | targets
  budget:(args={})=>{
    const{df,cf}=_splitFilter(args.filter);
    const src=_expUnion(df,cf);
    const metric=(args.metric||'summary').toLowerCase();
    const cat=(args.category||'').replace(/'/g,"''");
    const catWhere=cat?`AND cb.category='${cat}'`:'';
    const spentJoin=`LEFT JOIN (SELECT category as cat, SUM(amount) as spent FROM ${src} GROUP BY cat) t ON t.cat=cb.category`;
    if(metric==='proximity'||metric==='closest')
      return _sql(`SELECT cb.category as name, cb.budget, ROUND(COALESCE(t.spent,0),2) as spent, ROUND(cb.budget-COALESCE(t.spent,0),2) as remaining, ROUND(COALESCE(t.spent,0)*100.0/NULLIF(cb.budget,0),1) as percentUsed FROM cat_budgets cb ${spentJoin} WHERE cb.budget>0 ${catWhere} ORDER BY percentUsed DESC`);
    if(metric==='over')
      return _sql(`SELECT cb.category as name, cb.budget, ROUND(t.spent,2) as spent, ROUND(t.spent-cb.budget,2) as over FROM cat_budgets cb JOIN (SELECT category as cat, SUM(amount) as spent FROM ${src} GROUP BY cat) t ON t.cat=cb.category WHERE t.spent>cb.budget ORDER BY over DESC`);
    if(metric==='remaining')
      return _sql(`SELECT cb.category as name, cb.budget, ROUND(COALESCE(t.spent,0),2) as spent, ROUND(cb.budget-COALESCE(t.spent,0),2) as remaining FROM cat_budgets cb ${spentJoin} WHERE cb.budget>0 ${catWhere} ORDER BY remaining ASC`);
    if(metric==='utilization')
      return _sql(`SELECT ROUND(SUM(cb.budget),2) as totalBudget, ROUND(COALESCE(SUM(t.spent),0),2) as totalSpent, ROUND(COALESCE(SUM(t.spent),0)*100.0/NULLIF(SUM(cb.budget),0),1) as percentUsed, ROUND(SUM(cb.budget)-COALESCE(SUM(t.spent),0),2) as remaining FROM cat_budgets cb ${spentJoin} WHERE cb.budget>0`);
    if(metric==='targets')
      return _sql(`SELECT category as name, budget as value FROM cat_budgets ORDER BY budget DESC`);
    // summary (default): full budget vs actual
    return _sql(`SELECT cb.category as name, cb.budget, ROUND(COALESCE(t.spent,0),2) as spent, ROUND(cb.budget-COALESCE(t.spent,0),2) as remaining, ROUND(COALESCE(t.spent,0)*100.0/NULLIF(cb.budget,0),1) as percentUsed FROM cat_budgets cb ${spentJoin} ORDER BY percentUsed DESC NULLS LAST`);
  },

  // ── bills ─────────────────────────────────────────────────────────────────
  // status: all (default) | due | paid | overdue | history
  // filter: month=YYYY-MM | category=X | amount>N
  // name: bill name substring (for history)
  bills:(args={})=>{
    const month=(args.filter||'').match(/month=(\d{4}-\d{2})/i)?.[1]||args.month||new Date().toISOString().slice(0,7);
    const status=(args.status||args.metric||'all').toLowerCase();
    const today=new Date().toISOString().split('T')[0];
    const nf=args.name?`AND LOWER(b.name) LIKE LOWER('%${(args.name||'').replace(/'/g,"''")}%')`:'';
    const cf=(args.filter||'').match(/category=([^A\s]+)/i);
    const catf=cf?`AND LOWER(b.category)='${cf[1].toLowerCase().replace(/'/g,"''")} '`:'';
    if(status==='history')
      return _sql(`SELECT bp.month, ROUND(bp.amount,2) as value, bp.paidDate FROM bill_payments bp JOIN bills b ON b.id=bp.billId WHERE LOWER(b.name) LIKE LOWER('%${(args.name||'').replace(/'/g,"''")}%') ORDER BY bp.month DESC LIMIT 24`);
    if(status==='paid')
      return _sql(`SELECT b.name, ROUND(bp.amount,2) as value, bp.paidDate, b.category FROM bills b JOIN bill_payments bp ON bp.billId=b.id WHERE bp.month='${month}' ${nf} ORDER BY b.dueDay`);
    if(status==='due')
      return _sql(`SELECT b.name, ROUND(b.amount,2) as value, '${month}-'||printf('%02d',b.dueDay) as dueDate, b.category FROM bills b WHERE b.active=1 AND b.id NOT IN (SELECT billId FROM bill_payments WHERE month='${month}') ${nf} ORDER BY b.dueDay`);
    if(status==='overdue')
      return _sql(`SELECT b.name, ROUND(b.amount,2) as value, '${month}-'||printf('%02d',b.dueDay) as dueDate FROM bills b WHERE b.active=1 AND '${month}-'||printf('%02d',b.dueDay)<'${today}' AND b.id NOT IN (SELECT billId FROM bill_payments WHERE month='${month}') ORDER BY b.dueDay`);
    if(status==='total')
      return _sql(`SELECT ROUND(SUM(amount),2) as monthlyTotal, COUNT(*) as count FROM bills WHERE active=1`);
    // all: list with status column
    return _sql(`SELECT b.name, ROUND(b.amount,2) as value, b.dueDay, b.category, CASE WHEN bp.id IS NOT NULL THEN 'paid' WHEN '${month}-'||printf('%02d',b.dueDay)<'${today}' THEN 'overdue' ELSE 'due' END as status FROM bills b LEFT JOIN bill_payments bp ON bp.billId=b.id AND bp.month='${month}' WHERE b.active=1 ${nf} ${catf} ORDER BY b.dueDay`);
  },

  // ── goals ─────────────────────────────────────────────────────────────────
  // metric: progress (default) | timeline | on_track | detail
  // name: goal name substring
  goals:(args={})=>{
    const metric=(args.metric||'progress').toLowerCase();
    const n=(args.name||'').replace(/'/g,"''");
    const nf=n?`WHERE LOWER(name) LIKE LOWER('%${n}%')`:'';
    if(metric==='timeline')
      return _sql(`
        WITH actual_savings AS (
          SELECT ROUND(AVG(monthly_net),2) as avg_monthly
          FROM (
            SELECT strftime('%Y-%m', date) as mo,
                   SUM(CASE WHEN type='income' THEN amount ELSE -amount END) as monthly_net
            FROM transactions
            WHERE date >= date('now','-6 months')
            GROUP BY strftime('%Y-%m', date)
          )
        )
        SELECT
          g.name,
          ROUND(g.targetAmount,2) as target,
          ROUND(COALESCE(g.currentAmount,0),2) as saved,
          ROUND(g.targetAmount-COALESCE(g.currentAmount,0),2) as remaining,
          ROUND(COALESCE(NULLIF(g.monthlyTarget,0),(SELECT avg_monthly FROM actual_savings)),2) as monthly_savings_rate,
          CASE
            WHEN COALESCE(NULLIF(g.monthlyTarget,0),(SELECT avg_monthly FROM actual_savings))>0
            THEN ROUND((g.targetAmount-COALESCE(g.currentAmount,0))/COALESCE(NULLIF(g.monthlyTarget,0),(SELECT avg_monthly FROM actual_savings)),1)
            ELSE NULL
          END as months_to_goal,
          g.deadline,
          CASE
            WHEN g.deadline IS NULL THEN 'No deadline'
            WHEN g.deadline < date('now') THEN 'Overdue'
            WHEN COALESCE(NULLIF(g.monthlyTarget,0),(SELECT avg_monthly FROM actual_savings))>0
              AND COALESCE(g.currentAmount,0)+((julianday(g.deadline)-julianday('now'))/30.44)*COALESCE(NULLIF(g.monthlyTarget,0),(SELECT avg_monthly FROM actual_savings))>=g.targetAmount
            THEN 'On track'
            ELSE 'Behind'
          END as status
        FROM goals g
        ${nf||'WHERE g.targetAmount>0'}
        ORDER BY g.deadline
      `);
    if(metric==='on_track'||metric==='ontrack')
      return _sql(`SELECT name, ROUND(targetAmount,2) as target, ROUND(COALESCE(currentAmount,0),2) as saved, deadline, CASE WHEN deadline IS NULL THEN 'No deadline' WHEN monthlyTarget>0 AND COALESCE(currentAmount,0)+(julianday(deadline)-julianday('now'))/30.0*monthlyTarget>=targetAmount THEN 'On track' ELSE 'Behind' END as status FROM goals WHERE targetAmount>0 ORDER BY deadline`);
    if(metric==='detail')
      return _sql(`SELECT name, ROUND(targetAmount,2) as target, ROUND(COALESCE(currentAmount,0),2) as saved, ROUND(targetAmount-COALESCE(currentAmount,0),2) as remaining, ROUND(COALESCE(currentAmount,0)*100.0/NULLIF(targetAmount,0),1) as percentComplete, deadline, ROUND(monthlyTarget,2) as monthlyTarget FROM goals ${nf} ORDER BY deadline`);
    // progress (default)
    return _sql(`SELECT name, ROUND(targetAmount,2) as target, ROUND(COALESCE(currentAmount,0),2) as saved, ROUND(COALESCE(currentAmount,0)*100.0/NULLIF(targetAmount,0),1) as percentComplete, ROUND(targetAmount-COALESCE(currentAmount,0),2) as remaining, deadline FROM goals ORDER BY percentComplete DESC`);
  },

  // ── net_worth ─────────────────────────────────────────────────────────────
  // metric: current (default) | trend | change | by_type | accounts
  net_worth:(args={})=>{
    const metric=(args.metric||'current').toLowerCase();
    const n=+args.months||12;
    if(metric==='trend')
      return _sql(`SELECT date as name, ROUND(SUM(balance),2) as value FROM account_history GROUP BY date ORDER BY date DESC LIMIT ${n}`);
    if(metric==='change')
      return _sql(`SELECT ROUND(SUM(CASE WHEN date=(SELECT MAX(date) FROM account_history) THEN balance ELSE 0 END),2) as latestNW, ROUND(SUM(CASE WHEN date=(SELECT MIN(date) FROM account_history WHERE date>=date('now','-${n} months')) THEN balance ELSE 0 END),2) as earliestNW FROM account_history WHERE date>=date('now','-${n} months')`);
    if(metric==='by_type')
      return _sql(`SELECT type, ROUND(SUM(balance),2) as balance, COUNT(*) as accounts FROM accounts GROUP BY type ORDER BY balance DESC`);
    if(metric==='accounts')
      return _sql(`SELECT name, type, ROUND(balance,2) as balance FROM accounts ORDER BY balance DESC`);
    // current (default)
    return _sql(`SELECT ROUND(SUM(balance),2) as netWorth, ROUND(SUM(CASE WHEN balance>0 THEN balance ELSE 0 END),2) as assets, ROUND(SUM(CASE WHEN balance<0 THEN balance ELSE 0 END),2) as liabilities FROM accounts`);
  },

  // ── debts ─────────────────────────────────────────────────────────────────
  // metric: summary (default) | interest | total
  // type: credit | mortgage | loan (optional filter)
  debts:(args={})=>{
    const metric=(args.metric||'summary').toLowerCase();
    const t=(args.type||'').replace(/'/g,"''");
    const tf=t?`WHERE LOWER(type) LIKE LOWER('%${t}%')`:'';
    if(metric==='interest')
      return _sql(`SELECT name, ROUND(balance,2) as balance, interestRate as rate, ROUND(balance*interestRate/100.0,2) as annualInterest FROM debts WHERE interestRate>0 ORDER BY annualInterest DESC`);
    if(metric==='total')
      return _sql(`SELECT ROUND(SUM(balance),2) as totalDebt, COUNT(*) as accounts, ROUND(SUM(minPayment),2) as totalMinPayment FROM debts`);
    return _sql(`SELECT name, ROUND(balance,2) as balance, interestRate as rate, ROUND(minPayment,2) as minPayment, type FROM debts ${tf} ORDER BY balance DESC`);
  },

  // ── subscriptions ─────────────────────────────────────────────────────────
  // groupBy: category (optional)
  subscriptions:(args={})=>{
    if(args.groupBy==='category')
      return _sql(`SELECT COALESCE(category,'Uncategorized') as name, ROUND(SUM(CASE WHEN billingCycle='monthly' THEN amount WHEN billingCycle='annual' THEN amount/12.0 WHEN billingCycle='weekly' THEN amount*52/12.0 ELSE amount END),2) as monthlyValue, COUNT(*) as count FROM subscriptions GROUP BY COALESCE(category,'Uncategorized') ORDER BY monthlyValue DESC`);
    if(args.metric==='total')
      return _sql(`SELECT ROUND(SUM(CASE WHEN billingCycle='monthly' THEN amount WHEN billingCycle='annual' THEN amount/12.0 WHEN billingCycle='weekly' THEN amount*52/12.0 ELSE amount END),2) as monthlyTotal, COUNT(*) as count FROM subscriptions`);
    return _sql(`SELECT name, ROUND(amount,2) as amount, billingCycle, category, ROUND(CASE WHEN billingCycle='annual' THEN amount/12.0 WHEN billingCycle='weekly' THEN amount*52/12.0 ELSE amount END,2) as monthlyEquiv FROM subscriptions ORDER BY monthlyEquiv DESC`);
  },

  // ── detect_subscriptions ──────────────────────────────────────────────────
  // Finds recurring merchants from transaction history (3+ charges, 25+ day span, active in last 90 days)
  detect_subscriptions:(args={})=>_sql(`
    SELECT
      merchant as name,
      ROUND(AVG(amount),2) as avg_amount,
      COUNT(*) as occurrences,
      ROUND(CAST(julianday(MAX(date))-julianday(MIN(date)) AS REAL)/(COUNT(*)-1),0) as avg_days_between,
      CASE
        WHEN CAST(julianday(MAX(date))-julianday(MIN(date)) AS REAL)/(COUNT(*)-1) BETWEEN 6 AND 8 THEN 'weekly'
        WHEN CAST(julianday(MAX(date))-julianday(MIN(date)) AS REAL)/(COUNT(*)-1) BETWEEN 13 AND 16 THEN 'biweekly'
        WHEN CAST(julianday(MAX(date))-julianday(MIN(date)) AS REAL)/(COUNT(*)-1) BETWEEN 25 AND 35 THEN 'monthly'
        WHEN CAST(julianday(MAX(date))-julianday(MIN(date)) AS REAL)/(COUNT(*)-1) BETWEEN 85 AND 100 THEN 'quarterly'
        ELSE 'recurring'
      END as frequency,
      ROUND(AVG(amount)*12,2) as est_annual_cost,
      MAX(date) as last_charge
    FROM transactions
    WHERE type='expense'
      AND merchant IS NOT NULL AND TRIM(merchant)!=''
      AND amount > 0
    GROUP BY LOWER(TRIM(merchant))
    HAVING COUNT(*) >= 3
      AND MAX(date) >= date('now','-90 days')
      AND CAST(julianday(MAX(date))-julianday(MIN(date)) AS REAL) >= 25
    ORDER BY avg_amount DESC
    LIMIT 20
  `),

  // ── vacations ─────────────────────────────────────────────────────────────
  // name: vacation name substring
  // metric: list (default) | spending | txns | biggest | merchants
  vacations:(args={})=>{
    const metric=(args.metric||'list').toLowerCase();
    const n=(args.name||'').replace(/'/g,"''");
    const nw=n?`WHERE LOWER(v.name) LIKE LOWER('%${n}%')`:'';
    const lim=args.limit||20;
    if(metric==='spending')
      return _sql(`SELECT v.name, v.budget, ROUND(COALESCE(SUM(vt.amount),0),2) as spent, ROUND(v.budget-COALESCE(SUM(vt.amount),0),2) as remaining FROM vacations v LEFT JOIN vacation_txns vt ON vt.vacationId=v.id ${nw} GROUP BY v.id ORDER BY v.startDate DESC`);
    if(metric==='txns'||metric==='transactions')
      return _sql(`SELECT vt.merchant as name, ROUND(vt.amount,2) as value, vt.date, vt.category FROM vacation_txns vt JOIN vacations v ON v.id=vt.vacationId ${nw} ORDER BY vt.amount DESC LIMIT ${lim}`);
    if(metric==='biggest')
      return _sql(`SELECT vt.merchant as name, ROUND(vt.amount,2) as value, vt.date, vt.category FROM vacation_txns vt JOIN vacations v ON v.id=vt.vacationId ${nw} ORDER BY vt.amount DESC LIMIT 1`);
    if(metric==='merchants')
      return _sql(`SELECT vt.merchant as name, ROUND(SUM(vt.amount),2) as value, COUNT(*) as count FROM vacation_txns vt JOIN vacations v ON v.id=vt.vacationId ${nw} GROUP BY vt.merchant ORDER BY value DESC LIMIT ${lim}`);
    // list
    return _sql(`SELECT v.name, v.startDate, v.endDate, v.budget, ROUND(COALESCE(SUM(vt.amount),0),2) as spent FROM vacations v LEFT JOIN vacation_txns vt ON vt.vacationId=v.id GROUP BY v.id ORDER BY v.startDate DESC`);
  },

  // ── portfolio ─────────────────────────────────────────────────────────────
  // metric: summary (default) | detail | gain
  // ticker: optional filter
  portfolio:(args={})=>{
    const metric=(args.metric||'summary').toLowerCase();
    const t=(args.ticker||'').replace(/'/g,"''");
    const tf=t?`WHERE UPPER(ticker)=UPPER('${t}')`:'';
    // currentPrice is persisted to DB whenever the Stocks tab is open and prices load.
    // Fall back to costBasis when currentPrice is null (prices not yet fetched).
    const price=`COALESCE(currentPrice,costBasis)`;
    const cost=`COALESCE(costBasis,0)`;
    if(metric==='gain')
      return _sql(`SELECT ticker, ROUND(shares,4) as shares, ROUND(${price},2) as price, ROUND(${cost},2) as costBasis, ROUND((${price}-${cost})*shares,2) as gain, ROUND((${price}-${cost})*100.0/NULLIF(${cost},0),1) as gainPct FROM holdings ${tf} ORDER BY gain DESC`);
    if(metric==='detail')
      return _sql(`SELECT ticker, name, ROUND(shares,4) as shares, ROUND(${price},2) as price, ROUND(${cost},2) as costBasis, ROUND(${price}*shares,2) as value FROM holdings ${tf} ORDER BY value DESC`);
    // summary — total value, per-holding breakdown, overall gain
    return _sql(`SELECT ticker, ROUND(${price}*shares,2) as value, ROUND((${price}-${cost})*shares,2) as gain, ROUND(${price},2) as currentPrice, ROUND(shares,4) as shares FROM holdings ORDER BY value DESC`);
  },

  // ── expected_income ───────────────────────────────────────────────────────
  // filter: month=YYYY-MM | from/to | source=X
  // metric: pending (default) | confirmed | recurring | all | total
  expected_income:(args={})=>{
    const metric=(args.metric||'pending').toLowerCase();
    const where=_parseFilter(args.filter,'expectedDate');
    const src=(args.source||'').replace(/'/g,"''");
    const sf=src?`AND LOWER(source) LIKE LOWER('%${src}%')`:'';
    if(metric==='confirmed')
      return _sql(`SELECT source as name, ROUND(amount,2) as value, confirmedDate as date FROM expected_income WHERE confirmed=1 AND ${where} ${sf} ORDER BY confirmedDate DESC`);
    if(metric==='recurring')
      return _sql(`SELECT source as name, ROUND(amount,2) as value, expectedDate as nextDate, cadence FROM expected_income WHERE cadence IS NOT NULL AND cadence!='once' AND confirmed=0 ${sf} ORDER BY expectedDate`);
    if(metric==='total')
      return _sql(`SELECT ROUND(SUM(amount),2) as totalPending, COUNT(*) as count FROM expected_income WHERE confirmed=0 AND expectedDate>=date('now')`);
    if(metric==='all')
      return _sql(`SELECT source as name, ROUND(amount,2) as value, expectedDate, confirmed, cadence FROM expected_income WHERE ${where} ${sf} ORDER BY expectedDate`);
    // pending (default)
    return _sql(`SELECT source as name, ROUND(amount,2) as value, expectedDate FROM expected_income WHERE confirmed=0 AND ${where} ${sf} ORDER BY expectedDate`);
  },

  // ── tax ───────────────────────────────────────────────────────────────────
  // year: YYYY (default: current year)
  // metric: deductible (default) | summary | rrsp | compare
  tax:(args={})=>{
    const metric=(args.metric||'deductible').toLowerCase();
    const y=args.year||new Date().getFullYear();
    const y2=args.year2||new Date().getFullYear();
    if(metric==='summary')
      return _sql(`SELECT COALESCE(category,'Uncategorized') as name, ROUND(SUM(amount),2) as value, COUNT(*) as count FROM transactions WHERE taxDeductible=1 AND strftime('%Y',date)='${y}' GROUP BY category ORDER BY value DESC`);
    if(metric==='rrsp')
      return _sql(`SELECT merchant as name, ROUND(amount,2) as value, date, note FROM transactions WHERE (LOWER(COALESCE(category,''))||' '||LOWER(COALESCE(note,''))||' '||LOWER(COALESCE(merchant,''))) LIKE '%rrsp%' AND strftime('%Y',date)='${y}' ORDER BY date`);
    if(metric==='compare'){
      const y1=args.year1||(new Date().getFullYear()-1);
      return _sql(`SELECT '${y1}' as year1, ROUND(SUM(CASE WHEN strftime('%Y',date)='${y1}' THEN amount ELSE 0 END),2) as deductible1, '${y2}' as year2, ROUND(SUM(CASE WHEN strftime('%Y',date)='${y2}' THEN amount ELSE 0 END),2) as deductible2 FROM transactions WHERE taxDeductible=1 AND strftime('%Y',date) IN ('${y1}','${y2}')`);
    }
    // deductible list (default)
    return _sql(`SELECT COALESCE(merchant,source,'?') as name, ROUND(amount,2) as value, date, category, note FROM transactions WHERE taxDeductible=1 AND strftime('%Y',date)='${y}' ORDER BY date`);
  },

  // ── wishlist ──────────────────────────────────────────────────────────────
  // metric: list (default) | affordable | total
  wishlist:(args={})=>{
    const metric=(args.metric||'list').toLowerCase();
    if(metric==='affordable')
      return _sql(`WITH cash AS (SELECT ROUND(SUM(balance),2) as bal FROM accounts WHERE type IN ('chequing','savings')) SELECT w.name, ROUND(w.price,2) as price, w.priority, CASE WHEN w.price<=cash.bal THEN 'Affordable' ELSE 'Not yet' END as status, ROUND(cash.bal-w.price,2) as balanceAfter FROM wishlist w, cash ORDER BY w.price ASC`);
    if(metric==='total')
      return _sql(`SELECT ROUND(SUM(price),2) as totalCost, COUNT(*) as items FROM wishlist`);
    return _sql(`SELECT name, ROUND(price,2) as price, priority, notes FROM wishlist ORDER BY priority DESC, price ASC`);
  },

  // ── household ─────────────────────────────────────────────────────────────
  // metric: balances (default) | members | settlements
  household:(args={})=>{
    const metric=(args.metric||'balances').toLowerCase();
    if(metric==='members') return _sql(`SELECT name FROM members ORDER BY name`);
    if(metric==='settlements') return _sql(`SELECT fromMember as 'from', toMember as 'to', ROUND(amount,2) as amount, date FROM settlements ORDER BY date DESC LIMIT 20`);
    return _sql(`SELECT m.name, ROUND(COALESCE(SUM(CASE WHEN s.paidBy=m.id THEN s.amount ELSE 0 END),0),2) as paid, ROUND(COALESCE(SUM(CASE WHEN s.owedBy=m.id THEN s.amount ELSE 0 END),0),2) as owes FROM members m LEFT JOIN splits s ON s.paidBy=m.id OR s.owedBy=m.id GROUP BY m.id ORDER BY m.name`);
  },

  // ── trend ─────────────────────────────────────────────────────────────────
  // metric: expenses (default) | income | net | net_worth | savings_rate
  // months: look-back window (default 6)
  trend:(args={})=>{
    const metric=(args.metric||'expenses').toLowerCase();
    const n=+args.months||6;
    const since=`date>=date('now','-${n} months')`;
    const exp=_expUnion(since);
    if(metric==='income')
      return _sql(`SELECT strftime('%Y-%m',date) as name, ROUND(SUM(amount),2) as value FROM transactions WHERE type='income' AND ${since} GROUP BY name ORDER BY name`);
    if(metric==='net')
      return _sql(`SELECT mo as name, ROUND(inc-exp,2) as net, ROUND(inc,2) as income, ROUND(exp,2) as expenses FROM (SELECT strftime('%Y-%m',date) as mo, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as inc, 0 as exp FROM transactions WHERE ${since} GROUP BY mo UNION ALL SELECT strftime('%Y-%m',date) as mo, 0 as inc, SUM(amount) as exp FROM ${exp} GROUP BY mo) GROUP BY mo ORDER BY mo`);
    if(metric==='net_worth')
      return _sql(`SELECT date as name, ROUND(SUM(balance),2) as value FROM account_history WHERE ${since} GROUP BY date ORDER BY date`);
    if(metric==='savings_rate')
      return _sql(`SELECT mo as name, ROUND((inc-exp)*100.0/NULLIF(inc,0),1) as savingsRate, ROUND(inc,2) as income, ROUND(exp,2) as expenses FROM (SELECT strftime('%Y-%m',date) as mo, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as inc, 0 as exp FROM transactions WHERE ${since} GROUP BY mo UNION ALL SELECT strftime('%Y-%m',date) as mo, 0 as inc, SUM(amount) as exp FROM ${exp} GROUP BY mo) GROUP BY mo ORDER BY mo`);
    // expenses (default)
    return _sql(`SELECT strftime('%Y-%m',date) as name, ROUND(SUM(amount),2) as value FROM ${exp} GROUP BY name ORDER BY name`);
  },

  // ── compare ───────────────────────────────────────────────────────────────
  // metric: expenses (default) | income | net
  // month1, month2: YYYY-MM
  compare:(args={})=>{
    const metric=(args.metric||'expenses').toLowerCase();
    const m1=args.month1||args.from;
    const m2=args.month2||args.to||new Date().toISOString().slice(0,7);
    if(!m1) return _sql(`SELECT 'provide month1 and month2 params' as error`);
    const expQ=(m)=>`(SELECT SUM(amount) FROM ${_expUnion(`strftime('%Y-%m',date)='${m}'`)})`;
    const incQ=(m)=>`(SELECT SUM(amount) FROM transactions WHERE type='income' AND strftime('%Y-%m',date)='${m}')`;
    if(metric==='income')
      return _sql(`SELECT '${m1}' as month1, ROUND(COALESCE(${incQ(m1)},0),2) as value1, '${m2}' as month2, ROUND(COALESCE(${incQ(m2)},0),2) as value2, ROUND(COALESCE(${incQ(m2)},0)-COALESCE(${incQ(m1)},0),2) as change, ROUND((COALESCE(${incQ(m2)},0)-COALESCE(${incQ(m1)},0))*100.0/NULLIF(COALESCE(${incQ(m1)},0),0),1) as changePercent`);
    if(metric==='net'){
      const netQ=(m)=>`(COALESCE(${incQ(m)},0)-COALESCE(${expQ(m)},0))`;
      return _sql(`SELECT '${m1}' as month1, ROUND(${netQ(m1)},2) as net1, '${m2}' as month2, ROUND(${netQ(m2)},2) as net2, ROUND(${netQ(m2)}-${netQ(m1)},2) as change`);
    }
    // expenses (default)
    return _sql(`SELECT '${m1}' as month1, ROUND(COALESCE(${expQ(m1)},0),2) as value1, '${m2}' as month2, ROUND(COALESCE(${expQ(m2)},0),2) as value2, ROUND(COALESCE(${expQ(m2)},0)-COALESCE(${expQ(m1)},0),2) as change, ROUND((COALESCE(${expQ(m2)},0)-COALESCE(${expQ(m1)},0))*100.0/NULLIF(COALESCE(${expQ(m1)},0),0),1) as changePercent`);
  },

  // ── savings_rate ──────────────────────────────────────────────────────────
  // filter: month=YYYY-MM | from/to | thisyear etc
  savings_rate:(args={})=>{
    const{df,cf}=_splitFilter(args.filter);
    const where=_parseFilter(args.filter);
    return _sql(`SELECT ROUND(SUM(inc),2) as income, ROUND(SUM(exp),2) as expenses, ROUND(SUM(inc)-SUM(exp),2) as saved, ROUND((SUM(inc)-SUM(exp))*100.0/NULLIF(SUM(inc),0),1) as rate FROM (SELECT amount as inc,0 as exp FROM transactions WHERE type='income' AND ${where} UNION ALL SELECT 0 as inc,amount as exp FROM ${_expUnion(df,cf)})`);
  },

  // ── runway ────────────────────────────────────────────────────────────────
  // How many months current liquid cash can cover at the 3-month avg spend rate
  runway:()=>_sql(`WITH cash AS (SELECT ROUND(SUM(balance),2) as bal FROM accounts WHERE type IN ('chequing','savings','other')), avg3 AS (SELECT ROUND(AVG(monthly),2) as avgMonthly FROM (SELECT strftime('%Y-%m',date) as mo, SUM(amount) as monthly FROM transactions WHERE type='expense' AND date>=date('now','-3 months') GROUP BY mo)) SELECT cash.bal as cashBalance, avg3.avgMonthly as avgMonthlySpend, ROUND(cash.bal/NULLIF(avg3.avgMonthly,0),1) as runwayMonths FROM cash, avg3`),

  // ── spending_anomalies ────────────────────────────────────────────────────
  // Transactions > threshold×category average (requires ≥3 txns in category for baseline)
  // filter: month/from/to | threshold: multiplier (default 2.0)
  spending_anomalies:(args={})=>{
    const{df}=_splitFilter(args.filter);
    const where=_parseFilter(args.filter);
    const mult=args.threshold||2.0;
    return _sql(`WITH avgs AS (SELECT category, AVG(amount) as avg_amount FROM transactions WHERE type='expense' GROUP BY category HAVING COUNT(*)>=3) SELECT t.merchant as name, t.amount as value, t.date, t.category, ROUND(a.avg_amount,2) as categoryAvg, ROUND(t.amount/a.avg_amount,1) as xAverage FROM transactions t JOIN avgs a ON a.category=t.category WHERE t.type='expense' AND ${where} AND t.amount>${mult}*a.avg_amount ORDER BY xAverage DESC LIMIT 15`);
  },

  // ── health_score ──────────────────────────────────────────────────────────
  // JS-computed composite score — resolved by executeTool, not SQL
  health_score:()=>'__HEALTH_SCORE__',

  // ── cashflow_projection ───────────────────────────────────────────────────
  // JS-computed — upcoming bills + expected income in next N days
  cashflow_projection:(args={})=>`__CASHFLOW__:${+args.days||30}`,

  // ── portfolio_by_currency ─────────────────────────────────────────────────
  // CAD vs USD asset split across all holdings
  portfolio_by_currency:(args={})=>_sql(`
    SELECT
      CASE WHEN UPPER(currency) = 'USD' THEN 'USD' ELSE 'CAD' END AS currency,
      COUNT(*) AS holdings,
      SUM(shares * COALESCE(avgCost, 0)) AS book_value
    FROM holdings
    GROUP BY 1
    ORDER BY book_value DESC
  `,[]),

  // ── debt_payoff_timeline ──────────────────────────────────────────────────
  // Months to pay off each debt at current monthly payment rate
  debt_payoff_timeline:(args={})=>_sql(`
    SELECT
      name,
      type,
      ROUND(balance, 2) AS balance,
      ROUND(interestRate, 2) AS interest_rate,
      ROUND(monthlyPayment, 2) AS monthly_payment,
      CASE
        WHEN monthlyPayment > 0 AND interestRate > 0
        THEN ROUND(
          LOG(monthlyPayment / (monthlyPayment - balance * interestRate / 1200))
          / LOG(1 + interestRate / 1200)
        , 1)
        WHEN monthlyPayment > 0
        THEN ROUND(balance / monthlyPayment, 1)
        ELSE NULL
      END AS months_to_payoff
    FROM debts
    WHERE balance > 0
    ORDER BY months_to_payoff ASC
  `,[]),

  // ── breakeven ────────────────────────────────────────────────────────────
  // Month when projected income will cover all fixed costs (bills + budgets)
  breakeven:(args={})=>_sql(`
    WITH monthly_income AS (
      SELECT AVG(monthly_total) AS avg_income FROM (
        SELECT strftime('%Y-%m', date) AS m, SUM(amount) AS monthly_total
        FROM transactions WHERE type = 'income'
        GROUP BY m ORDER BY m DESC LIMIT 3
      )
    ),
    fixed_costs AS (
      SELECT SUM(amount) AS total_bills FROM bills WHERE active = 1 OR active IS NULL
    )
    SELECT
      ROUND(monthly_income.avg_income, 2) AS avg_monthly_income,
      ROUND(fixed_costs.total_bills, 2) AS total_fixed_costs,
      CASE
        WHEN monthly_income.avg_income >= fixed_costs.total_bills THEN 'Already covered'
        ELSE 'Income does not cover fixed costs'
      END AS status,
      ROUND(fixed_costs.total_bills - monthly_income.avg_income, 2) AS shortfall
    FROM monthly_income, fixed_costs
  `,[]),

  // ── sql_query ─────────────────────────────────────────────────────────────
  // Escape hatch: run any SELECT directly against SQLite
  sql_query:(args={})=>_sql(args.sql||'SELECT 1',args.params||[]),
};


export { TOOL_LIBRARY, buildSchemaQuery, schemaToTools, DOMAIN_PATTERNS, classifyQuery, execTool, extractFacts, buildToolSummary, quickNavFastPath };

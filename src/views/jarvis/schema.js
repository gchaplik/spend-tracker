// Schema constants for Jarvis AI — view definitions, measure types, response shapes
const MEASURE_TYPES=[
  {v:"count",    l:"count",    color:"#8b5cf6"},
  {v:"sum",      l:"sum",      color:"#0284C7"},
  {v:"subtract", l:"subtract", color:"#ef4444"},
  {v:"multiply", l:"multiply", color:"#f59e0b"},
  {v:"divide",   l:"divide",   color:"#06b6d4"},
  {v:"average",  l:"average",  color:"#059669"},
];
const DIM_TYPES=["string","number","date","boolean","currency"];

// ── JSON-Schema response shapes reused across measures ─────────────────────────
const RS_SCALAR={type:"object",properties:{value:{type:"number"},count:{type:"integer"}},required:["value"]};
const RS_ROWS  ={type:"array", items:{type:"object",properties:{name:{type:"string"},value:{type:"number"},count:{type:"integer"}},required:["name","value"]}};

const DEFAULT_SCHEMA={views:{

  // ── expenses ── transactions WHERE type='expense' UNION ALL vacation_txns ─────
  expenses:{
    label:"Expenses",
    description:"All spending — regular transactions + vacation purchases",
    table:"transactions",
    baseSQL:"SELECT amount,date,COALESCE(category,'Other') as category,COALESCE(merchant,'?') as merchant,COALESCE(note,'') as note FROM transactions WHERE type='expense'",
    joins:[
      {type:"UNION ALL",label:"Vacation Transactions",table:"vacation_txns",
       sql:"SELECT amount,date,COALESCE(category,'Vacation') as category,COALESCE(merchant,'?') as merchant,'' as note FROM vacation_txns"}
    ],
    defaultDateField:"date",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["total","count","avg"],default:"total",description:"Aggregation to apply"},
        filter: {type:"string",description:"Date range: thismonth | lastmonth | thisyear | last30days | last3months | month=YYYY-MM | year=YYYY"},
        groupBy:{type:"string",enum:["category","merchant","month"],description:"Dimension to group results by"},
        limit:  {type:"integer",description:"Max rows when grouping (default 20)"}
      }
    },
    dimensions:{
      date:    {type:"date",   label:"Date",     field:"date",     sql:"${TABLE}.date"},
      month:   {type:"string", label:"Month",    field:"date",     sql:"strftime('%Y-%m',${TABLE}.date)"},
      category:{type:"string", label:"Category", field:"category", sql:"COALESCE(${TABLE}.category,'Other')"},
      merchant:{type:"string", label:"Merchant", field:"merchant", sql:"COALESCE(${TABLE}.merchant,'?')"},
    },
    measures:{
      total:{type:"sum",    label:"Total Spent",  description:"Sum of all expense amounts including vacation spending", sql:"ROUND(SUM(${TABLE}.amount),2)", responseSchema:RS_SCALAR},
      count:{type:"count",  label:"Count",        description:"Number of expense transactions",                         sql:"COUNT(*)",                       responseSchema:RS_SCALAR},
      avg:  {type:"average",label:"Average",      description:"Average expense amount per transaction",                 sql:"ROUND(AVG(${TABLE}.amount),2)", responseSchema:RS_SCALAR},
    }
  },

  // ── income ── transactions WHERE type='income' ────────────────────────────────
  income:{
    label:"Income",
    description:"All income transactions",
    table:"transactions",
    baseSQL:"SELECT amount,date,COALESCE(category,'Income') as category,COALESCE(merchant,source,'?') as merchant,COALESCE(note,'') as note FROM transactions WHERE type='income'",
    joins:[],
    defaultDateField:"date",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["total","count"],default:"total",description:"Aggregation to apply"},
        filter: {type:"string",description:"Date range: thismonth | lastmonth | thisyear | last30days | month=YYYY-MM | year=YYYY"},
        groupBy:{type:"string",enum:["source","month"],description:"Dimension to group results by"},
        limit:  {type:"integer",description:"Max rows when grouping"}
      }
    },
    dimensions:{
      date:  {type:"date",   label:"Date",   field:"date",     sql:"${TABLE}.date"},
      month: {type:"string", label:"Month",  field:"date",     sql:"strftime('%Y-%m',${TABLE}.date)"},
      source:{type:"string", label:"Source", field:"merchant", sql:"COALESCE(${TABLE}.merchant,'?')"},
    },
    measures:{
      total:{type:"sum",  label:"Total Income", description:"Sum of all income amounts", sql:"ROUND(SUM(${TABLE}.amount),2)", responseSchema:RS_SCALAR},
      count:{type:"count",label:"Count",        description:"Number of income transactions", sql:"COUNT(*)",                  responseSchema:RS_SCALAR},
    }
  },

  // ── transactions (all) ────────────────────────────────────────────────────────
  transactions:{
    label:"Transactions",description:"All income and expense transactions",source:"txns",table:"transactions",
    joins:[],
    defaultDateField:"date",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total_expenses","total_income","net_position","avg_expense","spend_x_income"],default:"count"},
        filter: {type:"string",description:"Date filter"},
        groupBy:{type:"string",enum:["category","merchant","month","type"]}
      }
    },
    dimensions:{
      date:    {type:"date",   label:"Date",     description:"Date the transaction occurred",   field:"date",    sql:"${TABLE}.date"},
      month:   {type:"string", label:"Month",    description:"Year-month of the transaction",   field:"date",    sql:"strftime('%Y-%m', ${TABLE}.date)"},
      amount:  {type:"currency",label:"Amount",  description:"Transaction amount in CAD",       field:"amount",  sql:"${TABLE}.amount"},
      category:{type:"string", label:"Category", description:"Spending / income category",      field:"category",sql:"${TABLE}.category"},
      type:    {type:"string", label:"Type",     description:"'income' or 'expense'",           field:"type",    sql:"${TABLE}.type"},
      merchant:{type:"string", label:"Merchant", description:"Merchant name or income source",  field:"merchant",sql:"${TABLE}.merchant"},
      note:    {type:"string", label:"Note",     description:"Optional transaction note",       field:"note",    sql:"${TABLE}.note"},
    },
    measures:{
      count:          {type:"count",   label:"Count",         description:"Total number of transactions",             sql:"COUNT(*)",                                                                                                                                                                 responseSchema:RS_SCALAR},
      total_expenses: {type:"sum",     label:"Total Expenses",description:"Sum of all expense amounts",               sql:"SUM(CASE WHEN ${TABLE}.type='expense' THEN ${TABLE}.amount ELSE 0 END)",                                                                                               responseSchema:RS_SCALAR},
      total_income:   {type:"sum",     label:"Total Income",  description:"Sum of all income amounts",                sql:"SUM(CASE WHEN ${TABLE}.type='income' THEN ${TABLE}.amount ELSE 0 END)",                                                                                                responseSchema:RS_SCALAR},
      net_position:   {type:"subtract",label:"Net Position",  description:"Total income minus total expenses",        sql:"SUM(CASE WHEN ${TABLE}.type='income' THEN ${TABLE}.amount ELSE -${TABLE}.amount END)",                                                                                 responseSchema:RS_SCALAR},
      avg_expense:    {type:"divide",  label:"Avg Expense",   description:"Average expense amount per transaction",   sql:"AVG(CASE WHEN ${TABLE}.type='expense' THEN ${TABLE}.amount ELSE NULL END)",                                                                                            responseSchema:RS_SCALAR},
      spend_x_income: {type:"multiply",label:"Expense Ratio", description:"Total expenses ÷ total income × 100 (%)", sql:"ROUND(SUM(CASE WHEN ${TABLE}.type='expense' THEN ${TABLE}.amount ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${TABLE}.type='income' THEN ${TABLE}.amount ELSE 0 END),0),1)",responseSchema:RS_SCALAR},
    }
  },

  // ── bills ─────────────────────────────────────────────────────────────────────
  bills:{
    label:"Bills",description:"Recurring monthly bills and subscriptions",source:"bills",table:"bills",
    joins:[],
    defaultDateField:null,
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total_monthly","total_yearly","avg_bill"],default:"total_monthly"},
        groupBy:{type:"string",enum:["name","category"]}
      }
    },
    dimensions:{
      name:    {type:"string", label:"Name",     description:"Bill name (e.g. Rent, Netflix)",         field:"name",    sql:"${TABLE}.name"},
      amount:  {type:"currency",label:"Amount",  description:"Monthly bill amount in CAD",             field:"amount",  sql:"${TABLE}.amount"},
      category:{type:"string", label:"Category", description:"Bill category",                          field:"category",sql:"${TABLE}.category"},
      due_day: {type:"number", label:"Due Day",  description:"Day of month the bill is due (1–31)",    field:"dueDay",  sql:"${TABLE}.dueDay"},
      active:  {type:"boolean",label:"Active",   description:"Whether the bill is currently active",   field:"active",  sql:"${TABLE}.active"},
    },
    measures:{
      count:         {type:"count",   label:"Active Count",  description:"Number of active bills",                    sql:"COUNT(*) FILTER (WHERE ${TABLE}.active=1)",                              responseSchema:RS_SCALAR},
      total_monthly: {type:"sum",     label:"Total Monthly", description:"Sum of all active monthly bill amounts",    sql:"SUM(CASE WHEN ${TABLE}.active=1 THEN ${TABLE}.amount ELSE 0 END)",       responseSchema:RS_SCALAR},
      total_yearly:  {type:"multiply",label:"Total Yearly",  description:"Monthly total × 12 — annual bill cost",    sql:"SUM(CASE WHEN ${TABLE}.active=1 THEN ${TABLE}.amount ELSE 0 END)*12",    responseSchema:RS_SCALAR},
      avg_bill:      {type:"divide",  label:"Avg Bill",      description:"Average monthly bill amount",              sql:"AVG(CASE WHEN ${TABLE}.active=1 THEN ${TABLE}.amount ELSE NULL END)",     responseSchema:RS_SCALAR},
    }
  },

  // ── expected_income ───────────────────────────────────────────────────────────
  expected_income:{
    label:"Expected Income",description:"Scheduled and recurring expected income payments",source:"expected",table:"expected_income",
    joins:[],
    defaultDateField:"expectedDate",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count_pending","total_pending","total_confirmed","confirmation_rate"],default:"total_pending"},
        filter: {type:"string",description:"Date filter applied to expectedDate"},
        groupBy:{type:"string",enum:["source","month","confirmed"]}
      }
    },
    dimensions:{
      source:       {type:"string", label:"Source",       description:"Income source / payer name",                     field:"source",      sql:"${TABLE}.source"},
      amount:       {type:"currency",label:"Amount",      description:"Expected payment amount in CAD",                 field:"amount",      sql:"${TABLE}.amount"},
      expected_date:{type:"date",   label:"Expected Date",description:"When the payment is expected",                   field:"expectedDate",sql:"${TABLE}.expectedDate"},
      month:        {type:"string", label:"Month",        description:"Year-month the payment is expected",             field:"expectedDate",sql:"strftime('%Y-%m', ${TABLE}.expectedDate)"},
      confirmed:    {type:"boolean",label:"Confirmed",    description:"Whether the payment has been received",          field:"confirmed",   sql:"${TABLE}.confirmed"},
      cadence:      {type:"string", label:"Cadence",      description:"Recurrence frequency",                          field:"cadence",     sql:"${TABLE}.cadence"},
    },
    measures:{
      count_pending:    {type:"count",  label:"Pending Count",   description:"Number of unconfirmed upcoming payments",  sql:"COUNT(*) FILTER (WHERE ${TABLE}.confirmed=0)",                         responseSchema:RS_SCALAR},
      total_pending:    {type:"sum",    label:"Total Pending",   description:"Sum of all unconfirmed expected amounts",  sql:"SUM(CASE WHEN ${TABLE}.confirmed=0 THEN ${TABLE}.amount ELSE 0 END)",  responseSchema:RS_SCALAR},
      total_confirmed:  {type:"sum",    label:"Total Confirmed", description:"Sum of all confirmed received payments",   sql:"SUM(CASE WHEN ${TABLE}.confirmed=1 THEN ${TABLE}.amount ELSE 0 END)",  responseSchema:RS_SCALAR},
      confirmation_rate:{type:"divide", label:"Confirmation %",  description:"% of payments confirmed",                 sql:"ROUND(SUM(${TABLE}.confirmed)*100.0/NULLIF(COUNT(*),0),1)",             responseSchema:RS_SCALAR},
    }
  },

  // ── goals ─────────────────────────────────────────────────────────────────────
  goals:{
    label:"Goals",description:"Financial savings goals and progress",source:"goals",table:"goals",
    joins:[],
    defaultDateField:"deadline",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total_target","total_saved","total_remaining","avg_progress"],default:"avg_progress"},
        groupBy:{type:"string",enum:["name"]}
      }
    },
    dimensions:{
      name:          {type:"string", label:"Name",           description:"Goal name",                                   field:"name",          sql:"${TABLE}.name"},
      target_amount: {type:"currency",label:"Target Amount", description:"Goal target amount in CAD",                   field:"targetAmount",  sql:"${TABLE}.targetAmount"},
      current_amount:{type:"currency",label:"Current Amount",description:"Amount saved so far in CAD",                  field:"currentAmount", sql:"${TABLE}.currentAmount"},
      deadline:      {type:"date",   label:"Deadline",       description:"Target completion date",                      field:"deadline",      sql:"${TABLE}.deadline"},
      progress_pct:  {type:"number", label:"Progress %",     description:"Completion % — currentAmount/targetAmount×100",field:"currentAmount", sql:"ROUND(${TABLE}.currentAmount*100.0/NULLIF(${TABLE}.targetAmount,0),1)"},
    },
    measures:{
      count:           {type:"count",   label:"Count",           description:"Total number of goals",                   sql:"COUNT(*)",                                                                       responseSchema:RS_SCALAR},
      total_target:    {type:"sum",     label:"Total Target",    description:"Sum of all goal target amounts",          sql:"SUM(${TABLE}.targetAmount)",                                                     responseSchema:RS_SCALAR},
      total_saved:     {type:"sum",     label:"Total Saved",     description:"Sum of all current amounts saved",        sql:"SUM(${TABLE}.currentAmount)",                                                    responseSchema:RS_SCALAR},
      total_remaining: {type:"subtract",label:"Total Remaining", description:"Total still needed to reach all goals",  sql:"SUM(${TABLE}.targetAmount-${TABLE}.currentAmount)",                              responseSchema:RS_SCALAR},
      avg_progress:    {type:"divide",  label:"Avg Progress %",  description:"Average completion % across all goals",  sql:"ROUND(AVG(${TABLE}.currentAmount*100.0/NULLIF(${TABLE}.targetAmount,0)),1)",     responseSchema:RS_SCALAR},
    }
  },

  // ── accounts ──────────────────────────────────────────────────────────────────
  accounts:{
    label:"Accounts",description:"Bank and financial accounts",source:"accounts",table:"accounts",
    joins:[],
    defaultDateField:null,
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total_assets","total_liabilities","net_worth"],default:"net_worth"},
        groupBy:{type:"string",enum:["name","type"]}
      }
    },
    dimensions:{
      name:   {type:"string", label:"Name",    description:"Account name (e.g. TD Chequing, Visa)",    field:"name",   sql:"${TABLE}.name"},
      type:   {type:"string", label:"Type",    description:"chequing, savings, credit_card, loan, etc",field:"type",   sql:"${TABLE}.type"},
      balance:{type:"currency",label:"Balance",description:"Current balance in CAD",                   field:"balance",sql:"${TABLE}.balance"},
    },
    measures:{
      count:             {type:"count",   label:"Count",             description:"Total number of accounts",              sql:"COUNT(*)",                                                                                                                                                                                                                                       responseSchema:RS_SCALAR},
      total_assets:      {type:"sum",     label:"Total Assets",      description:"Sum of asset account balances",         sql:"SUM(CASE WHEN ${TABLE}.type IN ('chequing','savings','investment','property','other_asset') THEN ${TABLE}.balance ELSE 0 END)",                                                                                                                 responseSchema:RS_SCALAR},
      total_liabilities: {type:"sum",     label:"Total Liabilities", description:"Sum of liability balances",             sql:"SUM(CASE WHEN ${TABLE}.type IN ('credit_card','loan','mortgage','other_liability') THEN ${TABLE}.balance ELSE 0 END)",                                                                                                                         responseSchema:RS_SCALAR},
      net_worth:         {type:"subtract",label:"Net Worth",         description:"Total assets minus total liabilities",  sql:"SUM(CASE WHEN ${TABLE}.type IN ('chequing','savings','investment','property','other_asset') THEN ${TABLE}.balance WHEN ${TABLE}.type IN ('credit_card','loan','mortgage','other_liability') THEN -${TABLE}.balance ELSE 0 END)",               responseSchema:RS_SCALAR},
    }
  },

  // ── holdings ──────────────────────────────────────────────────────────────────
  holdings:{
    label:"Stock Holdings",description:"Investment portfolio — stock holdings and cost basis",source:"holdings",table:"holdings",
    joins:[],
    defaultDateField:null,
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total_cost","total_shares"],default:"total_cost"},
        groupBy:{type:"string",enum:["ticker"]}
      }
    },
    dimensions:{
      ticker:    {type:"string", label:"Ticker",     description:"Stock ticker (e.g. TSLA, XEQT.TO)",            field:"ticker",   sql:"${TABLE}.ticker"},
      shares:    {type:"number", label:"Shares",     description:"Number of shares held",                        field:"shares",   sql:"${TABLE}.shares"},
      cost_basis:{type:"currency",label:"Cost Basis",description:"Weighted average purchase price per share",    field:"costBasis",sql:"${TABLE}.costBasis"},
      total_cost:{type:"currency",label:"Total Cost",description:"Cost basis × shares for this holding",         field:"costBasis",sql:"${TABLE}.costBasis * ${TABLE}.shares"},
    },
    measures:{
      count:        {type:"count",label:"Holdings Count",description:"Number of distinct stock holdings",           sql:"COUNT(*)",                                      responseSchema:RS_SCALAR},
      total_cost:   {type:"sum",  label:"Total Cost",    description:"Sum of cost basis × shares for all holdings", sql:"SUM(${TABLE}.costBasis * ${TABLE}.shares)",     responseSchema:RS_SCALAR},
      total_shares: {type:"sum",  label:"Total Shares",  description:"Total share count across all holdings",      sql:"SUM(${TABLE}.shares)",                          responseSchema:RS_SCALAR},
    }
  },

  // ── vacations ─────────────────────────────────────────────────────────────────
  vacations:{
    label:"Vacations",description:"Vacation budgets and date ranges",source:"vacations",table:"vacations",
    joins:[
      {type:"LEFT JOIN",label:"Vacation Transactions",table:"vacation_txns",
       sql:"LEFT JOIN vacation_txns vt ON vt.vacationId=${TABLE}.id"}
    ],
    defaultDateField:"startDate",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total_budget","total_spent","total_remaining"],default:"total_spent"},
        groupBy:{type:"string",enum:["name"]}
      }
    },
    dimensions:{
      name:      {type:"string", label:"Name",       description:"Vacation name (e.g. Paris 2026)",  field:"name",      sql:"${TABLE}.name"},
      start_date:{type:"date",   label:"Start Date", description:"Vacation start date",              field:"startDate", sql:"${TABLE}.startDate"},
      end_date:  {type:"date",   label:"End Date",   description:"Vacation end date",                field:"endDate",   sql:"${TABLE}.endDate"},
      budget:    {type:"currency",label:"Budget",    description:"Total budget in CAD",              field:"budget",    sql:"${TABLE}.budget"},
      notes:     {type:"string", label:"Notes",      description:"Optional notes",                   field:"notes",     sql:"${TABLE}.notes"},
    },
    measures:{
      count:          {type:"count",   label:"Count",           description:"Total number of vacations",              sql:"COUNT(DISTINCT ${TABLE}.id)",                                                                    responseSchema:RS_SCALAR},
      total_budget:   {type:"sum",     label:"Total Budget",    description:"Sum of all vacation budgets",            sql:"SUM(DISTINCT ${TABLE}.budget)",                                                                  responseSchema:RS_SCALAR},
      total_spent:    {type:"sum",     label:"Total Spent",     description:"Sum of all vacation transaction amounts",sql:"(SELECT COALESCE(SUM(vt2.amount),0) FROM vacation_txns vt2)",                                    responseSchema:RS_SCALAR},
      total_remaining:{type:"subtract",label:"Total Remaining", description:"Total budgets minus total spending",    sql:"SUM(DISTINCT ${TABLE}.budget)-(SELECT COALESCE(SUM(vt2.amount),0) FROM vacation_txns vt2)",       responseSchema:RS_SCALAR},
    }
  },

  // ── vacation_txns ─────────────────────────────────────────────────────────────
  vacation_txns:{
    label:"Vacation Transactions",description:"Individual spending entries recorded against a vacation",source:"vacationTxns",table:"vacation_txns",
    joins:[],
    defaultDateField:"date",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total","avg_txn"],default:"total"},
        filter: {type:"string",description:"Date filter applied to transaction date"},
        groupBy:{type:"string",enum:["category","merchant","month"]}
      }
    },
    dimensions:{
      vacation_id:{type:"string", label:"Vacation ID",description:"ID of the parent vacation",                     field:"vacationId",sql:"${TABLE}.vacationId"},
      date:       {type:"date",   label:"Date",        description:"Date the vacation expense occurred",           field:"date",      sql:"${TABLE}.date"},
      month:      {type:"string", label:"Month",       description:"Year-month of the expense",                    field:"date",      sql:"strftime('%Y-%m', ${TABLE}.date)"},
      amount:     {type:"currency",label:"Amount",     description:"Expense amount in CAD",                        field:"amount",    sql:"${TABLE}.amount"},
      category:   {type:"string", label:"Category",   description:"Spending category",                            field:"category",  sql:"${TABLE}.category"},
      merchant:   {type:"string", label:"Merchant",   description:"Merchant or vendor name",                      field:"merchant",  sql:"${TABLE}.merchant"},
      note:       {type:"string", label:"Note",       description:"Optional note",                                field:"note",      sql:"${TABLE}.note"},
    },
    measures:{
      count:  {type:"count", label:"Count",       description:"Total vacation transactions",                        sql:"COUNT(*)",              responseSchema:RS_SCALAR},
      total:  {type:"sum",   label:"Total Spent", description:"Total amount spent across all vacation transactions", sql:"SUM(${TABLE}.amount)",  responseSchema:RS_SCALAR},
      avg_txn:{type:"divide",label:"Avg per Txn", description:"Average vacation transaction amount",               sql:"AVG(${TABLE}.amount)",  responseSchema:RS_SCALAR},
    }
  },

  // ── bill_payments ─────────────────────────────────────────────────────────────
  bill_payments:{
    label:"Bill Payments",description:"History of bills marked as paid each month",source:"billPayments",table:"bill_payments",
    joins:[],
    defaultDateField:"paidDate",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total_paid","avg_payment"],default:"total_paid"},
        filter: {type:"string",description:"Date filter applied to paidDate"},
        groupBy:{type:"string",enum:["month","bill_id"]}
      }
    },
    dimensions:{
      bill_id:  {type:"string", label:"Bill ID",   description:"ID of the parent bill",                            field:"billId",  sql:"${TABLE}.billId"},
      month:    {type:"string", label:"Month",     description:"Month the bill was paid (YYYY-MM)",                field:"month",   sql:"${TABLE}.month"},
      amount:   {type:"currency",label:"Amount",   description:"Amount paid",                                     field:"amount",  sql:"${TABLE}.amount"},
      paid_date:{type:"date",   label:"Paid Date", description:"Date the payment was recorded",                   field:"paidDate",sql:"${TABLE}.paidDate"},
      note:     {type:"string", label:"Note",      description:"Optional payment note",                           field:"note",    sql:"${TABLE}.note"},
    },
    measures:{
      count:      {type:"count", label:"Payment Count",description:"Total bill payment records",    sql:"COUNT(*)",             responseSchema:RS_SCALAR},
      total_paid: {type:"sum",   label:"Total Paid",   description:"Sum of all recorded payments", sql:"SUM(${TABLE}.amount)", responseSchema:RS_SCALAR},
      avg_payment:{type:"divide",label:"Avg Payment",  description:"Average bill payment amount",  sql:"AVG(${TABLE}.amount)", responseSchema:RS_SCALAR},
    }
  },

  // ── account_history ───────────────────────────────────────────────────────────
  account_history:{
    label:"Account History",description:"Point-in-time account balance snapshots",source:"accountHistory",table:"account_history",
    joins:[],
    defaultDateField:"date",
    toolSchema:{
      type:"object",
      properties:{
        measure:{type:"string",enum:["count","total_balance","latest_total"],default:"latest_total"},
        filter: {type:"string",description:"Date filter applied to snapshot date"},
        groupBy:{type:"string",enum:["month","account_id"]}
      }
    },
    dimensions:{
      date:      {type:"date",   label:"Date",       description:"Date the balance snapshot was recorded",         field:"date",     sql:"${TABLE}.date"},
      month:     {type:"string", label:"Month",      description:"Year-month of the snapshot",                    field:"date",     sql:"strftime('%Y-%m', ${TABLE}.date)"},
      balance:   {type:"currency",label:"Balance",   description:"Account balance at the snapshot date in CAD",   field:"balance",  sql:"${TABLE}.balance"},
      account_id:{type:"string", label:"Account ID", description:"ID of the account this snapshot belongs to",   field:"accountId",sql:"${TABLE}.accountId"},
      note:      {type:"string", label:"Note",       description:"Optional note about this balance entry",        field:"note",     sql:"${TABLE}.note"},
    },
    measures:{
      count:        {type:"count",label:"Snapshots",       description:"Total number of balance snapshots",          sql:"COUNT(*)",           responseSchema:RS_SCALAR},
      total_balance:{type:"sum",  label:"Total Balance",   description:"Sum of all balance values in the table",     sql:"SUM(${TABLE}.balance)", responseSchema:RS_SCALAR},
      latest_total: {type:"sum",  label:"Latest Snapshot", description:"Sum of the most recent balance per account", sql:"SUM(${TABLE}.balance) FILTER (WHERE ${TABLE}.date=(SELECT MAX(ah2.date) FROM account_history ah2 WHERE ah2.accountId=${TABLE}.accountId))", responseSchema:RS_SCALAR},
    }
  }
}};

// DEFAULT_SETTINGS imported from ./constants/index.js


export { MEASURE_TYPES, DIM_TYPES, RS_SCALAR, RS_ROWS, DEFAULT_SCHEMA };

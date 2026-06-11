import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell, ReferenceLine, PieChart, Pie, AreaChart, Area } from "recharts";
import { T, IS, CA, Fld, Btn } from "../../theme/tokens.jsx";
import { DEFAULT_CATS, COLORS, CADENCES, NAV_ITEMS, DEFAULT_SETTINGS } from "../../constants/index.js";
import { fmt, fmtUSD, today, uid, toB64, cLabel, isPdf, fpHash } from "../../utils/formatters.js";
import { buildDates, _df, _label, _sqlDf } from "../../utils/dateUtils.js";
import { fetchData as loadServerData, patchData as saveServerData } from "../../api/client.js";
import { getCatIcon, ICON_SET, ICON_BY_KEY, ICON_GROUPS, ICON_KEYWORDS } from "../../icons/index.jsx";
import { nfmt, useNfmt, DiscreteModeCtx, DiscreteModeBlockedCard } from "../../utils/discrete.jsx";
import { fetchUsdCad } from "../../utils/fx.js";

const DATA_POINTS = [
  // ── Transactions ────────────────────────────────────────────────────────────
  {entity:"Transaction",field:"amount",         desc:"Expense or income amount",                           tools:["expenses","income","net","categories","monthly","merchants"]},
  {entity:"Transaction",field:"date",           desc:"Transaction date",                                   tools:["expenses","income","daily_spend","weekly_spend","spending_trend","income_trend","net_trend"]},
  {entity:"Transaction",field:"type",           desc:"'expense' or 'income'",                              tools:["expenses","income","net"]},
  {entity:"Transaction",field:"category",       desc:"Spending category",                                  tools:["categories","top_category","txns_by_category","budget_vs_actual","budget_proximity","expense_share"]},
  {entity:"Transaction",field:"merchant/source",desc:"Who was paid / income source",                       tools:["merchants","txns_by_merchant","income_by_source","vacation_merchants"]},
  {entity:"Transaction",field:"note/memo",      desc:"Free-text note on a transaction",                    tools:["txns_search","txns_with_notes"]},
  {entity:"Transaction",field:"taxDeductible",  desc:"Flagged as tax-deductible",                          tools:["tax_deductible","tax_summary","rrsp_contributions","tax_year_comparison"]},
  {entity:"Transaction",field:"originalAmountUSD",desc:"Original USD amount before conversion",            tools:["usd_txns"]},
  {entity:"Transaction",field:"fxRate",         desc:"CAD/USD exchange rate applied",                      tools:["usd_txns"]},
  {entity:"Transaction",field:"cadence/groupId",desc:"Recurring group membership",                         tools:["recurring_txns"]},
  {entity:"Transaction",field:"vacationId",     desc:"Linked vacation",                                    tools:["vacation_txns","vacation_biggest_txn","vacation_merchants"]},
  // ── Categories & Budgets ────────────────────────────────────────────────────
  {entity:"Category",   field:"name",           desc:"Category name string",                               tools:["categories","budgets","budget_vs_actual","budget_proximity","budget_remaining","over_budget","expense_share"]},
  {entity:"CatBudget",  field:"budget",         desc:"Monthly spending cap per category",                  tools:["budgets","budget_vs_actual","budget_proximity","budget_remaining","over_budget","budget_utilization"]},
  // ── Bills ───────────────────────────────────────────────────────────────────
  {entity:"Bill",       field:"name/amount",    desc:"Recurring bill name and value",                      tools:["bills","bills_due","bills_paid","bills_total","cashflow_projection"]},
  {entity:"Bill",       field:"dueDay",         desc:"Day of month the bill is due",                       tools:["bills_due","bills_overdue"]},
  {entity:"Bill",       field:"active",         desc:"Whether bill is currently active",                   tools:["bills","bills_total"]},
  {entity:"Bill",       field:"category",       desc:"Category assigned to the bill",                      tools:["bills"]},
  {entity:"BillPayment",field:"paidDate/month", desc:"When and for which month a bill was paid",           tools:["bills_paid","bill_history"]},
  {entity:"Bill",       field:"overdue",        desc:"Bills past due date and unpaid",                     tools:["bills_overdue"]},
  // ── Expected Income ─────────────────────────────────────────────────────────
  {entity:"ExpectedIncome",field:"source/amount",desc:"Future income entry",                               tools:["pending_income","all_expected_income","expected_income_recurring","expected_income_by_source","cashflow_projection"]},
  {entity:"ExpectedIncome",field:"cadence",    desc:"Recurrence pattern",                                  tools:["expected_income_recurring","recurring_income"]},
  {entity:"ExpectedIncome",field:"confirmed",  desc:"Whether income has been received",                    tools:["confirmed_income","expected_income_total_pending"]},
  {entity:"ExpectedIncome",field:"expectedDate",desc:"Scheduled receipt date",                             tools:["pending_income","cashflow_projection"]},
  // ── Goals ───────────────────────────────────────────────────────────────────
  {entity:"Goal",       field:"name/target",    desc:"Goal name and target amount",                        tools:["goals_progress","goal_detail","goals_on_track"]},
  {entity:"Goal",       field:"currentAmount",  desc:"Amount saved toward goal",                           tools:["goals_progress","goal_detail","goal_timeline"]},
  {entity:"Goal",       field:"monthlyTarget",  desc:"Monthly savings target",                             tools:["goals_progress","goal_timeline","goals_on_track"]},
  {entity:"Goal",       field:"deadline",       desc:"Target completion date",                             tools:["goal_timeline","goals_on_track"]},
  // ── Net Worth / Accounts ────────────────────────────────────────────────────
  {entity:"Account",    field:"balance/type",   desc:"Account balance and type (chequing/savings/etc)",   tools:["accounts_list","accounts_by_type","net_worth","runway","wishlist_affordable"]},
  {entity:"AccountHistory",field:"balance/date",desc:"Historical balance snapshots per account",           tools:["balance_history","net_worth_trend","net_worth_change"]},
  // ── Debts ───────────────────────────────────────────────────────────────────
  {entity:"Debt",       field:"balance/rate",   desc:"Outstanding debt and interest rate",                 tools:["debt_summary","debt_total","debt_by_type","debt_interest_cost"]},
  {entity:"Debt",       field:"type",           desc:"Debt type (credit/mortgage/loan)",                   tools:["debt_by_type"]},
  // ── Subscriptions ───────────────────────────────────────────────────────────
  {entity:"Subscription",field:"amount/cycle", desc:"Subscription cost and billing cycle",                 tools:["subscription_list","subscription_total","subscriptions_by_category"]},
  {entity:"Subscription",field:"category",     desc:"Category assigned to subscription",                   tools:["subscriptions_by_category"]},
  // ── Vacations ───────────────────────────────────────────────────────────────
  {entity:"Vacation",   field:"name/budget",    desc:"Vacation name and budget",                           tools:["vacations","vacation_spending","vacations_by_year"]},
  {entity:"VacationTxn",field:"amount/merchant",desc:"Individual purchases on a vacation",                 tools:["vacation_txns","vacation_biggest_txn","vacation_merchants"]},
  // ── Holdings / Stocks ───────────────────────────────────────────────────────
  {entity:"Holding",    field:"ticker/shares",  desc:"Stock or ETF position",                              tools:["portfolio","holdings_detail","holding"]},
  {entity:"Holding",    field:"gain/loss",      desc:"Unrealized P&L on holding",                          tools:["portfolio_gain"]},
  // ── Wishlist ────────────────────────────────────────────────────────────────
  {entity:"WishlistItem",field:"name/price",   desc:"Desired purchase with price",                         tools:["wishlist","wishlist_affordable","wishlist_total"]},
  // ── Tax ─────────────────────────────────────────────────────────────────────
  {entity:"TaxRecord",  field:"deductible txns",desc:"Transactions tagged tax-deductible",                 tools:["tax_deductible","tax_summary","rrsp_contributions"]},
  // ── Household ───────────────────────────────────────────────────────────────
  {entity:"Member",     field:"name",           desc:"Household member name",                              tools:["household_members","household_balances"]},
  {entity:"Split",      field:"amounts/member", desc:"Expense split allocation",                           tools:["household_balances"]},
  {entity:"Settlement", field:"from/to/amount", desc:"Recorded settlement payment",                        tools:["household_settlements"]},
  // ── Derived / Calculated ────────────────────────────────────────────────────
  {entity:"Calc",       field:"spending trend", desc:"Month-over-month spend direction",                   tools:["spending_trend"]},
  {entity:"Calc",       field:"income trend",   desc:"Month-over-month income direction",                  tools:["income_trend"]},
  {entity:"Calc",       field:"net trend",      desc:"Net income minus expenses over time",                tools:["net_trend"]},
  {entity:"Calc",       field:"savings rate",   desc:"% of income saved",                                  tools:["savings_rate"]},
  {entity:"Calc",       field:"budget utilization",desc:"% of total budget consumed",                      tools:["budget_utilization"]},
  {entity:"Calc",       field:"spending anomalies",desc:"Transactions unusually large vs category avg",    tools:["spending_anomalies"]},
  {entity:"Calc",       field:"health score",   desc:"Composite financial health score 0-100",             tools:["health_score"]},
  {entity:"Calc",       field:"cashflow forecast",desc:"Projected 30/60/90-day balance",                   tools:["cashflow_projection"]},
  {entity:"Calc",       field:"avg daily spend",desc:"Average spending per day",                           tools:["avg_daily_spend"]},
  {entity:"Calc",       field:"avg monthly spend",desc:"Average monthly spend over rolling window",        tools:["avg_monthly_spend"]},
  {entity:"Calc",       field:"avg monthly income",desc:"Average monthly income",                          tools:["avg_monthly_income"]},
  {entity:"Calc",       field:"runway",         desc:"Months of expenses current cash can cover",          tools:["runway"]},
  {entity:"Calc",       field:"biggest month",  desc:"Which month had highest spend/income",               tools:["biggest_month"]},
  {entity:"Calc",       field:"net worth trend",desc:"Net worth change over time",                         tools:["net_worth_trend","net_worth_change"]},
  {entity:"Calc",       field:"goal timeline",  desc:"Months until a goal is reached",                     tools:["goal_timeline"]},
  {entity:"Calc",       field:"debt interest cost",desc:"Estimated annual interest cost per debt",         tools:["debt_interest_cost"]},
  {entity:"Calc",       field:"tax year comparison",desc:"Compare deductible totals between years",        tools:["tax_year_comparison"]},
  {entity:"Calc",       field:"portfolio by currency",desc:"CAD vs USD asset split",                       tools:["portfolio_by_currency"]},
  {entity:"Calc",       field:"debt payoff timeline",desc:"Months to pay off a debt at current rate",      tools:["debt_payoff_timeline"]},
  {entity:"Calc",       field:"break-even month",desc:"Month when income will cover fixed costs",          tools:["breakeven"]},
];

function ToolCoveragePanel(){
  const [filter,setFilter]=useState("all");
  const [search,setSearch]=useState("");
  const allTools=[...new Set(DATA_POINTS.flatMap(p=>p.tools))].sort();
  const covered=DATA_POINTS.filter(p=>p.tools.length>0);
  const gaps=DATA_POINTS.filter(p=>p.tools.length===0);
  const coveragePct=Math.round(covered.length*100/DATA_POINTS.length);
  const filtered=DATA_POINTS.filter(p=>{
    if(filter==="gaps"&&p.tools.length>0)return false;
    if(filter==="covered"&&p.tools.length===0)return false;
    if(search){const q=search.toLowerCase();return(p.entity+p.field+p.desc+p.tools.join(" ")).toLowerCase().includes(q);}
    return true;
  });
  // group by entity
  const byEntity={};
  filtered.forEach(p=>{(byEntity[p.entity]=byEntity[p.entity]||[]).push(p);});
  const entityColors={Transaction:T.accent,Category:"#059669",Bill:"#d97706",ExpectedIncome:"#8b5cf6",Goal:"#ec4899",Account:"#06b6d4",AccountHistory:"#0891b2",Debt:"#dc2626",Subscription:"#f97316",Vacation:"#10b981",Holding:"#6366f1",WishlistItem:"#84cc16",TaxRecord:"#a16207",Member:"#7c3aed",Split:"#2563eb",Settlement:"#db2777",Calc:T.tx3};
  return(
    <div style={{padding:"24px 28px",maxWidth:1000}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:18,fontWeight:600,color:T.tx1,marginBottom:4}}>Tool Coverage</div>
        <div style={{fontSize:13,color:T.tx2}}>All data points vs available Jarvis tools. Update <code style={{background:T.overlay,padding:"1px 5px",borderRadius:4,fontSize:12}}>DATA_POINTS</code> in SpendTracker.jsx whenever a new data entity or field is added.</div>
      </div>
      {/* Summary bar */}
      <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        {[
          {label:"Total data points",value:DATA_POINTS.length,color:T.tx1,bg:T.overlay},
          {label:"Covered",value:covered.length,color:T.green,bg:T.greenBg},
          {label:"Gaps",value:gaps.length,color:T.red,bg:T.redBg},
          {label:"Coverage",value:coveragePct+"%",color:coveragePct>=80?T.green:coveragePct>=50?T.amber:T.red,bg:coveragePct>=80?T.greenBg:coveragePct>=50?T.amberBg:T.redBg},
          {label:"Unique tools",value:allTools.length,color:T.accent,bg:T.accentBg},
        ].map(s=>(
          <div key={s.label} style={{background:s.bg,borderRadius:T.r,padding:"10px 16px",minWidth:120}}>
            <div style={{fontSize:22,fontWeight:700,color:s.color}}>{s.value}</div>
            <div style={{fontSize:11,color:T.tx2,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>
      {/* Filter + search */}
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
        {["all","covered","gaps"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{padding:"5px 14px",borderRadius:99,border:"none",cursor:"pointer",fontSize:12,fontWeight:500,background:filter===f?T.accent:T.overlay,color:filter===f?"#fff":T.tx2}}>{f==="all"?"All":f==="covered"?"✓ Covered":"✗ Gaps"}</button>
        ))}
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{marginLeft:"auto",border:"1px solid "+T.border,borderRadius:T.r,padding:"5px 10px",fontSize:12,color:T.tx1,background:T.surface,outline:"none",width:180}}/>
      </div>
      {/* Table grouped by entity */}
      {Object.entries(byEntity).map(([entity,points])=>(
        <div key={entity} style={{marginBottom:16,background:T.surface,borderRadius:T.rCard,boxShadow:T.shadow,overflow:"hidden"}}>
          <div style={{padding:"8px 14px",background:T.overlay,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:entityColors[entity]||T.tx3,flexShrink:0}}/>
            <span style={{fontSize:12,fontWeight:600,color:T.tx1}}>{entity}</span>
            <span style={{fontSize:11,color:T.tx3,marginLeft:"auto"}}>{points.filter(p=>p.tools.length>0).length}/{points.length} covered</span>
          </div>
          {points.map((p,i)=>(
            <div key={i} style={{display:"flex",gap:8,padding:"7px 14px",borderTop:i===0?"none":"1px solid "+T.border,alignItems:"flex-start",background:p.tools.length===0?T.redBg:"transparent"}}>
              <div style={{width:16,flexShrink:0,paddingTop:1}}>
                {p.tools.length>0
                  ?<svg width={12} height={12} viewBox="0 0 12 12"><circle cx={6} cy={6} r={5} fill={T.green}/><polyline points="3,6 5,9 9,3" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/></svg>
                  :<svg width={12} height={12} viewBox="0 0 12 12"><circle cx={6} cy={6} r={5} fill={T.red}/><line x1={4} y1={4} x2={8} y2={8} stroke="#fff" strokeWidth={1.5} strokeLinecap="round"/><line x1={8} y1={4} x2={4} y2={8} stroke="#fff" strokeWidth={1.5} strokeLinecap="round"/></svg>
                }
              </div>
              <div style={{flex:"0 0 160px",fontSize:12,fontWeight:500,color:T.tx1}}>{p.field}</div>
              <div style={{flex:1,fontSize:11,color:T.tx2}}>{p.desc}</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end",flex:"0 0 280px"}}>
                {p.tools.length===0
                  ?<span style={{fontSize:10,color:T.red,fontStyle:"italic"}}>No tool coverage</span>
                  :p.tools.map(t=>(
                    <span key={t} style={{fontSize:10,background:T.accentBg,color:T.accent,borderRadius:99,padding:"1px 7px",fontWeight:500,whiteSpace:"nowrap"}}>{t}</span>
                  ))
                }
              </div>
            </div>
          ))}
        </div>
      ))}
      {filtered.length===0&&<div style={{textAlign:"center",color:T.tx3,padding:40}}>No matching data points</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA MODEL COMPONENT  (dev mode only)
// ─────────────────────────────────────────────────────────────────────────────

export { ToolCoveragePanel, DATA_POINTS };

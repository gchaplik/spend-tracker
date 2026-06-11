import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell, ReferenceLine, PieChart, Pie, AreaChart, Area } from "recharts";
import { T, IS, CA, Fld, Btn } from "../theme/tokens.jsx";
import { DEFAULT_CATS, COLORS, CADENCES, NAV_ITEMS, DEFAULT_SETTINGS } from "../constants/index.js";
import { fmt, fmtUSD, today, uid, toB64, cLabel, isPdf, fpHash } from "../utils/formatters.js";
import { buildDates, _df, _label, _sqlDf } from "../utils/dateUtils.js";
import { fetchData as loadServerData, patchData as saveServerData } from "../api/client.js";
import { getCatIcon, ICON_SET, ICON_BY_KEY, ICON_GROUPS, ICON_KEYWORDS } from "../icons/index.jsx";
import { nfmt, useNfmt, DiscreteModeCtx, DiscreteModeBlockedCard } from "../utils/discrete.jsx";
import { fetchUsdCad } from "../utils/fx.js";

// ── Cash Flow Forecast ────────────────────────────────────────────────────────
function CashFlowForecast({txns,bills,billPayments,expected,accounts,settings,catBudgets={},cats=[]}){
  const DAYS=90;
  // Current balance: sum of all accounts
  const startBalance=accounts.reduce((s,a)=>s+(+a.balance||0),0);
  const [threshold,setThreshold]=useState(()=>Math.round(startBalance*0.1/100)*100||500);
  const [extraExpense,setExtraExpense]=useState("");
  const [extraLabel,setExtraLabel]=useState("");

  // Build day-by-day projection
  const projection=useMemo(()=>{
    const today_str=today();
    const days=[];
    let balance=startBalance;

    // ── Daily spend estimate ──────────────────────────────────────────────────
    // Strategy: use 3-month rolling average per category if ≥3 months of data
    // exist for that category; otherwise fall back to the category's budget
    // target. Sum all categories for total monthly spend → divide by 30.
    const expenseTxns=txns.filter(t=>t.type==="expense");

    // Find the earliest month that has any expense data
    const monthsWithData=new Set(expenseTxns.map(t=>t.date.slice(0,7)));
    const sortedMonths=[...monthsWithData].sort();
    const dataMonthCount=sortedMonths.length;

    // Build last-3-months per-category spend map
    const now=new Date();
    const last3Months=[];
    for(let m=1;m<=3;m++){
      const d=new Date(now.getFullYear(),now.getMonth()-m,1);
      last3Months.push(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));
    }

    // Per-category 3-month totals and month counts
    const catMonthTotals={}; // {cat: {ym: total}}
    expenseTxns.filter(t=>last3Months.includes(t.date.slice(0,7))).forEach(t=>{
      const cat=t.category||"Uncategorized";
      const ym=t.date.slice(0,7);
      if(!catMonthTotals[cat]) catMonthTotals[cat]={};
      catMonthTotals[cat][ym]=(catMonthTotals[cat][ym]||0)+t.amount;
    });

    // Determine monthly spend estimate for each known category
    // Use the union of cats with budgets + cats seen in data
    const allCats=new Set([...cats,...Object.keys(catBudgets),...Object.keys(catMonthTotals)]);
    let estimatedMonthlySpend=0;
    allCats.forEach(cat=>{
      const monthData=catMonthTotals[cat]||{};
      const activeMonths=last3Months.filter(ym=>monthData[ym]>0);
      if(dataMonthCount>=3&&activeMonths.length>=3){
        // Enough data: use 3-month rolling average for this category
        const avg=activeMonths.reduce((s,ym)=>s+(monthData[ym]||0),0)/activeMonths.length;
        estimatedMonthlySpend+=avg;
      } else if(dataMonthCount>=3&&activeMonths.length>0){
        // Have overall data but sparse for this cat — blend actual avg + budget
        const avg=activeMonths.reduce((s,ym)=>s+(monthData[ym]||0),0)/activeMonths.length;
        const budget=catBudgets[cat]||0;
        estimatedMonthlySpend+=budget>0?(avg+budget)/2:avg;
      } else {
        // Fewer than 3 months of overall data — rely on budget target
        estimatedMonthlySpend+=catBudgets[cat]||0;
      }
    });

    // If we have some actual spend data but no category breakdown at all, fall
    // back to a simple recent-60-day average so the chart isn't flat zero.
    if(estimatedMonthlySpend===0&&expenseTxns.length>0){
      const since=new Date();since.setDate(since.getDate()-60);
      const sinceStr=since.toISOString().split("T")[0];
      const recent=expenseTxns.filter(t=>t.date>=sinceStr).reduce((s,t)=>s+t.amount,0);
      estimatedMonthlySpend=recent/2; // 60 days → monthly
    }

    const dailySpend=estimatedMonthlySpend/30;
    // Label for UI — explains which method was used
    const spendMethod=dataMonthCount>=3
      ?"3-month rolling average by category"
      :dataMonthCount>0
        ?"category budgets + partial spend data"
        :"category budget targets";

    // Build a map of scheduled events per date
    const events={};
    const addEvent=(date,label,amount,type)=>{
      if(!events[date]) events[date]=[];
      events[date].push({label,amount,type});
    };

    // Bills — find next due date for each unpaid bill
    const curMonth=today_str.slice(0,7);
    bills.forEach(b=>{
      for(let m=0;m<3;m++){
        const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+m);
        const ym=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
        const dueDay=String(b.dueDay||15).padStart(2,"0");
        const dueDate=ym+"-"+dueDay;
        const paid=billPayments.some(p=>p.billId===b.id&&p.month===ym);
        if(!paid&&dueDate>=today_str) addEvent(dueDate,b.name,+(b.amount)||0,"bill");
      }
    });

    // Expected income — use expectedDate (not date), and extrapolate recurring entries
    // First pass: add all explicitly stored future entries
    const addedDates=new Set();
    expected.filter(e=>!e.confirmed&&e.expectedDate&&e.expectedDate>=today_str).forEach(e=>{
      addEvent(e.expectedDate,e.source,+e.amount||0,"income");
      addedDates.add(e.id);
    });
    // Second pass: for recurring entries, project forward up to 90 days if no future entries exist
    const recurGroups={};
    expected.filter(e=>e.cadence&&e.cadence!=="once").forEach(e=>{
      if(!recurGroups[e.groupId||e.id]||e.expectedDate>recurGroups[e.groupId||e.id].expectedDate)
        recurGroups[e.groupId||e.id]={...e};
    });
    const advanceDate=(dateStr,cadence)=>{
      const d=new Date(dateStr+"T12:00:00");
      if(cadence==="weekly")      d.setDate(d.getDate()+7);
      else if(cadence==="biweekly") d.setDate(d.getDate()+14);
      else if(cadence==="every15") d.setDate(d.getDate()+15);
      else if(cadence==="monthly") d.setMonth(d.getMonth()+1);
      else if(cadence==="bimonthly") d.setMonth(d.getMonth()+2);
      else if(cadence==="quarterly") d.setMonth(d.getMonth()+3);
      else if(cadence==="annually") d.setFullYear(d.getFullYear()+1);
      return d.toISOString().split("T")[0];
    };
    Object.values(recurGroups).forEach(e=>{
      // Find last known entry for this group and project forward
      const groupEntries=expected.filter(x=>(x.groupId||x.id)===(e.groupId||e.id));
      const lastDate=groupEntries.reduce((m,x)=>x.expectedDate>m?x.expectedDate:m,"");
      if(!lastDate) return;
      const endDate=new Date();endDate.setDate(endDate.getDate()+DAYS);
      const endStr=endDate.toISOString().split("T")[0];
      let cur=lastDate;
      for(let i=0;i<50;i++){
        cur=advanceDate(cur,e.cadence);
        if(cur>endStr) break;
        if(cur>=today_str) addEvent(cur,e.source,+e.amount||0,"income");
      }
    });

    // Extra what-if expense
    if(+extraExpense>0&&extraLabel){
      const midDate=new Date();midDate.setDate(midDate.getDate()+30);
      addEvent(midDate.toISOString().split("T")[0],extraLabel,+extraExpense,"extra");
    }

    for(let i=0;i<DAYS;i++){
      const d=new Date();d.setDate(d.getDate()+i);
      const dateStr=d.toISOString().split("T")[0];
      balance-=dailySpend;
      const dayEvents=events[dateStr]||[];
      dayEvents.forEach(ev=>{
        if(ev.type==="bill"||ev.type==="extra") balance-=ev.amount;
        else balance+=ev.amount;
      });
      days.push({date:dateStr,balance:+balance.toFixed(2),events:dayEvents,day:i});
    }
    return {days,spendMethod,estimatedMonthlySpend};
  },[txns,bills,billPayments,expected,accounts,startBalance,extraExpense,extraLabel,catBudgets,cats]);

  const {days:projDays,spendMethod,estimatedMonthlySpend}=projection;
  const minBalance=Math.min(...projDays.map(d=>d.balance));
  const dangerDays=projDays.filter(d=>d.balance<threshold);
  const firstDanger=dangerDays[0];

  // Chart data — weekly points
  const chartData=projDays.filter((_,i)=>i%7===0||i===DAYS-1).map(d=>({
    date:new Date(d.date).toLocaleDateString("en-CA",{month:"short",day:"numeric"}),
    Balance:+d.balance.toFixed(0),
    Threshold:threshold,
  }));

  const GREEN="#059669",RED="#ef4444",AMBER="#f59e0b";
  const healthColor=minBalance>=threshold?GREEN:minBalance>0?AMBER:RED;

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Cash Flow Forecast</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>
        90-day projection based on upcoming bills and expected income.{" "}
        <span style={{color:"#94a3b8"}}>Daily spend estimate: <strong style={{fontWeight:600,color:"#64748b"}}>{nfmt(estimatedMonthlySpend)}/mo</strong> via {spendMethod}.</span>
      </div>

      {/* Summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:28}}>
        {[
          {label:"Starting Balance",val:nfmt(startBalance),color:"#0284C7",sub:accounts.length+" account"+(accounts.length!==1?"s":"")},
          {label:"Lowest Point",val:nfmt(minBalance),color:healthColor,sub:minBalance<threshold?"Below threshold":"Looking good"},
          {label:"90-Day Outlook",val:nfmt(projDays[DAYS-1]?.balance||0),color:projDays[DAYS-1]?.balance>startBalance?GREEN:RED,sub:projDays[DAYS-1]?.balance>startBalance?"Net positive":"Net negative"},
        ].map(c=>(
          <div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:c.color}}>{c.val}</div>
            <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{c.sub}</div>
          </div>
        ))}
      </div>

      {firstDanger&&(
        <div style={{background:"#fef9c3",borderRadius:12,border:"1px solid #fde047",padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:13,fontWeight:800,color:"#f59e0b"}}>!</span>
          <div><strong>Balance warning:</strong> your balance is projected to drop below {nfmt(threshold)} around <strong>{new Date(firstDanger.date).toLocaleDateString("en-CA",{month:"long",day:"numeric"})}</strong>.</div>
        </div>
      )}

      {/* Chart */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:16}}>Projected Balance</div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{top:4,right:16,bottom:0,left:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="date" tick={{fontSize:10}} tickLine={false}/>
            <YAxis tick={{fontSize:10}} tickLine={false} tickFormatter={v=>"$"+Math.round(v/1000)+"k"}/>
            <Tooltip formatter={(v,n)=>[nfmt(v),n]} contentStyle={{fontSize:12,borderRadius:8}}/>
            <Area type="monotone" dataKey="Balance" stroke="#0284C7" fill="#bae6fd" fillOpacity={0.4} strokeWidth={2}/>
            <Line type="monotone" dataKey="Threshold" stroke={RED} strokeDasharray="4 2" strokeWidth={1.5} dot={false}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Controls */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>Warning Threshold</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:8}}>Alert when balance drops below:</div>
          <input type="number" min={0} step={100} value={threshold} onChange={e=>setThreshold(+e.target.value)} style={{...IS,width:"100%"}}/>
        </div>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>What-If Scenario</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:8}}>Add a hypothetical one-time expense:</div>
          <div style={{display:"flex",gap:8}}>
            <input placeholder="Label" value={extraLabel} onChange={e=>setExtraLabel(e.target.value)} style={{...IS,flex:1}}/>
            <input type="number" placeholder="$0" value={extraExpense} onChange={e=>setExtraExpense(e.target.value)} style={{...IS,width:90}}/>
          </div>
        </div>
      </div>

      {/* Upcoming events */}
      <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>Upcoming Events</div>
        <div style={{maxHeight:240,overflowY:"auto"}}>
          {projDays.filter(d=>d.events.length>0).slice(0,20).map(d=>d.events.map((ev,i)=>(
            <div key={d.date+i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f1f5f9",fontSize:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span>{""}</span>
                <div>
                  <div style={{fontWeight:600}}>{ev.label}</div>
                  <div style={{color:"#94a3b8"}}>{new Date(d.date).toLocaleDateString("en-CA",{month:"short",day:"numeric"})}</div>
                </div>
              </div>
              <div style={{fontWeight:700,color:ev.type==="income"?GREEN:RED}}>{ev.type==="income"?"+":"-"}{nfmt(ev.amount)}</div>
            </div>
          )))}
          {projDays.every(d=>d.events.length===0)&&<div style={{fontSize:12,color:"#94a3b8",textAlign:"center",padding:16}}>No scheduled events found. Add bills and expected income to see them here.</div>}
        </div>
      </div>
    </div>
  );
}

// ── Debt Tracker ─────────────────────────────────────────────────────────────

export { CashFlowForecast };

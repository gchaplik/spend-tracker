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
import { idbPut, idbGet, idbDel } from "../utils/idb.js";
import { extractReceipt } from "../utils/receiptOCR.js";
import { SelectableWrapper } from "../components/SelectableWrapper.jsx";
import { StockPriceChart } from "./Stocks.jsx";

function ExpectedIncomeWidget({mExp,ml,month,GREEN,YELLOW,onConfirm,onRevert}){
  const nfmt=useNfmt();
  const [open,setOpen]=useState(true);
  const confirmed=mExp.filter(e=>e.confirmed).length;
  const overdue=mExp.filter(e=>!e.confirmed&&e.expectedDate<today()).length;
  return (
    <div style={{gridColumn:"1/-1",...CA}}>
      <button onClick={()=>setOpen(v=>!v)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:0,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",marginBottom:open?10:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:11,fontWeight:500,color:T.tx3}}>Expected Income — {ml(month)}</span>
          <span style={{fontSize:11,color:confirmed===mExp.length?GREEN:YELLOW}}>{confirmed}/{mExp.length} received</span>
          {overdue>0&&<span style={{fontSize:10,color:T.red,background:T.redBg,padding:"1px 8px",borderRadius:99}}>{overdue} overdue</span>}
        </div>
        <span style={{fontSize:13,color:T.tx3,lineHeight:1}}>{open?"▲":"▼"}</span>
      </button>
      {/* Collapsed */}
      {!open&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:6}}>
          {mExp.map(e=>(
            <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,padding:"6px 10px 6px 12px",borderRadius:T.r,background:T.overlay}}>
              <span style={{fontSize:12,color:T.tx1}}>{e.source}</span>
              {e.confirmed
                ?<button onClick={()=>onRevert(e.id)} title="Click to revert" style={{width:22,height:22,borderRadius:"50%",background:"#d1fae5",border:"2px solid #059669",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",flexShrink:0,fontFamily:"inherit",color:GREEN}}>✓</button>
                :<button onClick={()=>onConfirm(e.id)} title="Mark as received" style={{width:22,height:22,borderRadius:"50%",background:"#fef3c7",border:"2px solid #d97706",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",flexShrink:0,fontFamily:"inherit",color:YELLOW}}>?</button>}
            </div>
          ))}
        </div>
      )}
      {/* Expanded: full view with amounts */}
      {open&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"0 16px"}}>
          {mExp.map(e=>(
            <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid "+T.border,gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <span style={{fontSize:12,fontWeight:500,color:T.tx1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{e.source}</span>
                {e.note&&<span style={{fontSize:10,color:"#94a3b8"}}>{e.note}</span>}
              </div>
              <span style={{fontSize:12,fontWeight:700,color:e.confirmed?GREEN:YELLOW,flexShrink:0}}>{nfmt(e.amount)}</span>
              {e.confirmed
                ?<button onClick={()=>onRevert(e.id)} title="Click to revert" style={{width:24,height:24,borderRadius:"50%",background:"#d1fae5",border:"2px solid #059669",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,cursor:"pointer",flexShrink:0,fontFamily:"inherit",color:GREEN}}>✓</button>
                :<button onClick={()=>onConfirm(e.id)} title="Mark as received" style={{width:24,height:24,borderRadius:"50%",background:"#fef3c7",border:"2px solid #d97706",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,cursor:"pointer",flexShrink:0,fontFamily:"inherit",color:YELLOW}}>?</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BillsDueWidget({monthBills,billsPaid,billsUnpaid,billPaid,onToggleBill,month,ml,GREEN,RED}){
  const nfmt=useNfmt();
  const [open,setOpen]=useState(true);
  return(
    <div style={{...CA,marginBottom:14}}>
      <button onClick={()=>setOpen(v=>!v)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:500,color:T.tx3}}>Bills Due — {ml(month)}</span>
          <span style={{fontSize:11,color:billsUnpaid.length===0?GREEN:RED}}>{billsPaid.length}/{monthBills.length} paid</span>
          {billsUnpaid.length>0&&<span style={{fontSize:11,color:RED}}>{nfmt(billsUnpaid.reduce((s,b)=>s+b.amount,0))} remaining</span>}
        </div>
        <span style={{fontSize:13,color:T.tx3,flexShrink:0}}>{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <div style={{marginTop:10,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:6}}>
          {[...monthBills].sort((a,b)=>a.dueDay-b.dueDay).map(b=>{
            const paid=billPaid(b.id);
            return(
              <div key={b.id} onClick={()=>onToggleBill&&onToggleBill(b.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"7px 12px",borderRadius:T.r,background:paid?T.greenBg:T.overlay,cursor:"pointer",transition:"background 0.15s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                  <div style={{width:18,height:18,borderRadius:"50%",background:paid?T.greenBg:"transparent",border:`1.5px solid ${paid?GREEN:T.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {paid&&<span style={{fontSize:9,color:GREEN}}>✓</span>}
                  </div>
                  <span style={{fontSize:12,color:paid?T.tx3:T.tx1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:paid?"line-through":"none"}}>{b.name}</span>
                </div>
                <span style={{fontSize:12,fontWeight:500,color:paid?T.tx3:RED,flexShrink:0}}>{nfmt(b.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dashboard({txns,expected,cats,catBudgets,catIcons={},month,setMonth,onConfirm,onRevert,vacations=[],vacationTxns=[],bills=[],billPayments=[],onToggleBill,goals=[],accounts=[],holdings=[],stockPrices={},fxRate=1.38,settings={}}){
  const nfmt=useNfmt();
  const opts=Array.from({length:13},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-12+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const ml=m=>new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"});
  const mt=txns.filter(t=>t.date&&t.date.startsWith(month));
  const actualIncome=mt.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const txnSpending=mt.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  const vacSpendMonth=vacationTxns.filter(t=>t.date&&t.date.startsWith(month)).reduce((s,t)=>s+t.amount,0);
  // spending = expense transactions + vacation transactions only.
  // bill_payments are NOT added here — bills are tracked as expense transactions when paid,
  // so adding paidBillsTotal would double-count any bill that also has an expense transaction.
  const spending=txnSpending+vacSpendMonth;
  const mExp=expected.filter(e=>e.expectedDate&&e.expectedDate.startsWith(month));
  const pendingExp=mExp.filter(e=>!e.confirmed).reduce((s,e)=>s+e.amount,0);
  const totalExp=mExp.reduce((s,e)=>s+e.amount,0);
  const projNet=(actualIncome+pendingExp)-spending;
  const actNet=actualIncome-spending;
  // Category breakdown includes vacation txns (bucketed under their category)
  const vacBycat=vacationTxns.filter(t=>t.date&&t.date.startsWith(month)).reduce((m,t)=>{const c=t.category||"Vacation";m[c]=(m[c]||0)+t.amount;return m;},{});
  const catData=cats.map(c=>({name:c,amount:mt.filter(t=>t.type==="expense"&&t.category===c).reduce((s,t)=>s+t.amount,0)+(vacBycat[c]||0),budget:catBudgets[c]||0})).filter(d=>d.amount>0||d.budget>0).sort((a,b)=>b.amount-a.amount);
  // Add any vacation categories not in cats list (e.g. "Vacation")
  Object.entries(vacBycat).forEach(([c,amt])=>{if(!cats.includes(c)&&!catData.find(d=>d.name===c))catData.push({name:c,amount:amt,budget:0});});
  catData.sort((a,b)=>b.amount-a.amount);
  const trend=Array.from({length:6},(_,i)=>{
    const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-5+i);
    const ym=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
    const tx=txns.filter(t=>t.date&&t.date.startsWith(ym));
    const ex=expected.filter(e=>e.expectedDate&&e.expectedDate.startsWith(ym));
    const vx=vacationTxns.filter(t=>t.date&&t.date.startsWith(ym)).reduce((s,t)=>s+t.amount,0);
    return {name:d.toLocaleString("default",{month:"short"}),Income:+tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0).toFixed(2),Expenses:+(tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0)+vx).toFixed(2),Expected:+ex.reduce((s,e)=>s+e.amount,0).toFixed(2)};
  });
  const recent=[...mt].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,8);
  const activeVacations=vacations.filter(v=>v.startDate&&v.startDate.slice(0,7)<=month&&v.endDate&&v.endDate.slice(0,7)>=month);
  const vacSpend=vacSpendMonth;
  const budgetTotal=Object.values(catBudgets).reduce((s,v)=>s+(v||0),0);
  const budgetRemaining=budgetTotal-spending;
  const vacSpendLabel=activeVacations.length>0?activeVacations.map(v=>v.name).join(", "):null;
  // Month-over-month (include vacation in prev month too)
  const prevMonth=(()=>{const d=new Date(month+"-02");d.setMonth(d.getMonth()-1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");})();
  const ptxns=txns.filter(t=>t.date&&t.date.startsWith(prevMonth));
  const prevIncome=ptxns.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const prevVacSpend=vacationTxns.filter(t=>t.date&&t.date.startsWith(prevMonth)).reduce((s,t)=>s+t.amount,0);
  const prevSpending=ptxns.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0)+prevVacSpend;
  const prevActNet=prevIncome-prevSpending;
  const delta=(cur,prev)=>{if(prev===0&&cur===0)return null;const d=cur-prev;const pct=prev!==0?Math.round(Math.abs(d)/Math.abs(prev)*100):null;const up=d>=0;return{d,pct,up};};
  const incomeDelta=delta(actualIncome,prevIncome);
  const spendDelta=delta(spending,prevSpending);
  const netDelta=delta(actNet,prevActNet);
  // Budget alerts
  const alertCats=catData.filter(d=>d.budget>0&&d.amount/d.budget>=0.8).sort((a,b)=>b.amount/b.budget-a.amount/a.budget);
  // Annual summary
  const curYear=month.slice(0,4);
  const yearData=Array.from({length:12},(_,i)=>{const ym=curYear+"-"+String(i+1).padStart(2,"0");const tx=txns.filter(t=>t.date&&t.date.startsWith(ym));return{name:new Date(ym+"-02").toLocaleString("default",{month:"short"}),Income:+tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0).toFixed(2),Expenses:+tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0).toFixed(2)};});
  const yearIncome=yearData.reduce((s,d)=>s+d.Income,0);
  const yearExpenses=yearData.reduce((s,d)=>s+d.Expenses,0);
  const GREEN="#059669", RED="#dc2626", YELLOW="#d97706";
  const [chartTab,setChartTab]=useState("6mo");
  // Net worth
  const ASSET_TYPES=["chequing","savings","investment","other"];
  const totalAssets=accounts.filter(a=>ASSET_TYPES.includes(a.type)).reduce((s,a)=>s+a.balance,0);
  const totalLiab=accounts.filter(a=>!ASSET_TYPES.includes(a.type)).reduce((s,a)=>s+a.balance,0);
  const netWorth=totalAssets-totalLiab;
  const portfolioValue=holdings.reduce((s,h)=>{const cur=stockPrices[h.ticker]?.currency??(h.ticker.toUpperCase().endsWith('.TO')?'CAD':'USD');return s+(stockPrices[h.ticker]?.price??0)*h.shares*(cur==='USD'?fxRate:1);},0);
  // Bills due this month
  const monthBills=bills.filter(b=>b.active!==false);
  const billPaid=id=>billPayments.some(p=>p.billId===id&&p.month===month);
  const billsUnpaid=monthBills.filter(b=>!billPaid(b.id));
  const billsPaid=monthBills.filter(b=>billPaid(b.id));
  // Budget health — last 6 months per category
  const bhMonths=Array.from({length:6},(_,i)=>{const d=new Date(month+"-02");d.setMonth(d.getMonth()-5+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const budgetHealth=cats.filter(c=>catBudgets[c]>0).map(c=>{
    const bgt=catBudgets[c];
    return{name:c,budget:bgt,months:bhMonths.map(ym=>{const spent=txns.filter(t=>t.date&&t.date.startsWith(ym)&&t.type==="expense"&&t.category===c).reduce((s,t)=>s+t.amount,0);return{ym,spent,status:spent===0?"none":spent>bgt?"over":"ok"};})};
  });
  // Anomaly detection — flag transactions >2.5x category average (min 3 txns)
  const catAvgs={};cats.forEach(c=>{const ct=txns.filter(t=>t.type==="expense"&&t.category===c&&t.amount>0);if(ct.length>=3)catAvgs[c]=ct.reduce((s,t)=>s+t.amount,0)/ct.length;});
  const isAnomaly=t=>t.type==="expense"&&catAvgs[t.category]&&t.amount>2.5*catAvgs[t.category];
  // Greeting + date helpers
  const greetHour=new Date().getHours();
  const greeting=greetHour<12?"Good morning":greetHour<17?"Good afternoon":"Good evening";
  const firstName=(settings.name||"").split(" ")[0]||null;
  const nowDate=new Date();
  const dayOfWeek=nowDate.toLocaleString("default",{weekday:"long"});
  const dayNum=nowDate.getDate();
  const monthName=nowDate.toLocaleString("default",{month:"long"});
  const fullYear=nowDate.getFullYear();

  // Month navigator helpers
  const curIdx=opts.indexOf(month);
  const canPrev=curIdx>0;
  const canNext=curIdx<opts.length-1;
  const isCurrentMonth=month===opts[opts.length-1];

  return (
    <div>
      {/* Greeting row */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:T.tx1,lineHeight:1.2}}>
            {greeting}{firstName?", "+firstName:""}
          </div>
          <div style={{fontSize:13,color:T.tx3,marginTop:3}}>
            {dayOfWeek}, {monthName} {dayNum}, {fullYear}
          </div>
        </div>

        {/* Pill month navigator */}
        <div style={{display:"flex",alignItems:"center",gap:6,background:T.overlay,borderRadius:99,padding:"4px 6px",border:"1px solid "+T.border}}>
          <button onClick={()=>canPrev&&setMonth(opts[curIdx-1])} disabled={!canPrev} style={{width:28,height:28,borderRadius:99,border:"none",background:canPrev?"transparent":"transparent",color:canPrev?T.tx1:T.tx3,cursor:canPrev?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:600,transition:"background 0.15s"}}
            onMouseEnter={e=>{if(canPrev)e.currentTarget.style.background=T.border;}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
            ‹
          </button>
          <div style={{position:"relative"}}>
            <select value={month} onChange={e=>setMonth(e.target.value)}
              style={{appearance:"none",WebkitAppearance:"none",border:"none",background:"transparent",fontSize:13,fontWeight:600,color:T.tx1,cursor:"pointer",padding:"2px 20px 2px 4px",fontFamily:"inherit",outline:"none"}}>
              {opts.map(m=><option key={m} value={m}>{new Date(m+"-02").toLocaleString("default",{month:"short",year:"numeric"})}</option>)}
            </select>
            <span style={{position:"absolute",right:4,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",fontSize:10,color:T.tx3}}>▾</span>
          </div>
          <button onClick={()=>canNext&&setMonth(opts[curIdx+1])} disabled={!canNext} style={{width:28,height:28,borderRadius:99,border:"none",background:"transparent",color:canNext?T.tx1:T.tx3,cursor:canNext?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:600,transition:"background 0.15s"}}
            onMouseEnter={e=>{if(canNext)e.currentTarget.style.background=T.border;}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
            ›
          </button>
          {!isCurrentMonth&&(
            <button onClick={()=>setMonth(opts[opts.length-1])} style={{marginLeft:2,padding:"3px 10px",borderRadius:99,border:"1px solid "+T.border,background:T.surface,fontSize:11,fontWeight:600,color:T.tx2,cursor:"pointer",letterSpacing:"0.02em"}}
              onMouseEnter={e=>{e.currentTarget.style.background=T.overlay;}}
              onMouseLeave={e=>{e.currentTarget.style.background=T.surface;}}>
              Today
            </button>
          )}
        </div>
      </div>

      {/* Hero — Net Position */}
      <SelectableWrapper item={{label:`Net Position ${ml(month)}`,llmContext:`Net Position for ${ml(month)}: ${nfmt(actNet)} (income: ${nfmt(actualIncome)}, spending: ${nfmt(spending)})${pendingExp>0?`, projected: ${nfmt(projNet)}, pending income: ${nfmt(pendingExp)}`:''}${netDelta?`, ${netDelta.up?'up':'down'} ${nfmt(Math.abs(netDelta.d))} vs last month`:''}`}}>
      <div style={{...CA,padding:"24px 28px",marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:500,color:T.tx3,marginBottom:8}}>Net Position · {ml(month)}</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:20,flexWrap:"wrap"}}>
          <div style={{fontSize:40,fontWeight:600,color:actNet>=0?GREEN:RED,lineHeight:1}}>{nfmt(actNet)}</div>
          <div style={{paddingBottom:6,display:"flex",flexDirection:"column",gap:3}}>
            {netDelta&&<div style={{fontSize:12,color:netDelta.up?GREEN:RED}}>{netDelta.up?"↑":"↓"} {nfmt(Math.abs(netDelta.d))}{netDelta.pct!=null?" ("+netDelta.pct+"%)":""} vs last month</div>}
            {pendingExp>0&&<div style={{fontSize:12,color:T.tx3}}>Expected <span style={{color:YELLOW,fontWeight:600}}>{nfmt(totalExp)}</span> · <span style={{color:YELLOW}}>{nfmt(pendingExp)} pending</span> · net <span style={{color:projNet>=0?GREEN:RED,fontWeight:600}}>{nfmt(projNet)}</span></div>}
          </div>
        </div>
      </div>
      </SelectableWrapper>

      {/* Net worth strip */}
      {(accounts.length>0||holdings.length>0)&&(
        <div style={{...CA,padding:"12px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
          <div style={{fontSize:11,fontWeight:500,color:T.tx3,flexShrink:0}}>Net Worth</div>
          <div style={{fontSize:18,fontWeight:600,color:netWorth>=0?GREEN:RED}}>{nfmt(netWorth+(portfolioValue||0))}</div>
          <div style={{fontSize:12,color:T.tx3,display:"flex",gap:14,flexWrap:"wrap"}}>
            <span>Assets <span style={{color:GREEN,fontWeight:500}}>{nfmt(totalAssets,netWorth+(portfolioValue||0))}</span></span>
            <span>Liabilities <span style={{color:RED,fontWeight:500}}>{nfmt(totalLiab,netWorth+(portfolioValue||0))}</span></span>
            {holdings.length>0&&portfolioValue>0&&<span>Portfolio <span style={{color:T.accent,fontWeight:500}}>{nfmt(portfolioValue,netWorth+(portfolioValue||0))}</span></span>}
          </div>
        </div>
      )}
      {/* Three stat cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10,marginBottom:12}}>
        <SelectableWrapper item={{label:`Income ${ml(month)}`,llmContext:`Income for ${ml(month)}: ${nfmt(actualIncome)}${incomeDelta&&incomeDelta.d!==0?`, ${incomeDelta.up?'up':'down'} ${nfmt(Math.abs(incomeDelta.d))} vs last month`:''}`}}>
        <div style={{...CA,padding:"18px 20px"}}>
          <div style={{fontSize:11,fontWeight:500,color:T.tx3,marginBottom:6}}>Income</div>
          <div style={{fontSize:26,fontWeight:600,color:GREEN,lineHeight:1}}>{nfmt(actualIncome)}</div>
          {incomeDelta&&incomeDelta.d!==0&&<div style={{fontSize:11,marginTop:6,color:incomeDelta.up?GREEN:RED}}>{incomeDelta.up?"↑":"↓"} {nfmt(Math.abs(incomeDelta.d))} vs last month</div>}
        </div>
        </SelectableWrapper>
        <SelectableWrapper item={{label:`Spending ${ml(month)}`,llmContext:`Spending for ${ml(month)}: ${nfmt(spending)}${vacSpend>0?` (including ${nfmt(vacSpend)} vacation)`:''}${budgetTotal>0?`, ${nfmt(Math.abs(budgetRemaining),budgetTotal)} ${budgetRemaining>=0?'under':'over'} budget`:''}${spendDelta&&spendDelta.d!==0?`, ${spendDelta.up?'up':'down'} ${nfmt(Math.abs(spendDelta.d),spending)} vs last month`:''}`}}>
        <div style={{...CA,padding:"18px 20px"}}>
          <div style={{fontSize:11,fontWeight:500,color:T.tx3,marginBottom:6}}>Spending</div>
          <div style={{fontSize:26,fontWeight:600,color:RED,lineHeight:1}}>{nfmt(spending)}</div>
          {budgetTotal>0&&<div style={{fontSize:11,marginTop:6,color:budgetRemaining>=0?GREEN:RED}}>{nfmt(Math.abs(budgetRemaining),budgetTotal)} {budgetRemaining>=0?"under budget":"over budget"}</div>}
          {spendDelta&&spendDelta.d!==0&&<div style={{fontSize:11,marginTop:budgetTotal>0?2:6,color:spendDelta.up?RED:GREEN}}>{spendDelta.up?"↑":"↓"} {nfmt(Math.abs(spendDelta.d),spending)} vs last month</div>}
          {vacSpend>0&&<div style={{fontSize:11,color:T.tx3,marginTop:3}}>+{nfmt(vacSpend,spending)} vacation</div>}
        </div>
        </SelectableWrapper>
        <SelectableWrapper item={{label:`Expected Income ${ml(month)}`,llmContext:`Expected income for ${ml(month)}: ${nfmt(totalExp)} total${pendingExp>0?`, ${nfmt(pendingExp)} still pending (${mExp.filter(e=>!e.confirmed).length} items)`:', all received'}`}}>
        <div style={{...CA,padding:"18px 20px"}}>
          <div style={{fontSize:11,fontWeight:500,color:T.tx3,marginBottom:6}}>Expected Income</div>
          <div style={{fontSize:26,fontWeight:600,color:YELLOW,lineHeight:1}}>{nfmt(totalExp)}</div>
          {pendingExp>0
            ?<div style={{fontSize:11,color:YELLOW,marginTop:6}}>{nfmt(pendingExp,totalExp)} pending · {mExp.filter(e=>!e.confirmed).length} items</div>
            :mExp.length>0&&<div style={{fontSize:11,color:GREEN,marginTop:6}}>All received ✓</div>}
        </div>
        </SelectableWrapper>
      </div>

      {/* Expected Income widget */}
      {mExp.length>0&&<div style={{marginBottom:14}}><ExpectedIncomeWidget mExp={mExp} ml={ml} month={month} GREEN={GREEN} YELLOW={YELLOW} onConfirm={onConfirm} onRevert={onRevert}/></div>}

      {/* Bills Due widget */}
      {monthBills.length>0&&<BillsDueWidget monthBills={monthBills} billsPaid={billsPaid} billsUnpaid={billsUnpaid} billPaid={billPaid} onToggleBill={onToggleBill} month={month} ml={ml} GREEN={GREEN} RED={RED}/>}

      {/* Goals strip */}
      {goals.length>0&&(
        <SelectableWrapper item={{label:"Savings Goals",llmContext:`Savings goals: ${goals.map(g=>`${g.name} ${Math.round(g.targetAmount>0?Math.min(g.currentAmount/g.targetAmount,1)*100:0)}% (${nfmt(g.currentAmount)} of ${nfmt(g.targetAmount)})`).join(', ')}`}}>
        <div style={{...CA,marginBottom:14,padding:"16px 20px"}}>
          <div style={{fontSize:11,fontWeight:500,color:T.tx3,marginBottom:10}}>Savings Goals</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
            {goals.map(g=>{
              const pct=g.targetAmount>0?Math.min(g.currentAmount/g.targetAmount,1):0;
              return(
                <div key={g.id} style={{padding:"10px 14px",borderRadius:T.r,background:T.overlay}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{fontSize:15}}>{g.emoji}</span>
                    <span style={{fontSize:12,fontWeight:500,color:T.tx1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</span>
                  </div>
                  <div style={{height:4,borderRadius:99,background:T.border,overflow:"hidden",marginBottom:5}}>
                    <div style={{height:"100%",borderRadius:99,width:(pct*100)+"%",background:pct>=1?GREEN:T.accent,transition:"width 0.4s"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:11,color:T.accent}}>{nfmt(g.currentAmount,g.targetAmount)}</span>
                    <span style={{fontSize:11,color:T.tx3}}>{Math.round(pct*100)}% of {nfmt(g.targetAmount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </SelectableWrapper>
      )}

      {/* Charts + Category */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <SelectableWrapper item={{label:`Spending by Category ${ml(month)}`,llmContext:`Spending by category for ${ml(month)}: `+catData.map(d=>d.name+' '+nfmt(d.amount)+(d.budget>0?' (budget '+nfmt(d.budget)+')':'')).join(', ')}}>
        <div style={CA}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:14,color:T.tx1}}>Spending by Category</div>
          {catData.length===0?<div style={{color:T.tx3,fontSize:13}}>No expenses this month</div>:catData.map((d,i)=>{
            const pct=d.budget>0?Math.min(d.amount/d.budget,1):0;
            const over=d.budget>0&&d.amount>d.budget;
            const warn=d.budget>0&&!over&&d.amount/d.budget>=0.8;
            return(
              <div key={d.name} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:over?RED:COLORS[i%COLORS.length],display:"inline-block",flexShrink:0}}/>
                    <span style={{fontSize:12,color:T.tx2}}>{d.name}</span>
                    {over&&<span style={{fontSize:10,color:RED,background:T.redBg,padding:"1px 6px",borderRadius:99}}>over</span>}
                    {warn&&<span style={{fontSize:10,color:YELLOW,background:T.amberBg,padding:"1px 6px",borderRadius:99}}>near</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                    <span style={{fontSize:12,fontWeight:500,color:over?RED:T.tx1}}>{nfmt(d.amount,catData.reduce((s,x)=>s+x.amount,0))}</span>
                    {d.budget>0&&<span style={{fontSize:11,color:T.tx3}}>/ {nfmt(d.budget)}</span>}
                  </div>
                </div>
                <div style={{height:3,borderRadius:99,background:T.border,overflow:"hidden"}}>
                  {d.budget>0
                    ?<div style={{height:"100%",borderRadius:99,width:(pct*100)+"%",background:over?RED:warn?YELLOW:T.accent,transition:"width 0.4s ease"}}/>
                    :<div style={{height:"100%",borderRadius:99,width:"100%",background:T.accentMid+"66"}}/>}
                </div>
              </div>
            );
          })}
        </div>
        </SelectableWrapper>
        <div style={CA}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:500,color:T.tx1}}>{chartTab==="6mo"?"6-Month Cashflow":curYear+" Annual"}</div>
            <div style={{display:"flex",background:T.overlay,borderRadius:T.r,padding:3,gap:1}}>
              {[{k:"6mo",l:"6 Mo"},{ k:"year",l:curYear}].map(t=>(
                <button key={t.k} onClick={()=>setChartTab(t.k)} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontSize:11,fontWeight:500,fontFamily:"inherit",background:chartTab===t.k?T.surface:"transparent",color:chartTab===t.k?T.tx1:T.tx3,boxShadow:chartTab===t.k?T.shadow:"none",transition:"all 0.15s"}}>{t.l}</button>
              ))}
            </div>
          </div>
          {chartTab==="6mo"?(
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{left:-12,right:8,top:4,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                <XAxis dataKey="name" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false}/>
                <Tooltip formatter={v=>nfmt(v)} contentStyle={{borderRadius:T.rCard,border:"none",boxShadow:T.shadowMd,fontSize:12}}/>
                <Line type="monotone" dataKey="Income" stroke={GREEN} strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="Expenses" stroke={RED} strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="Expected" stroke={T.accentMid} strokeWidth={1.5} strokeDasharray="4 3" dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          ):(
            <>
              <div style={{display:"flex",gap:20,marginBottom:12}}>
                <span style={{fontSize:12,color:GREEN,fontWeight:600}}>Income {nfmt(yearIncome)}</span>
                <span style={{fontSize:12,color:RED,fontWeight:600}}>Expenses {nfmt(yearExpenses)}</span>
                <span style={{fontSize:12,color:yearIncome-yearExpenses>=0?GREEN:RED,fontWeight:700}}>Net {nfmt(yearIncome-yearExpenses)}</span>
              </div>
              <ResponsiveContainer width="100%" height={196}>
                <BarChart data={yearData} margin={{left:-12,right:8,top:4,bottom:0}} barSize={8} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                  <XAxis dataKey="name" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false}/>
                  <Tooltip formatter={v=>nfmt(v)} contentStyle={{borderRadius:T.rCard,border:"none",boxShadow:T.shadowMd,fontSize:12}}/>
                  <Bar dataKey="Income" fill={GREEN} radius={[3,3,0,0]}/>
                  <Bar dataKey="Expenses" fill={RED} radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
          <div style={{display:"flex",gap:14,marginTop:10,flexWrap:"wrap"}}>
            {[{c:GREEN,l:"Income"},{c:RED,l:"Expenses"},...(chartTab==="6mo"?[{c:T.accentMid,l:"Expected",dashed:true}]:[])].map(item=>(
              <span key={item.l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:T.tx3}}>
                {item.dashed?<span style={{width:14,borderTop:"2px dashed "+T.accentMid,display:"inline-block"}}/>:<span style={{width:7,height:7,borderRadius:"50%",background:item.c,display:"inline-block"}}/>}{item.l}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Budget Health */}
      {budgetHealth.length>0&&(
        <div style={{...CA,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:14,color:T.tx1}}>Budget Health — Last 6 Months</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr>
                  <th style={{textAlign:"left",padding:"0 10px 8px 0",color:"#94a3b8",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>Category</th>
                  {bhMonths.map(ym=><th key={ym} style={{textAlign:"center",padding:"0 6px 8px",color:"#94a3b8",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>{new Date(ym+"-02").toLocaleString("default",{month:"short"})}</th>)}
                  <th style={{textAlign:"right",padding:"0 0 8px 10px",color:"#94a3b8",fontWeight:600,fontSize:11}}>Budget</th>
                </tr>
              </thead>
              <tbody>
                {budgetHealth.map(row=>{
                  const hits=row.months.filter(m=>m.status==="ok").length;
                  const total=row.months.filter(m=>m.status!=="none").length;
                  return(
                    <tr key={row.name} style={{borderTop:"1px solid #f8fafc"}}>
                      <td style={{padding:"7px 10px 7px 0",fontWeight:500,color:"#374151",whiteSpace:"nowrap"}}>
                        {row.name}
                        {total>0&&<span style={{fontSize:10,marginLeft:7,color:hits===total?"#059669":hits/total>=0.5?"#d97706":"#dc2626",fontWeight:600}}>{hits}/{total}</span>}
                      </td>
                      {row.months.map(m=>(
                        <td key={m.ym} style={{textAlign:"center",padding:"7px 6px"}}>
                          {m.status==="ok"&&<span title={nfmt(m.spent)} style={{display:"inline-block",width:16,height:16,borderRadius:"50%",background:"#dcfce7",border:"1.5px solid #059669",lineHeight:"14px",fontSize:10,color:"#059669"}}>✓</span>}
                          {m.status==="over"&&<span title={nfmt(m.spent)} style={{display:"inline-block",width:16,height:16,borderRadius:"50%",background:"#fee2e2",border:"1.5px solid #dc2626",lineHeight:"14px",fontSize:10,color:"#dc2626"}}>✗</span>}
                          {m.status==="none"&&<span style={{display:"inline-block",width:16,height:16,borderRadius:"50%",background:"#f8fafc",border:"1.5px solid #f1f5f9"}}/>}
                        </td>
                      ))}
                      <td style={{textAlign:"right",padding:"7px 0 7px 10px",color:"#94a3b8",fontSize:11}}>{nfmt(row.budget)}/mo</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock price chart */}
      {holdings.length>0&&<StockPriceChart holdings={holdings}/>}

      {/* Recent Transactions */}
      <SelectableWrapper item={{label:`Recent Transactions ${ml(month)}`,llmContext:`Recent transactions for ${ml(month)} (${recent.length} shown): ${recent.slice(0,10).map(t=>`${t.date} ${t.merchant||t.source} ${t.type==='income'?'+':'-'}${nfmt(t.amount)}${t.category?' ('+t.category+')':''}`).join('; ')}`}}>
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:14,color:"#1E293B"}}>Recent Transactions</div>
        {recent.length===0?<div style={{color:"#94a3b8",fontSize:13}}>No transactions this month</div>:recent.map(t=>(
          <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #f8fafc"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:t.type==="income"?T.greenBg:T.overlay,border:"1px solid "+(t.type==="income"?"#bbf7d0":T.border),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {getCatIcon(t.category,t.type,t.type==="income"?T.green:T.tx2,catIcons)}
              </div>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>{t.merchant||t.source}</span>
                  {isAnomaly(t)&&<span title={"Avg for "+t.category+": "+nfmt(catAvgs[t.category])} style={{fontSize:9,fontWeight:700,background:"#fef3c7",color:"#92400e",padding:"1px 6px",borderRadius:20,letterSpacing:"0.05em",border:"1px solid #fde68a"}}>UNUSUAL</span>}
                </div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>{t.date}{t.type==="expense"&&t.category?" · "+t.category:" · Income"}</div>
              </div>
            </div>
            <div style={{fontWeight:700,fontSize:14,color:t.type==="income"?GREEN:"#374151"}}>{t.type==="income"?"+":"-"}{nfmt(t.amount)}</div>
          </div>
        ))}
      </div>
      </SelectableWrapper>
    </div>
  );
}

export { Dashboard, ExpectedIncomeWidget, BillsDueWidget };

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

function Reports({txns,bills,billPayments,cats,catBudgets,goals,vacations,vacationTxns,settings}){
  const [reportType,setReportType]=useState("monthly");
  const [year,setYear]=useState(()=>new Date().getFullYear());
  const [month,setMonth]=useState(()=>today().slice(0,7));
  const [catFilter,setCatFilter]=useState("all");
  const [typeFilter,setTypeFilter]=useState("all");
  const [importStatus,setImportStatus]=useState(null);
  const fileInputRef=useRef(null);

  const years=useMemo(()=>{
    const ys=new Set(txns.map(t=>t.date?.slice(0,4)).filter(Boolean));
    ys.add(String(new Date().getFullYear()));
    return [...ys].sort((a,b)=>b-a);
  },[txns]);

  // Escape CSV value
  const esc=v=>`"${String(v||"").replace(/"/g,'""')}"`;

  const downloadCSV=(rows,filename)=>{
    const csv=rows.map(r=>r.map(esc).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=filename;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const exportTransactions=()=>{
    let data=txns;
    if(reportType==="monthly") data=data.filter(t=>t.date?.startsWith(month));
    else if(reportType==="annual"||reportType==="tax") data=data.filter(t=>t.date?.startsWith(String(year)));
    if(catFilter!=="all") data=data.filter(t=>t.category===catFilter||t.type===catFilter);
    if(typeFilter!=="all") data=data.filter(t=>t.type===typeFilter);
    const rows=[["Date","Type","Merchant/Source","Amount","Category","Note"],...data.map(t=>[t.date,t.type,t.merchant||t.source||"",t.amount,t.category||"Income",t.note||""])];
    const label=reportType==="monthly"?month:String(year);
    downloadCSV(rows,`cashheap-transactions-${label}.csv`);
  };

  const exportMonthlySummary=()=>{
    const months=[];
    const allTxns=[...txns,...vacationTxns];
    // Build list of unique months in range
    const ms=new Set(allTxns.map(t=>t.date?.slice(0,7)).filter(Boolean));
    [...ms].filter(m=>m.startsWith(String(year))).sort().forEach(m=>{
      const mt=allTxns.filter(t=>t.date?.startsWith(m));
      const income=mt.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
      const expenses=mt.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
      const net=income-expenses;
      months.push([m,income.toFixed(2),expenses.toFixed(2),net.toFixed(2)]);
    });
    downloadCSV([["Month","Income","Expenses","Net"],...months],`cashheap-summary-${year}.csv`);
  };

  const exportCategoryBreakdown=()=>{
    const allTxns=[...txns,...vacationTxns].filter(t=>t.date?.startsWith(String(year))&&t.type==="expense");
    const byCat={};
    allTxns.forEach(t=>{const c=t.category||"Uncategorized";byCat[c]=(byCat[c]||0)+t.amount;});
    const rows=[["Category","Total","Budget","% of Budget"],...Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([c,v])=>{
      const budget=(catBudgets[c]||0)*12;
      return[c,v.toFixed(2),budget?budget.toFixed(2):"—",budget?(v/budget*100).toFixed(1)+"%":"—"];
    })];
    downloadCSV(rows,`cashheap-categories-${year}.csv`);
  };

  const exportFullBackup=async()=>{
    const data=await loadServerData();
    const json=JSON.stringify(data,null,2);
    const blob=new Blob([json],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=`cashheap-backup-${today()}.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const handleImport=async(e)=>{
    const file=e.target.files?.[0];
    if(!file){return;}
    e.target.value="";
    setImportStatus({state:"reading"});
    try{
      const text=await file.text();
      const incoming=JSON.parse(text);
      const current=await loadServerData();
      const mergeArr=(cur=[],inc=[])=>{
        const byId=new Map((cur||[]).map(x=>[x.id,x]));
        let added=0;
        for(const item of (inc||[])){if(!byId.has(item.id)){byId.set(item.id,item);added++;}}
        return{merged:[...byId.values()],added};
      };
      const mergeObj=(cur={},inc={})=>({...inc,...cur});
      const txnR   =mergeArr(current.txns,           incoming.txns);
      const billR  =mergeArr(current.bills,           incoming.bills);
      const bpR    =mergeArr(current.billPayments,    incoming.billPayments);
      const expR   =mergeArr(current.expected,        incoming.expected);
      const vacR   =mergeArr(current.vacations,       incoming.vacations);
      const vtR    =mergeArr(current.vacationTxns,    incoming.vacationTxns);
      const holdR  =mergeArr(current.holdings,        incoming.holdings);
      const ahR    =mergeArr(current.accountHistory,  incoming.accountHistory);
      const goalR  =mergeArr(current.goals,           incoming.goals);
      const accR   =mergeArr(current.accounts,        incoming.accounts);
      const debtR  =mergeArr(current.debts,           incoming.debts);
      const subR   =mergeArr(current.subscriptions,   incoming.subscriptions);
      const taxR   =mergeArr(current.taxItems,        incoming.taxItems);
      const wishR  =mergeArr(current.wishlist,        incoming.wishlist);
      const membR  =mergeArr(current.members,         incoming.members);
      const merged={
        txns:txnR.merged, bills:billR.merged, billPayments:bpR.merged,
        expected:expR.merged, vacations:vacR.merged, vacationTxns:vtR.merged,
        holdings:holdR.merged, accountHistory:ahR.merged, goals:goalR.merged,
        accounts:accR.merged, debts:debtR.merged, subscriptions:subR.merged,
        taxItems:taxR.merged, wishlist:wishR.merged, members:membR.merged,
        catBudgets:mergeObj(current.catBudgets,incoming.catBudgets),
        splits:mergeObj(current.splits,incoming.splits),
        settlements:mergeObj(current.settlements,incoming.settlements),
        cats:current.cats?.length?current.cats:(incoming.cats||current.cats),
        favourites:current.favourites?.length?current.favourites:(incoming.favourites||current.favourites),
        schema:current.schema||incoming.schema,
        settings:current.settings||incoming.settings,
      };
      await saveServerData(merged);
      const total=txnR.added+billR.added+bpR.added+expR.added+vacR.added+vtR.added+holdR.added+ahR.added+goalR.added+accR.added+debtR.added+subR.added+taxR.added+wishR.added+membR.added;
      setImportStatus({state:"done",added:total,details:{
        transactions:txnR.added, bills:billR.added, goals:goalR.added,
        vacations:vacR.added, holdings:holdR.added,
      }});
    }catch(err){
      setImportStatus({state:"error",msg:err.message});
    }
  };

  const totalIncome=txns.filter(t=>t.type==="income"&&t.date?.startsWith(String(year))).reduce((s,t)=>s+t.amount,0);
  const totalExpenses=[...txns,...vacationTxns].filter(t=>t.type==="expense"&&t.date?.startsWith(String(year))).reduce((s,t)=>s+t.amount,0);
  const savingsRate=totalIncome>0?((totalIncome-totalExpenses)/totalIncome*100):0;

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Reports & Export</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Download summaries and transaction data as CSV files.</div>

      {/* Annual snapshot */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:28}}>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em"}}>Year</span>
            <select value={year} onChange={e=>setYear(+e.target.value)} style={{fontSize:12,border:"1px solid #e2e8f0",borderRadius:6,padding:"2px 6px",fontFamily:"inherit"}}>
              {years.map(y=><option key={y}>{y}</option>)}
            </select>
          </div>
          <div style={{fontSize:22,fontWeight:800,color:"#0f172a"}}>{year}</div>
        </div>
        {[
          {label:"Income",val:nfmt(totalIncome),color:"#059669"},
          {label:"Expenses",val:nfmt(totalExpenses),color:"#ef4444"},
          {label:"Savings Rate",val:savingsRate.toFixed(1)+"%",color:savingsRate>=20?"#059669":savingsRate>=10?"#f59e0b":"#ef4444"},
        ].map(c=>(
          <div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
            <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:c.color}}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* Export cards */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>

        {/* Transactions export */}
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:4}}>Transaction Export</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>Export a filtered list of transactions to CSV.</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
            {[["monthly","Monthly"],["annual","Annual"],["tax","Tax Year"]].map(([k,l])=>(
              <button key={k} onClick={()=>setReportType(k)} style={{fontSize:11,padding:"5px 12px",borderRadius:20,border:`1.5px solid ${reportType===k?"#0284C7":"#e2e8f0"}`,background:reportType===k?"#0284C7":"#f8fafc",color:reportType===k?"#fff":"#64748b",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>{l}</button>
            ))}
          </div>
          {reportType==="monthly"&&(
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{...IS,width:"100%",marginBottom:8}}/>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={IS}>
              <option value="all">All Types</option><option value="expense">Expenses</option><option value="income">Income</option>
            </select>
            <select value={catFilter} onChange={e=>setCatFilter(e.target.value)} style={IS}>
              <option value="all">All Categories</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Btn full onClick={exportTransactions}>Download CSV</Btn>
        </div>

        {/* Summary reports */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:4}}>Monthly Summary</div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>All months in {year} — income, expenses, net per month.</div>
            <Btn full onClick={exportMonthlySummary}>Download CSV</Btn>
          </div>
          <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:4}}>Category Breakdown</div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>Annual spending by category vs budget for {year}.</div>
            <Btn full onClick={exportCategoryBreakdown}>Download CSV</Btn>
          </div>
        </div>

      </div>

      {/* Backup & Restore */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        <div style={{background:T.surface,borderRadius:16,border:"1px solid "+T.border,padding:20}}>
          <div style={{fontSize:14,fontWeight:700,color:T.tx1,marginBottom:4}}>Full Backup</div>
          <div style={{fontSize:12,color:T.tx3,marginBottom:14}}>Export all your data as a single JSON file — transactions, bills, goals, settings, and more.</div>
          <Btn full onClick={exportFullBackup}>Download JSON Backup</Btn>
        </div>
        <div style={{background:T.surface,borderRadius:16,border:"1px solid "+T.border,padding:20}}>
          <div style={{fontSize:14,fontWeight:700,color:T.tx1,marginBottom:4}}>Restore / Merge</div>
          <div style={{fontSize:12,color:T.tx3,marginBottom:14}}>Import a JSON backup. New records are added by ID; existing records are kept unchanged.</div>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{display:"none"}}/>
          <Btn full onClick={()=>{setImportStatus(null);fileInputRef.current?.click();}}>Import JSON Backup</Btn>
          {importStatus?.state==="reading"&&<div style={{marginTop:10,fontSize:12,color:T.tx3}}>Reading file…</div>}
          {importStatus?.state==="done"&&(
            <div style={{marginTop:10,padding:"10px 12px",background:T.overlay,borderRadius:8,border:"1px solid "+T.border}}>
              <div style={{fontSize:12,fontWeight:600,color:T.tx1,marginBottom:6}}>Import complete — {importStatus.added} new records added</div>
              {Object.entries(importStatus.details).filter(([,v])=>v>0).map(([k,v])=>(
                <div key={k} style={{fontSize:11,color:T.tx3}}>{v} {k}</div>
              ))}
              {importStatus.added===0&&<div style={{fontSize:11,color:T.tx3}}>All records already exist — nothing to add.</div>}
              <div style={{fontSize:11,color:"#f59e0b",marginTop:6}}>Reload the app to see imported data.</div>
            </div>
          )}
          {importStatus?.state==="error"&&(
            <div style={{marginTop:10,padding:"10px 12px",background:"#fef2f2",borderRadius:8,border:"1px solid #fecaca",fontSize:12,color:"#dc2626"}}>
              Import failed: {importStatus.msg}
            </div>
          )}
        </div>
      </div>

      {/* Tax summary table */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>{year} Tax Year Summary</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
          {[
            {label:"Total Income",val:nfmt(totalIncome)},
            {label:"Total Expenses",val:nfmt(totalExpenses)},
            {label:"Net Saved",val:nfmt(Math.max(0,totalIncome-totalExpenses))},
          ].map(r=>(
            <div key={r.label} style={{background:"#f8fafc",borderRadius:10,padding:12}}>
              <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>{r.label}</div>
              <div style={{fontSize:16,fontWeight:700,color:"#0f172a"}}>{r.val}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:12,color:"#94a3b8",fontStyle:"italic"}}>
          Tip: For tax deductions tracking, tag individual transactions as deductible (coming in Phase 2 Tax Tracker feature).
        </div>
      </div>
    </div>
  );
}

// ── Alerts & Notifications ────────────────────────────────────────────────────
// ── Alert computation (shared hook) ──────────────────────────────────────────

export { Reports };

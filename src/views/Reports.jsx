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

  // Rolling 12-month savings rate
  const savingsRateData=useMemo(()=>Array.from({length:12},(_,i)=>{
    const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-11+i);
    const ym=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
    const inc=txns.filter(t=>t.type==="income"&&t.date?.startsWith(ym)).reduce((s,t)=>s+t.amount,0);
    const exp=[...txns,...(vacationTxns||[])].filter(t=>t.type==="expense"&&t.date?.startsWith(ym)).reduce((s,t)=>s+t.amount,0);
    const rate=inc>0?Math.round((inc-exp)/inc*100):null;
    return{name:d.toLocaleString("default",{month:"short"})+"'"+String(d.getFullYear()).slice(2),rate,inc,exp};
  }),[txns,vacationTxns]);

  const printMonthlyReport=()=>{
    const mt=txns.filter(t=>t.date?.startsWith(month));
    const inc=mt.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
    const exp=mt.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
    const net=inc-exp;
    const catRows=cats.map(c=>({cat:c,amt:mt.filter(t=>t.type==="expense"&&t.category===c).reduce((s,t)=>s+t.amount,0),budget:catBudgets[c]||0})).filter(r=>r.amt>0);
    const mo=new Date(month+"-02").toLocaleString("default",{month:"long",year:"numeric"});
    const html=`<!DOCTYPE html><html><head><title>CashHeap — ${month}</title><style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;color:#1e293b}h1{font-size:24px;font-weight:800;margin-bottom:4px}h2{font-size:16px;font-weight:700;margin:24px 0 8px}.cards{display:flex;gap:16px;margin-bottom:24px}.card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;flex:1}.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:4px}.val{font-size:22px;font-weight:700}table{width:100%;border-collapse:collapse}th{font-size:11px;text-transform:uppercase;color:#64748b;text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0}td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px}@media print{body{margin:20px}}</style></head><body><h1>CashHeap Report — ${mo}</h1><div class="cards"><div class="card"><div class="lbl">Income</div><div class="val" style="color:#059669">$${inc.toFixed(2)}</div></div><div class="card"><div class="lbl">Expenses</div><div class="val" style="color:#dc2626">$${exp.toFixed(2)}</div></div><div class="card"><div class="lbl">Net</div><div class="val" style="color:${net>=0?"#059669":"#dc2626"}">$${net.toFixed(2)}</div></div></div><h2>Spending by Category</h2><table><tr><th>Category</th><th style="text-align:right">Spent</th><th style="text-align:right">Budget</th><th style="text-align:right">Remaining</th></tr>${catRows.map(r=>`<tr><td>${r.cat}</td><td style="text-align:right;color:#dc2626">$${r.amt.toFixed(2)}</td><td style="text-align:right;color:#64748b">${r.budget>0?"$"+r.budget.toFixed(2):"—"}</td><td style="text-align:right;color:${r.budget>0&&r.budget-r.amt<0?"#dc2626":"#059669"}">${r.budget>0?"$"+(r.budget-r.amt).toFixed(2):"—"}</td></tr>`).join("")}</table></body></html>`;
    const w=window.open("","_blank","width=800,height=600");
    w.document.write(html);w.document.close();
    setTimeout(()=>w.print(),500);
  };

  // Year-over-year data
  const yoyData=useMemo(()=>Array.from({length:12},(_,i)=>{
    const mo=String(i+1).padStart(2,"0");
    const name=new Date(`${year}-${mo}-02`).toLocaleString("default",{month:"short"});
    const curInc=txns.filter(t=>t.type==="income"&&t.date?.startsWith(`${year}-${mo}`)).reduce((s,t)=>s+t.amount,0);
    const curExp=[...txns,...(vacationTxns||[])].filter(t=>t.type==="expense"&&t.date?.startsWith(`${year}-${mo}`)).reduce((s,t)=>s+t.amount,0);
    const prevInc=txns.filter(t=>t.type==="income"&&t.date?.startsWith(`${year-1}-${mo}`)).reduce((s,t)=>s+t.amount,0);
    const prevExp=[...txns,...(vacationTxns||[])].filter(t=>t.type==="expense"&&t.date?.startsWith(`${year-1}-${mo}`)).reduce((s,t)=>s+t.amount,0);
    return{name,[`${year} Income`]:+curInc.toFixed(2),[`${year} Expenses`]:+curExp.toFixed(2),[`${year-1} Income`]:+prevInc.toFixed(2),[`${year-1} Expenses`]:+prevExp.toFixed(2)};
  }),[txns,vacationTxns,year]);

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
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <Btn full onClick={exportMonthlySummary}>Download CSV</Btn>
              <button onClick={printMonthlyReport} style={{flex:1,padding:"8px 16px",borderRadius:T.r,border:"1px solid "+T.border,background:T.overlay,fontSize:13,fontWeight:600,color:T.tx2,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Print / PDF</button>
            </div>
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

      {/* Year-over-year chart */}
      <div style={{...CA,marginTop:24}}>
        <div style={{fontSize:15,fontWeight:700,color:T.tx1,marginBottom:4}}>Year-over-Year Comparison</div>
        <div style={{fontSize:12,color:T.tx3,marginBottom:16}}>{year} vs {year-1} — monthly income and expenses</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={yoyData} barCategoryGap="20%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
            <XAxis dataKey="name" tick={{fontSize:11,fill:T.tx3}}/>
            <YAxis tick={{fontSize:11,fill:T.tx3}} tickFormatter={v=>v>=1000?`$${(v/1000).toFixed(0)}k`:`$${v}`}/>
            <Tooltip formatter={(v,n)=>[nfmt(v),n]} contentStyle={{fontSize:12,borderRadius:8,border:"1px solid "+T.border}}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            <Bar dataKey={`${year} Income`} fill="#059669" radius={[3,3,0,0]}/>
            <Bar dataKey={`${year} Expenses`} fill="#dc2626" radius={[3,3,0,0]}/>
            <Bar dataKey={`${year-1} Income`} fill="#86efac" radius={[3,3,0,0]}/>
            <Bar dataKey={`${year-1} Expenses`} fill="#fca5a5" radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Savings rate chart */}
      <div style={{...CA,marginTop:24}}>
        <div style={{fontSize:15,fontWeight:700,color:T.tx1,marginBottom:4}}>Savings Rate — Rolling 12 Months</div>
        <div style={{fontSize:12,color:T.tx3,marginBottom:16}}>(Income − Expenses) ÷ Income × 100</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={savingsRateData} margin={{left:-8,right:8,top:4,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
            <XAxis dataKey="name" tick={{fontSize:10,fill:T.tx3}}/>
            <YAxis tick={{fontSize:10,fill:T.tx3}} tickFormatter={v=>v+"%"} domain={["auto","auto"]}/>
            <Tooltip formatter={(v)=>[v!=null?v+"%":"—","Savings Rate"]} contentStyle={{fontSize:12,borderRadius:8,border:"1px solid "+T.border}}/>
            <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 2" strokeWidth={1}/>
            <ReferenceLine y={20} stroke="#059669" strokeDasharray="4 2" strokeWidth={1} label={{value:"20% goal",position:"right",fontSize:10,fill:"#059669"}}/>
            <Line type="monotone" dataKey="rate" stroke={T.accent} strokeWidth={2} dot={{r:3,fill:T.accent}} connectNulls/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* RRSP / TFSA Room Tracker */}
      <RrspTfsaTracker txns={txns}/>
    </div>
  );
}

function RrspTfsaTracker({txns}){
  const nfmt=useNfmt();
  const [data,setData]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("ch_rrsp_tfsa")||"{}");}catch{return {};}
  });
  const save=d=>{setData(d);localStorage.setItem("ch_rrsp_tfsa",JSON.stringify(d));};
  const [newContrib,setNewContrib]=useState({type:"rrsp",amount:"",date:today()});
  const addContrib=()=>{
    const amt=parseFloat(newContrib.amount);
    if(!amt||amt<=0) return;
    const list=[...(data.contributions||[]),{id:uid(),type:newContrib.type,amount:amt,date:newContrib.date}];
    save({...data,contributions:list});
    setNewContrib(p=>({...p,amount:""}));
  };
  const delContrib=id=>save({...data,contributions:(data.contributions||[]).filter(c=>c.id!==id)});
  const rrspRoom=parseFloat(data.rrspRoom)||0;
  const tfsaRoom=parseFloat(data.tfsaRoom)||0;
  const contributions=data.contributions||[];
  const rrspContribs=contributions.filter(c=>c.type==="rrsp").reduce((s,c)=>s+c.amount,0);
  const tfsaContribs=contributions.filter(c=>c.type==="tfsa").reduce((s,c)=>s+c.amount,0);
  const rrspRemaining=rrspRoom-rrspContribs;
  const tfsaRemaining=tfsaRoom-tfsaContribs;
  return(
    <div style={{...CA,marginTop:24}}>
      <div style={{fontSize:15,fontWeight:700,color:T.tx1,marginBottom:4}}>RRSP / TFSA Room Tracker</div>
      <div style={{fontSize:12,color:T.tx3,marginBottom:16}}>Track contributions against your annual room. Find your room on your CRA MyAccount or Notice of Assessment.</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
        {[{key:"rrspRoom",label:"RRSP Room",contrib:rrspContribs,remaining:rrspRemaining},{key:"tfsaRoom",label:"TFSA Room",contrib:tfsaContribs,remaining:tfsaRemaining}].map(r=>(
          <div key={r.key} style={{background:T.overlay,borderRadius:T.r,padding:"14px 16px",border:"1px solid "+T.border}}>
            <div style={{fontSize:12,fontWeight:600,color:T.tx1,marginBottom:10}}>{r.label}</div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:11,color:T.tx3}}>Room $</span>
              <input type="number" min="0" value={data[r.key]||""} onChange={e=>save({...data,[r.key]:e.target.value})} placeholder="0" style={{...IS,width:110,fontSize:13}}/>
            </div>
            {parseFloat(data[r.key])>0&&(
              <div>
                <div style={{fontSize:12,color:T.tx2}}>Contributed: <span style={{fontWeight:600,color:T.tx1}}>{nfmt(r.contrib)}</span></div>
                <div style={{fontSize:12,color:r.remaining<0?"#dc2626":"#059669",marginTop:2}}>Remaining: <span style={{fontWeight:600}}>{nfmt(Math.abs(r.remaining))} {r.remaining<0?"OVER-CONTRIBUTED":""}</span></div>
                {r.remaining>0&&<div style={{height:4,borderRadius:99,background:T.border,overflow:"hidden",marginTop:6}}><div style={{height:"100%",borderRadius:99,width:Math.min(r.contrib/parseFloat(data[r.key])*100,100)+"%",background:T.accent}}/></div>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:600,color:T.tx1,marginBottom:8}}>Log a Contribution</div>
        <div style={{display:"grid",gridTemplateColumns:"80px 1fr 120px auto",gap:8,alignItems:"center"}}>
          <select value={newContrib.type} onChange={e=>setNewContrib(p=>({...p,type:e.target.value}))} style={{...IS,fontSize:12}}>
            <option value="rrsp">RRSP</option><option value="tfsa">TFSA</option>
          </select>
          <input type="number" min="0" step="0.01" value={newContrib.amount} onChange={e=>setNewContrib(p=>({...p,amount:e.target.value}))} placeholder="Amount" style={{...IS,fontSize:13}}/>
          <input type="date" value={newContrib.date} onChange={e=>setNewContrib(p=>({...p,date:e.target.value}))} style={{...IS,fontSize:12}}/>
          <Btn onClick={addContrib} disabled={!newContrib.amount}>Add</Btn>
        </div>
      </div>
      {contributions.length>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {[...contributions].sort((a,b)=>b.date.localeCompare(a.date)).map(c=>(
            <div key={c.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",borderRadius:T.r,background:T.overlay}}>
              <span style={{fontSize:12,fontWeight:600,color:c.type==="rrsp"?T.accent:"#7c3aed"}}>{c.type.toUpperCase()}</span>
              <span style={{fontSize:12,color:T.tx2}}>{c.date}</span>
              <span style={{fontSize:13,fontWeight:600,color:T.tx1}}>{nfmt(c.amount)}</span>
              <button onClick={()=>delContrib(c.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:T.tx3,padding:0,lineHeight:1}}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Alerts & Notifications ────────────────────────────────────────────────────
// ── Alert computation (shared hook) ──────────────────────────────────────────

export { Reports };

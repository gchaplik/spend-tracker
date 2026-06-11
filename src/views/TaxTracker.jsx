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

// ── Tax Tracker ───────────────────────────────────────────────────────────────
const TAX_CATS=["Medical","Charitable Donation","Business Expense","Home Office","Childcare","Education","Moving","Investment","Other Deductible"];
const RRSP_LIMIT_2026=32490; // CRA 2026 limit
function TaxTracker({txns,taxItems,onSaveTaxItems,settings}){
  const [year,setYear]=useState(()=>new Date().getFullYear());
  const [rrspContrib,setRrspContrib]=useState(()=>taxItems.find(t=>t.type==="rrsp")?.amount||"");
  const [rrspRoom,setRrspRoom]=useState(()=>taxItems.find(t=>t.type==="rrsp")?.room||"");
  const [tfsa,setTfsa]=useState(()=>taxItems.find(t=>t.type==="tfsa")?.amount||"");
  const [marked,setMarked]=useState(()=>taxItems.filter(t=>t.type==="deductible")||[]);

  // persist on change
  useEffect(()=>{
    const items=[
      {type:"rrsp",amount:+rrspContrib||0,room:+rrspRoom||0},
      {type:"tfsa",amount:+tfsa||0},
      ...marked,
    ];
    onSaveTaxItems(items);
  },[rrspContrib,rrspRoom,tfsa,marked]);

  const yearTxns=txns.filter(t=>t.date?.startsWith(String(year)));
  const income=yearTxns.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const expenses=yearTxns.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);

  const markDeductible=(txnId,taxCat)=>{
    setMarked(prev=>{
      const existing=prev.find(m=>m.txnId===txnId);
      if(existing) return prev.map(m=>m.txnId===txnId?{...m,taxCat}:m);
      return[...prev,{type:"deductible",txnId,taxCat,year}];
    });
  };
  const unmark=txnId=>setMarked(prev=>prev.filter(m=>m.txnId!==txnId));
  const isMarked=txnId=>marked.find(m=>m.txnId===txnId);

  const deductByCategory={};
  marked.filter(m=>m.year===year||!m.year).forEach(m=>{
    const txn=txns.find(t=>t.id===m.txnId);
    if(!txn) return;
    deductByCategory[m.taxCat]=(deductByCategory[m.taxCat]||0)+txn.amount;
  });
  const totalDeductible=Object.values(deductByCategory).reduce((s,v)=>s+v,0);
  const rrspPct=rrspRoom>0?(+rrspContrib/+rrspRoom)*100:0;

  const years=[...new Set(txns.map(t=>t.date?.slice(0,4)).filter(Boolean))].sort((a,b)=>b-a);
  if(!years.includes(String(year))) years.unshift(String(year));

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div>
          <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Tax Tracker</div>
          <div style={{fontSize:13,color:"#64748b"}}>Tag deductible transactions and track RRSP/TFSA contributions.</div>
        </div>
        <select value={year} onChange={e=>setYear(+e.target.value)} style={{...IS,width:"auto",minWidth:100}}>
          {years.map(y=><option key={y}>{y}</option>)}
        </select>
      </div>

      {/* Summary row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
        {[
          {label:"Total Income",val:nfmt(income),color:"#059669"},
          {label:"Total Expenses",val:nfmt(expenses),color:"#ef4444"},
          {label:"Deductible Expenses",val:nfmt(totalDeductible),color:"#0284C7"},
          {label:"RRSP Contributed",val:nfmt(+rrspContrib||0),color:"#8b5cf6"},
        ].map(c=><div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div><div style={{fontSize:20,fontWeight:800,color:c.color}}>{c.val}</div></div>)}
      </div>

      {/* RRSP & TFSA */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:12}}>RRSP ({year})</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <Fld label="Contribution Room ($)"><input type="number" style={IS} value={rrspRoom} onChange={e=>setRrspRoom(e.target.value)} placeholder={String(RRSP_LIMIT_2026)}/></Fld>
            <Fld label="Amount Contributed ($)"><input type="number" style={IS} value={rrspContrib} onChange={e=>setRrspContrib(e.target.value)} placeholder="0"/></Fld>
          </div>
          {rrspRoom>0&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                <span style={{color:"#64748b"}}>Room used</span>
                <span style={{fontWeight:700}}>{rrspPct.toFixed(1)}%</span>
              </div>
              <div style={{background:"#f1f5f9",borderRadius:99,height:8}}>
                <div style={{height:8,borderRadius:99,background:rrspPct>=100?"#ef4444":"#8b5cf6",width:`${Math.min(100,rrspPct)}%`,transition:"width .4s"}}/>
              </div>
              <div style={{fontSize:11,color:"#64748b",marginTop:6}}>{nfmt(Math.max(0,+rrspRoom-+rrspContrib))} room remaining · Deadline: Mar 1 {year+1}</div>
            </>
          )}
        </div>
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:12}}>TFSA ({year})</div>
          <Fld label="Amount Contributed ($)"><input type="number" style={IS} value={tfsa} onChange={e=>setTfsa(e.target.value)} placeholder="0"/></Fld>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:8}}>2026 TFSA annual limit: $7,000 · Lifetime limit varies by birth year.</div>
        </div>
      </div>

      {/* Deductible categories summary */}
      {Object.keys(deductByCategory).length>0&&(
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>Deductible by Category</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(deductByCategory).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>(
              <div key={cat} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:12}}>
                <span style={{fontWeight:600}}>{cat}</span>
                <span style={{fontWeight:700,color:"#0284C7"}}>{nfmt(amt)}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",fontSize:13,fontWeight:700}}>
              <span>Total Deductible</span>
              <span style={{color:"#0284C7"}}>{nfmt(totalDeductible)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Transaction tagger */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:4}}>Tag Deductible Transactions</div>
        <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>Mark any expense as tax-deductible and assign a CRA category.</div>
        <div style={{maxHeight:400,overflowY:"auto"}}>
          {yearTxns.filter(t=>t.type==="expense").sort((a,b)=>b.date?.localeCompare(a.date)).map(t=>{
            const m=isMarked(t.id);
            return(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f1f5f9",background:m?"#f0f9ff":"transparent",borderRadius:m?8:0,paddingLeft:m?8:0,paddingRight:m?8:0,marginBottom:m?2:0}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant}</div>
                  <div style={{fontSize:11,color:"#94a3b8"}}>{t.date} · {nfmt(t.amount)}</div>
                </div>
                {m?(
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <select value={m.taxCat} onChange={e=>markDeductible(t.id,e.target.value)} style={{fontSize:11,border:"1px solid #bae6fd",borderRadius:6,padding:"2px 4px",fontFamily:"inherit"}}>
                      {TAX_CATS.map(c=><option key={c}>{c}</option>)}
                    </select>
                    <button onClick={()=>unmark(t.id)} style={{fontSize:11,padding:"3px 7px",border:"1px solid #fecaca",borderRadius:6,cursor:"pointer",background:"#fff5f5",color:"#ef4444",fontFamily:"inherit"}}>Untag</button>
                  </div>
                ):(
                  <select defaultValue="" onChange={e=>{if(e.target.value)markDeductible(t.id,e.target.value);}} style={{fontSize:11,border:"1px solid #e2e8f0",borderRadius:6,padding:"2px 4px",fontFamily:"inherit",color:"#94a3b8"}}>
                    <option value="">Tag as deductible…</option>
                    {TAX_CATS.map(c=><option key={c}>{c}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Retirement Planner ────────────────────────────────────────────────────────

export { TaxTracker, TAX_CATS, RRSP_LIMIT_2026 };

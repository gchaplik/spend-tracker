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

function NetWorth({accounts,accountHistory,onSaveAccounts,onSaveAccountHistory,holdings=[],stockPrices={},fxRate=1.38}){
  const nfmt=useNfmt();
  const [form,setForm]=useState({name:"",type:"chequing",balance:""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const [editId,setEditId]=useState(null);
  const [editBal,setEditBal]=useState("");
  const TYPES=[{v:"chequing",l:"Chequing",asset:true},{v:"savings",l:"Savings",asset:true},{v:"investment",l:"Investment / RRSP",asset:true},{v:"credit",l:"Credit Card",asset:false},{v:"loan",l:"Loan / Mortgage",asset:false},{v:"other",l:"Other",asset:true}];
  const isAsset=t=>TYPES.find(x=>x.v===t)?.asset!==false;
  const add=()=>{
    if(!form.name.trim())return;
    const bal=parseFloat(form.balance)||0;
    const acc={id:uid(),name:form.name.trim(),type:form.type,balance:bal};
    onSaveAccounts([...accounts,acc]);
    onSaveAccountHistory([...accountHistory,{id:uid(),accountId:acc.id,date:today(),balance:bal}]);
    setForm({name:"",type:"chequing",balance:""});
  };
  const saveBalance=id=>{
    const bal=parseFloat(editBal)||0;
    onSaveAccounts(accounts.map(a=>a.id===id?{...a,balance:bal}:a));
    onSaveAccountHistory([...accountHistory,{id:uid(),accountId:id,date:today(),balance:bal}]);
    setEditId(null);
  };
  const remove=id=>{onSaveAccounts(accounts.filter(a=>a.id!==id));onSaveAccountHistory(accountHistory.filter(h=>h.accountId!==id));};
  const assets=accounts.filter(a=>isAsset(a.type));
  const liabilities=accounts.filter(a=>!isAsset(a.type));
  const totalAssets=assets.reduce((s,a)=>s+a.balance,0);
  const totalLiab=liabilities.reduce((s,a)=>s+a.balance,0);
  const portfolioValue=holdings.reduce((s,h)=>{const cur=stockPrices[h.ticker]?.currency??(h.ticker.toUpperCase().endsWith('.TO')?'CAD':'USD');return s+(stockPrices[h.ticker]?.price??0)*h.shares*(cur==='USD'?fxRate:1);},0);
  const netWorth=totalAssets+portfolioValue-totalLiab;
  const AccountRow=({a})=>(
    <div style={{display:"flex",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #f8fafc",gap:10}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:500}}>{a.name}</div>
        <div style={{fontSize:11,color:"#94a3b8"}}>{TYPES.find(t=>t.v===a.type)?.l||a.type}</div>
      </div>
      {editId===a.id
        ?<div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="number" value={editBal} onChange={e=>setEditBal(e.target.value)} style={{...IS,width:100}} onKeyDown={e=>e.key==="Enter"&&saveBalance(a.id)} autoFocus/>
            <Btn sm onClick={()=>saveBalance(a.id)}>Save</Btn>
            <Btn sm v="secondary" onClick={()=>setEditId(null)}>✕</Btn>
          </div>
        :<>
          <div style={{fontSize:14,fontWeight:700,color:isAsset(a.type)?"#059669":"#dc2626"}}>{nfmt(a.balance)}</div>
          <button onClick={()=>{setEditId(a.id);setEditBal(String(a.balance));}} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
          <button onClick={()=>remove(a.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
        </>}
    </div>
  );
  return(
    <div>
      <h2 style={{margin:"0 0 22px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Accounts & Net Worth</h2>
      {(accounts.length>0||holdings.length>0)&&(
        <div style={{...CA,padding:"24px 28px",marginBottom:16,borderLeft:`4px solid ${netWorth>=0?"#0284C7":"#dc2626"}`}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Net Worth</div>
          <div style={{fontSize:40,fontWeight:800,color:netWorth>=0?"#059669":"#dc2626",letterSpacing:"-1.5px",marginBottom:10}}>{nfmt(netWorth)}</div>
          <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
            {totalAssets>0&&<span style={{fontSize:13,color:"#94a3b8"}}>Assets <span style={{color:"#059669",fontWeight:700}}>{nfmt(totalAssets)}</span></span>}
            {portfolioValue>0&&<span style={{fontSize:13,color:"#94a3b8"}}>Portfolio <span style={{color:"#0284C7",fontWeight:700}}>{nfmt(portfolioValue)}</span></span>}
            {totalLiab>0&&<span style={{fontSize:13,color:"#94a3b8"}}>Liabilities <span style={{color:"#dc2626",fontWeight:700}}>{nfmt(totalLiab)}</span></span>}
          </div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:assets.length>0&&liabilities.length>0?"1fr 1fr":"1fr",gap:16,marginBottom:16}}>
        {assets.length>0&&<div style={CA}><div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1E293B"}}>Assets <span style={{color:"#94a3b8",fontWeight:400,fontSize:12}}>· {nfmt(totalAssets)}</span></div>{assets.map(a=><AccountRow key={a.id} a={a}/>)}</div>}
        {liabilities.length>0&&<div style={CA}><div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1E293B"}}>Liabilities <span style={{color:"#94a3b8",fontWeight:400,fontSize:12}}>· {nfmt(totalLiab)}</span></div>{liabilities.map(a=><AccountRow key={a.id} a={a}/>)}</div>}
      </div>
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Add Account</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fld label="Account Name"><input style={IS} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. TD Chequing, Visa"/></Fld>
          <Fld label="Type"><select style={{...IS,background:"#fff"}} value={form.type} onChange={e=>set("type",e.target.value)}>{TYPES.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}</select></Fld>
        </div>
        <Fld label="Current Balance ($)" style={{marginBottom:12}}><input style={IS} type="number" value={form.balance} onChange={e=>set("balance",e.target.value)} placeholder="0.00"/></Fld>
        <Btn onClick={add} disabled={!form.name.trim()} full>Add Account</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT SCHEMA  (FinanceLookML)

export { NetWorth };

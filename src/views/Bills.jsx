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

function Bills({bills,billPayments,onSaveBills,onSaveBillPayments,onTogglePaid,cats}){
  const nfmt=useNfmt();
  const [form,setForm]=useState({name:"",amount:"",category:cats[0]||"Other",dueDay:"15",note:""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const monthOpts=Array.from({length:13},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-12+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const ml=m=>new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"});
  const [viewMonth,setViewMonth]=useState(today().slice(0,7));
  const [editId,setEditId]=useState(null);
  const [editBill,setEditBill]=useState({});
  const active=bills.filter(b=>b.active!==false);
  const isPaid=(id,mo=viewMonth)=>billPayments.some(p=>p.billId===id&&p.month===mo);
  const togglePaid=id=>{
    if(onTogglePaid){onTogglePaid(id,viewMonth);return;}
    if(isPaid(id)){onSaveBillPayments(billPayments.filter(p=>!(p.billId===id&&p.month===viewMonth)));}
    else{const b=bills.find(x=>x.id===id);onSaveBillPayments([...billPayments,{id:uid(),billId:id,month:viewMonth,paidDate:today(),amount:b.amount}]);}
  };
  const add=()=>{
    if(!form.name.trim()||!form.amount)return;
    onSaveBills([...bills,{id:uid(),name:form.name.trim(),amount:parseFloat(form.amount)||0,category:form.category,dueDay:parseInt(form.dueDay)||15,note:form.note,active:true}]);
    setForm({name:"",amount:"",category:cats[0]||"Other",dueDay:"15",note:""});
  };
  const remove=id=>onSaveBills(bills.filter(b=>b.id!==id));
  const startEdit=b=>{setEditId(b.id);setEditBill({name:b.name,amount:String(b.amount),category:b.category||cats[0]||"Other",dueDay:String(b.dueDay||15),note:b.note||""});};
  const saveEdit=()=>{
    if(!editBill.name.trim()||!editBill.amount)return;
    onSaveBills(bills.map(b=>b.id===editId?{...b,name:editBill.name.trim(),amount:parseFloat(editBill.amount)||0,category:editBill.category,dueDay:parseInt(editBill.dueDay)||15,note:editBill.note}:b));
    setEditId(null);
  };
  const paidAmt=active.filter(b=>isPaid(b.id)).reduce((s,b)=>s+b.amount,0);
  const totalAmt=active.reduce((s,b)=>s+b.amount,0);
  const sorted=[...active].sort((a,b)=>a.dueDay-b.dueDay);
  const ordinal=n=>n+(n===1?"st":n===2?"nd":n===3?"rd":"th");
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Bills</h2>
        <select value={viewMonth} onChange={e=>setViewMonth(e.target.value)} style={{padding:"8px 14px",borderRadius:10,border:"1.5px solid #e2e8f0",fontSize:13,background:"#fff",fontFamily:"inherit",color:"#1E293B",fontWeight:500}}>
          {monthOpts.map(m=><option key={m} value={m}>{ml(m)}</option>)}
        </select>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:16}}>
        {[{l:"Monthly Total",v:totalAmt,c:"#1E293B"},{l:"Paid",v:paidAmt,c:"#059669"},{l:"Remaining",v:totalAmt-paidAmt,c:totalAmt-paidAmt>0?"#dc2626":"#059669"}].map(card=>(
          <div key={card.l} style={{...CA,padding:"16px 20px"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{card.l}</div>
            <div style={{fontSize:22,fontWeight:800,color:card.c,letterSpacing:"-0.5px"}}>{nfmt(card.v)}</div>
          </div>
        ))}
      </div>
      <div style={{...CA,marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Add Recurring Bill</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fld label="Bill Name"><input style={IS} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Netflix, Rent, Phone"/></Fld>
          <Fld label="Amount ($)"><input style={IS} type="number" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Category"><select style={{...IS,background:"#fff"}} value={form.category} onChange={e=>set("category",e.target.value)}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>
          <Fld label="Due Day of Month"><input style={IS} type="number" min="1" max="28" value={form.dueDay} onChange={e=>set("dueDay",e.target.value)}/></Fld>
        </div>
        <Fld label="Note (optional)" style={{marginBottom:12}}><input style={IS} value={form.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
        <Btn onClick={add} disabled={!form.name.trim()||!form.amount} full>Add Bill</Btn>
      </div>
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Bills for {ml(viewMonth)}</div>
        {sorted.length===0?<div style={{color:"#94a3b8",fontSize:13}}>No bills yet. Add recurring bills above.</div>:sorted.map(b=>{
          const paid=isPaid(b.id);
          if(editId===b.id) return(
            <div key={b.id} style={{padding:"14px 0",borderBottom:"1px solid #f1f5f9"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <Fld label="Bill Name"><input style={IS} value={editBill.name} onChange={e=>setEditBill(p=>({...p,name:e.target.value}))} autoFocus/></Fld>
                <Fld label="Amount ($)"><input style={IS} type="number" value={editBill.amount} onChange={e=>setEditBill(p=>({...p,amount:e.target.value}))}/></Fld>
                <Fld label="Category"><select style={{...IS,background:"#fff"}} value={editBill.category} onChange={e=>setEditBill(p=>({...p,category:e.target.value}))}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>
                <Fld label="Due Day of Month"><input style={IS} type="number" min="1" max="28" value={editBill.dueDay} onChange={e=>setEditBill(p=>({...p,dueDay:e.target.value}))}/></Fld>
                <Fld label="Note" style={{gridColumn:"1/-1"}}><input style={IS} value={editBill.note} onChange={e=>setEditBill(p=>({...p,note:e.target.value}))} placeholder="Optional"/></Fld>
              </div>
              <div style={{display:"flex",gap:8}}>
                <Btn sm onClick={saveEdit} disabled={!editBill.name.trim()||!editBill.amount}>Save</Btn>
                <Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn>
              </div>
            </div>
          );
          return(
            <div key={b.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid #f8fafc"}}>
              <button onClick={()=>togglePaid(b.id)} style={{width:26,height:26,borderRadius:"50%",background:paid?"#d1fae5":"transparent",border:`2px solid ${paid?"#059669":"#e2e8f0"}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all 0.15s",fontFamily:"inherit"}}>
                {paid&&<span style={{fontSize:11,color:"#059669"}}>✓</span>}
              </button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:paid?"#94a3b8":"#1E293B",textDecoration:paid?"line-through":"none"}}>{b.name}</div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>Due {ordinal(b.dueDay)} · {b.category}{b.note?" · "+b.note:""}</div>
              </div>
              <div style={{fontSize:14,fontWeight:700,color:paid?"#94a3b8":"#dc2626"}}>{nfmt(b.amount)}</div>
              <button onClick={()=>startEdit(b)} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit",flexShrink:0}}>Edit</button>
              <button onClick={()=>remove(b.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit",flexShrink:0}}>Remove</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export { Bills };

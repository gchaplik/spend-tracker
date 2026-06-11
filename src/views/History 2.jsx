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
import { learnCategory } from "../utils/catLearn.js";

function History({txns,cats,onUpdate,fMonth,setFMonth,onToast}){
  const [fCat,setFCat]=useState("all");
  const [search,setSearch]=useState("");
  const [editId,setEditId]=useState(null);
  const [ed,setEd]=useState({});
  const [expanded,setExpanded]=useState(new Set());
  const [editGroupId,setEditGroupId]=useState(null);
  const [gEd,setGEd]=useState({});
  const [selectMode,setSelectMode]=useState(false);
  const [selected,setSelected]=useState(new Set());
  const months=[...new Set(txns.map(t=>t.date&&t.date.slice(0,7)).filter(Boolean))].sort().reverse();
  const sq=search.toLowerCase().trim();
  const filtered=txns.filter(t=>{
    if(fMonth!=="all"&&!(t.date&&t.date.startsWith(fMonth))) return false;
    if(fCat!=="all"){if(fCat==="income"&&t.type!=="income")return false;if(fCat!=="income"&&(t.type!=="expense"||t.category!==fCat))return false;}
    if(sq){const hay=((t.merchant||t.source||"")+" "+(t.note||"")+" "+(t.category||"")+" "+String(t.amount||"")).toLowerCase();if(!hay.includes(sq))return false;}
    return true;
  });
  const exportCSV=()=>{
    const rows=[["Date","Type","Merchant","Amount","Category","Note"]];
    filtered.forEach(t=>rows.push([t.date||"",t.type,t.merchant||t.source||"",t.amount,t.category||"",t.note||""]));
    const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\n");
    const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download="transactions-"+(fMonth==="all"?"all":fMonth)+".csv";a.click();
  };
  const groupMap={};
  const displayItems=[];
  filtered.forEach(t=>{if(t.groupId){(groupMap[t.groupId]=groupMap[t.groupId]||[]).push(t);}else displayItems.push({kind:"single",t,sortDate:t.date||""});});
  Object.keys(groupMap).forEach(gid=>{const gTxns=[...groupMap[gid]].sort((a,b)=>(a.date||"").localeCompare(b.date||""));displayItems.push({kind:"group",groupId:gid,txns:gTxns,sortDate:gTxns[gTxns.length-1]?gTxns[gTxns.length-1].date||"":""});});
  displayItems.sort((a,b)=>b.sortDate.localeCompare(a.sortDate));
  const del=id=>{const prev=[...txns];onUpdate(txns.filter(t=>t.id!==id));onToast&&onToast("Transaction deleted",()=>onUpdate(prev));};
  const delGroup=gid=>{const prev=[...txns];onUpdate(txns.filter(t=>t.groupId!==gid));onToast&&onToast("Recurring group deleted",()=>onUpdate(prev));};
  const startEdit=t=>{setEditId(t.id);setEd({...t});};
  const saveEdit=()=>{
    const orig=txns.find(t=>t.id===editId);
    const updated={...ed,amount:parseFloat(ed.amount)||0};
    if(orig&&updated.category&&updated.category!==orig.category&&(updated.merchant||updated.source)){
      learnCategory(updated.merchant||updated.source,updated.category);
    }
    onUpdate(txns.map(t=>t.id===editId?updated:t));
    setEditId(null);
  };
  const toggleExpand=gid=>setExpanded(prev=>{const n=new Set(prev);n.has(gid)?n.delete(gid):n.add(gid);return n;});
  const startEditGroup=(gid,gTxns)=>{const rep=gTxns[0];setEditGroupId(gid);setGEd({merchant:rep.merchant||rep.source||"",amount:String(rep.amount||""),category:rep.category||cats[0]||"Other",cadence:rep.cadence||"monthly",startDate:gTxns[0].date||today(),occurrences:String(gTxns.length),note:rep.note||"",type:rep.type});};
  const saveGroup=()=>{const amtNum=parseFloat(gEd.amount)||0;const count=Math.max(1,parseInt(gEd.occurrences)||1);const dates=buildDates(gEd.startDate,gEd.cadence,count);const newEntries=dates.map(date=>({id:uid(),groupId:editGroupId,cadence:gEd.cadence,type:gEd.type,merchant:gEd.merchant,source:gEd.merchant,amount:amtNum,date:date,category:gEd.type==="expense"?gEd.category:undefined,note:gEd.note}));onUpdate([...txns.filter(t=>t.groupId!==editGroupId),...newEntries]);setEditGroupId(null);};
  const totI=filtered.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const totE=filtered.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  const ss={padding:"7px 10px",borderRadius:7,border:"1px solid #d1d5db",fontSize:12,background:"#fff",fontFamily:"inherit"};
  const rBtn=(onClick,bdr,col,txt)=><button onClick={onClick} style={{background:"none",border:"1px solid "+bdr,borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:col,fontFamily:"inherit"}}>{txt}</button>;
  const toggleSelect=id=>setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleGroup=(gTxns,allSelected)=>setSelected(prev=>{const n=new Set(prev);gTxns.forEach(t=>allSelected?n.delete(t.id):n.add(t.id));return n;});
  const exitSelect=()=>{setSelectMode(false);setSelected(new Set());};
  const deleteSelected=()=>{const prev=[...txns];onUpdate(txns.filter(t=>!selected.has(t.id)));onToast&&onToast(`${selected.size} transaction${selected.size!==1?"s":""} deleted`,()=>onUpdate(prev));exitSelect();};
  const selectedIds=[...selected];
  const selectedGroups=[...new Set(selectedIds.map(id=>{const t=txns.find(x=>x.id===id);return t?.groupId;}).filter(Boolean))];
  const canEditGroup=selectedGroups.length===1&&selectedIds.every(id=>{const t=txns.find(x=>x.id===id);return t?.groupId===selectedGroups[0];});
  if(editGroupId){
    const gCount=Math.max(1,parseInt(gEd.occurrences)||1);const gAmt=parseFloat(gEd.amount)||0;
    return (
      <div style={{width:"100%"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}><button onClick={()=>setEditGroupId(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#9ca3af",padding:0,fontFamily:"inherit"}}>←</button><h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Edit Recurring Group</h2></div>
        <div style={CA}>
          <div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,padding:"10px 13px",marginBottom:16,fontSize:12,color:"#92400e"}}>This replaces all entries in this group with new ones based on your updated settings.</div>
          <Fld label="Merchant / Source"><input style={IS} value={gEd.merchant} onChange={e=>setGEd(p=>({...p,merchant:e.target.value}))}/></Fld>
          <Fld label="Amount per payment ($)"><input style={IS} type="number" value={gEd.amount} onChange={e=>setGEd(p=>({...p,amount:e.target.value}))}/></Fld>
          {gEd.type==="expense"&&<Fld label="Category"><select style={{...IS,background:"#fff"}} value={gEd.category} onChange={e=>setGEd(p=>({...p,category:e.target.value}))}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>}
          <Fld label="Start Date"><input style={IS} type="date" value={gEd.startDate} onChange={e=>setGEd(p=>({...p,startDate:e.target.value}))}/></Fld>
          <Fld label="Cadence"><select style={{...IS,background:"#fff"}} value={gEd.cadence} onChange={e=>setGEd(p=>({...p,cadence:e.target.value}))}>{CADENCES.filter(c=>c.v!=="once").map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></Fld>
          <Fld label="Number of entries"><input style={IS} type="number" min="1" max="120" value={gEd.occurrences} onChange={e=>setGEd(p=>({...p,occurrences:e.target.value}))}/></Fld>
          <Fld label="Note (optional)" style={{marginBottom:12}}><input style={IS} value={gEd.note} onChange={e=>setGEd(p=>({...p,note:e.target.value}))}/></Fld>
          {gAmt>0&&<div style={{background:"#f0f9ff",border:"1px solid #7dd3fc",borderRadius:8,padding:"10px 13px",marginBottom:16,fontSize:13,color:"#0284C7"}}>{gCount} entries of {nfmt(gAmt)} = <strong>{nfmt(gAmt*gCount)}</strong> — {cLabel(gEd.cadence).toLowerCase()}, starting {gEd.startDate}</div>}
          <div style={{display:"flex",gap:8}}><Btn onClick={saveGroup} disabled={!gEd.merchant.trim()||!gEd.amount} full>Save Group</Btn><Btn v="secondary" onClick={()=>setEditGroupId(null)}>Cancel</Btn></div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
        <h2 style={{margin:0,fontSize:19,fontWeight:600,marginRight:"auto"}}>History</h2>
        <select value={fMonth} onChange={e=>setFMonth(e.target.value)} style={ss}><option value="all">All Months</option>{months.map(m=><option key={m} value={m}>{new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"})}</option>)}</select>
        <select value={fCat} onChange={e=>setFCat(e.target.value)} style={ss}><option value="all">All Types</option><option value="income">Income</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <button onClick={()=>{setSelectMode(s=>!s);setSelected(new Set());}} style={{padding:"7px 12px",borderRadius:7,border:"1px solid "+(selectMode?"#0284C7":"#bae6fd"),fontSize:12,background:selectMode?"#eff6ff":"#fff",color:selectMode?"#0284C7":"#1E293B",cursor:"pointer",fontFamily:"inherit",fontWeight:selectMode?600:400}}>Select</button>
        <button onClick={exportCSV} disabled={filtered.length===0} style={{padding:"7px 12px",borderRadius:7,border:"1px solid #bae6fd",fontSize:12,background:"#fff",color:"#0284C7",cursor:filtered.length===0?"not-allowed":"pointer",fontFamily:"inherit",opacity:filtered.length===0?0.4:1}}>Export CSV</button>
      </div>
      <div style={{marginBottom:14}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search merchant, category, note, amount…" style={{...IS,borderRadius:10,paddingLeft:13}}/>
      </div>
      {selectMode&&selected.size>0&&(
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,padding:"10px 14px",background:"#f0f9ff",borderRadius:8,border:"1px solid #7dd3fc",flexWrap:"wrap"}}>
          <span style={{fontSize:13,fontWeight:500,color:"#0284C7",marginRight:"auto"}}>{selected.size} selected</span>
          {canEditGroup&&<Btn sm onClick={()=>{const gTxns=txns.filter(t=>t.groupId===selectedGroups[0]);startEditGroup(selectedGroups[0],gTxns);exitSelect();}}>Edit Group</Btn>}
          <Btn sm v="danger" onClick={deleteSelected}>Delete Selected</Btn>
          <Btn sm v="secondary" onClick={exitSelect}>Cancel</Btn>
        </div>
      )}
      {filtered.length>0&&<div style={{display:"flex",gap:16,marginBottom:12}}><span style={{fontSize:12,color:"#6b7280"}}>{filtered.length} transactions</span>{totI>0&&<span style={{fontSize:12,color:"#059669"}}>+{nfmt(totI)}</span>}{totE>0&&<span style={{fontSize:12,color:"#dc2626"}}>{nfmt(totE)}</span>}</div>}
      <div style={CA}>
        {displayItems.length===0?<div style={{color:"#9ca3af",fontSize:13}}>No transactions found</div>:displayItems.map(item=>{
          if(item.kind==="group"){
            const gid=item.groupId,gTxns=item.txns,rep=gTxns[0];
            const isExp=expanded.has(gid);
            const total=gTxns.reduce((s,t)=>s+t.amount,0);
            const first=gTxns[0]?gTxns[0].date:"",last=gTxns[gTxns.length-1]?gTxns[gTxns.length-1].date:"";
            return (
              <div key={gid} style={{borderBottom:"1px solid #f3f4f6"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",flexWrap:"wrap"}}>
                  {selectMode&&(()=>{const allSel=gTxns.every(t=>selected.has(t.id));const someSel=gTxns.some(t=>selected.has(t.id));return<input type="checkbox" checked={allSel} ref={el=>{if(el)el.indeterminate=someSel&&!allSel;}} onChange={()=>toggleGroup(gTxns,allSel)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>;})()}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:500}}>{rep.merchant||rep.source}</span>
                      <span style={{fontSize:11,background:"#f0f9ff",color:"#0284C7",padding:"1px 7px",borderRadius:20,fontWeight:500}}>{cLabel(rep.cadence||"monthly")}</span>
                      <span style={{fontSize:11,color:"#9ca3af"}}>{gTxns.length} entries</span>
                    </div>
                    <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{first} – {last}{rep.category?" · "+rep.category:""}</div>
                  </div>
                  <div style={{fontWeight:600,fontSize:13,color:rep.type==="income"?"#059669":"#111827",whiteSpace:"nowrap"}}>{rep.type==="income"?"+":""}{nfmt(total)}</div>
                  {!selectMode&&<div style={{display:"flex",gap:5,flexShrink:0}}>
                    {rBtn(()=>toggleExpand(gid),"#e5e7eb","#6b7280",isExp?"Collapse":"Expand")}
                    {rBtn(()=>startEditGroup(gid,gTxns),"#bae6fd","#0284C7","Edit Group")}
                    {rBtn(()=>delGroup(gid),"#fecaca","#dc2626","Delete All")}
                  </div>}
                  {selectMode&&rBtn(()=>toggleExpand(gid),"#e5e7eb","#6b7280",isExp?"Collapse":"Expand")}
                </div>
                {isExp&&gTxns.map(t=>(
                  <div key={t.id} style={{marginLeft:16,borderLeft:"2px solid #e5e7eb",paddingLeft:12,background:selectMode&&selected.has(t.id)?"#eff6ff":"transparent",borderRadius:selectMode&&selected.has(t.id)?4:0}}>
                    {editId===t.id
                      ?<div style={{padding:"10px 0"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}><Fld label="Amount ($)"><input style={IS} type="number" value={ed.amount||""} onChange={e=>setEd(d=>({...d,amount:e.target.value}))}/></Fld><Fld label="Date"><input style={IS} type="date" value={ed.date||""} onChange={e=>setEd(d=>({...d,date:e.target.value}))}/></Fld><Fld label="Note"><input style={IS} value={ed.note||""} onChange={e=>setEd(d=>({...d,note:e.target.value}))}/></Fld></div><div style={{display:"flex",gap:8}}><Btn sm onClick={saveEdit}>Save</Btn><Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn></div></div>
                      :<div style={{display:"flex",alignItems:"center",padding:"7px 0",gap:10,borderBottom:"1px solid #f9fafb"}}>
                        {selectMode&&<input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleSelect(t.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>}
                        <div style={{flex:1}}><div style={{fontSize:12,color:"#1E293B"}}>{t.date}</div>{t.note&&<div style={{fontSize:11,color:"#9ca3af"}}>{t.note}</div>}</div>
                        <div style={{fontSize:12,fontWeight:500,color:t.type==="income"?"#059669":"#111827"}}>{t.type==="income"?"+":""}{nfmt(t.amount)}</div>
                        {!selectMode&&<div style={{display:"flex",gap:4}}>{rBtn(()=>startEdit(t),"#e5e7eb","#6b7280","Edit")}{rBtn(()=>del(t.id),"#fecaca","#dc2626","Delete")}</div>}
                      </div>}
                  </div>
                ))}
              </div>
            );
          }
          const t=item.t;
          return (
            <div key={t.id} style={{borderBottom:"1px solid #f3f4f6"}}>
              {editId===t.id
                ?<div style={{padding:"12px 0"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}><Fld label="Merchant / Source"><input style={IS} value={ed.merchant||ed.source||""} onChange={e=>setEd(d=>({...d,merchant:e.target.value,source:e.target.value}))}/></Fld><Fld label="Amount ($)"><input style={IS} type="number" value={ed.amount||""} onChange={e=>setEd(d=>({...d,amount:e.target.value}))}/></Fld><Fld label="Date"><input style={IS} type="date" value={ed.date||""} onChange={e=>setEd(d=>({...d,date:e.target.value}))}/></Fld>{ed.type==="expense"&&<Fld label="Category"><select style={{...IS,background:"#fff"}} value={ed.category||cats[0]} onChange={e=>setEd(d=>({...d,category:e.target.value}))}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>}<Fld label="Note"><input style={IS} value={ed.note||""} onChange={e=>setEd(d=>({...d,note:e.target.value}))}/></Fld></div><div style={{display:"flex",gap:8}}><Btn sm onClick={saveEdit}>Save</Btn><Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn></div></div>
                :<div style={{display:"flex",alignItems:"center",padding:"9px 0",gap:10,background:selectMode&&selected.has(t.id)?"#eff6ff":"transparent",borderRadius:4}}>
                  {selectMode&&<input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleSelect(t.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>}
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant||t.source}</div><div style={{fontSize:11,color:"#9ca3af"}}>{t.date} · {t.type==="income"?"Income":t.category||"Uncategorized"}{t.note?" · "+t.note:""}{t.originalAmountUSD?" · $"+t.originalAmountUSD.toFixed(2)+" USD @ "+Number(t.fxRate).toFixed(4):""}</div></div>
                  <div style={{fontWeight:600,fontSize:13,color:t.type==="income"?"#059669":"#111827",whiteSpace:"nowrap"}}>{t.type==="income"?"+":""}{nfmt(t.amount)}</div>
                  {!selectMode&&<div style={{display:"flex",gap:5,flexShrink:0}}>{rBtn(()=>startEdit(t),"#e5e7eb","#6b7280","Edit")}{rBtn(()=>del(t.id),"#fecaca","#dc2626","Delete")}</div>}
                </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}


export { History };

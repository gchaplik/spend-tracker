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

function ExpectedIncome({expected,onUpdate,onConfirm}){
  const [f,setF]=useState({source:"",amount:"",expectedDate:today(),recurrence:"once",note:"",currency:"CAD"});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const [fxRate,setFxRate]=useState(null);
  const [fxLoading,setFxLoading]=useState(false);
  const [fxError,setFxError]=useState(null);
  const [fxOverride,setFxOverride]=useState("");
  useEffect(()=>{
    if(f.currency!=="USD") return;
    setFxLoading(true);setFxError(null);
    fetchUsdCad(f.expectedDate)
      .then(rate=>{setFxRate(rate);setFxOverride(String(rate.toFixed(4)));})
      .catch(()=>setFxError("Could not fetch rate"))
      .finally(()=>setFxLoading(false));
  },[f.expectedDate,f.currency]);
  const [filter,setFilter]=useState("all");
  const [selectMode,setSelectMode]=useState(false);
  const [selected,setSelected]=useState(new Set());
  const toggleSel=id=>setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const exitSelect=()=>{setSelectMode(false);setSelected(new Set());};
  const deleteSelected=()=>{onUpdate(expected.filter(e=>!selected.has(e.id)));exitSelect();};
  const confirmSelected=()=>{[...selected].forEach(id=>onConfirm(id));exitSelect();};
  const allPendingSelected=[...selected].every(id=>{const e=expected.find(x=>x.id===id);return e&&!e.confirmed;});

  // How many times does a cadence fit from startDate to Dec 31 of that same year?
  const countForYear=(start,cadence)=>{
    const yearEnd=new Date(new Date(start+"T12:00:00").getFullYear(),11,31);
    let d=new Date(start+"T12:00:00"),count=1;
    while(true){
      const n=new Date(d);
      if(cadence==="weekly") n.setDate(n.getDate()+7);
      else if(cadence==="biweekly") n.setDate(n.getDate()+14);
      else if(cadence==="every15") n.setDate(n.getDate()+15);
      else if(cadence==="monthly") n.setMonth(n.getMonth()+1);
      else if(cadence==="bimonthly") n.setMonth(n.getMonth()+2);
      else if(cadence==="quarterly") n.setMonth(n.getMonth()+3);
      else if(cadence==="annually") n.setFullYear(n.getFullYear()+1);
      else break;
      if(n>yearEnd)break;
      count++;d=n;
    }
    return count;
  };

  const amtNum=parseFloat(f.amount)||0;
  const isUSD=f.currency==="USD";
  const effectiveRate=parseFloat(fxOverride)||fxRate||1;
  const cadAmt=isUSD?+(amtNum*effectiveRate).toFixed(2):amtNum;
  const recurring=f.recurrence!=="once";
  const yearCount=recurring?countForYear(f.expectedDate,f.recurrence):1;
  const recurrenceLabel=(CADENCES.find(c=>c.v===f.recurrence)||{l:""}).l;

  const add=()=>{
    if(!f.source.trim()||!f.amount) return;
    const fxMeta=isUSD?{originalAmountUSD:amtNum,fxRate:effectiveRate,fxDate:f.expectedDate}:{};
    const base={source:f.source.trim(),amount:cadAmt,expectedDate:f.expectedDate,note:f.note,confirmed:false,confirmedDate:null,...fxMeta};
    let items;
    if(recurring){
      const gid=uid();
      const dates=buildDates(f.expectedDate,f.recurrence,yearCount);
      items=dates.map(date=>({...base,id:uid(),expectedDate:date,groupId:gid,cadence:f.recurrence}));
    } else {
      items=[{...base,id:uid()}];
    }
    onUpdate([...expected,...items]);
    setF({source:"",amount:"",expectedDate:today(),recurrence:"once",note:"",currency:"CAD"});
    setFxRate(null);setFxOverride("");
  };
  const del=id=>onUpdate(expected.filter(e=>e.id!==id));

  // ── Inline edit state ──────────────────────────────────────────────────────
  const [editId,setEditId]=useState(null);
  const [ed,setEd]=useState({});
  const [edFxRate,setEdFxRate]=useState(null);
  const [edFxLoading,setEdFxLoading]=useState(false);
  const [edFxError,setEdFxError]=useState(null);
  const [edFxOverride,setEdFxOverride]=useState("");

  useEffect(()=>{
    if(!editId||ed.currency!=="USD") return;
    setEdFxLoading(true);setEdFxError(null);
    fetchUsdCad(ed.expectedDate)
      .then(rate=>{setEdFxRate(rate);setEdFxOverride(String(rate.toFixed(4)));})
      .catch(()=>setEdFxError("Could not fetch rate"))
      .finally(()=>setEdFxLoading(false));
  },[editId,ed.expectedDate,ed.currency]);

  const startEdit=e=>{
    setEditId(e.id);
    setEdFxRate(e.fxRate||null);
    setEdFxOverride(e.fxRate?String(Number(e.fxRate).toFixed(4)):"");
    setEd({source:e.source,amount:String(e.originalAmountUSD||e.amount),currency:e.originalAmountUSD?"USD":"CAD",expectedDate:e.expectedDate,note:e.note||""});
  };
  const saveEdit=()=>{
    const amtNum=parseFloat(ed.amount)||0;
    const edIsUSD=ed.currency==="USD";
    const edRate=parseFloat(edFxOverride)||edFxRate||1;
    const cadAmt=edIsUSD?+(amtNum*edRate).toFixed(2):amtNum;
    const fxMeta=edIsUSD?{originalAmountUSD:amtNum,fxRate:edRate,fxDate:ed.expectedDate}:{originalAmountUSD:undefined,fxRate:undefined,fxDate:undefined};
    onUpdate(expected.map(e=>e.id===editId?{...e,...fxMeta,source:ed.source.trim()||e.source,amount:cadAmt,expectedDate:ed.expectedDate,note:ed.note}:e));
    setEditId(null);
  };

  const pending=expected.filter(e=>!e.confirmed);
  const confirmed=expected.filter(e=>e.confirmed);
  const shown=filter==="pending"?pending:filter==="confirmed"?confirmed:expected;
  const sorted=[...shown].sort((a,b)=>(a.expectedDate||"").localeCompare(b.expectedDate||""));
  const thisYear=new Date().getFullYear().toString();
  const thisMonth=today().slice(0,7);
  const confirmedYear=confirmed.filter(e=>(e.expectedDate||"").startsWith(thisYear));
  const confirmedMonth=confirmed.filter(e=>(e.expectedDate||"").startsWith(thisMonth));

  // Extrapolate yearly: deduplicate recurring groups → amount × annual frequency + one-offs
  const timesPerYear=c=>({weekly:52,biweekly:26,every15:24,monthly:12,bimonthly:6,quarterly:4,annually:1}[c]||1);
  const allYear=expected.filter(e=>(e.expectedDate||"").startsWith(thisYear));
  const seenGroups=new Set();
  const projectedYearly=allYear.reduce((s,e)=>{
    if(e.groupId){
      if(seenGroups.has(e.groupId))return s;
      seenGroups.add(e.groupId);
      return s+e.amount*timesPerYear(e.cadence);
    }
    return s+e.amount; // one-off
  },0);
  const confirmedYearTotal=confirmedYear.reduce((s,e)=>s+e.amount,0);
  const confirmedMonthTotal=confirmedMonth.reduce((s,e)=>s+e.amount,0);

  const sumCards=[
    {l:`Projected Annual ${thisYear}`,v:projectedYearly,c:"#0284C7",sub:`${nfmt(confirmedYearTotal)} confirmed · ${nfmt(confirmedMonthTotal)} this month`},
    {l:"Total Scheduled",v:expected.reduce((s,e)=>s+e.amount,0),c:"#111827",sub:expected.length+" total"},
  ];
  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Expected Income</h2>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
        <div style={CA}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Add Expected Income</div>
          <Fld label="Source"><input style={IS} value={f.source} onChange={e=>set("source",e.target.value)} placeholder="e.g. Salary, Client payment"/></Fld>
          <Fld label="Currency">
            <div style={{display:"flex",gap:8}}>
              {["CAD","USD"].map(cur=>(
                <button key={cur} onClick={()=>set("currency",cur)} style={{flex:1,padding:"7px 0",borderRadius:8,border:`2px solid ${f.currency===cur?"#0284C7":"#e2e8f0"}`,background:f.currency===cur?"#f0f9ff":"#fff",color:f.currency===cur?"#0284C7":"#64748b",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
                  {cur==="CAD"?"CAD":"USD"}
                </button>
              ))}
            </div>
          </Fld>
          <Fld label={`Amount (${f.currency})`}><input style={IS} type="number" value={f.amount} onChange={e=>set("amount",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Expected Date"><input style={IS} type="date" value={f.expectedDate} onChange={e=>set("expectedDate",e.target.value)}/></Fld>
          <Fld label="Recurrence">
            <select style={{...IS,background:"#fff"}} value={f.recurrence} onChange={e=>set("recurrence",e.target.value)}>
              {CADENCES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </Fld>
          {isUSD&&amtNum>0&&(
            <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:10,padding:"11px 14px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
                <span style={{fontSize:11,fontWeight:700,color:"#0369a1",textTransform:"uppercase",letterSpacing:"0.05em"}}>USD → CAD</span>
                {fxLoading&&<span style={{fontSize:11,color:"#0284C7"}}>Fetching rate...</span>}
                {fxError&&<span style={{fontSize:11,color:"#dc2626"}}>{fxError}</span>}
                {!fxLoading&&!fxError&&fxRate&&<span style={{fontSize:11,color:"#0369a1"}}>Rate for {f.expectedDate}</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                <span style={{fontSize:12,color:"#0369a1",flexShrink:0}}>1 USD =</span>
                <input style={{...IS,width:90,padding:"5px 8px",fontSize:13}} type="number" step="0.0001" value={fxOverride} onChange={e=>setFxOverride(e.target.value)} placeholder={fxLoading?"…":"rate"}/>
                <span style={{fontSize:12,color:"#0369a1",flexShrink:0}}>CAD</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:12,color:"#0369a1"}}>${amtNum.toFixed(2)} USD × {effectiveRate.toFixed(4)}</span>
                <span style={{fontSize:16,fontWeight:800,color:"#0284C7"}}>{nfmt(cadAmt)} CAD</span>
              </div>
            </div>
          )}
          {recurring&&amtNum>0&&!isUSD&&(
            <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#0369a1",fontWeight:500}}>
              {yearCount} {recurrenceLabel.toLowerCase()} payments of <strong>{nfmt(amtNum)} CAD</strong> = <strong style={{fontWeight:800}}>{nfmt(amtNum*yearCount)} CAD</strong> through Dec&nbsp;{new Date(f.expectedDate+"T12:00:00").getFullYear()}
            </div>
          )}
          {recurring&&amtNum>0&&isUSD&&cadAmt>0&&(
            <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#0369a1",fontWeight:500}}>
              {yearCount} {recurrenceLabel.toLowerCase()} payments of <strong>${amtNum.toFixed(2)} USD</strong> ({nfmt(cadAmt)} CAD each) = <strong style={{fontWeight:800}}>{nfmt(cadAmt*yearCount)} CAD</strong> through Dec&nbsp;{new Date(f.expectedDate+"T12:00:00").getFullYear()}
            </div>
          )}
          <Fld label="Note (optional)" style={{marginBottom:16}}><input style={IS} value={f.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
          <Btn onClick={add} disabled={!f.source.trim()||!f.amount||(isUSD&&!effectiveRate)} full>{recurring?`Add ${yearCount} Entries`:"Add to Schedule"}</Btn>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {sumCards.map(item=>(
            <div key={item.l} style={{...CA,padding:"18px 20px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>{item.l}</div>
              <div style={{fontSize:24,fontWeight:800,color:item.c,letterSpacing:"-0.5px",lineHeight:1.1}}>{nfmt(item.v)}</div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:5,fontWeight:500}}>{item.sub}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={CA}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>Income Schedule</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <select value={filter} onChange={e=>setFilter(e.target.value)} style={{padding:"6px 10px",borderRadius:7,border:"1px solid #d1d5db",fontSize:12,background:"#fff",fontFamily:"inherit"}}>
              <option value="all">All</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option>
            </select>
            <button onClick={()=>{setSelectMode(s=>!s);setSelected(new Set());}} style={{padding:"6px 12px",borderRadius:7,border:"1px solid "+(selectMode?"#0284C7":"#bae6fd"),fontSize:12,background:selectMode?"#eff6ff":"#fff",color:selectMode?"#0284C7":"#1E293B",cursor:"pointer",fontFamily:"inherit",fontWeight:selectMode?600:400}}>Select</button>
          </div>
        </div>
        {selectMode&&selected.size>0&&(
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,padding:"10px 14px",background:"#f0f9ff",borderRadius:8,border:"1px solid #7dd3fc",flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:500,color:"#0284C7",marginRight:"auto"}}>{selected.size} selected</span>
            {allPendingSelected&&<Btn sm v="success" onClick={confirmSelected}>Confirm Selected</Btn>}
            <Btn sm v="danger" onClick={deleteSelected}>Delete Selected</Btn>
            <Btn sm v="secondary" onClick={exitSelect}>Cancel</Btn>
          </div>
        )}
        {sorted.length===0?<div style={{color:"#9ca3af",fontSize:13}}>No items</div>:sorted.map(e=>{
          const isPast=!e.confirmed&&e.expectedDate<today();
          const edIsUSD=ed.currency==="USD";
          const edRate=parseFloat(edFxOverride)||edFxRate||1;
          const edAmtNum=parseFloat(ed.amount)||0;
          const edCadAmt=edIsUSD?+(edAmtNum*edRate).toFixed(2):edAmtNum;

          if(editId===e.id) return(
            <div key={e.id} style={{padding:"14px 0",borderBottom:"1px solid #e0f2fe",background:"#f8fbff",borderRadius:8,marginBottom:2,paddingLeft:10,paddingRight:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <Fld label="Source" style={{gridColumn:"1/-1"}}><input style={IS} value={ed.source} onChange={e2=>setEd(p=>({...p,source:e2.target.value}))} autoFocus/></Fld>
                <Fld label="Currency" style={{gridColumn:"1/-1"}}>
                  <div style={{display:"flex",gap:8}}>
                    {["CAD","USD"].map(cur=>(
                      <button key={cur} onClick={()=>setEd(p=>({...p,currency:cur}))} style={{flex:1,padding:"6px 0",borderRadius:8,border:`2px solid ${ed.currency===cur?"#0284C7":"#e2e8f0"}`,background:ed.currency===cur?"#f0f9ff":"#fff",color:ed.currency===cur?"#0284C7":"#64748b",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                        {cur==="CAD"?"CAD":"USD"}
                      </button>
                    ))}
                  </div>
                </Fld>
                <Fld label={`Amount (${ed.currency})`}><input style={IS} type="number" value={ed.amount} onChange={e2=>setEd(p=>({...p,amount:e2.target.value}))}/></Fld>
                <Fld label="Expected Date"><input style={IS} type="date" value={ed.expectedDate} onChange={e2=>setEd(p=>({...p,expectedDate:e2.target.value}))}/></Fld>
                <Fld label="Note" style={{gridColumn:"1/-1"}}><input style={IS} value={ed.note} onChange={e2=>setEd(p=>({...p,note:e2.target.value}))} placeholder="Optional"/></Fld>
              </div>
              {edIsUSD&&edAmtNum>0&&(
                <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{fontSize:12,color:"#0369a1",flexShrink:0}}>1 USD =</span>
                    <input style={{...IS,width:90,padding:"4px 8px",fontSize:13}} type="number" step="0.0001" value={edFxOverride} onChange={e2=>setEdFxOverride(e2.target.value)} placeholder={edFxLoading?"…":"rate"}/>
                    <span style={{fontSize:12,color:"#0369a1",flexShrink:0}}>CAD</span>
                    {edFxLoading&&<span style={{fontSize:11,color:"#0284C7",marginLeft:"auto"}}>Fetching…</span>}
                    {edFxError&&<span style={{fontSize:11,color:"#dc2626",marginLeft:"auto"}}>{edFxError}</span>}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:12,color:"#0369a1"}}>${edAmtNum.toFixed(2)} USD × {edRate.toFixed(4)}</span>
                    <span style={{fontSize:15,fontWeight:800,color:"#0284C7"}}>{nfmt(edCadAmt)} CAD</span>
                  </div>
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <Btn sm onClick={saveEdit} disabled={!ed.source.trim()||!ed.amount}>Save</Btn>
                <Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn>
              </div>
            </div>
          );

          return (
            <div key={e.id} onClick={()=>!selectMode&&!e.confirmed&&startEdit(e)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f3f4f6",flexWrap:"wrap",background:selectMode&&selected.has(e.id)?"#eff6ff":"transparent",borderRadius:4,cursor:!selectMode&&!e.confirmed?"pointer":"default"}}>
              {selectMode&&<input type="checkbox" checked={selected.has(e.id)} onChange={()=>toggleSel(e.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>}
              <div style={{flex:1,minWidth:160}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13,fontWeight:500}}>{e.source}</span>
                  {isPast&&<span style={{fontSize:10,background:"#fee2e2",color:"#b91c1c",padding:"1px 7px",borderRadius:20,fontWeight:500}}>Overdue</span>}
                  {!e.confirmed&&!selectMode&&<span style={{fontSize:10,color:"#cbd5e1"}}>click to edit</span>}
                </div>
                <div style={{fontSize:11,color:"#9ca3af",marginTop:1}}>Expected {e.expectedDate}{e.note?" · "+e.note:""}{e.originalAmountUSD?" · $"+e.originalAmountUSD.toFixed(2)+" USD @ "+Number(e.fxRate).toFixed(4):""}</div>
                {e.confirmed&&<div style={{fontSize:11,color:"#059669",marginTop:1}}>Confirmed {e.confirmedDate}</div>}
              </div>
              <div style={{fontWeight:600,fontSize:13,color:e.confirmed?"#059669":"#0284C7",whiteSpace:"nowrap"}}>{nfmt(e.amount)}</div>
              {!selectMode&&<div style={{display:"flex",gap:6,flexShrink:0}} onClick={ev=>ev.stopPropagation()}>
                {!e.confirmed&&<Btn v="success" sm onClick={()=>onConfirm(e.id)}>Confirm</Btn>}
                <button onClick={()=>del(e.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>Remove</button>
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ExpectedIncome };

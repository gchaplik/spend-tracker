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

const SUB_CADENCES=[{v:"weekly",l:"Weekly",mo:4.33},{v:"monthly",l:"Monthly",mo:1},{v:"bimonthly",l:"Every 2 months",mo:0.5},{v:"quarterly",l:"Quarterly",mo:0.333},{v:"annually",l:"Annually",mo:0.0833}];
function SubscriptionManager({subscriptions,onSave,txns}){
  const blank={id:"",name:"",amount:"",cadence:"monthly",category:"Entertainment",url:"",trialEnd:"",active:true};
  const [form,setForm]=useState(blank);
  const [editing,setEditing]=useState(false);
  const [showDetect,setShowDetect]=useState(false);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  // Auto-detect potential subscriptions from transaction history
  const detected=useMemo(()=>{
    const merchantMap={};
    txns.filter(t=>t.type==="expense").forEach(t=>{
      const m=(t.merchant||"").toLowerCase().trim();
      if(!m) return;
      if(!merchantMap[m]) merchantMap[m]=[];
      merchantMap[m].push(t);
    });
    return Object.entries(merchantMap)
      .filter(([,ts])=>ts.length>=2)
      .map(([merchant,ts])=>{
        const amounts=ts.map(t=>t.amount);
        const avgAmt=amounts.reduce((s,v)=>s+v,0)/amounts.length;
        const consistent=amounts.every(a=>Math.abs(a-avgAmt)<avgAmt*0.1+1);
        const dates=ts.map(t=>t.date).sort();
        const gaps=dates.slice(1).map((d,i)=>Math.round((new Date(d)-new Date(dates[i]))/(1000*60*60*24)));
        const avgGap=gaps.reduce((s,v)=>s+v,0)/(gaps.length||1);
        const isMonthly=avgGap>=25&&avgGap<=35;
        const isAnnual=avgGap>=330&&avgGap<=400;
        if(!consistent||(gaps.length>0&&!isMonthly&&!isAnnual)) return null;
        const alreadyTracked=subscriptions.some(s=>s.name.toLowerCase()===merchant);
        if(alreadyTracked) return null;
        return{merchant:ts[0].merchant,amount:+avgAmt.toFixed(2),cadence:isAnnual?"annually":"monthly",count:ts.length,lastDate:dates[dates.length-1]};
      }).filter(Boolean).slice(0,10);
  },[txns,subscriptions]);

  const save=()=>{
    if(!form.name.trim()||!form.amount) return;
    const item={...form,id:form.id||uid(),amount:+form.amount,active:form.active!==false};
    onSave(form.id?subscriptions.map(s=>s.id===form.id?item:s):[...subscriptions,item]);
    setForm(blank);setEditing(false);
  };

  const totalMo=subscriptions.filter(s=>s.active!==false).reduce((sum,s)=>{
    const cad=SUB_CADENCES.find(c=>c.v===s.cadence)||SUB_CADENCES[1];
    return sum+s.amount*cad.mo;
  },0);

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Subscriptions</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Track recurring subscriptions and see your total monthly cost.</div>

      {/* Summary */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:24}}>
        {[
          {label:"Monthly Cost",val:nfmt(totalMo),color:"#ef4444"},
          {label:"Annual Cost",val:nfmt(totalMo*12),color:"#f59e0b"},
          {label:"Active",val:subscriptions.filter(s=>s.active!==false).length+" subs",color:"#0284C7"},
        ].map(c=><div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}><div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div><div style={{fontSize:22,fontWeight:800,color:c.color}}>{c.val}</div></div>)}
      </div>

      {/* Auto-detect banner */}
      {detected.length>0&&(
        <div style={{background:"#f0f9ff",borderRadius:14,border:"1px solid #bae6fd",padding:16,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showDetect?12:0}}>
            <div style={{fontSize:13,fontWeight:700,color:"#0369a1"}}>{detected.length} potential subscription{detected.length!==1?"s":""} detected from your history</div>
            <button onClick={()=>setShowDetect(p=>!p)} style={{fontSize:11,padding:"4px 10px",border:"1px solid #bae6fd",borderRadius:7,cursor:"pointer",background:"#fff",color:"#0369a1",fontFamily:"inherit"}}>{showDetect?"Hide":"Review"}</button>
          </div>
          {showDetect&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {detected.map(d=>(
                <div key={d.merchant} style={{display:"flex",alignItems:"center",gap:10,background:"#fff",borderRadius:8,padding:"8px 12px",border:"1px solid #e2e8f0"}}>
                  <div style={{flex:1,fontSize:12}}><strong>{d.merchant}</strong> · {nfmt(d.amount)}/{d.cadence} · seen {d.count}× (last: {d.lastDate})</div>
                  <button onClick={()=>{setForm({...blank,name:d.merchant,amount:String(d.amount),cadence:d.cadence});setEditing(true);setShowDetect(false);window.scrollTo(0,0);}} style={{fontSize:11,padding:"4px 10px",border:"1px solid #0284C7",borderRadius:7,cursor:"pointer",background:"#0284C7",color:"#fff",fontFamily:"inherit"}}>Add</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add/Edit form */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>{editing?"Edit Subscription":"Add Subscription"}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:12}}>
          <Fld label="Service Name *"><input style={IS} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Netflix, Spotify"/></Fld>
          <Fld label="Amount *"><input type="number" style={IS} value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Billing Cycle"><select style={IS} value={form.cadence} onChange={e=>set("cadence",e.target.value)}>{SUB_CADENCES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></Fld>
          <Fld label="Category"><input style={IS} value={form.category} onChange={e=>set("category",e.target.value)} placeholder="Entertainment"/></Fld>
          <Fld label="Cancellation URL"><input style={IS} value={form.url} onChange={e=>set("url",e.target.value)} placeholder="https://..."/></Fld>
          <Fld label="Trial Ends"><input type="date" style={IS} value={form.trialEnd} onChange={e=>set("trialEnd",e.target.value)}/></Fld>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}>
          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,cursor:"pointer"}}>
            <input type="checkbox" checked={form.active!==false} onChange={e=>set("active",e.target.checked)} style={{accentColor:"#0284C7"}}/>
            Active subscription
          </label>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={save} disabled={!form.name.trim()||!form.amount}>{editing?"Save Changes":"Add Subscription"}</Btn>
          {editing&&<Btn v="secondary" onClick={()=>{setForm(blank);setEditing(false);}}>Cancel</Btn>}
        </div>
      </div>

      {/* List */}
      {subscriptions.length===0&&<div style={{textAlign:"center",padding:40,color:"#94a3b8",fontSize:13}}>No subscriptions yet. Add one above or detect from your transaction history.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {subscriptions.map(s=>{
          const cad=SUB_CADENCES.find(c=>c.v===s.cadence)||SUB_CADENCES[1];
          const mo=+(s.amount*cad.mo).toFixed(2);
          const isTrialSoon=s.trialEnd&&s.trialEnd>today()&&Math.ceil((new Date(s.trialEnd)-new Date())/(86400000))<=7;
          return(
            <div key={s.id} style={{background:"#fff",borderRadius:12,border:`1px solid ${s.active===false?"#e2e8f0":"#bae6fd"}`,padding:"14px 16px",display:"flex",alignItems:"center",gap:12,opacity:s.active===false?0.55:1}}>
              <div style={{width:40,height:40,borderRadius:10,background:"#f0f9ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                {s.active===false?"Paused":"Active"}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <span style={{fontWeight:700,fontSize:14}}>{s.name}</span>
                  {isTrialSoon&&<span style={{fontSize:10,background:"#fef9c3",color:"#92400e",padding:"2px 6px",borderRadius:99,fontWeight:600}}>Trial ends soon</span>}
                  {s.active===false&&<span style={{fontSize:10,background:"#f1f5f9",color:"#64748b",padding:"2px 6px",borderRadius:99,fontWeight:600}}>Paused</span>}
                </div>
                <div style={{fontSize:11,color:"#64748b"}}>{nfmt(s.amount)}/{s.cadence} · {nfmt(mo)}/mo · {s.category}{s.trialEnd?` · Trial ends ${s.trialEnd}`:""}</div>
              </div>
              <div style={{fontWeight:800,fontSize:15,color:"#ef4444",marginRight:8}}>{nfmt(mo)}<span style={{fontSize:10,fontWeight:400,color:"#94a3b8"}}>/mo</span></div>
              <div style={{display:"flex",gap:6}}>
                {s.url&&<a href={s.url} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"4px 8px",border:"1px solid #e2e8f0",borderRadius:6,textDecoration:"none",color:"#0369a1",background:"#f0f9ff"}}>Cancel</a>}
                <button onClick={()=>{edit(s);}} style={{fontSize:11,padding:"4px 8px",border:"1px solid #bae6fd",borderRadius:6,cursor:"pointer",background:"#f0f9ff",color:"#0369a1",fontFamily:"inherit"}}>Edit</button>
                <button onClick={()=>onSave(subscriptions.filter(x=>x.id!==s.id))} style={{fontSize:11,padding:"4px 8px",border:"1px solid #fecaca",borderRadius:6,cursor:"pointer",background:"#fff5f5",color:"#ef4444",fontFamily:"inherit"}}>✕</button>
              </div>
            </div>
          );
          function edit(sub){setForm({...sub,amount:String(sub.amount)});setEditing(true);window.scrollTo(0,0);}
        })}
      </div>
    </div>
  );
}


export { SubscriptionManager, SUB_CADENCES };

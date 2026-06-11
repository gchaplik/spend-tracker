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

function WishlistPage({wishlist,onSave,txns,goals,onSaveGoals}){
  const blank={id:"",name:"",cost:"",priority:"nice-to-have",note:"",url:"",purchased:false};
  const [form,setForm]=useState(blank);
  const [editing,setEditing]=useState(false);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const last3=[0,1,2].map(i=>{const d=new Date();d.setMonth(d.getMonth()-i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const income3=txns.filter(t=>t.type==="income"&&last3.some(m=>t.date?.startsWith(m))).reduce((s,t)=>s+t.amount,0)/3;
  const exp3=txns.filter(t=>t.type==="expense"&&last3.some(m=>t.date?.startsWith(m))).reduce((s,t)=>s+t.amount,0)/3;
  const monthlySavings=Math.max(0,income3-exp3);

  const affordIn=(cost)=>monthlySavings>0?Math.ceil(cost/monthlySavings):null;

  const save=()=>{
    if(!form.name.trim()||!form.cost) return;
    const item={...form,id:form.id||uid(),cost:+form.cost};
    onSave(form.id?wishlist.map(w=>w.id===form.id?item:w):[...wishlist,item]);
    setForm(blank);setEditing(false);
  };

  const promoteToGoal=(item)=>{
    const g={id:uid(),name:item.name,target:item.cost,saved:0,note:item.note||"From Wishlist",dueDate:""};
    onSaveGoals([...goals,g]);
    onSave(wishlist.map(w=>w.id===item.id?{...w,promotedToGoal:true}:w));
  };

  const priorities=[["essential","Essential"],["want","Want"],["nice-to-have","Nice to Have"]];
  const sorted=[...wishlist].sort((a,b)=>{const o={essential:0,want:1,"nice-to-have":2};return(o[a.priority]||2)-(o[b.priority]||2);});

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Wishlist</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Track planned purchases and see when you can afford them based on your savings rate.</div>

      {monthlySavings>0&&(
        <div style={{background:"#f0f9ff",borderRadius:12,border:"1px solid #bae6fd",padding:"12px 16px",marginBottom:20,fontSize:12,display:"flex",alignItems:"center",gap:8}}>
          
          <span>You're currently saving <strong>{nfmt(monthlySavings)}/month</strong> on average. Affordability estimates are based on this rate.</span>
        </div>
      )}

      {/* Form */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>{editing?"Edit Item":"Add to Wishlist"}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:12}}>
          <Fld label="Item Name *"><input style={IS} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. MacBook Pro"/></Fld>
          <Fld label="Estimated Cost *"><input type="number" style={IS} value={form.cost} onChange={e=>set("cost",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Priority">
            <select style={IS} value={form.priority} onChange={e=>set("priority",e.target.value)}>
              {priorities.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </Fld>
          <Fld label="Link / URL"><input style={IS} value={form.url} onChange={e=>set("url",e.target.value)} placeholder="https://..."/></Fld>
          <Fld label="Note" style={{gridColumn:"span 2"}}><input style={IS} value={form.note} onChange={e=>set("note",e.target.value)} placeholder="Optional notes"/></Fld>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={save} disabled={!form.name.trim()||!form.cost}>{editing?"Save Changes":"Add Item"}</Btn>
          {editing&&<Btn v="secondary" onClick={()=>{setForm(blank);setEditing(false);}}>Cancel</Btn>}
        </div>
      </div>

      {wishlist.length===0&&<div style={{textAlign:"center",padding:40,color:"#94a3b8",fontSize:13}}>Your wishlist is empty. Add items above to start tracking.</div>}

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {sorted.map(item=>{
          const months=item.cost?affordIn(item.cost):null;
          const affordDate=months?new Date(new Date().setMonth(new Date().getMonth()+months)).toLocaleDateString("en-CA",{month:"short",year:"numeric"}):null;
          const priorityColor={essential:"#ef4444",want:"#f59e0b","nice-to-have":"#059669"}[item.priority]||"#64748b";
          return(
            <div key={item.id} style={{background:"#fff",borderRadius:12,border:`1px solid ${item.purchased?"#d1fae5":"#e2e8f0"}`,padding:"14px 16px",display:"flex",alignItems:"center",gap:12,opacity:item.purchased?0.6:1}}>
              <div style={{width:8,height:40,borderRadius:99,background:priorityColor,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                  <span style={{fontWeight:700,fontSize:14}}>{item.purchased?"✓ ":""}{item.name}</span>
                  {item.promotedToGoal&&<span style={{fontSize:10,background:"#f0fdf4",color:"#059669",padding:"2px 6px",borderRadius:99,fontWeight:600}}>→ Goal created</span>}
                </div>
                <div style={{fontSize:11,color:"#64748b"}}>{nfmt(item.cost)}{item.note?` · ${item.note}`:""}{affordDate&&!item.purchased?` · Affordable in ~${months} month${months!==1?"s":""} (${affordDate})`:""}</div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                {item.url&&<a href={item.url} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"4px 8px",border:"1px solid #e2e8f0",borderRadius:6,textDecoration:"none",color:"#64748b"}}>Link</a>}
                {!item.purchased&&!item.promotedToGoal&&<button onClick={()=>promoteToGoal(item)} style={{fontSize:11,padding:"4px 8px",border:"1px solid #bbf7d0",borderRadius:6,cursor:"pointer",background:"#f0fdf4",color:"#059669",fontFamily:"inherit"}}>→ Goal</button>}
                <button onClick={()=>onSave(wishlist.map(w=>w.id===item.id?{...w,purchased:!w.purchased}:w))} style={{fontSize:11,padding:"4px 8px",border:"1px solid #e2e8f0",borderRadius:6,cursor:"pointer",background:"#f8fafc",color:"#64748b",fontFamily:"inherit"}}>{item.purchased?"Unpurchase":"✓ Bought"}</button>
                <button onClick={()=>{setForm({...item,cost:String(item.cost)});setEditing(true);window.scrollTo(0,0);}} style={{fontSize:11,padding:"4px 8px",border:"1px solid #bae6fd",borderRadius:6,cursor:"pointer",background:"#f0f9ff",color:"#0369a1",fontFamily:"inherit"}}>Edit</button>
                <button onClick={()=>onSave(wishlist.filter(w=>w.id!==item.id))} style={{fontSize:11,padding:"4px 8px",border:"1px solid #fecaca",borderRadius:6,cursor:"pointer",background:"#fff5f5",color:"#ef4444",fontFamily:"inherit"}}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mortgage Calculator ───────────────────────────────────────────────────────

export { WishlistPage };

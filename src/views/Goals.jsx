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

function Goals({goals,onSaveGoals}){
  const nfmt=useNfmt();
  const [form,setForm]=useState({name:"",emoji:"",targetAmount:"",currentAmount:"",monthlyTarget:"",deadline:"",color:"#0284C7"});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const [contrib,setContrib]=useState({});
  const GOAL_COLORS=["#0284C7","#059669","#d97706","#7c3aed","#db2777","#0891b2"];
  const add=()=>{
    if(!form.name.trim()||!form.targetAmount)return;
    onSaveGoals([...goals,{id:uid(),name:form.name.trim(),emoji:form.emoji||"",targetAmount:parseFloat(form.targetAmount)||0,currentAmount:parseFloat(form.currentAmount)||0,monthlyTarget:parseFloat(form.monthlyTarget)||0,deadline:form.deadline,color:form.color,createdAt:today()}]);
    setForm({name:"",emoji:"",targetAmount:"",currentAmount:"",monthlyTarget:"",deadline:"",color:"#0284C7"});
  };
  const logContrib=id=>{
    const amt=parseFloat(contrib[id])||0;if(!amt)return;
    onSaveGoals(goals.map(g=>g.id===id?{...g,currentAmount:Math.min(g.currentAmount+amt,g.targetAmount)}:g));
    setContrib(p=>({...p,[id]:""}));
  };
  const remove=id=>onSaveGoals(goals.filter(g=>g.id!==id));
  return(
    <div>
      <h2 style={{margin:"0 0 22px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Savings Goals</h2>
      {goals.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14,marginBottom:16}}>
          {goals.map(g=>{
            const pct=g.targetAmount>0?Math.min(g.currentAmount/g.targetAmount,1):0;
            const remaining=Math.max(g.targetAmount-g.currentAmount,0);
            const monthsLeft=g.monthlyTarget>0&&remaining>0?Math.ceil(remaining/g.monthlyTarget):null;
            return(
              <div key={g.id} style={{...CA,padding:"20px"}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14}}>
                  <div><div style={{fontSize:24,marginBottom:4}}>{g.emoji}</div><div style={{fontSize:15,fontWeight:700,color:"#1E293B"}}>{g.name}</div>{g.deadline&&<div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>By {g.deadline}</div>}</div>
                  <button onClick={()=>remove(g.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#cbd5e1",fontSize:18,fontFamily:"inherit",padding:0,lineHeight:1}}>×</button>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:22,fontWeight:800,color:g.color||"#0284C7",letterSpacing:"-0.5px"}}>{nfmt(g.currentAmount)}</span>
                  <span style={{fontSize:13,color:"#94a3b8",alignSelf:"flex-end",marginBottom:2}}>of {nfmt(g.targetAmount)}</span>
                </div>
                <div style={{height:8,borderRadius:99,background:"#f1f5f9",overflow:"hidden",marginBottom:6}}>
                  <div style={{height:"100%",borderRadius:99,width:(pct*100)+"%",background:pct>=1?"#059669":g.color||"#0284C7",transition:"width 0.4s ease"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:pct<1?12:0}}>
                  <span style={{fontSize:11,color:"#94a3b8"}}>{Math.round(pct*100)}% saved</span>
                  {pct<1&&<span style={{fontSize:11,color:"#94a3b8"}}>{nfmt(remaining)} to go{monthsLeft?" · ~"+monthsLeft+" mo":""}</span>}
                  {pct>=1&&<span style={{fontSize:11,color:"#059669",fontWeight:600}}>Goal reached!</span>}
                </div>
                {pct<1&&(
                  <div style={{display:"flex",gap:8,borderTop:"1px solid #f1f5f9",paddingTop:10}}>
                    <input type="number" placeholder="Add amount" value={contrib[g.id]||""} onChange={e=>setContrib(p=>({...p,[g.id]:e.target.value}))} style={{...IS,flex:1}} onKeyDown={e=>e.key==="Enter"&&logContrib(g.id)}/>
                    <Btn sm onClick={()=>logContrib(g.id)} disabled={!contrib[g.id]}>Add</Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>{goals.length===0?"Create Your First Goal":"Add Another Goal"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fld label="Goal Name"><input style={IS} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Emergency Fund, House"/></Fld>
          
          <Fld label="Target Amount ($)"><input style={IS} type="number" value={form.targetAmount} onChange={e=>set("targetAmount",e.target.value)} placeholder="10000"/></Fld>
          <Fld label="Already Saved ($)"><input style={IS} type="number" value={form.currentAmount} onChange={e=>set("currentAmount",e.target.value)} placeholder="0"/></Fld>
          <Fld label="Monthly Target ($)"><input style={IS} type="number" value={form.monthlyTarget} onChange={e=>set("monthlyTarget",e.target.value)} placeholder="Optional"/></Fld>
          <Fld label="Target Date"><input style={IS} type="date" value={form.deadline} onChange={e=>set("deadline",e.target.value)}/></Fld>
        </div>
        <Fld label="Color">
          <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
            {GOAL_COLORS.map(c=><button key={c} onClick={()=>set("color",c)} style={{width:26,height:26,borderRadius:"50%",background:c,border:form.color===c?"3px solid #1E293B":"2px solid transparent",cursor:"pointer"}}/>)}
          </div>
        </Fld>
        <Btn onClick={add} disabled={!form.name.trim()||!form.targetAmount} full>Create Goal</Btn>
      </div>
    </div>
  );
}


export { Goals };

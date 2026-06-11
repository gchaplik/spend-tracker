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

function useAlerts({txns,bills,billPayments,catBudgets,goals,month,settings}){
  const discrete=!!settings?.discreteMode;
  const mfmt=(v)=>discrete?"●●●":fmt(v);
  return useMemo(()=>{
    const found=[];
    const curMonth=month||today().slice(0,7);
    const todayStr=today();

    bills.filter(b=>b.active!==false).forEach(b=>{
      const paid=billPayments.some(p=>p.billId===b.id&&p.month===curMonth);
      if(paid) return;
      const dueStr=curMonth+"-"+String(b.dueDay||15).padStart(2,"0");
      const daysUntil=Math.ceil((new Date(dueStr)-new Date(todayStr))/(1000*60*60*24));
      if(daysUntil<=3&&daysUntil>=-3){
        const over=daysUntil<0;
        found.push({id:"bill-"+b.id,title:`${b.name} ${over?"overdue":"due soon"}`,detail:`${mfmt(b.amount)} · ${over?Math.abs(daysUntil)+" days overdue":`due in ${daysUntil} day${daysUntil!==1?"s":""}`}`,severity:over?"high":"medium",category:"bill"});
      }
    });

    const mt=txns.filter(t=>t.type==="expense"&&t.date?.startsWith(curMonth));
    Object.entries(catBudgets).forEach(([cat,budget])=>{
      if(!budget) return;
      const spent=mt.filter(t=>t.category===cat).reduce((s,t)=>s+t.amount,0);
      const pct=spent/budget*100;
      if(pct>=100) found.push({id:"budget-over-"+cat,title:`${cat} budget exceeded`,detail:`${mfmt(spent)} of ${mfmt(budget)} — ${pct.toFixed(0)}% used`,severity:"high",category:"budget"});
      else if(pct>=80) found.push({id:"budget-warn-"+cat,title:`${cat} at ${pct.toFixed(0)}%`,detail:`${mfmt(spent)} of ${mfmt(budget)} used this month`,severity:"medium",category:"budget"});
    });

    goals.forEach(g=>{
      if(!g.target||!g.saved) return;
      const pct=g.saved/g.target*100;
      if(pct>=100) found.push({id:"goal-done-"+g.id,title:`Goal "${g.name}" complete!`,detail:`Saved ${mfmt(g.saved)} — target reached`,severity:"info",category:"goal"});
      else if(pct>=75) found.push({id:"goal-near-"+g.id,title:`Goal "${g.name}" at ${pct.toFixed(0)}%`,detail:`${mfmt(g.target-g.saved)} remaining`,severity:"info",category:"goal"});
    });

    const threshold=settings?.largeTransactionAlert||500;
    mt.filter(t=>t.amount>=threshold).forEach(t=>{
      found.push({id:"large-"+t.id,title:`Large charge: ${t.merchant||"Unknown"}`,detail:`${mfmt(t.amount)} on ${t.date}`,severity:"medium",category:"transaction"});
    });

    return found;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[txns,bills,billPayments,catBudgets,goals,month,settings,discrete]);
}

// Severity icon SVGs
function AlertIcon({severity}){
  const s={width:16,height:16,viewBox:"0 0 16 16",fill:"none",style:{flexShrink:0}};
  if(severity==="high") return(
    <svg {...s}><circle cx="8" cy="8" r="7" fill={T.red} opacity={0.12}/><path d="M8 5v3.5" stroke={T.red} strokeWidth={1.8} strokeLinecap="round"/><circle cx="8" cy="11" r="1" fill={T.red}/></svg>
  );
  if(severity==="medium") return(
    <svg {...s}><circle cx="8" cy="8" r="7" fill={T.amber} opacity={0.15}/><path d="M8 5v3.5" stroke={T.amber} strokeWidth={1.8} strokeLinecap="round"/><circle cx="8" cy="11" r="1" fill={T.amber}/></svg>
  );
  // info / goal
  return(
    <svg {...s}><circle cx="8" cy="8" r="7" fill={T.green} opacity={0.12}/><path d="M8 7v4" stroke={T.green} strokeWidth={1.8} strokeLinecap="round"/><circle cx="8" cy="5.5" r="1" fill={T.green}/></svg>
  );
}

function AlertsPanel({alerts,dismissed,onDismiss,onDismissAll,settings,onUpdateSettings,onEnable,onDisable}){
  const visible=alerts.filter(a=>!dismissed.has(a.id));
  const highCount=visible.filter(a=>a.severity==="high").length;
  const medCount=visible.filter(a=>a.severity==="medium").length;
  const infCount=visible.filter(a=>a.severity==="info").length;

  const severityBg={high:T.redBg,medium:T.amberBg,info:T.greenBg};
  const severityBorder={high:"#fecaca",medium:"#fde68a",info:"#bbf7d0"};

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px 12px",borderBottom:"1px solid "+T.border,flexShrink:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:T.tx1}}>Notifications</div>
          <div style={{fontSize:11,color:T.tx3,marginTop:2}}>
            {visible.length===0?"All clear":[highCount&&`${highCount} urgent`,medCount&&`${medCount} warnings`,infCount&&`${infCount} info`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {visible.length>0&&<button onClick={onDismissAll} style={{fontSize:11,padding:"4px 10px",border:"1px solid "+T.border,borderRadius:99,cursor:"pointer",background:T.overlay,color:T.tx2,fontFamily:"inherit",fontWeight:500}}>Clear all</button>}
          <button onClick={onDisable} title="Turn off notifications" style={{background:"none",border:"none",cursor:"pointer",color:T.tx3,fontFamily:"inherit",fontSize:11,padding:"4px 6px"}}>Turn off</button>
        </div>
      </div>

      {/* Alert list */}
      <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:8}}>
        {visible.length===0&&(
          <div style={{textAlign:"center",padding:"32px 0",color:T.tx3,fontSize:13}}>
            <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke={T.tx3} strokeWidth={1.5} style={{display:"block",margin:"0 auto 10px"}}><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            You're all caught up!
          </div>
        )}
        {visible.map(a=>(
          <div key={a.id} style={{display:"flex",alignItems:"flex-start",gap:10,background:severityBg[a.severity]||T.overlay,border:`1px solid ${severityBorder[a.severity]||T.border}`,borderRadius:T.r,padding:"10px 12px"}}>
            <div style={{marginTop:1}}><AlertIcon severity={a.severity}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13,color:T.tx1,lineHeight:1.3}}>{a.title}</div>
              <div style={{fontSize:11,color:T.tx2,marginTop:3}}>{a.detail}</div>
            </div>
            <button onClick={()=>onDismiss(a.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:T.tx3,padding:"0 2px",fontFamily:"inherit",lineHeight:1,flexShrink:0}}>×</button>
          </div>
        ))}
      </div>

      {/* Preferences */}
      <div style={{borderTop:"1px solid "+T.border,padding:"12px 16px",flexShrink:0}}>
        <div style={{fontSize:11,fontWeight:600,color:T.tx3,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>Preferences</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12,color:T.tx2}}>
          <span>Large transaction threshold</span>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{color:T.tx3,fontSize:11}}>$</span>
            <input type="number" min={50} step={50} value={settings?.largeTransactionAlert||500}
              onChange={e=>onUpdateSettings({...settings,largeTransactionAlert:+e.target.value})}
              style={{...IS,width:70,textAlign:"right",padding:"4px 8px",fontSize:12}}/>
          </div>
        </div>
      </div>
    </div>
  );
}

// Bell icon with slide-in drawer
function AlertsBell({alerts,dismissed,onDismiss,onDismissAll,settings,onUpdateSettings,onEnable,onDisable}){
  const [open,setOpen]=useState(false);
  const visible=alerts.filter(a=>!dismissed.has(a.id));
  const urgentCount=visible.filter(a=>a.severity==="high"||a.severity==="medium").length;

  return(
    <>
      <button onClick={()=>setOpen(v=>!v)} title="Notifications"
        style={{position:"relative",width:34,height:34,borderRadius:"50%",border:"1px solid "+(open?T.accent:T.border),background:open?T.accentBg:T.surface,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.background=T.accentBg;}}
        onMouseLeave={e=>{if(!open){e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.surface;}}}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={open?T.accent:T.tx2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        {urgentCount>0&&(
          <span style={{position:"absolute",top:-3,right:-3,minWidth:16,height:16,borderRadius:99,background:T.red,color:"#fff",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px",border:"2px solid "+T.surface,lineHeight:1}}>
            {urgentCount>9?"9+":urgentCount}
          </span>
        )}
      </button>

      {/* Backdrop */}
      {open&&<div style={{position:"fixed",inset:0,zIndex:1199}} onClick={()=>setOpen(false)}/>}

      {/* Drawer */}
      <div style={{position:"fixed",top:0,right:0,width:340,height:"100vh",background:T.surface,boxShadow:"-4px 0 24px rgba(0,0,0,0.10)",zIndex:1200,transform:open?"translateX(0)":"translateX(100%)",transition:"transform 0.22s cubic-bezier(.4,0,.2,1)",display:"flex",flexDirection:"column"}}>
        <AlertsPanel alerts={alerts} dismissed={dismissed} onDismiss={onDismiss} onDismissAll={onDismissAll} settings={settings} onUpdateSettings={onUpdateSettings} onEnable={onEnable} onDisable={()=>{onDisable();setOpen(false);}}/>
      </div>
    </>
  );
}


export { useAlerts, AlertIcon, AlertsPanel, AlertsBell };

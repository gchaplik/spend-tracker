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

function FinancialCalendar({bills,billPayments,expected,goals,vacations,txns}){
  const [calMonth,setCalMonth]=useState(()=>today().slice(0,7));
  const [selectedDay,setSelectedDay]=useState(null);

  const ym=calMonth;
  const firstDay=new Date(ym+"-01");
  const daysInMonth=new Date(firstDay.getFullYear(),firstDay.getMonth()+1,0).getDate();
  const startDow=firstDay.getDay(); // 0=Sun

  // Build events map keyed by YYYY-MM-DD
  const events=useMemo(()=>{
    const map={};
    const add=(date,ev)=>{if(!map[date])map[date]=[];map[date].push(ev);};

    // Bills
    bills.filter(b=>b.active!==false).forEach(b=>{
      const dueDate=ym+"-"+String(b.dueDay||15).padStart(2,"0");
      if(dueDate.startsWith(ym)){
        const paid=billPayments.some(p=>p.billId===b.id&&p.month===ym);
        add(dueDate,{type:"bill",label:b.name,amount:b.amount,paid,color:paid?"#059669":"#f59e0b",icon:"bill"});
      }
    });

    // Expected income
    expected.filter(e=>e.date?.startsWith(ym)).forEach(e=>{
      add(e.date,{type:"income",label:e.source,amount:e.amount,confirmed:e.confirmed,color:e.confirmed?"#059669":"#0284C7",icon:"income"});
    });

    // Actual transactions
    txns.filter(t=>t.date?.startsWith(ym)).forEach(t=>{
      add(t.date,{type:"txn",label:t.merchant||t.source,amount:t.amount,txnType:t.type,color:t.type==="income"?"#059669":"#94a3b8",icon:t.type==="income"?"income":"expense"});
    });

    // Vacations
    vacations.forEach(v=>{
      if(!v.startDate||!v.endDate) return;
      const s=new Date(v.startDate),e=new Date(v.endDate);
      for(let d=new Date(s);d<=e;d.setDate(d.getDate()+1)){
        const ds=d.toISOString().split("T")[0];
        if(ds.startsWith(ym)) add(ds,{type:"vacation",label:v.name,color:"#8b5cf6",icon:"trip"});
      }
    });

    return map;
  },[bills,billPayments,expected,vacations,txns,ym]);

  const prevMonth=()=>{const d=new Date(ym+"-01");d.setMonth(d.getMonth()-1);setCalMonth(d.toISOString().slice(0,7));setSelectedDay(null);};
  const nextMonth=()=>{const d=new Date(ym+"-01");d.setMonth(d.getMonth()+1);setCalMonth(d.toISOString().slice(0,7));setSelectedDay(null);};

  const cells=[];
  for(let i=0;i<startDow;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++) cells.push(d);
  while(cells.length%7!==0) cells.push(null);

  const todayStr=today();
  const monthName=firstDay.toLocaleString("default",{month:"long",year:"numeric"});

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Financial Calendar</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Bills, income, transactions, and vacations at a glance.</div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:20}}>
        {/* Calendar grid */}
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",overflow:"hidden"}}>
          {/* Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:"1px solid #f1f5f9"}}>
            <button onClick={prevMonth} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:8,cursor:"pointer",padding:"4px 10px",fontFamily:"inherit",fontSize:16,color:"#64748b"}}>‹</button>
            <span style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>{monthName}</span>
            <button onClick={nextMonth} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:8,cursor:"pointer",padding:"4px 10px",fontFamily:"inherit",fontSize:16,color:"#64748b"}}>›</button>
          </div>
          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"#f8fafc",borderBottom:"1px solid #f1f5f9"}}>
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} style={{padding:"8px 0",textAlign:"center",fontSize:11,fontWeight:700,color:"#64748b"}}>{d}</div>)}
          </div>
          {/* Day cells */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
            {cells.map((d,i)=>{
              if(!d) return <div key={"e"+i} style={{minHeight:80,borderBottom:"1px solid #f8fafc",borderRight:"1px solid #f8fafc"}}/>;
              const ds=ym+"-"+String(d).padStart(2,"0");
              const dayEvs=events[ds]||[];
              const isToday=ds===todayStr;
              const isSelected=ds===selectedDay;
              return(
                <div key={d} onClick={()=>setSelectedDay(isSelected?null:ds)} style={{minHeight:80,padding:"6px 6px 4px",borderBottom:"1px solid #f8fafc",borderRight:"1px solid #f8fafc",cursor:"pointer",background:isSelected?"#f0f9ff":isToday?"#fffbeb":"#fff",transition:"background .15s"}}>
                  <div style={{fontSize:12,fontWeight:isToday?800:500,color:isToday?"#fff":"#374151",width:22,height:22,borderRadius:"50%",background:isToday?"#0284C7":undefined,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:3}}>{d}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:1}}>
                    {dayEvs.slice(0,3).map((ev,ei)=>(
                      <div key={ei} style={{fontSize:9,padding:"1px 4px",borderRadius:3,background:ev.color+"22",color:ev.color,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.icon} {ev.label}</div>
                    ))}
                    {dayEvs.length>3&&<div style={{fontSize:9,color:"#94a3b8"}}>+{dayEvs.length-3} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* Legend */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}>
            <div style={{fontSize:12,fontWeight:700,color:"#0f172a",marginBottom:10}}>Legend</div>
            {[["B","#f59e0b","Bill due"],["B","#059669","Bill paid"],["$","#0284C7","Expected income"],["$","#059669","Income received"],["–","#94a3b8","Expense"],["T","#8b5cf6","Vacation"]].map(([icon,color,label])=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,fontSize:11}}>
                <span style={{fontSize:14}}>{icon}</span>
                <div style={{width:10,height:10,borderRadius:2,background:color}}/>
                <span style={{color:"#64748b"}}>{label}</span>
              </div>
            ))}
          </div>

          {/* Selected day detail */}
          {selectedDay&&(
            <div style={{background:"#fff",borderRadius:14,border:"1px solid #bae6fd",padding:16,flex:1}}>
              <div style={{fontSize:12,fontWeight:700,color:"#0f172a",marginBottom:10}}>{new Date(selectedDay+"T12:00").toLocaleDateString("en-CA",{weekday:"long",month:"long",day:"numeric"})}</div>
              {(events[selectedDay]||[]).length===0&&<div style={{fontSize:11,color:"#94a3b8"}}>No events this day.</div>}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {(events[selectedDay]||[]).map((ev,i)=>(
                  <div key={i} style={{padding:"8px 10px",borderRadius:8,background:ev.color+"11",border:`1px solid ${ev.color}33`,fontSize:11}}>
                    <div style={{fontWeight:700,color:ev.color}}>{ev.icon} {ev.label}</div>
                    {ev.amount&&<div style={{color:"#64748b",marginTop:2}}>{ev.type==="income"||ev.txnType==="income"?"+":"-"}{nfmt(ev.amount)}</div>}
                    {ev.paid&&<div style={{color:"#059669",fontWeight:600,marginTop:2}}>✓ Paid</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Month summary */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}>
            <div style={{fontSize:12,fontWeight:700,color:"#0f172a",marginBottom:10}}>Month at a glance</div>
            {[
              {label:"Bills due",val:bills.filter(b=>b.active!==false).length,color:"#f59e0b"},
              {label:"Bills paid",val:billPayments.filter(p=>p.month===ym).length,color:"#059669"},
              {label:"Income events",val:expected.filter(e=>e.date?.startsWith(ym)).length,color:"#0284C7"},
              {label:"Transactions",val:txns.filter(t=>t.date?.startsWith(ym)).length,color:"#64748b"},
            ].map(r=>(
              <div key={r.label} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"4px 0",borderBottom:"1px solid #f8fafc"}}>
                <span style={{color:"#64748b"}}>{r.label}</span>
                <span style={{fontWeight:700,color:r.color}}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Wishlist ──────────────────────────────────────────────────────────────────

export { FinancialCalendar };

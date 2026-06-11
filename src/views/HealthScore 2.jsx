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

function HealthScore({txns,accounts,holdings,catBudgets,goals,bills,billPayments,month,fxRate,stockPrices}){
  const nfmt=useNfmt();
  const score=useMemo(()=>{
    const curMonth=month||today().slice(0,7);
    const last3=[0,1,2].map(i=>{const d=new Date();d.setMonth(d.getMonth()-i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
    const recentTxns=txns.filter(t=>last3.some(m=>t.date?.startsWith(m)));
    const income3=recentTxns.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0)/3;
    const exp3=recentTxns.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0)/3;

    // 1. Savings rate (target 20%)
    const savingsRate=income3>0?(income3-exp3)/income3*100:0;
    const savingsScore=Math.min(100,Math.max(0,(savingsRate/20)*100));

    // 2. Emergency fund (target 3 months expenses)
    const cashAccounts=accounts.filter(a=>a.type!=="investment"&&a.type!=="loan");
    const totalCash=cashAccounts.reduce((s,a)=>s+(+a.balance||0),0);
    const emergencyMonths=exp3>0?totalCash/exp3:0;
    const emergencyScore=Math.min(100,(emergencyMonths/3)*100);

    // 3. Budget adherence (% cats under budget this month)
    const mt=txns.filter(t=>t.type==="expense"&&t.date?.startsWith(curMonth));
    const budgCats=Object.entries(catBudgets).filter(([,v])=>v>0);
    const adherePct=budgCats.length===0?100:budgCats.filter(([c,b])=>mt.filter(t=>t.category===c).reduce((s,t)=>s+t.amount,0)<=b).length/budgCats.length*100;

    // 4. Goal progress (avg % across active goals)
    const activeGoals=goals.filter(g=>g.target>0);
    const goalPct=activeGoals.length===0?100:activeGoals.reduce((s,g)=>s+Math.min(100,(g.saved||0)/g.target*100),0)/activeGoals.length;

    // 5. Net worth trend (positive = 100, flat = 50, negative = 0)
    const nwScore=totalCash>0?75:50;

    const total=Math.round((savingsScore*0.3)+(emergencyScore*0.25)+(adherePct*0.2)+(goalPct*0.15)+(nwScore*0.1));
    return{total,savingsRate:+savingsRate.toFixed(1),emergencyMonths:+emergencyMonths.toFixed(1),adherePct:+adherePct.toFixed(0),goalPct:+goalPct.toFixed(0),savingsScore,emergencyScore,adherePct2:adherePct,goalPct2:goalPct,nwScore};
  },[txns,accounts,catBudgets,goals,month]);

  const color=score.total>=80?"#059669":score.total>=60?"#f59e0b":"#ef4444";
  const label=score.total>=80?"Excellent":score.total>=60?"Good":score.total>=40?"Fair":"Needs Attention";

  const metrics=[
    {
      label:"Savings Rate",val:score.savingsRate+"%",target:"20%",score:score.savingsScore,
      tip:"Aim to save at least 20% of income",
      weight:"30% of score",
      calc:"(Monthly income − Monthly expenses) ÷ Monthly income × 100. Averaged over your last 3 months.",
      pro:"One of the strongest predictors of long-term financial health. High savings rate directly accelerates wealth building.",
      flaw:"Ignores one-time windfalls or large irregular expenses that distort a single month. A 3-month average smooths this but can still be skewed by bonuses or medical bills.",
    },
    {
      label:"Emergency Fund",val:score.emergencyMonths+"mo",target:"3mo",score:score.emergencyScore,
      tip:"Target 3 months of expenses in cash",
      weight:"25% of score",
      calc:"Total balance across all non-investment, non-loan accounts ÷ average monthly expenses over 3 months.",
      pro:"Measures your real-world buffer against job loss or emergencies. Directly tied to your actual spending pace.",
      flaw:"Treats all cash accounts equally — doesn't distinguish between a chequing account and a locked GIC. Also doesn't account for dual income, job stability, or access to credit.",
    },
    {
      label:"Budget Adherence",val:score.adherePct+"%",target:"100%",score:score.adherePct2,
      tip:"Stay under budget in all categories",
      weight:"20% of score",
      calc:"Number of budget categories where spending ≤ budget this month ÷ total number of budgeted categories × 100.",
      pro:"Rewards consistent discipline across all categories. Going over in even one category counts against you.",
      flaw:"Categories with no budget set are excluded entirely — so a sparse budget gives an inflated score. Also treats a $1 overage the same as a $500 overage.",
    },
    {
      label:"Goal Progress",val:score.goalPct+"%",target:"100%",score:score.goalPct2,
      tip:"Average progress across your savings goals",
      weight:"15% of score",
      calc:"Average of (amount saved ÷ target amount × 100) across all active goals with a target > $0.",
      pro:"Keeps long-term priorities visible alongside day-to-day spending. Penalises stalled goals.",
      flaw:"Weights all goals equally regardless of size or urgency. A $500 vacation fund and a $50,000 down payment count the same. No goals set = 100% by default.",
    },
  ];

  const [hoveredMetric,setHoveredMetric]=useState(null);

  return(
    <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center",gap:20,marginBottom:16}}>
        <div style={{position:"relative",width:72,height:72,flexShrink:0}}>
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="30" fill="none" stroke="#f1f5f9" strokeWidth="8"/>
            <circle cx="36" cy="36" r="30" fill="none" stroke={color} strokeWidth="8" strokeDasharray={`${score.total*1.885} 188.5`} strokeLinecap="round" transform="rotate(-90 36 36)" style={{transition:"stroke-dasharray .6s ease"}}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
            <span style={{fontSize:18,fontWeight:800,color,lineHeight:1}}>{score.total}</span>
          </div>
        </div>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#0f172a"}}>Financial Health Score</div>
          <div style={{fontSize:13,fontWeight:700,color,marginTop:2}}>{label}</div>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Based on savings, emergency fund, budgets &amp; goals</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,position:"relative"}}>
        {metrics.map((m,i)=>(
          <div key={m.label} style={{background:"#f8fafc",borderRadius:10,padding:10,cursor:"default",position:"relative",transition:"box-shadow .15s",boxShadow:hoveredMetric===i?"0 0 0 2px #0284C7 inset":""}}
            onMouseEnter={()=>setHoveredMetric(i)}
            onMouseLeave={()=>setHoveredMetric(null)}
          >
            <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{m.label}</div>
            <div style={{fontSize:15,fontWeight:800,color:"#0f172a"}}>{m.val} <span style={{fontSize:10,color:"#94a3b8",fontWeight:400}}>/ {m.target}</span></div>
            <div style={{background:"#e2e8f0",borderRadius:99,height:4,marginTop:6}}>
              <div style={{height:4,borderRadius:99,background:m.score>=80?"#059669":m.score>=50?"#f59e0b":"#ef4444",width:`${Math.min(100,m.score)}%`,transition:"width .4s"}}/>
            </div>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4,lineHeight:1.3}}>{m.tip}</div>

            {/* Tooltip */}
            {hoveredMetric===i&&(
              <div style={{position:"absolute",bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)",width:260,background:"#1e293b",color:"#f1f5f9",borderRadius:10,padding:"12px 14px",fontSize:11,lineHeight:1.5,zIndex:100,boxShadow:"0 8px 24px rgba(0,0,0,0.18)",pointerEvents:"none"}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:6,color:"#fff"}}>{m.label} <span style={{fontWeight:400,color:"#94a3b8",fontSize:10}}>({m.weight})</span></div>
                <div style={{marginBottom:8}}>
                  <span style={{color:"#7dd3fc",fontWeight:600}}>How it's calculated: </span>{m.calc}
                </div>
                <div style={{marginBottom:8}}>
                  <span style={{color:"#86efac",fontWeight:600}}>✓ Strength: </span>{m.pro}
                </div>
                <div>
                  <span style={{color:"#fca5a5",fontWeight:600}}>⚠ Limitation: </span>{m.flaw}
                </div>
                {/* Arrow */}
                <div style={{position:"absolute",bottom:-5,left:"50%",transform:"translateX(-50%)",width:10,height:10,background:"#1e293b",clipPath:"polygon(0 0,100% 0,50% 100%)"}}/>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Spending Anomaly Detection ────────────────────────────────────────────────
function SpendingAnomalies({txns,cats,month}){
  const anomalies=useMemo(()=>{
    const curMonth=month||today().slice(0,7);
    const results=[];
    cats.forEach(cat=>{
      const curSpend=txns.filter(t=>t.type==="expense"&&t.category===cat&&t.date?.startsWith(curMonth)).reduce((s,t)=>s+t.amount,0);
      if(curSpend===0) return;
      const prev3=[1,2,3].map(i=>{const d=new Date(curMonth+"-01");d.setMonth(d.getMonth()-i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
      const prevSpends=prev3.map(m=>txns.filter(t=>t.type==="expense"&&t.category===cat&&t.date?.startsWith(m)).reduce((s,t)=>s+t.amount,0));
      const avg=prevSpends.reduce((s,v)=>s+v,0)/3;
      if(avg<10) return;
      const ratio=curSpend/avg;
      if(ratio>=1.5) results.push({cat,curSpend,avg,ratio,type:"high"});
      else if(ratio<0.3&&avg>50) results.push({cat,curSpend,avg,ratio,type:"low"});
    });
    // Duplicate transactions (same merchant+amount+date)
    const seen={};
    txns.filter(t=>t.date?.startsWith(curMonth)).forEach(t=>{
      const key=`${t.date}|${t.amount}|${(t.merchant||"").toLowerCase()}`;
      if(seen[key]) seen[key]++;else seen[key]=1;
    });
    const dupes=Object.entries(seen).filter(([,v])=>v>1).map(([k])=>k);
    return{catAnomalies:results.sort((a,b)=>b.ratio-a.ratio),dupes};
  },[txns,cats,month]);

  if(anomalies.catAnomalies.length===0&&anomalies.dupes.length===0) return null;
  return(
    <div style={{background:"#fff",borderRadius:16,border:"1px solid #fde047",padding:20,marginBottom:24}}>
      <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:12}}>Spending Insights</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {anomalies.catAnomalies.map(a=>(
          <div key={a.cat} style={{display:"flex",alignItems:"center",gap:10,fontSize:12,padding:"8px 10px",background:a.type==="high"?"#fffbeb":"#f0fdf4",borderRadius:8,border:`1px solid ${a.type==="high"?"#fde047":"#bbf7d0"}`}}>
            <span>{a.type==="high"?"↑":"↓"}</span>
            <div style={{flex:1}}>
              <strong>{a.cat}</strong> spending is <strong>{a.type==="high"?"+"+((a.ratio-1)*100).toFixed(0):"-"+((1-a.ratio)*100).toFixed(0)}%</strong> vs your 3-month average
            </div>
            <div style={{color:"#64748b",whiteSpace:"nowrap"}}>{nfmt(a.curSpend)} vs {nfmt(a.avg)} avg</div>
          </div>
        ))}
        {anomalies.dupes.length>0&&(
          <div style={{fontSize:12,padding:"8px 10px",background:"#fef2f2",borderRadius:8,border:"1px solid #fecaca",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontWeight:800,color:"#f59e0b",fontSize:12}}>!</span>
            <span><strong>{anomalies.dupes.length}</strong> possible duplicate transaction{anomalies.dupes.length!==1?"s":""} this month — check your history.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subscription Manager ──────────────────────────────────────────────────────

export { HealthScore, SpendingAnomalies };

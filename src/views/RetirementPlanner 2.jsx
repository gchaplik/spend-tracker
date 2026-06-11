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

function RetirementPlanner({txns,accounts,settings}){
  const curYear=new Date().getFullYear();
  const [age,setAge]=useState(35);
  const [retireAge,setRetireAge]=useState(65);
  const [rate,setRate]=useState(6);
  const [rrsp,setRrsp]=useState(0);
  const [tfsa,setTfsa]=useState(0);
  const [contrib,setContrib]=useState(500);
  const [retireTarget,setRetireTarget]=useState(1000000);

  const yearsToRetire=Math.max(0,retireAge-age);
  const monthlyRate=rate/100/12;
  const n=yearsToRetire*12;

  // Future value: existing savings + monthly contributions compounded
  const existing=rrsp+tfsa;
  const fvExisting=existing*Math.pow(1+rate/100,yearsToRetire);
  const fvContribs=contrib>0&&monthlyRate>0?contrib*(Math.pow(1+monthlyRate,n)-1)/monthlyRate*Math.pow(1+monthlyRate,1):contrib*n;
  const projected=Math.round(fvExisting+fvContribs);
  const gap=Math.max(0,retireTarget-projected);
  const extraNeeded=gap>0&&n>0?Math.ceil(gap/(((Math.pow(1+monthlyRate,n)-1)/monthlyRate)*Math.pow(1+monthlyRate,1))):0;

  // Projection chart — every 5 years
  const chartData=[];
  for(let y=0;y<=yearsToRetire;y+=Math.max(1,Math.floor(yearsToRetire/10))){
    const nm=y*12;
    const evEx=existing*Math.pow(1+rate/100,y);
    const evCon=contrib>0&&monthlyRate>0?contrib*(Math.pow(1+monthlyRate,nm)-1)/monthlyRate*Math.pow(1+monthlyRate,1):contrib*nm;
    chartData.push({age:age+y,Projected:Math.round(evEx+evCon),Target:retireTarget});
  }
  if(chartData[chartData.length-1]?.age!==retireAge) chartData.push({age:retireAge,Projected:projected,Target:retireTarget});

  const pct=Math.min(100,(projected/retireTarget)*100);
  const GREEN="#059669",RED="#ef4444",BLUE="#0284C7";

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Retirement Planner</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Project your RRSP/TFSA growth and see if you're on track for retirement.</div>

      <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:20,marginBottom:24}}>
        {/* Inputs */}
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>Your Details</div>
          {[
            {label:"Current Age",val:age,set:setAge,min:18,max:80},
            {label:"Retirement Age",val:retireAge,set:setRetireAge,min:age+1,max:90},
            {label:"Current RRSP Balance ($)",val:rrsp,set:setRrsp,min:0,step:1000},
            {label:"Current TFSA Balance ($)",val:tfsa,set:setTfsa,min:0,step:1000},
            {label:"Monthly Contribution ($)",val:contrib,set:setContrib,min:0,step:50},
            {label:"Expected Return (%/yr)",val:rate,set:setRate,min:1,max:20,step:0.5},
            {label:"Retirement Target ($)",val:retireTarget,set:setRetireTarget,min:0,step:50000},
          ].map(({label,val,set:s,min,max,step})=>(
            <Fld key={label} label={label}>
              <input type="number" style={IS} value={val} min={min} max={max} step={step||1} onChange={e=>s(+e.target.value)}/>
            </Fld>
          ))}
        </div>

        {/* Results */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {/* Score ring */}
          <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,display:"flex",alignItems:"center",gap:20}}>
            <div style={{position:"relative",width:88,height:88,flexShrink:0}}>
              <svg width="88" height="88" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="38" fill="none" stroke="#f1f5f9" strokeWidth="10"/>
                <circle cx="44" cy="44" r="38" fill="none" stroke={pct>=100?GREEN:pct>=60?BLUE:RED} strokeWidth="10" strokeDasharray={`${pct*2.388} 238.8`} strokeLinecap="round" transform="rotate(-90 44 44)" style={{transition:"stroke-dasharray .6s"}}/>
              </svg>
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:16,fontWeight:800,color:pct>=100?GREEN:pct>=60?BLUE:RED}}>{pct.toFixed(0)}%</span></div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:800,color:"#0f172a",marginBottom:8}}>On track for retirement?</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  {l:"Projected at "+retireAge,v:nfmt(projected),c:projected>=retireTarget?GREEN:RED},
                  {l:"Target",v:nfmt(retireTarget),c:"#0f172a"},
                  {l:"Gap",v:gap>0?nfmt(gap):"None",c:gap>0?RED:GREEN},
                  {l:"Extra needed/mo",v:extraNeeded>0?nfmt(extraNeeded):"-",c:extraNeeded>0?"#f59e0b":GREEN},
                ].map(r=><div key={r.l} style={{background:"#f8fafc",borderRadius:8,padding:10}}><div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{r.l}</div><div style={{fontSize:15,fontWeight:800,color:r.c,marginTop:2}}>{r.v}</div></div>)}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,flex:1}}>
            <div style={{fontSize:12,fontWeight:700,color:"#0f172a",marginBottom:12}}>Growth Projection</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{top:4,right:16,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                <XAxis dataKey="age" tick={{fontSize:10}} tickLine={false} label={{value:"Age",position:"insideBottom",offset:-2,fontSize:10}}/>
                <YAxis tick={{fontSize:10}} tickLine={false} tickFormatter={v=>"$"+Math.round(v/1000)+"k"}/>
                <Tooltip formatter={(v,n)=>[nfmt(v),n]} contentStyle={{fontSize:12,borderRadius:8}}/>
                <Area type="monotone" dataKey="Projected" stroke={BLUE} fill="#bae6fd" fillOpacity={0.4} strokeWidth={2}/>
                <Line type="monotone" dataKey="Target" stroke={RED} strokeDasharray="4 2" strokeWidth={1.5} dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Financial Calendar ────────────────────────────────────────────────────────

export { RetirementPlanner };

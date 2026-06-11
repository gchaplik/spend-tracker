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

function MortgageCalculator({accounts,onSaveAccounts}){
  const [price,setPrice]=useState(500000);
  const [down,setDown]=useState(100000);
  const [rate,setRate]=useState(5.5);
  const [amort,setAmort]=useState(25);
  const [freq,setFreq]=useState("monthly");
  const [extra,setExtra]=useState(0);
  const [showTable,setShowTable]=useState(false);

  const freqMap={monthly:{n:12,l:"Monthly"},biweekly:{n:26,l:"Bi-Weekly"},weekly:{n:52,l:"Weekly"}};
  const principal=Math.max(0,price-down);
  const annualRate=rate/100;
  const periodsPerYear=freqMap[freq].n;
  const perRate=annualRate/periodsPerYear;
  const totalPeriods=amort*periodsPerYear;
  const payment=principal>0&&perRate>0?+(principal*perRate*Math.pow(1+perRate,totalPeriods)/(Math.pow(1+perRate,totalPeriods)-1)).toFixed(2):0;
  const paymentWithExtra=payment+extra/periodsPerYear*12;

  // Amortization table
  const amortTable=useMemo(()=>{
    if(!showTable||payment<=0) return[];
    const rows=[];let bal=principal,totalInt=0;
    for(let p=1;p<=totalPeriods;p++){
      const interest=bal*perRate;
      const principal_=paymentWithExtra-interest;
      if(principal_<=0) break;
      bal=Math.max(0,bal-principal_);
      totalInt+=interest;
      rows.push({period:p,payment:+paymentWithExtra.toFixed(2),interest:+interest.toFixed(2),principal:+principal_.toFixed(2),balance:+bal.toFixed(2)});
      if(bal<0.01){rows[rows.length-1].balance=0;break;}
    }
    return rows;
  },[showTable,principal,perRate,totalPeriods,paymentWithExtra]);

  const totalCost=payment*totalPeriods;
  const totalInterest=totalCost-principal;
  const downPct=(down/price*100).toFixed(1);

  // Extra payment savings
  let stdPayoff=totalPeriods,extraPayoff=totalPeriods,stdInt=0,extraInt=0;
  if(payment>0){
    let b=principal;for(let p=0;p<totalPeriods*2;p++){const i=b*perRate;b=b+i-payment;stdInt+=i;if(b<=0.01){stdPayoff=p+1;break;}}
    b=principal;for(let p=0;p<totalPeriods*2;p++){const i=b*perRate;b=b+i-paymentWithExtra;extraInt+=i;if(b<=0.01){extraPayoff=p+1;break;}}
  }
  const periodsSaved=stdPayoff-extraPayoff;
  const yearsSaved=(periodsSaved/periodsPerYear).toFixed(1);
  const intSaved=(stdInt-extraInt).toFixed(0);

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Mortgage Calculator</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Amortization schedule, extra payment simulator, and payoff scenarios.</div>

      <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:20,marginBottom:24}}>
        {/* Inputs */}
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>Mortgage Details</div>
          {[
            {label:"Purchase Price ($)",val:price,set:setPrice,step:5000,min:0},
            {label:"Down Payment ($)",val:down,set:setDown,step:5000,min:0,max:price},
            {label:"Interest Rate (%/yr)",val:rate,set:setRate,step:0.05,min:0.1,max:30},
            {label:"Amortization (years)",val:amort,set:setAmort,step:1,min:1,max:30},
          ].map(({label,val,set:s,step,min,max})=>(
            <Fld key={label} label={label}><input type="number" style={IS} value={val} step={step} min={min} max={max} onChange={e=>s(+e.target.value)}/></Fld>
          ))}
          <Fld label="Payment Frequency">
            <select style={IS} value={freq} onChange={e=>setFreq(e.target.value)}>
              {Object.entries(freqMap).map(([k,v])=><option key={k} value={k}>{v.l}</option>)}
            </select>
          </Fld>
          <Fld label="Extra Payment ($/month)">
            <input type="number" style={IS} value={extra} min={0} step={50} onChange={e=>setExtra(+e.target.value)}/>
          </Fld>
        </div>

        {/* Results */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12}}>
            {[
              {label:`${freqMap[freq].l} Payment`,val:nfmt(payment),color:"#0284C7",sub:`${freqMap[freq].l} installment`},
              {label:"Total Interest",val:nfmt(Math.round(totalInterest)),color:"#ef4444",sub:"Over full amortization"},
              {label:"Total Cost",val:nfmt(Math.round(totalCost+down)),color:"#0f172a",sub:"Principal + interest + down"},
              {label:"Down Payment",val:nfmt(down),color:"#059669",sub:`${downPct}% of purchase price`},
            ].map(c=><div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div><div style={{fontSize:20,fontWeight:800,color:c.color}}>{c.val}</div><div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{c.sub}</div></div>)}
          </div>

          {extra>0&&(
            <div style={{background:"#f0fdf4",borderRadius:14,border:"1px solid #bbf7d0",padding:16}}>
              <div style={{fontSize:13,fontWeight:700,color:"#059669",marginBottom:8}}>Extra Payment Impact</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,fontSize:12}}>
                <div style={{background:"#fff",borderRadius:10,padding:10}}><div style={{color:"#64748b",marginBottom:2}}>Years saved</div><div style={{fontWeight:800,fontSize:16,color:"#059669"}}>{yearsSaved} yrs</div></div>
                <div style={{background:"#fff",borderRadius:10,padding:10}}><div style={{color:"#64748b",marginBottom:2}}>Interest saved</div><div style={{fontWeight:800,fontSize:16,color:"#059669"}}>{nfmt(+intSaved)}</div></div>
                <div style={{background:"#fff",borderRadius:10,padding:10}}><div style={{color:"#64748b",marginBottom:2}}>New payoff</div><div style={{fontWeight:800,fontSize:16,color:"#059669"}}>{Math.floor(extraPayoff/periodsPerYear)}y {Math.round(extraPayoff%periodsPerYear/(periodsPerYear/12))}m</div></div>
              </div>
            </div>
          )}

          {/* Principal vs Interest donut-ish bar */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}>
            <div style={{fontSize:12,fontWeight:700,color:"#0f172a",marginBottom:10}}>Principal vs Interest breakdown</div>
            <div style={{display:"flex",borderRadius:8,overflow:"hidden",height:20,marginBottom:8}}>
              <div style={{background:"#0284C7",flex:principal}} title={`Principal: ${nfmt(principal)}`}/>
              <div style={{background:"#ef4444",flex:totalInterest>0?totalInterest:0}} title={`Interest: ${nfmt(Math.round(totalInterest))}`}/>
            </div>
            <div style={{display:"flex",gap:16,fontSize:11}}>
              <span style={{color:"#0284C7"}}>■ Principal: {nfmt(principal)} ({(principal/(principal+totalInterest)*100).toFixed(0)}%)</span>
              <span style={{color:"#ef4444"}}>■ Interest: {nfmt(Math.round(totalInterest))} ({(totalInterest/(principal+totalInterest)*100).toFixed(0)}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Amortization table toggle */}
      <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showTable?14:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>Full Amortization Schedule</div>
          <button onClick={()=>setShowTable(p=>!p)} style={{fontSize:11,padding:"5px 12px",border:"1px solid #bae6fd",borderRadius:8,cursor:"pointer",background:"#f0f9ff",color:"#0369a1",fontFamily:"inherit"}}>{showTable?"Hide Table":"Show Table"}</button>
        </div>
        {showTable&&(
          <div style={{overflowX:"auto",maxHeight:360,overflowY:"auto"}}>
            <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
              <thead style={{position:"sticky",top:0,background:"#f8fafc"}}>
                <tr>{["#","Payment","Principal","Interest","Balance"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"right",color:"#64748b",fontWeight:700,borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {amortTable.filter((_,i)=>i%periodsPerYear===0||i===amortTable.length-1).map(r=>(
                  <tr key={r.period} style={{borderBottom:"1px solid #f8fafc"}}>
                    {[r.period,nfmt(r.payment),nfmt(r.principal),nfmt(r.interest),nfmt(r.balance)].map((v,i)=><td key={i} style={{padding:"5px 10px",textAlign:"right",color:i===0?"#94a3b8":i===4?"#0284C7":"#374151"}}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:8}}>Showing yearly rows. {amortTable.length} total periods.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Household ────────────────────────────────────────────────────────────────


export { MortgageCalculator };

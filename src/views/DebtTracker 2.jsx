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

const DEBT_TYPES=["Credit Card","Car Loan","Student Loan","Mortgage","Line of Credit","Personal Loan","Other"];
function DebtTracker({debts=[],onSaveDebts}){
  const blank={id:"",name:"",type:"Credit Card",balance:"",rate:"",minPayment:"",cadence:"monthly",note:""};
  const [form,setForm]=useState(blank);
  const [editing,setEditing]=useState(false);
  const [strategy,setStrategy]=useState("avalanche"); // avalanche | snowball
  const [extra,setExtra]=useState(""); // extra monthly payment
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const save=()=>{
    if(!form.name.trim()||!form.balance||!form.rate) return;
    const item={...form,id:form.id||uid(),balance:+form.balance,rate:+form.rate,minPayment:+form.minPayment||0};
    onSaveDebts(form.id?debts.map(d=>d.id===form.id?item:d):[...debts,item]);
    setForm(blank);setEditing(false);
  };
  const remove=id=>onSaveDebts(debts.filter(d=>d.id!==id));
  const edit=d=>{setForm({...d,balance:String(d.balance),rate:String(d.rate),minPayment:String(d.minPayment||"")});setEditing(true);};

  // Payoff simulation
  const simulate=useMemo(()=>{
    if(!debts.length) return [];
    const extraAmt=+extra||0;
    let items=debts.map(d=>({...d,remaining:d.balance}));
    // Sort by strategy
    if(strategy==="avalanche") items.sort((a,b)=>b.rate-a.rate);
    else items.sort((a,b)=>a.remaining-b.remaining);

    const results=[];
    items.forEach((debt,di)=>{
      let bal=debt.balance;
      const monthlyRate=debt.rate/100/12;
      let months=0,totalInterest=0;
      const payment=debt.minPayment+(di===0?extraAmt:0);
      const effPay=Math.max(payment,bal*monthlyRate+1);
      while(bal>0.01&&months<600){
        const interest=bal*monthlyRate;
        totalInterest+=interest;
        bal=bal+interest-effPay;
        if(bal<0)bal=0;
        months++;
      }
      const payoffDate=new Date();payoffDate.setMonth(payoffDate.getMonth()+months);
      results.push({...debt,months,totalInterest:+totalInterest.toFixed(2),payoffDate:payoffDate.toLocaleDateString("en-CA",{year:"numeric",month:"short"})});
    });
    return results;
  },[debts,strategy,extra]);

  const totalDebt=debts.reduce((s,d)=>s+d.balance,0);
  const totalInterest=simulate.reduce((s,d)=>s+d.totalInterest,0);
  const maxMonths=Math.max(...simulate.map(d=>d.months),1);

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Debt Tracker</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Track all debts and model payoff strategies to minimise interest paid.</div>

      {/* Summary bar */}
      {debts.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:24}}>
          {[
            {label:"Total Debt",val:nfmt(totalDebt),color:"#ef4444"},
            {label:"Total Interest (projected)",val:nfmt(totalInterest),color:"#f59e0b"},
            {label:"Debt-Free Date",val:simulate.length?simulate[simulate.length-1].payoffDate:"—",color:"#059669"},
          ].map(c=>(
            <div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
              <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div>
              <div style={{fontSize:20,fontWeight:800,color:c.color}}>{c.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>{editing?"Edit Debt":"Add Debt"}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:12}}>
          <Fld label="Name *"><input style={IS} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. TD Visa"/></Fld>
          <Fld label="Type"><select style={IS} value={form.type} onChange={e=>set("type",e.target.value)}>{DEBT_TYPES.map(t=><option key={t}>{t}</option>)}</select></Fld>
          <Fld label="Current Balance *"><input type="number" style={IS} value={form.balance} onChange={e=>set("balance",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Interest Rate % *"><input type="number" style={IS} value={form.rate} onChange={e=>set("rate",e.target.value)} placeholder="19.99"/></Fld>
          <Fld label="Min. Payment / mo"><input type="number" style={IS} value={form.minPayment} onChange={e=>set("minPayment",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Note"><input style={IS} value={form.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={save} disabled={!form.name.trim()||!form.balance||!form.rate}>{editing?"Save Changes":"Add Debt"}</Btn>
          {editing&&<Btn v="secondary" onClick={()=>{setForm(blank);setEditing(false);}}>Cancel</Btn>}
        </div>
      </div>

      {debts.length===0&&<div style={{textAlign:"center",padding:40,color:"#94a3b8",fontSize:13}}>No debts tracked yet. Add your first debt above to model your payoff plan.</div>}

      {debts.length>0&&(<>
        {/* Debt list */}
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",overflow:"hidden",marginBottom:24}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 100px 80px 90px 1fr 80px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",padding:"8px 16px",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.06em"}}>
            <div>Debt</div><div>Balance</div><div>Rate</div><div>Min Pay</div><div style={{textAlign:"center"}}>Progress to zero</div><div/>
          </div>
          {debts.map(d=>{
            const pct=Math.max(0,Math.min(100,100-(d.balance/(d.balance+0.01))*100));
            return(
              <div key={d.id} style={{display:"grid",gridTemplateColumns:"1fr 100px 80px 90px 1fr 80px",alignItems:"center",padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
                <div><div style={{fontWeight:600,fontSize:13}}>{d.name}</div><div style={{fontSize:11,color:"#94a3b8"}}>{d.type}</div></div>
                <div style={{fontWeight:700,color:"#ef4444",fontSize:13}}>{nfmt(d.balance)}</div>
                <div style={{fontSize:13,color:"#f59e0b",fontWeight:600}}>{d.rate}%</div>
                <div style={{fontSize:13}}>{nfmt(d.minPayment)}/mo</div>
                <div style={{paddingRight:16}}>
                  <div style={{background:"#f1f5f9",borderRadius:99,height:6}}>
                    <div style={{height:6,borderRadius:99,background:"#ef4444",width:`${pct}%`,transition:"width .3s"}}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>edit(d)} style={{fontSize:11,padding:"4px 8px",border:"1px solid #bae6fd",borderRadius:6,cursor:"pointer",background:"#f0f9ff",color:"#0369a1",fontFamily:"inherit"}}>Edit</button>
                  <button onClick={()=>remove(d.id)} style={{fontSize:11,padding:"4px 8px",border:"1px solid #fecaca",borderRadius:6,cursor:"pointer",background:"#fff5f5",color:"#ef4444",fontFamily:"inherit"}}>✕</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Payoff strategy */}
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>Payoff Strategy</div>
          <div style={{display:"flex",gap:16,marginBottom:16,flexWrap:"wrap"}}>
            {[["avalanche","Avalanche","Highest rate first — minimises total interest"],["snowball","Snowball","Lowest balance first — fastest wins, best for motivation"]].map(([k,l,d])=>(
              <label key={k} style={{display:"flex",alignItems:"flex-start",gap:8,cursor:"pointer",flex:1,minWidth:200,background:strategy===k?"#f0f9ff":"#f8fafc",border:`1.5px solid ${strategy===k?"#0284C7":"#e2e8f0"}`,borderRadius:10,padding:12}}>
                <input type="radio" name="strategy" value={k} checked={strategy===k} onChange={()=>setStrategy(k)} style={{marginTop:2,accentColor:"#0284C7"}}/>
                <div><div style={{fontWeight:700,fontSize:12}}>{l}</div><div style={{fontSize:11,color:"#64748b"}}>{d}</div></div>
              </label>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",whiteSpace:"nowrap"}}>Extra monthly payment:</label>
            <input type="number" min={0} value={extra} onChange={e=>setExtra(e.target.value)} placeholder="$0" style={{...IS,width:120}}/>
          </div>
          {/* Payoff timeline bars */}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {simulate.map(d=>(
              <div key={d.id}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                  <span style={{fontWeight:600}}>{d.name}</span>
                  <span style={{color:"#64748b"}}>Paid off {d.payoffDate} · {nfmt(d.totalInterest)} interest</span>
                </div>
                <div style={{background:"#f1f5f9",borderRadius:99,height:10}}>
                  <div style={{height:10,borderRadius:99,background:"linear-gradient(90deg,#0284C7,#0ea5e9)",width:`${(d.months/maxMonths)*100}%`,transition:"width .4s"}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>)}
    </div>
  );
}

// ── Reports & Export ─────────────────────────────────────────────────────────

export { DebtTracker, DEBT_TYPES };

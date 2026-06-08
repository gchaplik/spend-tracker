import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell, ReferenceLine, PieChart, Pie, AreaChart, Area } from "recharts";
import { DEFAULT_CATS, COLORS, CADENCES, NAV_ITEMS, DEFAULT_SETTINGS } from "./constants/index.js";
import { fmt, fmtUSD, today, uid, toB64, cLabel, isPdf, fpHash } from "./utils/formatters.js";
import { buildDates, _df, _label, _sqlDf } from "./utils/dateUtils.js";
import { fetchData as loadServerData, patchData as saveServerData } from "./api/client.js";

// ── Auth / crypto helpers ─────────────────────────────────────────────────────
function _b64e(buf){return btoa(String.fromCharCode(...new Uint8Array(buf)));}
function _b64d(str){return Uint8Array.from(atob(str),c=>c.charCodeAt(0));}
function _b64ue(buf){return _b64e(buf).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function _b64ud(str){return _b64d(str.replace(/-/g,'+').replace(/_/g,'/'));}
async function hashPin(pin,salt){
  const enc=new TextEncoder();
  const km=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:200000,hash:'SHA-256'},km,256);
  return _b64e(bits);
}
function genSalt(){return _b64e(crypto.getRandomValues(new Uint8Array(16)));}
function _b32d(s){
  const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s=s.toUpperCase().replace(/=+$/,'');
  let bits=0,val=0;const out=[];
  for(const c of s){const i=A.indexOf(c);if(i<0)continue;val=(val<<5)|i;bits+=5;if(bits>=8){bits-=8;out.push((val>>bits)&0xff);}}
  return new Uint8Array(out);
}
async function calcTOTP(secret,time=Date.now()){
  const T=Math.floor(time/1000/30);
  const ctr=new Uint8Array(8);new DataView(ctr.buffer).setUint32(4,T,false);
  const ck=await crypto.subtle.importKey('raw',_b32d(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',ck,ctr));
  const off=sig[19]&0xf;
  const code=((sig[off]&0x7f)<<24)|(sig[off+1]<<16)|(sig[off+2]<<8)|sig[off+3];
  return String(code%1000000).padStart(6,'0');
}
function genTOTPSecret(){
  const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b=>A[b%32]).join('');
}

// Fetch USD→CAD rate: use /latest for today or future dates (Frankfurter only has past data)
const fetchUsdCad = (dateStr) => {
  const endpoint = dateStr >= today()
    ? "https://api.frankfurter.app/latest?from=USD&to=CAD"
    : `https://api.frankfurter.app/${dateStr}?from=USD&to=CAD`;
  return fetch(endpoint).then(r => r.json()).then(d => {
    const rate = d?.rates?.CAD;
    if (!rate) throw new Error("Rate unavailable");
    return rate;
  });
};

// receiptFPs is now persisted in data.json via App state; these are no-ops kept for safety
const loadFPs = () => new Set();
const saveFPs = () => {};

// IndexedDB helpers for persisting FileSystemDirectoryHandle across page loads
const _idb = () => new Promise((res, rej) => {
  const req = indexedDB.open('cashheap-fs', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('handles');
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});
const idbPut = async (key, val) => { const db = await _idb(); return new Promise((res,rej) => { const tx=db.transaction('handles','readwrite'); tx.objectStore('handles').put(val,key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); };
const idbGet = async (key) => { const db = await _idb(); return new Promise((res,rej) => { const tx=db.transaction('handles','readonly'); const req=tx.objectStore('handles').get(key); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); };
const idbDel = async (key) => { const db = await _idb(); return new Promise((res,rej) => { const tx=db.transaction('handles','readwrite'); tx.objectStore('handles').delete(key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); };

async function extractReceipt(b64, mtype, cats) {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mtype, data: b64 } },
          { text: "Extract from this receipt or invoice. Return ONLY a raw JSON object, no markdown:\n{\"merchant\":\"store name\",\"date\":\"YYYY-MM-DD\",\"amount\":12.34,\"suggestedCategory\":\"one of these\"}\nCategories: " + cats.join(", ") + ". Use " + today() + " if date unclear. Dates on receipts are in month/day/year format. All receipts are dated on or after June 1 2026 — if the year is ambiguous, use 2026. For PDFs with multiple pages, use the total/grand total amount." }
        ]
      }]
    })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  const text = d.candidates?.[0]?.content?.parts?.filter(p => !p.thought)?.map(p => p.text || "").join("") || "";
  return JSON.parse(text.replace(/```[\w]*/g,"").replace(/```/g,"").trim());
}

const IS={width:"100%",padding:"10px 13px",borderRadius:10,border:"1.5px solid #bae6fd",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",background:"#f0f9ff",color:"#1E293B",transition:"border-color 0.15s,box-shadow 0.15s"};
const CA={background:"#fff",borderRadius:18,border:"1px solid #e0f2fe",padding:22,boxShadow:"0 1px 4px rgba(2,132,199,0.05),0 8px 24px rgba(2,132,199,0.07)"};

function Fld({label,children,style}){
  return <div style={{marginBottom:16,...style}}>{label&&<label style={{display:"block",fontSize:11,fontWeight:600,color:"#0369a1",marginBottom:6,letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</label>}{children}</div>;
}
function Btn({children,onClick,v,disabled,full,sm,style}){
  const vv=v||"primary";
  const variants={
    primary:{background:"linear-gradient(135deg,#0284C7 0%,#0369a1 100%)",color:"#fff",border:"none",boxShadow:"0 2px 10px rgba(2,132,199,0.35)"},
    secondary:{background:"#f0f9ff",color:"#0369a1",border:"1.5px solid #bae6fd",boxShadow:"none"},
    danger:{background:"#fff1f2",color:"#e11d48",border:"1.5px solid #fecdd3",boxShadow:"none"},
    success:{background:"#f0fdf4",color:"#059669",border:"1.5px solid #bbf7d0",boxShadow:"none"},
  };
  const s=variants[vv]||variants.primary;
  return <button onClick={onClick} disabled={!!disabled} style={{padding:sm?"5px 13px":"10px 20px",borderRadius:10,cursor:disabled?"not-allowed":"pointer",fontSize:sm?12:13,fontWeight:600,opacity:disabled?0.45:1,width:full?"100%":"auto",fontFamily:"inherit",letterSpacing:"0.01em",...s,...style}}>{children}</button>;
}

function ExpectedIncomeWidget({mExp,ml,month,GREEN,YELLOW,onConfirm,onRevert}){
  const [open,setOpen]=useState(true);
  const confirmed=mExp.filter(e=>e.confirmed).length;
  const overdue=mExp.filter(e=>!e.confirmed&&e.expectedDate<today()).length;
  return (
    <div style={{gridColumn:"1/-1",background:"#fff",borderRadius:18,border:"1px solid #e0f2fe",boxShadow:"0 1px 4px rgba(2,132,199,0.05),0 8px 24px rgba(2,132,199,0.07)"}}>
      <button onClick={()=>setOpen(v=>!v)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",borderRadius:18}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em"}}>Expected Income — {ml(month)}</span>
          <span style={{fontSize:11,fontWeight:600,color:confirmed===mExp.length?GREEN:YELLOW}}>{confirmed}/{mExp.length} received</span>
          {overdue>0&&<span style={{fontSize:10,fontWeight:600,background:"#fee2e2",color:"#b91c1c",padding:"1px 8px",borderRadius:20}}>{overdue} overdue</span>}
        </div>
        <span style={{fontSize:13,color:"#94a3b8",fontWeight:600,lineHeight:1}}>{open?"▲":"▼"}</span>
      </button>
      {/* Collapsed: compact name + button chips */}
      {!open&&(
        <div style={{padding:"0 18px 12px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8}}>
          {mExp.map(e=>(
            <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,padding:"6px 10px 6px 12px",borderRadius:10,background:e.confirmed?"#f0fdf4":"#fffbeb",border:`1px solid ${e.confirmed?"#bbf7d0":"#fde68a"}`}}>
              <span style={{fontSize:12,fontWeight:600,color:"#1E293B"}}>{e.source}</span>
              {e.confirmed
                ?<button onClick={()=>onRevert(e.id)} title="Click to revert" style={{width:22,height:22,borderRadius:"50%",background:"#d1fae5",border:"2px solid #059669",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",flexShrink:0,fontFamily:"inherit",color:GREEN}}>✓</button>
                :<button onClick={()=>onConfirm(e.id)} title="Mark as received" style={{width:22,height:22,borderRadius:"50%",background:"#fef3c7",border:"2px solid #d97706",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",flexShrink:0,fontFamily:"inherit",color:YELLOW}}>?</button>}
            </div>
          ))}
        </div>
      )}
      {/* Expanded: full view with amounts */}
      {open&&(
        <div style={{padding:"0 18px 12px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"0 16px"}}>
          {mExp.map(e=>(
            <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #f0f9ff",gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <span style={{fontSize:12,fontWeight:600,color:"#1E293B",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{e.source}</span>
                {e.note&&<span style={{fontSize:10,color:"#94a3b8"}}>{e.note}</span>}
              </div>
              <span style={{fontSize:12,fontWeight:700,color:e.confirmed?GREEN:YELLOW,flexShrink:0}}>{fmt(e.amount)}</span>
              {e.confirmed
                ?<button onClick={()=>onRevert(e.id)} title="Click to revert" style={{width:24,height:24,borderRadius:"50%",background:"#d1fae5",border:"2px solid #059669",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,cursor:"pointer",flexShrink:0,fontFamily:"inherit",color:GREEN}}>✓</button>
                :<button onClick={()=>onConfirm(e.id)} title="Mark as received" style={{width:24,height:24,borderRadius:"50%",background:"#fef3c7",border:"2px solid #d97706",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,cursor:"pointer",flexShrink:0,fontFamily:"inherit",color:YELLOW}}>?</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BillsDueWidget({monthBills,billsPaid,billsUnpaid,billPaid,onToggleBill,month,ml,GREEN,RED}){
  const [open,setOpen]=useState(true);
  return(
    <div style={{...CA,marginBottom:14}}>
      <button onClick={()=>setOpen(v=>!v)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <span style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em"}}>Bills Due — {ml(month)}</span>
          <span style={{fontSize:11,fontWeight:600,color:billsUnpaid.length===0?GREEN:RED}}>{billsPaid.length}/{monthBills.length} paid</span>
          {billsUnpaid.length>0&&<span style={{fontSize:11,color:RED,fontWeight:600}}>{fmt(billsUnpaid.reduce((s,b)=>s+b.amount,0))} remaining</span>}
        </div>
        <span style={{fontSize:13,color:"#94a3b8",fontWeight:600,flexShrink:0}}>{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <div style={{marginTop:10,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
          {[...monthBills].sort((a,b)=>a.dueDay-b.dueDay).map(b=>{
            const paid=billPaid(b.id);
            return(
              <div key={b.id} onClick={()=>onToggleBill&&onToggleBill(b.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"8px 12px",borderRadius:10,background:paid?"#f0fdf4":"#fafafa",border:`1px solid ${paid?"#bbf7d0":"#f1f5f9"}`,cursor:"pointer",transition:"all 0.15s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                  <div style={{width:20,height:20,borderRadius:"50%",background:paid?"#d1fae5":"transparent",border:`2px solid ${paid?GREEN:"#e2e8f0"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {paid&&<span style={{fontSize:10,color:GREEN}}>✓</span>}
                  </div>
                  <span style={{fontSize:12,fontWeight:600,color:paid?"#94a3b8":"#1E293B",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:paid?"line-through":"none"}}>{b.name}</span>
                </div>
                <span style={{fontSize:12,fontWeight:700,color:paid?"#94a3b8":RED,flexShrink:0}}>{fmt(b.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dashboard({txns,expected,cats,catBudgets,month,setMonth,onConfirm,onRevert,vacations=[],vacationTxns=[],bills=[],billPayments=[],onToggleBill,goals=[],accounts=[],holdings=[],stockPrices={},fxRate=1.38}){
  const opts=Array.from({length:13},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-12+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const ml=m=>new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"});
  const mt=txns.filter(t=>t.date&&t.date.startsWith(month));
  const actualIncome=mt.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const txnSpending=mt.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  // Paid bills for this month count as spending
  const paidBillsTotal=billPayments.filter(p=>p.month===month).reduce((s,p)=>s+p.amount,0);
  const vacSpendMonth=vacationTxns.filter(t=>t.date&&t.date.startsWith(month)).reduce((s,t)=>s+t.amount,0);
  const spending=txnSpending+paidBillsTotal+vacSpendMonth;
  const mExp=expected.filter(e=>e.expectedDate&&e.expectedDate.startsWith(month));
  const pendingExp=mExp.filter(e=>!e.confirmed).reduce((s,e)=>s+e.amount,0);
  const totalExp=mExp.reduce((s,e)=>s+e.amount,0);
  const projNet=(actualIncome+pendingExp)-spending;
  const actNet=actualIncome-spending;
  // Category breakdown includes vacation txns (bucketed under their category)
  const vacBycat=vacationTxns.filter(t=>t.date&&t.date.startsWith(month)).reduce((m,t)=>{const c=t.category||"Vacation";m[c]=(m[c]||0)+t.amount;return m;},{});
  const catData=cats.map(c=>({name:c,amount:mt.filter(t=>t.type==="expense"&&t.category===c).reduce((s,t)=>s+t.amount,0)+(vacBycat[c]||0),budget:catBudgets[c]||0})).filter(d=>d.amount>0||d.budget>0).sort((a,b)=>b.amount-a.amount);
  // Add any vacation categories not in cats list (e.g. "Vacation")
  Object.entries(vacBycat).forEach(([c,amt])=>{if(!cats.includes(c)&&!catData.find(d=>d.name===c))catData.push({name:c,amount:amt,budget:0});});
  catData.sort((a,b)=>b.amount-a.amount);
  const trend=Array.from({length:6},(_,i)=>{
    const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-5+i);
    const ym=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
    const tx=txns.filter(t=>t.date&&t.date.startsWith(ym));
    const ex=expected.filter(e=>e.expectedDate&&e.expectedDate.startsWith(ym));
    const vx=vacationTxns.filter(t=>t.date&&t.date.startsWith(ym)).reduce((s,t)=>s+t.amount,0);
    return {name:d.toLocaleString("default",{month:"short"}),Income:+tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0).toFixed(2),Expenses:+(tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0)+vx).toFixed(2),Expected:+ex.filter(e=>!e.confirmed).reduce((s,e)=>s+e.amount,0).toFixed(2)};
  });
  const recent=[...mt].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,8);
  const activeVacations=vacations.filter(v=>v.startDate&&v.startDate.slice(0,7)<=month&&v.endDate&&v.endDate.slice(0,7)>=month);
  const vacSpend=vacSpendMonth;
  const budgetTotal=Object.values(catBudgets).reduce((s,v)=>s+(v||0),0);
  const budgetRemaining=budgetTotal-spending;
  const vacSpendLabel=activeVacations.length>0?activeVacations.map(v=>v.name).join(", "):null;
  // Month-over-month (include vacation in prev month too)
  const prevMonth=(()=>{const d=new Date(month+"-02");d.setMonth(d.getMonth()-1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");})();
  const ptxns=txns.filter(t=>t.date&&t.date.startsWith(prevMonth));
  const prevIncome=ptxns.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const prevVacSpend=vacationTxns.filter(t=>t.date&&t.date.startsWith(prevMonth)).reduce((s,t)=>s+t.amount,0);
  const prevSpending=ptxns.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0)+prevVacSpend;
  const prevActNet=prevIncome-prevSpending;
  const delta=(cur,prev)=>{if(prev===0&&cur===0)return null;const d=cur-prev;const pct=prev!==0?Math.round(Math.abs(d)/Math.abs(prev)*100):null;const up=d>=0;return{d,pct,up};};
  const incomeDelta=delta(actualIncome,prevIncome);
  const spendDelta=delta(spending,prevSpending);
  const netDelta=delta(actNet,prevActNet);
  // Budget alerts
  const alertCats=catData.filter(d=>d.budget>0&&d.amount/d.budget>=0.8).sort((a,b)=>b.amount/b.budget-a.amount/a.budget);
  // Annual summary
  const curYear=month.slice(0,4);
  const yearData=Array.from({length:12},(_,i)=>{const ym=curYear+"-"+String(i+1).padStart(2,"0");const tx=txns.filter(t=>t.date&&t.date.startsWith(ym));return{name:new Date(ym+"-02").toLocaleString("default",{month:"short"}),Income:+tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0).toFixed(2),Expenses:+tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0).toFixed(2)};});
  const yearIncome=yearData.reduce((s,d)=>s+d.Income,0);
  const yearExpenses=yearData.reduce((s,d)=>s+d.Expenses,0);
  const GREEN="#059669", RED="#dc2626", YELLOW="#d97706";
  const [chartTab,setChartTab]=useState("6mo");
  // Net worth
  const ASSET_TYPES=["chequing","savings","investment","other"];
  const totalAssets=accounts.filter(a=>ASSET_TYPES.includes(a.type)).reduce((s,a)=>s+a.balance,0);
  const totalLiab=accounts.filter(a=>!ASSET_TYPES.includes(a.type)).reduce((s,a)=>s+a.balance,0);
  const netWorth=totalAssets-totalLiab;
  const portfolioValue=holdings.reduce((s,h)=>{const cur=stockPrices[h.ticker]?.currency??(h.ticker.toUpperCase().endsWith('.TO')?'CAD':'USD');return s+(stockPrices[h.ticker]?.price??0)*h.shares*(cur==='USD'?fxRate:1);},0);
  // Bills due this month
  const monthBills=bills.filter(b=>b.active!==false);
  const billPaid=id=>billPayments.some(p=>p.billId===id&&p.month===month);
  const billsUnpaid=monthBills.filter(b=>!billPaid(b.id));
  const billsPaid=monthBills.filter(b=>billPaid(b.id));
  // Budget health — last 6 months per category
  const bhMonths=Array.from({length:6},(_,i)=>{const d=new Date(month+"-02");d.setMonth(d.getMonth()-5+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const budgetHealth=cats.filter(c=>catBudgets[c]>0).map(c=>{
    const bgt=catBudgets[c];
    return{name:c,budget:bgt,months:bhMonths.map(ym=>{const spent=txns.filter(t=>t.date&&t.date.startsWith(ym)&&t.type==="expense"&&t.category===c).reduce((s,t)=>s+t.amount,0);return{ym,spent,status:spent===0?"none":spent>bgt?"over":"ok"};})};
  });
  // Anomaly detection — flag transactions >2.5x category average (min 3 txns)
  const catAvgs={};cats.forEach(c=>{const ct=txns.filter(t=>t.type==="expense"&&t.category===c&&t.amount>0);if(ct.length>=3)catAvgs[c]=ct.reduce((s,t)=>s+t.amount,0)/ct.length;});
  const isAnomaly=t=>t.type==="expense"&&catAvgs[t.category]&&t.amount>2.5*catAvgs[t.category];
  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px",color:"#1E293B"}}>Dashboard</h2>
        <select value={month} onChange={e=>setMonth(e.target.value)} style={{padding:"8px 14px",borderRadius:10,border:"1.5px solid #e2e8f0",fontSize:13,background:"#fff",fontFamily:"inherit",color:"#1E293B",fontWeight:500}}>
          {opts.map(m=><option key={m} value={m}>{ml(m)}</option>)}
        </select>
      </div>

      {/* Hero — Net Position */}
      <div style={{...CA,padding:"28px 32px",marginBottom:14,borderLeft:`4px solid ${actNet>=0?GREEN:RED}`,background:actNet>=0?"linear-gradient(135deg,#f0fdf4 0%,#fff 60%)":"linear-gradient(135deg,#fff1f2 0%,#fff 60%)"}}>
        <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>Net Position · {ml(month)}</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:24,flexWrap:"wrap"}}>
          <div style={{fontSize:48,fontWeight:800,color:actNet>=0?GREEN:RED,letterSpacing:"-2px",lineHeight:1}}>{fmt(actNet)}</div>
          <div style={{paddingBottom:8,display:"flex",flexDirection:"column",gap:4}}>
            {netDelta&&<div style={{fontSize:12,fontWeight:600,color:netDelta.up?GREEN:RED}}>{netDelta.up?"↑":"↓"} {fmt(Math.abs(netDelta.d))}{netDelta.pct!=null?" ("+netDelta.pct+"%)":""} vs last month</div>}
            {pendingExp>0&&<div style={{fontSize:12,color:"#94a3b8"}}>Projected <span style={{color:projNet>=0?GREEN:RED,fontWeight:700}}>{fmt(projNet)}</span> <span style={{color:YELLOW}}>· {fmt(pendingExp)} pending</span></div>}
          </div>
        </div>
      </div>

      {/* Net worth strip */}
      {(accounts.length>0||holdings.length>0)&&(
        <div style={{...CA,padding:"12px 20px",marginBottom:14,display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",flexShrink:0}}>Net Worth</div>
          <div style={{fontSize:18,fontWeight:800,color:netWorth>=0?GREEN:RED,letterSpacing:"-0.4px"}}>{fmt(netWorth+(portfolioValue||0))}</div>
          <div style={{fontSize:12,color:"#94a3b8",display:"flex",gap:14,flexWrap:"wrap"}}>
            <span>Assets <span style={{color:GREEN,fontWeight:600}}>{fmt(totalAssets)}</span></span>
            <span>Liabilities <span style={{color:RED,fontWeight:600}}>{fmt(totalLiab)}</span></span>
            {holdings.length>0&&portfolioValue>0&&<span>Portfolio <span style={{color:"#0284C7",fontWeight:600}}>{fmt(portfolioValue)}</span></span>}
          </div>
        </div>
      )}
      {/* Three stat cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12,marginBottom:14}}>
        <div style={{...CA,padding:"20px 22px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Income</div>
          <div style={{fontSize:28,fontWeight:800,color:GREEN,letterSpacing:"-0.7px",lineHeight:1}}>{fmt(actualIncome)}</div>
          {incomeDelta&&incomeDelta.d!==0&&<div style={{fontSize:11,fontWeight:600,marginTop:6,color:incomeDelta.up?GREEN:RED}}>{incomeDelta.up?"↑":"↓"} {fmt(Math.abs(incomeDelta.d))} vs last month</div>}
        </div>
        <div style={{...CA,padding:"20px 22px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Spending</div>
          <div style={{fontSize:28,fontWeight:800,color:RED,letterSpacing:"-0.7px",lineHeight:1}}>{fmt(spending)}</div>
          {budgetTotal>0&&<div style={{fontSize:11,fontWeight:500,marginTop:6,color:budgetRemaining>=0?GREEN:RED}}>{fmt(Math.abs(budgetRemaining))} {budgetRemaining>=0?"under budget":"over budget"}</div>}
          {spendDelta&&spendDelta.d!==0&&<div style={{fontSize:11,fontWeight:600,marginTop:budgetTotal>0?2:6,color:spendDelta.up?RED:GREEN}}>{spendDelta.up?"↑":"↓"} {fmt(Math.abs(spendDelta.d))} vs last month</div>}
          {vacSpend>0&&<div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>+{fmt(vacSpend)} vacation</div>}
        </div>
        <div style={{...CA,padding:"20px 22px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Expected Income</div>
          <div style={{fontSize:28,fontWeight:800,color:YELLOW,letterSpacing:"-0.7px",lineHeight:1}}>{fmt(totalExp)}</div>
          {pendingExp>0
            ?<div style={{fontSize:11,color:YELLOW,fontWeight:600,marginTop:6}}>{fmt(pendingExp)} pending · {mExp.filter(e=>!e.confirmed).length} items</div>
            :mExp.length>0&&<div style={{fontSize:11,color:GREEN,fontWeight:600,marginTop:6}}>All received ✓</div>}
        </div>
      </div>

      {/* Expected Income widget */}
      {mExp.length>0&&<div style={{marginBottom:14}}><ExpectedIncomeWidget mExp={mExp} ml={ml} month={month} GREEN={GREEN} YELLOW={YELLOW} onConfirm={onConfirm} onRevert={onRevert}/></div>}

      {/* Bills Due widget */}
      {monthBills.length>0&&<BillsDueWidget monthBills={monthBills} billsPaid={billsPaid} billsUnpaid={billsUnpaid} billPaid={billPaid} onToggleBill={onToggleBill} month={month} ml={ml} GREEN={GREEN} RED={RED}/>}

      {/* Goals strip */}
      {goals.length>0&&(
        <div style={{...CA,marginBottom:14,padding:"16px 20px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>Savings Goals</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
            {goals.map(g=>{
              const pct=g.targetAmount>0?Math.min(g.currentAmount/g.targetAmount,1):0;
              return(
                <div key={g.id} style={{padding:"10px 14px",borderRadius:10,background:"#fafafa",border:"1px solid #f1f5f9"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{fontSize:16}}>{g.emoji}</span>
                    <span style={{fontSize:12,fontWeight:600,color:"#1E293B",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</span>
                  </div>
                  <div style={{height:5,borderRadius:99,background:"#f1f5f9",overflow:"hidden",marginBottom:5}}>
                    <div style={{height:"100%",borderRadius:99,width:(pct*100)+"%",background:pct>=1?"#059669":g.color||"#0284C7",transition:"width 0.4s"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:11,fontWeight:600,color:g.color||"#0284C7"}}>{fmt(g.currentAmount)}</span>
                    <span style={{fontSize:11,color:"#94a3b8"}}>{Math.round(pct*100)}% of {fmt(g.targetAmount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Charts + Category */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div style={CA}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:16,color:"#1E293B"}}>Spending by Category</div>
          {catData.length===0?<div style={{color:"#94a3b8",fontSize:13}}>No expenses this month</div>:catData.map((d,i)=>{
            const pct=d.budget>0?Math.min(d.amount/d.budget,1):0;
            const over=d.budget>0&&d.amount>d.budget;
            const warn=d.budget>0&&!over&&d.amount/d.budget>=0.8;
            return(
              <div key={d.name} style={{marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:over?RED:COLORS[i%COLORS.length],display:"inline-block",flexShrink:0}}/>
                    <span style={{fontSize:12,fontWeight:500,color:"#374151"}}>{d.name}</span>
                    {over&&<span style={{fontSize:9,fontWeight:700,color:RED,background:"#fee2e2",padding:"1px 6px",borderRadius:20,letterSpacing:"0.05em"}}>OVER</span>}
                    {warn&&<span style={{fontSize:9,fontWeight:700,color:YELLOW,background:"#fef3c7",padding:"1px 6px",borderRadius:20,letterSpacing:"0.05em"}}>NEAR</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"baseline",gap:5}}>
                    <span style={{fontSize:12,fontWeight:700,color:over?RED:"#1E293B"}}>{fmt(d.amount)}</span>
                    {d.budget>0&&<span style={{fontSize:11,color:"#cbd5e1"}}>/ {fmt(d.budget)}</span>}
                  </div>
                </div>
                <div style={{height:4,borderRadius:99,background:"#f1f5f9",overflow:"hidden"}}>
                  {d.budget>0
                    ?<div style={{height:"100%",borderRadius:99,width:(pct*100)+"%",background:over?RED:warn?"#f59e0b":COLORS[i%COLORS.length],transition:"width 0.4s ease"}}/>
                    :<div style={{height:"100%",borderRadius:99,width:"100%",background:COLORS[i%COLORS.length]+"55"}}/>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={CA}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>{chartTab==="6mo"?"6-Month Cashflow":curYear+" Annual"}</div>
            <div style={{display:"flex",background:"#f1f5f9",borderRadius:8,padding:3,gap:1}}>
              {[{k:"6mo",l:"6 Mo"},{ k:"year",l:curYear}].map(t=>(
                <button key={t.k} onClick={()=>setChartTab(t.k)} style={{padding:"4px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit",background:chartTab===t.k?"#fff":"transparent",color:chartTab===t.k?"#1E293B":"#94a3b8",boxShadow:chartTab===t.k?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>{t.l}</button>
              ))}
            </div>
          </div>
          {chartTab==="6mo"?(
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{left:-12,right:8,top:4,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                <XAxis dataKey="name" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false}/>
                <Tooltip formatter={v=>fmt(v)} contentStyle={{borderRadius:10,border:"1px solid #e0f2fe",boxShadow:"0 4px 20px rgba(0,0,0,0.08)",fontSize:12}}/>
                <Line type="monotone" dataKey="Income" stroke={GREEN} strokeWidth={2.5} dot={false}/>
                <Line type="monotone" dataKey="Expenses" stroke={RED} strokeWidth={2.5} dot={false}/>
                <Line type="monotone" dataKey="Expected" stroke="#0284C7" strokeWidth={1.5} strokeDasharray="4 3" dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          ):(
            <>
              <div style={{display:"flex",gap:20,marginBottom:12}}>
                <span style={{fontSize:12,color:GREEN,fontWeight:600}}>Income {fmt(yearIncome)}</span>
                <span style={{fontSize:12,color:RED,fontWeight:600}}>Expenses {fmt(yearExpenses)}</span>
                <span style={{fontSize:12,color:yearIncome-yearExpenses>=0?GREEN:RED,fontWeight:700}}>Net {fmt(yearIncome-yearExpenses)}</span>
              </div>
              <ResponsiveContainer width="100%" height={196}>
                <BarChart data={yearData} margin={{left:-12,right:8,top:4,bottom:0}} barSize={8} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                  <XAxis dataKey="name" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false}/>
                  <Tooltip formatter={v=>fmt(v)} contentStyle={{borderRadius:10,border:"1px solid #e0f2fe",boxShadow:"0 4px 20px rgba(0,0,0,0.08)",fontSize:12}}/>
                  <Bar dataKey="Income" fill={GREEN} radius={[3,3,0,0]}/>
                  <Bar dataKey="Expenses" fill={RED} radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
          <div style={{display:"flex",gap:14,marginTop:10,flexWrap:"wrap"}}>
            {[{c:GREEN,l:"Income"},{c:RED,l:"Expenses"},...(chartTab==="6mo"?[{c:"#0284C7",l:"Expected",dashed:true}]:[])].map(item=>(
              <span key={item.l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#94a3b8"}}>
                {item.dashed?<span style={{width:14,borderTop:"2px dashed #0284C7",display:"inline-block"}}/>:<span style={{width:8,height:8,borderRadius:"50%",background:item.c,display:"inline-block"}}/>}{item.l}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Budget Health */}
      {budgetHealth.length>0&&(
        <div style={{...CA,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:14,color:"#1E293B"}}>Budget Health — Last 6 Months</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr>
                  <th style={{textAlign:"left",padding:"0 10px 8px 0",color:"#94a3b8",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>Category</th>
                  {bhMonths.map(ym=><th key={ym} style={{textAlign:"center",padding:"0 6px 8px",color:"#94a3b8",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>{new Date(ym+"-02").toLocaleString("default",{month:"short"})}</th>)}
                  <th style={{textAlign:"right",padding:"0 0 8px 10px",color:"#94a3b8",fontWeight:600,fontSize:11}}>Budget</th>
                </tr>
              </thead>
              <tbody>
                {budgetHealth.map(row=>{
                  const hits=row.months.filter(m=>m.status==="ok").length;
                  const total=row.months.filter(m=>m.status!=="none").length;
                  return(
                    <tr key={row.name} style={{borderTop:"1px solid #f8fafc"}}>
                      <td style={{padding:"7px 10px 7px 0",fontWeight:500,color:"#374151",whiteSpace:"nowrap"}}>
                        {row.name}
                        {total>0&&<span style={{fontSize:10,marginLeft:7,color:hits===total?"#059669":hits/total>=0.5?"#d97706":"#dc2626",fontWeight:600}}>{hits}/{total}</span>}
                      </td>
                      {row.months.map(m=>(
                        <td key={m.ym} style={{textAlign:"center",padding:"7px 6px"}}>
                          {m.status==="ok"&&<span title={fmt(m.spent)} style={{display:"inline-block",width:16,height:16,borderRadius:"50%",background:"#dcfce7",border:"1.5px solid #059669",lineHeight:"14px",fontSize:10,color:"#059669"}}>✓</span>}
                          {m.status==="over"&&<span title={fmt(m.spent)} style={{display:"inline-block",width:16,height:16,borderRadius:"50%",background:"#fee2e2",border:"1.5px solid #dc2626",lineHeight:"14px",fontSize:10,color:"#dc2626"}}>✗</span>}
                          {m.status==="none"&&<span style={{display:"inline-block",width:16,height:16,borderRadius:"50%",background:"#f8fafc",border:"1.5px solid #f1f5f9"}}/>}
                        </td>
                      ))}
                      <td style={{textAlign:"right",padding:"7px 0 7px 10px",color:"#94a3b8",fontSize:11}}>{fmt(row.budget)}/mo</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock price chart */}
      {holdings.length>0&&<StockPriceChart holdings={holdings}/>}

      {/* Recent Transactions */}
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:14,color:"#1E293B"}}>Recent Transactions</div>
        {recent.length===0?<div style={{color:"#94a3b8",fontSize:13}}>No transactions this month</div>:recent.map(t=>(
          <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #f8fafc"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:t.type==="income"?"#f0fdf4":"#fafafa",border:"1px solid "+(t.type==="income"?"#bbf7d0":"#f1f5f9"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>
                {t.type==="income"?"💰":"🧾"}
              </div>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>{t.merchant||t.source}</span>
                  {isAnomaly(t)&&<span title={"Avg for "+t.category+": "+fmt(catAvgs[t.category])} style={{fontSize:9,fontWeight:700,background:"#fef3c7",color:"#92400e",padding:"1px 6px",borderRadius:20,letterSpacing:"0.05em",border:"1px solid #fde68a"}}>UNUSUAL</span>}
                </div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>{t.date}{t.type==="expense"&&t.category?" · "+t.category:" · Income"}</div>
              </div>
            </div>
            <div style={{fontWeight:700,fontSize:14,color:t.type==="income"?GREEN:"#374151"}}>{t.type==="income"?"+":"-"}{fmt(t.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
    {l:`Projected Annual ${thisYear}`,v:projectedYearly,c:"#0284C7",sub:`${fmt(confirmedYearTotal)} confirmed · ${fmt(confirmedMonthTotal)} this month`},
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
                  {cur==="CAD"?"🍁 CAD":"🇺🇸 USD"}
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
                {fxLoading&&<span style={{fontSize:11,color:"#0284C7"}}>Fetching rate…</span>}
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
                <span style={{fontSize:16,fontWeight:800,color:"#0284C7"}}>{fmt(cadAmt)} CAD</span>
              </div>
            </div>
          )}
          {recurring&&amtNum>0&&!isUSD&&(
            <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#0369a1",fontWeight:500}}>
              {yearCount} {recurrenceLabel.toLowerCase()} payments of <strong>{fmt(amtNum)} CAD</strong> = <strong style={{fontWeight:800}}>{fmt(amtNum*yearCount)} CAD</strong> through Dec&nbsp;{new Date(f.expectedDate+"T12:00:00").getFullYear()}
            </div>
          )}
          {recurring&&amtNum>0&&isUSD&&cadAmt>0&&(
            <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#0369a1",fontWeight:500}}>
              {yearCount} {recurrenceLabel.toLowerCase()} payments of <strong>${amtNum.toFixed(2)} USD</strong> ({fmt(cadAmt)} CAD each) = <strong style={{fontWeight:800}}>{fmt(cadAmt*yearCount)} CAD</strong> through Dec&nbsp;{new Date(f.expectedDate+"T12:00:00").getFullYear()}
            </div>
          )}
          <Fld label="Note (optional)" style={{marginBottom:16}}><input style={IS} value={f.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
          <Btn onClick={add} disabled={!f.source.trim()||!f.amount||(isUSD&&!effectiveRate)} full>{recurring?`Add ${yearCount} Entries`:"Add to Schedule"}</Btn>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {sumCards.map(item=>(
            <div key={item.l} style={{...CA,padding:"18px 20px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>{item.l}</div>
              <div style={{fontSize:24,fontWeight:800,color:item.c,letterSpacing:"-0.5px",lineHeight:1.1}}>{fmt(item.v)}</div>
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
                        {cur==="CAD"?"🍁 CAD":"🇺🇸 USD"}
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
                    <span style={{fontSize:15,fontWeight:800,color:"#0284C7"}}>{fmt(edCadAmt)} CAD</span>
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
                <div style={{fontSize:11,color:"#9ca3af",marginTop:1}}>Expected {e.expectedDate}{e.note?" · "+e.note:""}{e.originalAmountUSD?" · 🇺🇸 $"+e.originalAmountUSD.toFixed(2)+" USD @ "+Number(e.fxRate).toFixed(4):""}</div>
                {e.confirmed&&<div style={{fontSize:11,color:"#059669",marginTop:1}}>Confirmed {e.confirmedDate}</div>}
              </div>
              <div style={{fontWeight:600,fontSize:13,color:e.confirmed?"#059669":"#0284C7",whiteSpace:"nowrap"}}>{fmt(e.amount)}</div>
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

function LocalFolderSync({cats, receiptFPs=new Set(), onSaveFPs, onSaveMultiple}) {
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [dirName, setDirName] = useState(()=>localStorage.getItem("folderDirName")||null);
  const [dirHandle, setDirHandle] = useState(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const folderRef = useRef();
  const [processedNames, setProcessedNames] = useState(() => {
    try { return JSON.parse(localStorage.getItem("folderProcessed") || "[]"); } catch { return []; }
  });

  const VALID_EXT = ["jpg","jpeg","png","gif","webp","heic","heif","pdf"];

  const loadFromHandle = async (handle, fps) => {
    setStatus({ t: "info", m: "Checking for new files…" });
    setPendingFiles([]);
    const files = [];
    for await (const entry of handle.values()) {
      if (entry.kind !== "file") continue;
      const file = await entry.getFile();
      const ext = file.name.split(".").pop().toLowerCase();
      if (!VALID_EXT.includes(ext) && !file.type.startsWith("image/") && file.type !== "application/pdf") continue;
      const mtype = file.type || (ext === "pdf" ? "application/pdf" : "image/jpeg");
      files.push({ file, mtype });
    }
    if (files.length === 0) {
      setStatus({ t: "error", m: "No image or PDF files found in this folder." });
      return;
    }
    const checked = await Promise.all(files.map(async ({file, mtype}) => {
      const b64 = await toB64(file);
      const fp = fpHash(b64);
      return { file, mtype, b64, fp, alreadyDone: fps.has(fp) };
    }));
    const newFiles = checked.filter(f => !f.alreadyDone);
    setPendingFiles(newFiles);
    const skipped = checked.length - newFiles.length;
    if (newFiles.length === 0) {
      setStatus({ t: "success", m: `All ${files.length} file${files.length !== 1 ? "s" : ""} already scanned — nothing new to import.` });
    } else {
      setStatus({ t: "info", m: `Found ${newFiles.length} new file${newFiles.length !== 1 ? "s" : ""} ready to scan.${skipped > 0 ? ` (${skipped} already imported, skipped)` : ""}` });
    }
  };

  // On mount, restore saved handle and auto-load if permission already granted
  useEffect(() => {
    if (!("showDirectoryPicker" in window)) return;
    idbGet("folderHandle").then(async handle => {
      if (!handle) return;
      const perm = await handle.queryPermission({ mode: "read" });
      setDirHandle(handle);
      setDirName(handle.name);
      localStorage.setItem("folderDirName", handle.name);
      if (perm === "granted") {
        loadFromHandle(handle, receiptFPs);
      } else {
        setNeedsPermission(true);
        setStatus({ t: "info", m: `Click "Restore Access" to reconnect to 📁 ${handle.name}.` });
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFolder = async () => {
    if (!("showDirectoryPicker" in window)) { folderRef.current.click(); return; }
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      await idbPut("folderHandle", handle);
      setDirHandle(handle);
      setDirName(handle.name);
      localStorage.setItem("folderDirName", handle.name);
      setNeedsPermission(false);
      await loadFromHandle(handle, receiptFPs);
    } catch (e) {
      if (e.name !== "AbortError") setStatus({ t: "error", m: "Error: " + e.message });
    }
  };

  const restoreAccess = async () => {
    if (!dirHandle) return;
    try {
      const perm = await dirHandle.requestPermission({ mode: "read" });
      if (perm === "granted") { setNeedsPermission(false); await loadFromHandle(dirHandle, receiptFPs); }
    } catch (e) { setStatus({ t: "error", m: "Could not restore access: " + e.message }); }
  };

  // Fallback for browsers without showDirectoryPicker
  const handleFolderInput = async (e) => {
    const all = Array.from(e.target.files || []);
    e.target.value = "";
    if (all.length === 0) return;
    const files = all.filter(f => {
      const ext = f.name.split(".").pop().toLowerCase();
      return VALID_EXT.includes(ext) || f.type.startsWith("image/") || f.type === "application/pdf";
    }).map(f => {
      const ext = f.name.split(".").pop().toLowerCase();
      const mtype = f.type || (ext === "pdf" ? "application/pdf" : "image/jpeg");
      return { file: f, mtype };
    });
    const firstPath = all[0].webkitRelativePath || all[0].name;
    const name = firstPath.includes("/") ? firstPath.split("/")[0] : "Selected files";
    setDirName(name);
    localStorage.setItem("folderDirName", name);
    if (files.length === 0) { setStatus({ t: "error", m: "No image or PDF files found." }); return; }
    setStatus({ t: "info", m: "Checking for new files…" });
    const checked = await Promise.all(files.map(async ({file, mtype}) => {
      const b64 = await toB64(file);
      const fp = fpHash(b64);
      return { file, mtype, b64, fp, alreadyDone: receiptFPs.has(fp) };
    }));
    const newFiles = checked.filter(f => !f.alreadyDone);
    setPendingFiles(newFiles);
    const skipped = checked.length - newFiles.length;
    if (newFiles.length === 0) {
      setStatus({ t: "success", m: `All ${files.length} file${files.length !== 1 ? "s" : ""} already scanned.` });
    } else {
      setStatus({ t: "info", m: `Found ${newFiles.length} new file${newFiles.length !== 1 ? "s" : ""} ready to scan.${skipped > 0 ? ` (${skipped} already imported, skipped)` : ""}` });
    }
  };

  const scan = async () => {
    if (pendingFiles.length === 0) return;
    setSyncing(true);
    setStatus({ t: "info", m: `Scanning ${pendingFiles.length} file${pendingFiles.length !== 1 ? "s" : ""}…` });
    try {
      const fps = new Set(receiptFPs);
      const results = await Promise.all(pendingFiles.map(async ({ file, mtype, b64: cachedB64, fp: cachedFp }) => {
        try {
          const b64 = cachedB64 || await toB64(file);
          const fp = cachedFp || fpHash(b64);
          if (fps.has(fp)) return { ok: false, file, skipped: true };
          const ext = await extractReceipt(b64, mtype, cats);
          return { ok: true, file, ext, fp };
        } catch {
          return { ok: false, file };
        }
      }));

      const successful = results.filter(r => r.ok);
      const newTxns = successful.map(r => ({
        id: uid(), type: "expense",
        merchant: r.ext.merchant || "Unknown",
        amount: parseFloat(r.ext.amount) || 0,
        date: r.ext.date || today(),
        category: cats.includes(r.ext.suggestedCategory) ? r.ext.suggestedCategory : cats[0] || "Other",
        note: "Imported from local folder",
        hasReceipt: true,
      }));

      successful.forEach(r => fps.add(r.fp));
      onSaveFPs(fps);
      const newNames = [...processedNames, ...successful.map(r => r.file.name)];
      setProcessedNames(newNames);
      localStorage.setItem("folderProcessed", JSON.stringify(newNames));
      setPendingFiles([]);

      if (newTxns.length > 0) await onSaveMultiple(newTxns);

      const skipped = results.filter(r => r.skipped).length;
      const failed = results.length - successful.length - skipped;
      setStatus({
        t: "success",
        m: `Imported ${newTxns.length} receipt${newTxns.length !== 1 ? "s" : ""}` +
           (skipped > 0 ? `, ${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped` : "") +
           (failed > 0 ? `, ${failed} could not be read` : "") + ".",
      });
    } catch (e) {
      setStatus({ t: "error", m: "Error: " + e.message });
    }
    setSyncing(false);
  };

  const reset = () => {
    setProcessedNames([]);
    setPendingFiles([]);
    setDirName(null);
    setDirHandle(null);
    setNeedsPermission(false);
    localStorage.removeItem("folderProcessed");
    localStorage.removeItem("folderDirName");
    idbDel("folderHandle").catch(()=>{});
    setStatus({ t: "info", m: "Reset — all files will be re-imported on next scan." });
  };

  const steps = [
    "Create a folder anywhere on your computer and drop receipt photos or PDF invoices into it.",
    "Click \"Pick Folder\" once. The folder is remembered — on refresh it reconnects automatically.",
    "Review how many new files were found, then click \"Scan with AI\" to extract the data.",
    "Already-imported file names are tracked so nothing is duplicated. Click Reset to start fresh.",
  ];

  return (
    <div style={{maxWidth:520}}>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Folder Sync</h2>
      <div style={{...CA,marginBottom:14}}>
        <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:12,padding:"13px 16px",marginBottom:18,fontSize:13,color:"#0369a1",lineHeight:1.65,fontWeight:500}}>
          Drop receipt photos or PDF invoices into a local folder. Pick the folder to preview what's new, then run the scan to extract data with AI.
        </div>
        {status && (
          <div style={{fontSize:13,marginBottom:14,padding:"10px 12px",borderRadius:7,
            background:status.t==="error"?"#fee2e2":status.t==="success"?"#f0fdf4":"#f9fafb",
            color:status.t==="error"?"#b91c1c":status.t==="success"?"#15803d":"#374151",
            border:"1px solid "+(status.t==="error"?"#fecaca":status.t==="success"?"#bbf7d0":"#e5e7eb")}}>
            {status.m}
          </div>
        )}
        <input ref={folderRef} type="file" webkitdirectory="" multiple onChange={handleFolderInput} style={{display:"none"}}/>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {needsPermission
            ? <Btn onClick={restoreAccess} disabled={syncing} full v="secondary">🔑 Restore Access to 📁 {dirName}</Btn>
            : <Btn onClick={pickFolder} disabled={syncing} full v="secondary">{dirName ? `📁 ${dirName}` : "Pick Folder"}</Btn>}
          <Btn onClick={scan} disabled={syncing || pendingFiles.length === 0} full>
            {syncing ? "Scanning…" : `Scan${pendingFiles.length > 0 ? ` ${pendingFiles.length} File${pendingFiles.length !== 1 ? "s" : ""}` : ""} with AI`}
          </Btn>
        </div>
        {processedNames.length > 0 && (
          <div style={{marginTop:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:12,color:"#9ca3af"}}>{processedNames.length} file{processedNames.length!==1?"s":""} already imported</span>
            <button onClick={reset} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#6b7280",textDecoration:"underline",fontFamily:"inherit"}}>Reset import history</button>
          </div>
        )}
      </div>
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1E293B"}}>How it works</div>
        {steps.map((step,i)=>(
          <div key={i} style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
            <span style={{minWidth:20,height:20,borderRadius:"50%",background:"#0284C7",color:"#fff",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{i+1}</span>
            <span style={{fontSize:13,color:"#475569",lineHeight:1.5}}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileThumbnail({ item }) {
  if (item.isImg) {
    return <img src={"data:" + item.mtype + ";base64," + item.b64} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  }
  if (isPdf(item.mtype)) {
    return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:4,background:"#f8fafc"}}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="2" width="14" height="18" rx="2" fill="#ef4444" opacity="0.15"/>
          <rect x="3" y="2" width="14" height="18" rx="2" stroke="#ef4444" strokeWidth="1.5"/>
          <path d="M7 7h6M7 10h6M7 13h4" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M15 2v4h4" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M15 2l4 4" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span style={{ fontSize: 9, color: "#ef4444", fontWeight: 600, letterSpacing: "0.5px" }}>PDF</span>
      </div>
    );
  }
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 11, color: "#6b7280" }}>File</div>;
}

function UploadReceipts({cats,receiptFPs=new Set(),onSaveFPs,onSave}){
  const [items,setItems]=useState([]);
  const [stage,setStage]=useState("select");
  const [busy,setBusy]=useState(false);
  const ref=useRef();

  const loadFiles = async files => {
    const fps = receiptFPs;
    const arr = await Promise.all(Array.from(files).map(async f => {
      const b64 = await toB64(f);
      const fp = fpHash(b64);
      return { id: uid(), b64, fp, mtype: f.type, name: f.name, isImg: f.type.startsWith("image/"), status: fps.has(fp) ? "duplicate" : "pending", merchant: "", date: today(), amount: "", category: cats[0] || "Other", note: "" };
    }));
    setItems(arr);
    setStage("select");
  };

  const processAll = async () => {
    setBusy(true);
    const res = await Promise.all(items.map(async item => {
      if (item.status === "duplicate") return item;
      try {
        const ext = await extractReceipt(item.b64, item.mtype, cats);
        return { ...item, status: "done", merchant: ext.merchant || "", date: ext.date || today(), amount: String(ext.amount || ""), category: cats.includes(ext.suggestedCategory) ? ext.suggestedCategory : cats[0] };
      } catch (e) { return { ...item, status: "error", errorMsg: e.message }; }
    }));
    setItems(res);
    setBusy(false);
    setStage("review");
  };

  const upd=(id,k,v)=>setItems(p=>p.map(i=>i.id===id?{...i,[k]:v}:i));
  const rem=id=>setItems(p=>p.filter(i=>i.id!==id));
  const logAll=()=>{
    const valid=items.filter(i=>i.status==="done"&&parseFloat(i.amount)>0);
    const fps=new Set(receiptFPs);
    valid.forEach(i=>fps.add(i.fp));
    onSaveFPs(fps);
    onSave(valid.map(i=>({id:uid(),type:"expense",merchant:i.merchant||"Unknown",amount:parseFloat(i.amount)||0,date:i.date,category:i.category,note:i.note,hasReceipt:true})));
  };

  if(stage==="select") return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Upload Receipts</h2>
      <div style={{...CA,marginBottom:14}}>
        <div
          onClick={()=>ref.current.click()}
          onDragOver={e=>e.preventDefault()}
          onDrop={e=>{e.preventDefault();loadFiles(e.dataTransfer.files);}}
          style={{border:"2px dashed #c7d2fe",borderRadius:16,padding:"36px 20px",textAlign:"center",cursor:"pointer",background:"linear-gradient(135deg,#fafbff,#f5f3ff)",userSelect:"none",transition:"border-color 0.15s"}}
        >
          <div style={{fontSize:28,marginBottom:10}}>📄</div>
          <div style={{fontWeight:700,fontSize:14,marginBottom:4,color:"#1E293B"}}>Tap to select receipts or drag and drop</div>
          <div style={{fontSize:12,color:"#94a3b8",fontWeight:500}}>JPG, PNG, HEIC, PDF — multiple files supported</div>
          <input ref={ref} type="file" multiple accept="image/*,application/pdf" style={{display:"none"}} onChange={e=>loadFiles(e.target.files)}/>
        </div>
        <div style={{display:"flex",gap:16,marginTop:12,justifyContent:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#6b7280"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"#3b82f6",display:"inline-block"}}/>Images (JPG, PNG, HEIC)
          </div>
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#6b7280"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"#ef4444",display:"inline-block"}}/>PDF invoices &amp; receipts
          </div>
        </div>
      </div>
      {items.length>0&&(
        <div style={CA}>
          {(()=>{const dupes=items.filter(i=>i.status==="duplicate").length;const fresh=items.length-dupes;return(<>
          <div style={{fontSize:12,color:"#6b7280",marginBottom:10}}>
            {fresh} new file{fresh!==1?"s":""} selected
            {" "}({items.filter(i=>isPdf(i.mtype)&&i.status!=="duplicate").length} PDF, {items.filter(i=>i.isImg&&i.status!=="duplicate").length} image)
            {dupes>0&&<span style={{marginLeft:8,color:"#f59e0b",fontWeight:500}}>{dupes} already imported (will be skipped)</span>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(80px,1fr))",gap:8,marginBottom:14}}>
            {items.map(i=>(
              <div key={i.id} style={{position:"relative",height:80,borderRadius:7,overflow:"hidden",background:i.status==="duplicate"?"#fef9c3":"#f3f4f6",border:"1px solid "+(i.status==="duplicate"?"#fde68a":isPdf(i.mtype)?"#fecaca":"#e5e7eb"),opacity:i.status==="duplicate"?0.6:1}}>
                <FileThumbnail item={i}/>
                {i.status==="duplicate"&&<div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.55)",color:"#fde68a",fontSize:9,textAlign:"center",padding:"2px 0",fontWeight:600}}>DUPLICATE</div>}
                <button onClick={()=>rem(i.id)} style={{position:"absolute",top:3,right:3,width:18,height:18,borderRadius:"50%",background:"rgba(0,0,0,0.5)",color:"#fff",border:"none",cursor:"pointer",fontSize:10}}>x</button>
              </div>
            ))}
          </div>
          <Btn onClick={processAll} disabled={busy||fresh===0}>{busy?"Scanning...":"Scan with AI"}</Btn>
          </>);})()}
        </div>
      )}
    </div>
  );

  const okCount=items.filter(i=>i.status==="done"&&parseFloat(i.amount)>0).length;
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Review Receipts</h2>
        <span style={{fontSize:12,color:"#9ca3af"}}>{items.length} scanned</span>
      </div>
      <div style={{display:"grid",gap:12,marginBottom:18}}>
        {items.map(i=>(
          <div key={i.id} style={CA}>
            <div style={{display:"grid",gridTemplateColumns:"80px 1fr",gap:14,alignItems:"start"}}>
              <div style={{height:80,borderRadius:7,overflow:"hidden",background:"#e0f2fe",border:"1px solid "+(isPdf(i.mtype)?"#fecaca":"#e5e7eb")}}>
                <FileThumbnail item={i}/>
              </div>
              <div>
                {i.name&&<div style={{fontSize:10,color:"#9ca3af",marginBottom:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{i.name}</div>}
                {i.status==="error"
                  ?<div><div style={{color:"#dc2626",fontSize:13,marginBottom:4}}>Could not read this receipt</div>{i.errorMsg&&<div style={{color:"#9ca3af",fontSize:11,marginBottom:8}}>{i.errorMsg}</div>}<Btn v="danger" sm onClick={()=>rem(i.id)}>Remove</Btn></div>
                  :<div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <Fld label="Merchant"><input style={IS} value={i.merchant} onChange={e=>upd(i.id,"merchant",e.target.value)} placeholder="Store name"/></Fld>
                      <Fld label="Amount ($)"><input style={IS} type="number" value={i.amount} onChange={e=>upd(i.id,"amount",e.target.value)} placeholder="0.00"/></Fld>
                      <Fld label="Date"><input style={IS} type="date" value={i.date} onChange={e=>upd(i.id,"date",e.target.value)}/></Fld>
                      <Fld label="Category">
                        <select style={{...IS,background:"#fff"}} value={i.category} onChange={e=>upd(i.id,"category",e.target.value)}>
                          {cats.map(c=><option key={c}>{c}</option>)}
                        </select>
                      </Fld>
                    </div>
                    <Fld label="Note (optional)" style={{marginBottom:0}}>
                      <input style={IS} value={i.note} onChange={e=>upd(i.id,"note",e.target.value)} placeholder="Optional"/>
                    </Fld>
                  </div>
                }
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={logAll} disabled={okCount===0}>Log {okCount} Transaction{okCount!==1?"s":""}</Btn>
        <Btn v="secondary" onClick={()=>setStage("select")}>Back</Btn>
      </div>
    </div>
  );
}

function RecurringForm({title,type,cats,onSaveMultiple}){
  const initCat=cats[0]||"Other";
  const [f,setF]=useState({merchant:"",amount:"",date:today(),category:initCat,note:"",recurrence:"once",occurrences:"12",currency:"CAD"});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const [fxRate,setFxRate]=useState(null);   // null = not fetched yet
  const [fxLoading,setFxLoading]=useState(false);
  const [fxError,setFxError]=useState(null);
  const [fxOverride,setFxOverride]=useState("");  // manual override

  // Fetch historical USD→CAD rate whenever date or currency changes
  useEffect(()=>{
    if(f.currency!=="USD") return;
    setFxLoading(true);setFxError(null);
    fetchUsdCad(f.date)
      .then(rate=>{setFxRate(rate);setFxOverride(String(rate.toFixed(4)));})
      .catch(()=>setFxError("Could not fetch rate"))
      .finally(()=>setFxLoading(false));
  },[f.date,f.currency,type]);

  const recurring=f.recurrence!=="once";
  const count=recurring?Math.max(1,parseInt(f.occurrences)||1):1;
  const amtNum=parseFloat(f.amount)||0;
  const isUSD=f.currency==="USD";
  const effectiveRate=parseFloat(fxOverride)||fxRate||1;
  const cadAmt=isUSD?+(amtNum*effectiveRate).toFixed(2):amtNum;

  const submit=()=>{
    if(!f.merchant.trim()||!f.amount) return;
    const fxMeta=isUSD?{originalAmountUSD:amtNum,fxRate:effectiveRate,fxDate:f.date}:{};
    const base=type==="expense"
      ?{type:"expense",merchant:f.merchant.trim(),amount:cadAmt,category:f.category,note:f.note,hasReceipt:false,...fxMeta}
      :{type:"income",merchant:f.merchant.trim(),source:f.merchant.trim(),amount:cadAmt,...fxMeta,note:f.note};
    const dates=recurring?buildDates(f.date,f.recurrence,count):[f.date];
    const gid=recurring?uid():undefined;
    onSaveMultiple(dates.map(date=>({...base,id:uid(),date,...(gid?{groupId:gid,cadence:f.recurrence}:{})})));
    setF({merchant:"",amount:"",date:today(),category:initCat,note:"",recurrence:"once",occurrences:"12",currency:"CAD"});
    setFxRate(null);setFxOverride("");
  };
  const lbl=(CADENCES.find(c=>c.v===f.recurrence)||{l:""}).l;
  return (
    <div style={{maxWidth:500}}>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>{title}</h2>
      <div style={CA}>
        <Fld label={type==="income"?"Source":"Merchant / Description"}><input style={IS} value={f.merchant} onChange={e=>set("merchant",e.target.value)} placeholder={type==="income"?"e.g. Salary, Freelance":"e.g. Walmart, Netflix, Rent"}/></Fld>
        {/* Currency selector */}
        <Fld label="Currency">
          <div style={{display:"flex",gap:8}}>
            {["CAD","USD"].map(cur=>(
              <button key={cur} onClick={()=>set("currency",cur)} style={{flex:1,padding:"8px 0",borderRadius:8,border:`2px solid ${f.currency===cur?"#0284C7":"#e2e8f0"}`,background:f.currency===cur?"#f0f9ff":"#fff",color:f.currency===cur?"#0284C7":"#64748b",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
                {cur==="CAD"?"🍁 CAD":"🇺🇸 USD"}
              </button>
            ))}
          </div>
        </Fld>
        <Fld label={`Amount per payment (${f.currency})`}><input style={IS} type="number" value={f.amount} onChange={e=>set("amount",e.target.value)} placeholder="0.00"/></Fld>
        <Fld label={recurring?"Start Date":"Date"}><input style={IS} type="date" value={f.date} onChange={e=>set("date",e.target.value)}/></Fld>
        {type==="expense"&&<Fld label="Category"><select style={{...IS,background:"#fff"}} value={f.category} onChange={e=>set("category",e.target.value)}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>}
        <Fld label="Recurrence"><select style={{...IS,background:"#fff"}} value={f.recurrence} onChange={e=>set("recurrence",e.target.value)}>{CADENCES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></Fld>
        {recurring&&<Fld label="Number of payments"><input style={IS} type="number" min="2" max="120" value={f.occurrences} onChange={e=>set("occurrences",e.target.value)}/></Fld>}
        <Fld label="Note (optional)" style={{marginBottom:12}}><input style={IS} value={f.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
        {/* FX conversion panel */}
        {isUSD&&amtNum>0&&(
          <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:12,fontWeight:700,color:"#0369a1",textTransform:"uppercase",letterSpacing:"0.05em"}}>USD → CAD Conversion</span>
              {fxLoading&&<span style={{fontSize:11,color:"#0284C7"}}>Fetching rate…</span>}
              {fxError&&<span style={{fontSize:11,color:"#dc2626"}}>{fxError}</span>}
              {!fxLoading&&!fxError&&fxRate&&<span style={{fontSize:11,color:"#0369a1"}}>Rate for {f.date}</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:12,color:"#0369a1",flexShrink:0}}>1 USD =</span>
              <input
                style={{...IS,width:90,padding:"5px 8px",fontSize:13}}
                type="number"
                step="0.0001"
                value={fxOverride}
                onChange={e=>setFxOverride(e.target.value)}
                placeholder={fxLoading?"…":"rate"}
              />
              <span style={{fontSize:12,color:"#0369a1",flexShrink:0}}>CAD</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:13,color:"#0369a1"}}>
                ${amtNum.toFixed(2)} USD × {effectiveRate.toFixed(4)}
              </span>
              <span style={{fontSize:18,fontWeight:800,color:"#0284C7",letterSpacing:"-0.5px"}}>
                {fmt(cadAmt)} CAD
              </span>
            </div>
            {recurring&&<div style={{fontSize:12,color:"#0369a1",marginTop:6,fontWeight:500}}>
              {count} payments of <strong>${amtNum.toFixed(2)} USD</strong> = <strong>{fmt(cadAmt*count)} CAD</strong> total
            </div>}
          </div>
        )}
        {recurring&&amtNum>0&&!isUSD&&<div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:12,padding:"11px 14px",marginBottom:16,fontSize:13,color:"#0369a1",fontWeight:500}}>{count} payments of <strong>{fmt(amtNum)} CAD</strong> = <strong style={{fontWeight:800}}>{fmt(amtNum*count)} CAD</strong> — {lbl.toLowerCase()}, starting {f.date}</div>}
        {recurring&&amtNum>0&&isUSD&&cadAmt>0&&<div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:12,padding:"11px 14px",marginBottom:16,fontSize:13,color:"#0369a1",fontWeight:500}}>{count} payments of <strong>${amtNum.toFixed(2)} USD</strong> ({fmt(cadAmt)} CAD each) = <strong style={{fontWeight:800}}>{fmt(cadAmt*count)} CAD</strong> — {lbl.toLowerCase()}, starting {f.date}</div>}
        <Btn onClick={submit} disabled={!f.merchant.trim()||!f.amount||(isUSD&&!effectiveRate)} full>{recurring?"Log "+count+" Entries":"Add "+title}</Btn>
      </div>
    </div>
  );
}

function History({txns,cats,onUpdate,fMonth,setFMonth,onToast}){
  const [fCat,setFCat]=useState("all");
  const [search,setSearch]=useState("");
  const [editId,setEditId]=useState(null);
  const [ed,setEd]=useState({});
  const [expanded,setExpanded]=useState(new Set());
  const [editGroupId,setEditGroupId]=useState(null);
  const [gEd,setGEd]=useState({});
  const [selectMode,setSelectMode]=useState(false);
  const [selected,setSelected]=useState(new Set());
  const months=[...new Set(txns.map(t=>t.date&&t.date.slice(0,7)).filter(Boolean))].sort().reverse();
  const sq=search.toLowerCase().trim();
  const filtered=txns.filter(t=>{
    if(fMonth!=="all"&&!(t.date&&t.date.startsWith(fMonth))) return false;
    if(fCat!=="all"){if(fCat==="income"&&t.type!=="income")return false;if(fCat!=="income"&&(t.type!=="expense"||t.category!==fCat))return false;}
    if(sq){const hay=((t.merchant||t.source||"")+" "+(t.note||"")+" "+(t.category||"")+" "+String(t.amount||"")).toLowerCase();if(!hay.includes(sq))return false;}
    return true;
  });
  const exportCSV=()=>{
    const rows=[["Date","Type","Merchant","Amount","Category","Note"]];
    filtered.forEach(t=>rows.push([t.date||"",t.type,t.merchant||t.source||"",t.amount,t.category||"",t.note||""]));
    const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\n");
    const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download="transactions-"+(fMonth==="all"?"all":fMonth)+".csv";a.click();
  };
  const groupMap={};
  const displayItems=[];
  filtered.forEach(t=>{if(t.groupId){(groupMap[t.groupId]=groupMap[t.groupId]||[]).push(t);}else displayItems.push({kind:"single",t,sortDate:t.date||""});});
  Object.keys(groupMap).forEach(gid=>{const gTxns=[...groupMap[gid]].sort((a,b)=>(a.date||"").localeCompare(b.date||""));displayItems.push({kind:"group",groupId:gid,txns:gTxns,sortDate:gTxns[gTxns.length-1]?gTxns[gTxns.length-1].date||"":""});});
  displayItems.sort((a,b)=>b.sortDate.localeCompare(a.sortDate));
  const del=id=>{const prev=[...txns];onUpdate(txns.filter(t=>t.id!==id));onToast&&onToast("Transaction deleted",()=>onUpdate(prev));};
  const delGroup=gid=>{const prev=[...txns];onUpdate(txns.filter(t=>t.groupId!==gid));onToast&&onToast("Recurring group deleted",()=>onUpdate(prev));};
  const startEdit=t=>{setEditId(t.id);setEd({...t});};
  const saveEdit=()=>{onUpdate(txns.map(t=>t.id===editId?{...ed,amount:parseFloat(ed.amount)||0}:t));setEditId(null);};
  const toggleExpand=gid=>setExpanded(prev=>{const n=new Set(prev);n.has(gid)?n.delete(gid):n.add(gid);return n;});
  const startEditGroup=(gid,gTxns)=>{const rep=gTxns[0];setEditGroupId(gid);setGEd({merchant:rep.merchant||rep.source||"",amount:String(rep.amount||""),category:rep.category||cats[0]||"Other",cadence:rep.cadence||"monthly",startDate:gTxns[0].date||today(),occurrences:String(gTxns.length),note:rep.note||"",type:rep.type});};
  const saveGroup=()=>{const amtNum=parseFloat(gEd.amount)||0;const count=Math.max(1,parseInt(gEd.occurrences)||1);const dates=buildDates(gEd.startDate,gEd.cadence,count);const newEntries=dates.map(date=>({id:uid(),groupId:editGroupId,cadence:gEd.cadence,type:gEd.type,merchant:gEd.merchant,source:gEd.merchant,amount:amtNum,date:date,category:gEd.type==="expense"?gEd.category:undefined,note:gEd.note}));onUpdate([...txns.filter(t=>t.groupId!==editGroupId),...newEntries]);setEditGroupId(null);};
  const totI=filtered.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const totE=filtered.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  const ss={padding:"7px 10px",borderRadius:7,border:"1px solid #d1d5db",fontSize:12,background:"#fff",fontFamily:"inherit"};
  const rBtn=(onClick,bdr,col,txt)=><button onClick={onClick} style={{background:"none",border:"1px solid "+bdr,borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:col,fontFamily:"inherit"}}>{txt}</button>;
  const toggleSelect=id=>setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleGroup=(gTxns,allSelected)=>setSelected(prev=>{const n=new Set(prev);gTxns.forEach(t=>allSelected?n.delete(t.id):n.add(t.id));return n;});
  const exitSelect=()=>{setSelectMode(false);setSelected(new Set());};
  const deleteSelected=()=>{const prev=[...txns];onUpdate(txns.filter(t=>!selected.has(t.id)));onToast&&onToast(`${selected.size} transaction${selected.size!==1?"s":""} deleted`,()=>onUpdate(prev));exitSelect();};
  const selectedIds=[...selected];
  const selectedGroups=[...new Set(selectedIds.map(id=>{const t=txns.find(x=>x.id===id);return t?.groupId;}).filter(Boolean))];
  const canEditGroup=selectedGroups.length===1&&selectedIds.every(id=>{const t=txns.find(x=>x.id===id);return t?.groupId===selectedGroups[0];});
  if(editGroupId){
    const gCount=Math.max(1,parseInt(gEd.occurrences)||1);const gAmt=parseFloat(gEd.amount)||0;
    return (
      <div style={{maxWidth:500}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}><button onClick={()=>setEditGroupId(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#9ca3af",padding:0,fontFamily:"inherit"}}>←</button><h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Edit Recurring Group</h2></div>
        <div style={CA}>
          <div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,padding:"10px 13px",marginBottom:16,fontSize:12,color:"#92400e"}}>This replaces all entries in this group with new ones based on your updated settings.</div>
          <Fld label="Merchant / Source"><input style={IS} value={gEd.merchant} onChange={e=>setGEd(p=>({...p,merchant:e.target.value}))}/></Fld>
          <Fld label="Amount per payment ($)"><input style={IS} type="number" value={gEd.amount} onChange={e=>setGEd(p=>({...p,amount:e.target.value}))}/></Fld>
          {gEd.type==="expense"&&<Fld label="Category"><select style={{...IS,background:"#fff"}} value={gEd.category} onChange={e=>setGEd(p=>({...p,category:e.target.value}))}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>}
          <Fld label="Start Date"><input style={IS} type="date" value={gEd.startDate} onChange={e=>setGEd(p=>({...p,startDate:e.target.value}))}/></Fld>
          <Fld label="Cadence"><select style={{...IS,background:"#fff"}} value={gEd.cadence} onChange={e=>setGEd(p=>({...p,cadence:e.target.value}))}>{CADENCES.filter(c=>c.v!=="once").map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></Fld>
          <Fld label="Number of entries"><input style={IS} type="number" min="1" max="120" value={gEd.occurrences} onChange={e=>setGEd(p=>({...p,occurrences:e.target.value}))}/></Fld>
          <Fld label="Note (optional)" style={{marginBottom:12}}><input style={IS} value={gEd.note} onChange={e=>setGEd(p=>({...p,note:e.target.value}))}/></Fld>
          {gAmt>0&&<div style={{background:"#f0f9ff",border:"1px solid #7dd3fc",borderRadius:8,padding:"10px 13px",marginBottom:16,fontSize:13,color:"#0284C7"}}>{gCount} entries of {fmt(gAmt)} = <strong>{fmt(gAmt*gCount)}</strong> — {cLabel(gEd.cadence).toLowerCase()}, starting {gEd.startDate}</div>}
          <div style={{display:"flex",gap:8}}><Btn onClick={saveGroup} disabled={!gEd.merchant.trim()||!gEd.amount} full>Save Group</Btn><Btn v="secondary" onClick={()=>setEditGroupId(null)}>Cancel</Btn></div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
        <h2 style={{margin:0,fontSize:19,fontWeight:600,marginRight:"auto"}}>History</h2>
        <select value={fMonth} onChange={e=>setFMonth(e.target.value)} style={ss}><option value="all">All Months</option>{months.map(m=><option key={m} value={m}>{new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"})}</option>)}</select>
        <select value={fCat} onChange={e=>setFCat(e.target.value)} style={ss}><option value="all">All Types</option><option value="income">Income</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <button onClick={()=>{setSelectMode(s=>!s);setSelected(new Set());}} style={{padding:"7px 12px",borderRadius:7,border:"1px solid "+(selectMode?"#0284C7":"#bae6fd"),fontSize:12,background:selectMode?"#eff6ff":"#fff",color:selectMode?"#0284C7":"#1E293B",cursor:"pointer",fontFamily:"inherit",fontWeight:selectMode?600:400}}>Select</button>
        <button onClick={exportCSV} disabled={filtered.length===0} style={{padding:"7px 12px",borderRadius:7,border:"1px solid #bae6fd",fontSize:12,background:"#fff",color:"#0284C7",cursor:filtered.length===0?"not-allowed":"pointer",fontFamily:"inherit",opacity:filtered.length===0?0.4:1}}>Export CSV</button>
      </div>
      <div style={{marginBottom:14}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search merchant, category, note, amount…" style={{...IS,borderRadius:10,paddingLeft:13}}/>
      </div>
      {selectMode&&selected.size>0&&(
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,padding:"10px 14px",background:"#f0f9ff",borderRadius:8,border:"1px solid #7dd3fc",flexWrap:"wrap"}}>
          <span style={{fontSize:13,fontWeight:500,color:"#0284C7",marginRight:"auto"}}>{selected.size} selected</span>
          {canEditGroup&&<Btn sm onClick={()=>{const gTxns=txns.filter(t=>t.groupId===selectedGroups[0]);startEditGroup(selectedGroups[0],gTxns);exitSelect();}}>Edit Group</Btn>}
          <Btn sm v="danger" onClick={deleteSelected}>Delete Selected</Btn>
          <Btn sm v="secondary" onClick={exitSelect}>Cancel</Btn>
        </div>
      )}
      {filtered.length>0&&<div style={{display:"flex",gap:16,marginBottom:12}}><span style={{fontSize:12,color:"#6b7280"}}>{filtered.length} transactions</span>{totI>0&&<span style={{fontSize:12,color:"#059669"}}>+{fmt(totI)}</span>}{totE>0&&<span style={{fontSize:12,color:"#dc2626"}}>{fmt(totE)}</span>}</div>}
      <div style={CA}>
        {displayItems.length===0?<div style={{color:"#9ca3af",fontSize:13}}>No transactions found</div>:displayItems.map(item=>{
          if(item.kind==="group"){
            const gid=item.groupId,gTxns=item.txns,rep=gTxns[0];
            const isExp=expanded.has(gid);
            const total=gTxns.reduce((s,t)=>s+t.amount,0);
            const first=gTxns[0]?gTxns[0].date:"",last=gTxns[gTxns.length-1]?gTxns[gTxns.length-1].date:"";
            return (
              <div key={gid} style={{borderBottom:"1px solid #f3f4f6"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",flexWrap:"wrap"}}>
                  {selectMode&&(()=>{const allSel=gTxns.every(t=>selected.has(t.id));const someSel=gTxns.some(t=>selected.has(t.id));return<input type="checkbox" checked={allSel} ref={el=>{if(el)el.indeterminate=someSel&&!allSel;}} onChange={()=>toggleGroup(gTxns,allSel)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>;})()}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:500}}>{rep.merchant||rep.source}</span>
                      <span style={{fontSize:11,background:"#f0f9ff",color:"#0284C7",padding:"1px 7px",borderRadius:20,fontWeight:500}}>{cLabel(rep.cadence||"monthly")}</span>
                      <span style={{fontSize:11,color:"#9ca3af"}}>{gTxns.length} entries</span>
                    </div>
                    <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{first} – {last}{rep.category?" · "+rep.category:""}</div>
                  </div>
                  <div style={{fontWeight:600,fontSize:13,color:rep.type==="income"?"#059669":"#111827",whiteSpace:"nowrap"}}>{rep.type==="income"?"+":""}{fmt(total)}</div>
                  {!selectMode&&<div style={{display:"flex",gap:5,flexShrink:0}}>
                    {rBtn(()=>toggleExpand(gid),"#e5e7eb","#6b7280",isExp?"Collapse":"Expand")}
                    {rBtn(()=>startEditGroup(gid,gTxns),"#bae6fd","#0284C7","Edit Group")}
                    {rBtn(()=>delGroup(gid),"#fecaca","#dc2626","Delete All")}
                  </div>}
                  {selectMode&&rBtn(()=>toggleExpand(gid),"#e5e7eb","#6b7280",isExp?"Collapse":"Expand")}
                </div>
                {isExp&&gTxns.map(t=>(
                  <div key={t.id} style={{marginLeft:16,borderLeft:"2px solid #e5e7eb",paddingLeft:12,background:selectMode&&selected.has(t.id)?"#eff6ff":"transparent",borderRadius:selectMode&&selected.has(t.id)?4:0}}>
                    {editId===t.id
                      ?<div style={{padding:"10px 0"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}><Fld label="Amount ($)"><input style={IS} type="number" value={ed.amount||""} onChange={e=>setEd(d=>({...d,amount:e.target.value}))}/></Fld><Fld label="Date"><input style={IS} type="date" value={ed.date||""} onChange={e=>setEd(d=>({...d,date:e.target.value}))}/></Fld><Fld label="Note"><input style={IS} value={ed.note||""} onChange={e=>setEd(d=>({...d,note:e.target.value}))}/></Fld></div><div style={{display:"flex",gap:8}}><Btn sm onClick={saveEdit}>Save</Btn><Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn></div></div>
                      :<div style={{display:"flex",alignItems:"center",padding:"7px 0",gap:10,borderBottom:"1px solid #f9fafb"}}>
                        {selectMode&&<input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleSelect(t.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>}
                        <div style={{flex:1}}><div style={{fontSize:12,color:"#1E293B"}}>{t.date}</div>{t.note&&<div style={{fontSize:11,color:"#9ca3af"}}>{t.note}</div>}</div>
                        <div style={{fontSize:12,fontWeight:500,color:t.type==="income"?"#059669":"#111827"}}>{t.type==="income"?"+":""}{fmt(t.amount)}</div>
                        {!selectMode&&<div style={{display:"flex",gap:4}}>{rBtn(()=>startEdit(t),"#e5e7eb","#6b7280","Edit")}{rBtn(()=>del(t.id),"#fecaca","#dc2626","Delete")}</div>}
                      </div>}
                  </div>
                ))}
              </div>
            );
          }
          const t=item.t;
          return (
            <div key={t.id} style={{borderBottom:"1px solid #f3f4f6"}}>
              {editId===t.id
                ?<div style={{padding:"12px 0"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}><Fld label="Merchant / Source"><input style={IS} value={ed.merchant||ed.source||""} onChange={e=>setEd(d=>({...d,merchant:e.target.value,source:e.target.value}))}/></Fld><Fld label="Amount ($)"><input style={IS} type="number" value={ed.amount||""} onChange={e=>setEd(d=>({...d,amount:e.target.value}))}/></Fld><Fld label="Date"><input style={IS} type="date" value={ed.date||""} onChange={e=>setEd(d=>({...d,date:e.target.value}))}/></Fld>{ed.type==="expense"&&<Fld label="Category"><select style={{...IS,background:"#fff"}} value={ed.category||cats[0]} onChange={e=>setEd(d=>({...d,category:e.target.value}))}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>}<Fld label="Note"><input style={IS} value={ed.note||""} onChange={e=>setEd(d=>({...d,note:e.target.value}))}/></Fld></div><div style={{display:"flex",gap:8}}><Btn sm onClick={saveEdit}>Save</Btn><Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn></div></div>
                :<div style={{display:"flex",alignItems:"center",padding:"9px 0",gap:10,background:selectMode&&selected.has(t.id)?"#eff6ff":"transparent",borderRadius:4}}>
                  {selectMode&&<input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleSelect(t.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>}
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant||t.source}</div><div style={{fontSize:11,color:"#9ca3af"}}>{t.date} · {t.type==="income"?"Income":t.category||"Uncategorized"}{t.note?" · "+t.note:""}{t.originalAmountUSD?" · 🇺🇸 $"+t.originalAmountUSD.toFixed(2)+" USD @ "+Number(t.fxRate).toFixed(4):""}</div></div>
                  <div style={{fontWeight:600,fontSize:13,color:t.type==="income"?"#059669":"#111827",whiteSpace:"nowrap"}}>{t.type==="income"?"+":""}{fmt(t.amount)}</div>
                  {!selectMode&&<div style={{display:"flex",gap:5,flexShrink:0}}>{rBtn(()=>startEdit(t),"#e5e7eb","#6b7280","Edit")}{rBtn(()=>del(t.id),"#fecaca","#dc2626","Delete")}</div>}
                </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Categories({cats,onUpdate,catBudgets,onUpdateBudgets}){
  const [newCat,setNewCat]=useState("");
  const [editIdx,setEditIdx]=useState(null);
  const [editVal,setEditVal]=useState("");
  const [budgetEdit,setBudgetEdit]=useState({});
  const add=()=>{const t=newCat.trim();if(!t||cats.includes(t))return;onUpdate([...cats,t]);setNewCat("");};
  const del=i=>{const c=cats[i];onUpdate(cats.filter((_,j)=>j!==i));const b={...catBudgets};delete b[c];onUpdateBudgets(b);};
  const startEdit=i=>{setEditIdx(i);setEditVal(cats[i]);};
  const saveEdit=()=>{const t=editVal.trim();if(!t)return;const old=cats[editIdx];const c=[...cats];c[editIdx]=t;onUpdate(c);if(catBudgets[old]!==undefined){const b={...catBudgets};b[t]=b[old];delete b[old];onUpdateBudgets(b);}setEditIdx(null);};
  const setBudget=(cat,val)=>{setBudgetEdit(p=>({...p,[cat]:val}));};
  const saveBudget=(cat)=>{const v=parseFloat(budgetEdit[cat]);onUpdateBudgets({...catBudgets,[cat]:isNaN(v)||v<=0?0:v});setBudgetEdit(p=>{const n={...p};delete n[cat];return n;});};
  return (
    <div style={{maxWidth:520}}>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Categories</h2>
      <div style={CA}>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={newCat} onChange={e=>setNewCat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="New category name" style={{...IS,flex:1}}/>
          <Btn onClick={add} disabled={!newCat.trim()}>Add</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",alignItems:"center",gap:"0 8px",marginBottom:4}}>
          <span style={{fontSize:11,color:"#9ca3af",fontWeight:600,textTransform:"uppercase"}}>Category</span>
          <span style={{fontSize:11,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",textAlign:"right",minWidth:110}}>Monthly Budget</span>
          <span/>
          <span/>
        </div>
        {cats.map((c,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",alignItems:"center",gap:"0 8px",padding:"7px 0",borderBottom:"1px solid #f3f4f6"}}>
            {editIdx===i
              ?<><input value={editVal} onChange={e=>setEditVal(e.target.value)} autoFocus onKeyDown={e=>e.key==="Enter"&&saveEdit()} style={{...IS,flex:1,gridColumn:"1"}}/><Btn sm onClick={saveEdit}>Save</Btn><Btn sm v="secondary" onClick={()=>setEditIdx(null)}>Cancel</Btn><span/></>
              :<>
                <span style={{fontSize:13}}>{c}</span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:11,color:"#6b7280"}}>$</span>
                  <input
                    type="number" min="0" placeholder="—"
                    value={budgetEdit[c]!==undefined?budgetEdit[c]:(catBudgets[c]||"")}
                    onChange={e=>setBudget(c,e.target.value)}
                    onBlur={()=>budgetEdit[c]!==undefined&&saveBudget(c)}
                    onKeyDown={e=>e.key==="Enter"&&saveBudget(c)}
                    style={{...IS,width:80,textAlign:"right"}}
                  />
                </div>
                <button onClick={()=>startEdit(i)} style={{background:"none",border:"1px solid #e5e7eb",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
                <button onClick={()=>del(i)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>Remove</button>
              </>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Vacations({vacations,vacationTxns,onSaveVacations,onSaveTxns}){
  const [view,setView]=useState("list"); // "list" | "detail" | "new"
  const [activeId,setActiveId]=useState(null);
  const [form,setForm]=useState({name:"",startDate:today(),endDate:today(),budget:""});
  const [expForm,setExpForm]=useState({merchant:"",amount:"",date:today(),note:""});
  const [editExpId,setEditExpId]=useState(null);
  const [editExp,setEditExp]=useState({});
  const [editingMeta,setEditingMeta]=useState(false);
  const [metaForm,setMetaForm]=useState({});
  const [selectMode,setSelectMode]=useState(false);
  const [selected,setSelected]=useState(new Set());

  const setF=(k,v)=>setForm(p=>({...p,[k]:v}));
  const setE=(k,v)=>setExpForm(p=>({...p,[k]:v}));
  const startEditMeta=vac=>{setMetaForm({name:vac.name,startDate:vac.startDate,endDate:vac.endDate,budget:vac.budget||""});setEditingMeta(true);};
  const saveEditMeta=()=>{onSaveVacations(vacations.map(v=>v.id===activeId?{...v,name:metaForm.name.trim()||v.name,startDate:metaForm.startDate,endDate:metaForm.endDate,budget:parseFloat(metaForm.budget)||0}:v));setEditingMeta(false);};

  const addVacation=()=>{
    if(!form.name.trim()) return;
    const v={id:uid(),name:form.name.trim(),startDate:form.startDate,endDate:form.endDate,budget:parseFloat(form.budget)||0,completed:false};
    onSaveVacations([...vacations,v]);
    setForm({name:"",startDate:today(),endDate:today(),budget:""});
    setActiveId(v.id);setView("detail");
  };
  const delVacation=id=>{onSaveVacations(vacations.filter(v=>v.id!==id));onSaveTxns(vacationTxns.filter(t=>t.vacationId!==id));};
  const toggleComplete=id=>onSaveVacations(vacations.map(v=>v.id===id?{...v,completed:!v.completed,completedAt:v.completed?null:today()}:v));
  const logExpense=()=>{
    if(!expForm.merchant.trim()||!expForm.amount) return;
    const t={id:uid(),vacationId:activeId,merchant:expForm.merchant.trim(),amount:parseFloat(expForm.amount)||0,date:expForm.date||today(),note:expForm.note};
    onSaveTxns([...vacationTxns,t]);
    setExpForm({merchant:"",amount:"",date:today(),note:""});
  };
  const saveEditExp=()=>{onSaveTxns(vacationTxns.map(t=>t.id===editExpId?{...t,...editExp,amount:parseFloat(editExp.amount)||0}:t));setEditExpId(null);};
  const delExp=id=>onSaveTxns(vacationTxns.filter(t=>t.id!==id));
  const toggleSel=id=>setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const exitSelect=()=>{setSelectMode(false);setSelected(new Set());};
  const deleteSelected=()=>{onSaveTxns(vacationTxns.filter(t=>!selected.has(t.id)));exitSelect();};

  if(view==="new") return (
    <div style={{maxWidth:460}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
        <button onClick={()=>setView("list")} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#9ca3af",padding:0,fontFamily:"inherit"}}>←</button>
        <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>New Vacation</h2>
      </div>
      <div style={CA}>
        <Fld label="Trip Name"><input style={IS} value={form.name} onChange={e=>setF("name",e.target.value)} placeholder="e.g. Paris Trip, Beach Week"/></Fld>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fld label="Start Date"><input style={IS} type="date" value={form.startDate} onChange={e=>setF("startDate",e.target.value)}/></Fld>
          <Fld label="End Date"><input style={IS} type="date" value={form.endDate} onChange={e=>setF("endDate",e.target.value)}/></Fld>
        </div>
        <Fld label="Budget (optional)" style={{marginBottom:16}}><input style={IS} type="number" value={form.budget} onChange={e=>setF("budget",e.target.value)} placeholder="0.00"/></Fld>
        <Btn onClick={addVacation} disabled={!form.name.trim()} full>Create Vacation</Btn>
      </div>
    </div>
  );

  if(view==="detail"){
    const vac=vacations.find(v=>v.id===activeId);
    if(!vac) return null;
    const txns=[...vacationTxns.filter(t=>t.vacationId===activeId)].sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    const total=txns.reduce((s,t)=>s+t.amount,0);
    const remaining=vac.budget>0?vac.budget-total:null;
    return (
      <div style={{maxWidth:560}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:editingMeta?12:18}}>
          <button onClick={()=>{setView("list");setEditingMeta(false);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#9ca3af",padding:0,fontFamily:"inherit"}}>←</button>
          <h2 style={{margin:0,fontSize:19,fontWeight:600,flex:1}}>{vac.name}</h2>
          {!editingMeta&&<button onClick={()=>startEditMeta(vac)} style={{background:"none",border:"1px solid #e5e7eb",borderRadius:6,padding:"4px 11px",cursor:"pointer",fontSize:12,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>}
          {!editingMeta&&<button onClick={()=>toggleComplete(vac.id)} style={{background:vac.completed?"#f0fdf4":"none",border:`1px solid ${vac.completed?"#86efac":"#e5e7eb"}`,borderRadius:6,padding:"4px 11px",cursor:"pointer",fontSize:12,color:vac.completed?"#15803d":"#6b7280",fontFamily:"inherit",fontWeight:vac.completed?600:400}}>{vac.completed?"✓ Completed":"Mark Complete"}</button>}
        </div>
        {editingMeta&&(
          <div style={{...CA,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1E293B"}}>Edit Vacation</div>
            <Fld label="Trip Name"><input style={IS} value={metaForm.name} onChange={e=>setMetaForm(p=>({...p,name:e.target.value}))}/></Fld>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Fld label="Start Date"><input style={IS} type="date" value={metaForm.startDate} onChange={e=>setMetaForm(p=>({...p,startDate:e.target.value}))}/></Fld>
              <Fld label="End Date"><input style={IS} type="date" value={metaForm.endDate} onChange={e=>setMetaForm(p=>({...p,endDate:e.target.value}))}/></Fld>
            </div>
            <Fld label="Budget (optional)" style={{marginBottom:14}}><input style={IS} type="number" value={metaForm.budget} onChange={e=>setMetaForm(p=>({...p,budget:e.target.value}))} placeholder="0.00"/></Fld>
            <div style={{display:"flex",gap:8}}><Btn onClick={saveEditMeta} disabled={!metaForm.name.trim()}>Save</Btn><Btn v="secondary" onClick={()=>setEditingMeta(false)}>Cancel</Btn></div>
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:16}}>
          {[{l:"Total Spent",v:fmt(total),c:"#dc2626"},{l:"Budget",v:vac.budget>0?fmt(vac.budget):"—",c:"#f59e0b"},{l:remaining>=0?"Remaining":"Over Budget",v:remaining!=null?fmt(Math.abs(remaining)):"—",c:remaining==null?"#9ca3af":remaining>=0?"#059669":"#dc2626"},{l:"Dates",v:vac.startDate+" – "+vac.endDate,c:"#374151",small:true}].map(card=>(
            <div key={card.l} style={{...CA,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:600,color:"#9ca3af",textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:4}}>{card.l}</div>
              <div style={{fontSize:card.small?12:16,fontWeight:700,color:card.c}}>{card.v}</div>
            </div>
          ))}
        </div>
        {vac.budget>0&&<div style={{height:8,borderRadius:4,background:"#e0f2fe",marginBottom:16,overflow:"hidden"}}><div style={{height:"100%",borderRadius:4,width:Math.min(total/vac.budget,1)*100+"%",background:remaining>=0?"#f59e0b":"#dc2626",transition:"width 0.3s"}}/></div>}
        <div style={{...CA,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1E293B"}}>Log Expense</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Fld label="Merchant"><input style={IS} value={expForm.merchant} onChange={e=>setE("merchant",e.target.value)} placeholder="e.g. Hotel, Restaurant"/></Fld>
            <Fld label="Amount ($)"><input style={IS} type="number" value={expForm.amount} onChange={e=>setE("amount",e.target.value)} placeholder="0.00"/></Fld>
            <Fld label="Date"><input style={IS} type="date" value={expForm.date} onChange={e=>setE("date",e.target.value)}/></Fld>
            <Fld label="Note (optional)"><input style={IS} value={expForm.note} onChange={e=>setE("note",e.target.value)} placeholder="Optional"/></Fld>
          </div>
          <Btn onClick={logExpense} disabled={!expForm.merchant.trim()||!expForm.amount} full style={{marginTop:4}}>Add Expense</Btn>
        </div>
        <div style={CA}>
          <div style={{display:"flex",alignItems:"center",marginBottom:12,gap:8}}>
            <span style={{fontSize:13,fontWeight:600,color:"#1E293B",flex:1}}>Expenses ({txns.length})</span>
            {txns.length>0&&<button onClick={()=>{setSelectMode(s=>!s);setSelected(new Set());}} style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+(selectMode?"#0284C7":"#bae6fd"),fontSize:11,background:selectMode?"#eff6ff":"#fff",color:selectMode?"#0284C7":"#1E293B",cursor:"pointer",fontFamily:"inherit",fontWeight:selectMode?600:400}}>Select</button>}
          </div>
          {selectMode&&selected.size>0&&(
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 12px",background:"#f0f9ff",borderRadius:7,border:"1px solid #7dd3fc"}}>
              <span style={{fontSize:12,fontWeight:500,color:"#0284C7",flex:1}}>{selected.size} selected</span>
              <Btn sm v="danger" onClick={deleteSelected}>Delete</Btn>
              <Btn sm v="secondary" onClick={exitSelect}>Cancel</Btn>
            </div>
          )}
          {txns.length===0?<div style={{color:"#9ca3af",fontSize:13}}>No expenses yet</div>:txns.map(t=>(
            <div key={t.id} style={{borderBottom:"1px solid #f3f4f6",background:selectMode&&selected.has(t.id)?"#eff6ff":"transparent",borderRadius:4}}>
              {editExpId===t.id
                ?<div style={{padding:"10px 0"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                    <Fld label="Merchant"><input style={IS} value={editExp.merchant||""} onChange={e=>setEditExp(p=>({...p,merchant:e.target.value}))}/></Fld>
                    <Fld label="Amount ($)"><input style={IS} type="number" value={editExp.amount||""} onChange={e=>setEditExp(p=>({...p,amount:e.target.value}))}/></Fld>
                    <Fld label="Date"><input style={IS} type="date" value={editExp.date||""} onChange={e=>setEditExp(p=>({...p,date:e.target.value}))}/></Fld>
                    <Fld label="Note"><input style={IS} value={editExp.note||""} onChange={e=>setEditExp(p=>({...p,note:e.target.value}))}/></Fld>
                  </div><div style={{display:"flex",gap:8}}><Btn sm onClick={saveEditExp}>Save</Btn><Btn sm v="secondary" onClick={()=>setEditExpId(null)}>Cancel</Btn></div></div>
                :<div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0"}}>
                  {selectMode&&<input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleSel(t.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant}</div>
                    <div style={{fontSize:11,color:"#9ca3af"}}>{t.date}{t.note?" · "+t.note:""}</div>
                  </div>
                  <div style={{fontWeight:600,fontSize:13,color:"#dc2626",whiteSpace:"nowrap"}}>{fmt(t.amount)}</div>
                  {!selectMode&&<div style={{display:"flex",gap:4}}>
                    <button onClick={()=>{setEditExpId(t.id);setEditExp({...t});}} style={{background:"none",border:"1px solid #e5e7eb",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
                    <button onClick={()=>delExp(t.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>Delete</button>
                  </div>}
                </div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",marginBottom:18}}>
        <h2 style={{margin:0,fontSize:19,fontWeight:600,flex:1}}>Vacations</h2>
        <Btn onClick={()=>setView("new")}>+ New Vacation</Btn>
      </div>
      {vacations.length===0?<div style={{...CA,color:"#9ca3af",fontSize:13}}>No vacations yet. Add one to start tracking trip expenses separately from your regular budget.</div>:
      <div style={{display:"grid",gap:12}}>
        {[...vacations].sort((a,b)=>{if(!!a.completed!==!!b.completed)return a.completed?1:-1;return(b.startDate||"").localeCompare(a.startDate||"");}).map(v=>{
          const vTxns=vacationTxns.filter(t=>t.vacationId===v.id);
          const total=vTxns.reduce((s,t)=>s+t.amount,0);
          const pct=v.budget>0?Math.min(total/v.budget,1):0;
          const over=v.budget>0&&total>v.budget;
          return (
            <div key={v.id} style={{...CA,cursor:"pointer",opacity:v.completed?0.75:1,borderColor:v.completed?"#86efac":"#f1f5f9"}} onClick={()=>{setActiveId(v.id);setView("detail");setSelectMode(false);setSelected(new Set());}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                    <div style={{fontSize:15,fontWeight:600}}>{v.name}</div>
                    {v.completed&&<span style={{fontSize:10,fontWeight:700,color:"#15803d",background:"#dcfce7",border:"1px solid #86efac",borderRadius:99,padding:"1px 7px",letterSpacing:"0.03em"}}>COMPLETED</span>}
                  </div>
                  <div style={{fontSize:11,color:"#9ca3af"}}>{v.startDate} – {v.endDate}{v.completedAt?" · done "+v.completedAt:""}</div>
                  {v.budget>0&&<div style={{marginTop:8,height:6,borderRadius:3,background:"#e0f2fe",overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,width:pct*100+"%",background:v.completed?"#059669":over?"#dc2626":"#f59e0b"}}/></div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:15,fontWeight:700,color:v.completed?"#059669":"#dc2626"}}>{fmt(total)}</div>
                    {v.budget>0&&<div style={{fontSize:11,color:over&&!v.completed?"#dc2626":"#9ca3af"}}>{over&&!v.completed?"over ":"of "}{fmt(v.budget)}</div>}
                    <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{vTxns.length} expense{vTxns.length!==1?"s":""}</div>
                  </div>
                  <button onClick={e=>{e.stopPropagation();toggleComplete(v.id);}} style={{fontSize:11,padding:"3px 9px",borderRadius:6,border:`1px solid ${v.completed?"#86efac":"#e2e8f0"}`,background:v.completed?"#f0fdf4":"#fff",color:v.completed?"#15803d":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:v.completed?600:400,whiteSpace:"nowrap"}}>
                    {v.completed?"✓ Done":"Mark Complete"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

const WHATS_NEW = [
  { icon: "✦", title: "AI Receipt Scanning", desc: "Upload photos or PDFs of receipts — AI extracts merchant, date, amount, and category automatically. Try Upload Receipts." },
  { icon: "✦", title: "Folder Sync", desc: "Point the app at a local folder of receipts and scan them all at once. Already-imported files are skipped automatically. Try Folder Sync." },
  { icon: "✦", title: "Recurring Transactions", desc: "Log expenses or income on weekly, bi-weekly, monthly, quarterly, and more cadences — all entries created in one shot. Try Add Expense or Add Income." },
  { icon: "✦", title: "Expected Income", desc: "Schedule future income and mark it received when it lands. Overdue items are flagged and pending totals show on the Dashboard. Try Expected Income." },
  { icon: "✦", title: "Vacation Budgets", desc: "Track trip expenses in a separate budget so they don't distort your monthly spending. Spending also rolls up to the Dashboard. Try Vacations." },
  { icon: "✦", title: "Category Budgets", desc: "Set a monthly cap per category. Progress bars and over-budget alerts appear on the Dashboard and in History. Try Categories." },
  { icon: "✦", title: "Bulk Select & Edit", desc: "In History and Expected Income, tap Select to check multiple rows and delete or confirm them all at once." },
  { icon: "✦", title: "6-Month Cashflow Chart", desc: "The Dashboard charts income, expenses, and pending expected income across the last 6 months so you can spot trends at a glance." },
];

function Toast({msg,undoFn,onClose}){
  return(
    <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:300,background:"#1E293B",color:"#fff",borderRadius:12,padding:"12px 20px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 32px rgba(15,23,42,0.25)",fontSize:13,fontWeight:500,minWidth:260,maxWidth:420,whiteSpace:"nowrap"}}>
      <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>{msg}</span>
      {undoFn&&<button onClick={()=>{undoFn();onClose();}} style={{background:"rgba(255,255,255,0.18)",border:"none",cursor:"pointer",padding:"4px 12px",borderRadius:7,color:"#fff",fontSize:12,fontWeight:600,fontFamily:"inherit",flexShrink:0}}>Undo</button>}
      <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.5)",fontSize:16,padding:0,fontFamily:"inherit",lineHeight:1,flexShrink:0}}>×</button>
    </div>
  );
}

const STOCK_COLORS=["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#ec4899","#f97316"];

function StockPriceChart({holdings}){
  const RANGES=[
    {l:"1W",v:"5d",iv:"1h"},
    {l:"1M",v:"1mo",iv:"1d"},
    {l:"3M",v:"3mo",iv:"1d"},
    {l:"6M",v:"6mo",iv:"1wk"},
    {l:"1Y",v:"1y",iv:"1wk"},
    {l:"YTD",v:"ytd",iv:"1d"},
    {l:"5Y",v:"5y",iv:"1mo"},
    {l:"All",v:"max",iv:"3mo"},
  ];
  const [range,setRange]=useState("1mo");
  const [chartData,setChartData]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [pinA,setPinA]=useState(null); // {date, vals:{ticker: normalizedPct}}
  const [hover,setHover]=useState(null); // same shape, tracks mouse position
  const chartRef=useRef(null);

  // Clear pin when clicking outside the chart card
  useEffect(()=>{
    const onDocClick=(e)=>{
      if(chartRef.current&&!chartRef.current.contains(e.target)){
        setPinA(null);setHover(null);
      }
    };
    document.addEventListener("mousedown",onDocClick);
    return()=>document.removeEventListener("mousedown",onDocClick);
  },[]);

  useEffect(()=>{
    if(!holdings.length){setChartData([]);return;}
    setPinA(null);setHover(null);
    setLoading(true);setError(null);
    const rv=RANGES.find(r=>r.v===range)||RANGES[1];
    Promise.all(holdings.map(h=>
      fetch(`/api/stocks/history?symbol=${h.ticker}&range=${rv.v}&interval=${rv.iv}`)
        .then(r=>r.json()).catch(()=>({symbol:h.ticker,points:[]}))
    )).then(results=>{
      const seriesMap={};
      results.forEach(({symbol,points})=>{
        if(!points||!points.length)return;
        const base=points[0].close;
        points.forEach(p=>{
          if(!seriesMap[p.date])seriesMap[p.date]={date:p.date};
          seriesMap[p.date][symbol]=base>0?+((p.close-base)/base*100).toFixed(4):0;
        });
      });
      setChartData(Object.values(seriesMap).sort((a,b)=>a.date.localeCompare(b.date)));
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[holdings.map(h=>h.ticker).join(","),range]);

  const [selected,setSelected]=useState(()=>new Set(holdings.map(h=>h.ticker)));
  // Keep selected in sync when holdings change (add newly added tickers, remove deleted)
  useEffect(()=>{
    const all=new Set(holdings.map(h=>h.ticker));
    setSelected(prev=>{
      const next=new Set([...prev].filter(t=>all.has(t)));
      all.forEach(t=>{if(!prev.has(t))next.add(t);});
      return next;
    });
  },[holdings.map(h=>h.ticker).join(",")]);// eslint-disable-line

  const toggleTicker=(tk)=>setSelected(prev=>{
    const next=new Set(prev);
    if(next.has(tk)){if(next.size>1)next.delete(tk);}
    else next.add(tk);
    return next;
  });

  if(!holdings.length)return null;

  const tickers=holdings.map(h=>h.ticker);
  const activeTickers=tickers.filter(t=>selected.has(t));

  // Period change for each active ticker (first → last data point)
  const periodChange=tk=>{
    const pts=chartData.filter(d=>d[tk]!=null);
    if(pts.length<2)return null;
    return pts[pts.length-1][tk]; // normalized pct from period start
  };

  const extractPoint=(data)=>{
    if(!data||!data.activeLabel)return null;
    const vals={};
    (data.activePayload||[]).forEach(p=>{vals[p.dataKey]=p.value;});
    return{date:data.activeLabel,vals};
  };

  const handleClick=(data)=>{
    const pt=extractPoint(data);
    if(!pt)return;
    if(!pinA||pt.date===pinA.date){setPinA(pt);}
    else{setPinA(pt);}  // clicking always resets the pin to the new point
  };

  const handleMouseMove=(data)=>{
    const pt=extractPoint(data);
    setHover(pt);
  };

  const handleMouseLeave=()=>setHover(null);

  // % return from pinA to any point
  const compareReturn=(a,b)=>((1+b/100)/(1+a/100)-1)*100;

  const comparePoint=pinA&&hover&&hover.date!==pinA.date?hover:null;

  const fmtPct=v=>(v>=0?"+":"")+v.toFixed(2)+"%";

  return(
    <div ref={chartRef} style={{...CA,marginTop:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>Stock Performance</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {RANGES.map(r=>(
            <button key={r.v} onClick={()=>setRange(r.v)} style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(range===r.v?"#3b82f6":"#e2e8f0"),background:range===r.v?"#3b82f6":"#fff",color:range===r.v?"#fff":"#64748b",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{r.l}</button>
          ))}
        </div>
      </div>

      {/* Ticker filter chips + period change summary */}
      <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
        {tickers.map((tk,i)=>{
          const color=STOCK_COLORS[i%STOCK_COLORS.length];
          const isOn=selected.has(tk);
          const pct=periodChange(tk);
          return(
            <button key={tk} onClick={()=>toggleTicker(tk)} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:20,border:`1.5px solid ${isOn?color:"#e2e8f0"}`,background:isOn?color+"18":"#f8fafc",cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:isOn?color:"#cbd5e1",flexShrink:0,display:"inline-block"}}/>
              <span style={{fontSize:11,fontWeight:700,color:isOn?color:"#94a3b8"}}>{tk}</span>
              {pct!=null&&isOn&&<span style={{fontSize:11,fontWeight:700,color:pct>=0?"#059669":"#dc2626"}}>{fmtPct(pct)}</span>}
            </button>
          );
        })}
      </div>

      {/* Compare panel — hover after pin */}
      {pinA&&comparePoint&&(
        <div style={{marginBottom:10,padding:"10px 14px",borderRadius:10,background:"#f0f9ff",border:"1px solid #bae6fd",display:"flex",flexWrap:"wrap",gap:14,alignItems:"center"}}>
          <div style={{fontSize:11,color:"#0284C7",fontWeight:600}}>{pinA.date} → {comparePoint.date}</div>
          {activeTickers.map((tk,i)=>{
            const globalIdx=tickers.indexOf(tk);
            const a=pinA.vals[tk]??null;
            const b=comparePoint.vals[tk]??null;
            if(a==null||b==null)return null;
            const ret=compareReturn(a,b);
            return(
              <div key={tk} style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:STOCK_COLORS[globalIdx%STOCK_COLORS.length],display:"inline-block"}}/>
                <span style={{fontSize:12,fontWeight:600,color:"#374151"}}>{tk}</span>
                <span style={{fontSize:13,fontWeight:800,color:ret>=0?"#059669":"#dc2626"}}>{fmtPct(ret)}</span>
              </div>
            );
          })}
          <button onClick={(e)=>{e.stopPropagation();setPinA(null);}} style={{marginLeft:"auto",fontSize:11,color:"#94a3b8",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>✕ Clear</button>
        </div>
      )}
      {pinA&&!comparePoint&&(
        <div style={{marginBottom:10,padding:"8px 14px",borderRadius:10,background:"#fefce8",border:"1px solid #fde68a",fontSize:11,color:"#92400e",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span>From: <strong>{pinA.date}</strong> — hover to compare · click to repin</span>
          <button onClick={(e)=>{e.stopPropagation();setPinA(null);}} style={{fontSize:11,color:"#94a3b8",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",marginLeft:12}}>✕ Clear</button>
        </div>
      )}

      {loading&&<div style={{textAlign:"center",padding:"32px 0",color:"#94a3b8",fontSize:13}}>Loading…</div>}
      {error&&<div style={{color:"#dc2626",fontSize:12,padding:"8px 0"}}>{error}</div>}
      {!loading&&chartData.length>0&&(
        <>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{top:4,right:8,left:0,bottom:0}} onClick={handleClick} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} style={{cursor:pinA?"crosshair":"default"}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="date" tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={d=>d.slice(5)} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={v=>v.toFixed(0)+"%"} tickLine={false} axisLine={false} width={40}/>
              <Tooltip formatter={(v,name)=>[fmtPct(Number(v)),name]} labelStyle={{fontSize:11,color:"#64748b"}} contentStyle={{fontSize:12,borderRadius:8,border:"1px solid #e2e8f0",boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}/>
              {pinA&&<ReferenceLine x={pinA.date} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2" label={{value:"from",position:"top",fill:"#f59e0b",fontSize:10,fontWeight:700}}/>}
              {tickers.map((tk,i)=>(
                <Line key={tk} type="monotone" dataKey={tk} stroke={STOCK_COLORS[i%STOCK_COLORS.length]} strokeWidth={selected.has(tk)?2:0} strokeOpacity={selected.has(tk)?1:0} dot={false} activeDot={selected.has(tk)?{r:4}:false} connectNulls hide={!selected.has(tk)}/>
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div style={{fontSize:10,color:"#94a3b8",marginTop:2,textAlign:"right"}}>% change · normalized · {pinA?"hover to compare · click to repin":"click to pin start date"}</div>
        </>
      )}
    </div>
  );
}

function Stocks({holdings,onSaveHoldings,onPricesUpdate,onFxRateUpdate}){
  const [prices,setPrices]=useState({});
  const [fxRate,setFxRate]=useState(1.38); // USD→CAD live rate
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [lastUpdated,setLastUpdated]=useState(null);

  // helpers
  const getCur=tk=>prices[tk]?.currency??(tk.toUpperCase().endsWith('.TO')?'CAD':'USD');
  const fmtN=(n,cur)=>cur==='USD'?fmtUSD(n):fmt(n);
  const toCAD=(amount,cur)=>cur==='USD'?amount*fxRate:amount;
  const [form,setForm]=useState({ticker:"",shares:"",costBasis:""});
  const [editId,setEditId]=useState(null);
  const [editF,setEditF]=useState({});
  const setF=(k,v)=>setForm(p=>({...p,[k]:v}));

  const fetchPrices=async(hdgs=holdings)=>{
    if(!hdgs.length)return;
    setLoading(true);setError(null);
    try{
      const symbols=hdgs.map(h=>h.ticker.toUpperCase()).join(",");
      const [stockRes,fxRes]=await Promise.all([
        fetch(`/api/stocks?symbols=${encodeURIComponent(symbols)}`),
        fetch(`/api/stocks?symbols=USDCAD%3DX`),
      ]);
      const stockData=await stockRes.json();
      const fxData=await fxRes.json();
      if(stockData.error)throw new Error(stockData.error);
      const map=Object.fromEntries((stockData.quotes||[]).map(q=>[q.symbol,q]));
      const rate=fxData.quotes?.[0]?.price??fxRate;
      setPrices(map);
      setFxRate(rate);
      onPricesUpdate&&onPricesUpdate(map);
      onFxRateUpdate&&onFxRateUpdate(rate);
      setLastUpdated(new Date());
    }catch(e){setError("Could not fetch prices: "+e.message);}
    setLoading(false);
  };

  useEffect(()=>{
    if(holdings.length){fetchPrices();}
    const iv=setInterval(()=>{if(holdings.length)fetchPrices();},60000);
    return()=>clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[holdings.map(h=>h.ticker).join(",")]);

  const add=()=>{
    const tk=form.ticker.trim().toUpperCase();
    if(!tk||!form.shares)return;
    if(holdings.some(h=>h.ticker===tk)){setError("Already tracking "+tk);return;}
    const next=[...holdings,{id:uid(),ticker:tk,shares:parseFloat(form.shares)||0,costBasis:form.costBasis?parseFloat(form.costBasis):null}];
    onSaveHoldings(next);setForm({ticker:"",shares:"",costBasis:""});setError(null);
    setTimeout(()=>fetchPrices(next),300);
  };
  const remove=id=>onSaveHoldings(holdings.filter(h=>h.id!==id));
  const saveEdit=()=>{
    onSaveHoldings(holdings.map(h=>h.id===editId?{...h,shares:parseFloat(editF.shares)||0,costBasis:editF.costBasis?parseFloat(editF.costBasis):null}:h));
    setEditId(null);
  };

  const [showAdd,setShowAdd]=useState(false);
  const [quickId,setQuickId]=useState(null);
  const [quickShares,setQuickShares]=useState("");

  const confirmQuickAdd=()=>{
    const n=parseFloat(quickShares);
    if(!n||n<=0){setQuickId(null);setQuickShares("");return;}
    onSaveHoldings(holdings.map(h=>{
      if(h.id!==quickId)return h;
      const curPrice=prices[h.ticker]?.price??null;
      const newShares=h.shares+n;
      let newCostBasis=h.costBasis;
      if(curPrice!=null){
        const oldCost=(h.costBasis??curPrice)*h.shares;
        newCostBasis=+(( oldCost+curPrice*n)/newShares).toFixed(4);
      }
      return{...h,shares:+newShares.toFixed(6),costBasis:newCostBasis};
    }));
    setQuickId(null);setQuickShares("");
  };
  // Native-currency per-holding value
  const hVal=h=>(prices[h.ticker]?.price??0)*h.shares;
  // CAD-converted totals (for combined display)
  const totalValueCAD=holdings.reduce((s,h)=>s+toCAD(hVal(h),getCur(h.ticker)),0);
  const totalCostCAD=holdings.filter(h=>h.costBasis!=null).reduce((s,h)=>s+toCAD(h.costBasis*h.shares,getCur(h.ticker)),0);
  const totalGainCAD=totalCostCAD>0?totalValueCAD-totalCostCAD:null;
  // For USD-only / CAD-only display
  const hasUSD=holdings.some(h=>getCur(h.ticker)==='USD');
  const hasCAD=holdings.some(h=>getCur(h.ticker)==='CAD');
  const isMixed=hasUSD&&hasCAD;
  const anyOpen=Object.values(prices).some(q=>q.marketState==="REGULAR");

  return(
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Stock Portfolio</h2>
          {lastUpdated&&<div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Prices as of {lastUpdated.toLocaleTimeString()} · {anyOpen?<span style={{color:"#059669",fontWeight:600}}>Market Open</span>:<span style={{color:"#94a3b8"}}>Market Closed</span>}</div>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setShowAdd(v=>!v)} style={{padding:"7px 14px",borderRadius:10,border:"1.5px solid "+(showAdd?"#0284C7":"#e2e8f0"),background:showAdd?"#0284C7":"#fff",color:showAdd?"#fff":"#374151",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
            {showAdd?"✕ Close":"+ Add Holding"}
          </button>
          <button onClick={()=>fetchPrices()} disabled={loading||!holdings.length} style={{padding:"7px 14px",borderRadius:10,border:"1.5px solid #bae6fd",background:"#fff",color:"#0284C7",cursor:loading||!holdings.length?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:loading||!holdings.length?0.5:1}}>
            {loading?"Updating…":"↻ Refresh"}
          </button>
        </div>
      </div>

      {error&&<div style={{marginBottom:14,padding:"10px 14px",borderRadius:10,background:"#fee2e2",color:"#b91c1c",fontSize:13,border:"1px solid #fecaca"}}>{error}</div>}

      {/* Collapsible add form */}
      {(showAdd||holdings.length===0)&&(
        <div style={{...CA,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:6}}>
            <div style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>{holdings.length===0?"Add Your First Holding":"Add Holding"}</div>
            <div style={{fontSize:11,color:"#94a3b8"}}>Canadian stocks: use <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:4,fontSize:11}}>SHOP.TO</code>, <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:4,fontSize:11}}>RY.TO</code>, etc.</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <Fld label="Ticker Symbol"><input style={IS} value={form.ticker} onChange={e=>setF("ticker",e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="e.g. AAPL, TSLA" autoFocus={showAdd}/></Fld>
            <Fld label="Number of Shares"><input style={IS} type="number" min="0" step="any" value={form.shares} onChange={e=>setF("shares",e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="10"/></Fld>
            <Fld label="Cost per Share (optional)"><input style={IS} type="number" min="0" step="any" value={form.costBasis} onChange={e=>setF("costBasis",e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="For gain/loss"/></Fld>
          </div>
          <Btn onClick={()=>{add();setShowAdd(false);}} disabled={!form.ticker.trim()||!form.shares} full>Add &amp; Fetch Price</Btn>
        </div>
      )}

      {/* Chart */}
      <StockPriceChart holdings={holdings}/>

      {/* Summary cards */}
      {holdings.length>0&&(
        <div style={{marginTop:14,marginBottom:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
            {/* Portfolio Value card — shows mixed currencies if applicable */}
            <div style={{...CA,padding:"16px 20px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Portfolio Value</div>
              {isMixed?(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {hasUSD&&<div style={{display:"flex",alignItems:"baseline",gap:6}}>
                    <span style={{fontSize:18,fontWeight:800,color:"#1E293B",letterSpacing:"-0.4px"}}>{fmtUSD(holdings.filter(h=>getCur(h.ticker)==='USD').reduce((s,h)=>s+hVal(h),0))}</span>
                    <span style={{fontSize:11,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:20}}>USD</span>
                  </div>}
                  {hasCAD&&<div style={{display:"flex",alignItems:"baseline",gap:6}}>
                    <span style={{fontSize:18,fontWeight:800,color:"#1E293B",letterSpacing:"-0.4px"}}>{fmt(holdings.filter(h=>getCur(h.ticker)==='CAD').reduce((s,h)=>s+hVal(h),0))}</span>
                    <span style={{fontSize:11,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:20}}>CAD</span>
                  </div>}
                </div>
              ):(
                <div style={{fontSize:22,fontWeight:800,color:"#1E293B",letterSpacing:"-0.5px"}}>{hasUSD?fmtUSD(totalValueCAD/fxRate):fmt(totalValueCAD)}</div>
              )}
            </div>
            {/* Gain/Loss card */}
            {totalGainCAD!=null&&(
              <div style={{...CA,padding:"16px 20px"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Total Gain / Loss</div>
                {isMixed?(
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {hasUSD&&(()=>{const usdHlds=holdings.filter(h=>getCur(h.ticker)==='USD'&&h.costBasis!=null);const g=usdHlds.reduce((s,h)=>s+hVal(h)-h.costBasis*h.shares,0);const c=usdHlds.reduce((s,h)=>s+h.costBasis*h.shares,0);return usdHlds.length?<div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:18,fontWeight:800,color:g>=0?"#059669":"#dc2626",letterSpacing:"-0.4px"}}>{g>=0?"+":""}{fmtUSD(g)}</span><span style={{fontSize:11,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:20}}>USD</span>{c>0&&<span style={{fontSize:11,color:g>=0?"#059669":"#dc2626",fontWeight:600}}>{g>=0?"+":""}{((g/c)*100).toFixed(2)}%</span>}</div>:null;})()}
                    {hasCAD&&(()=>{const cadHlds=holdings.filter(h=>getCur(h.ticker)==='CAD'&&h.costBasis!=null);const g=cadHlds.reduce((s,h)=>s+hVal(h)-h.costBasis*h.shares,0);const c=cadHlds.reduce((s,h)=>s+h.costBasis*h.shares,0);return cadHlds.length?<div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:18,fontWeight:800,color:g>=0?"#059669":"#dc2626",letterSpacing:"-0.4px"}}>{g>=0?"+":""}{fmt(g)}</span><span style={{fontSize:11,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:20}}>CAD</span>{c>0&&<span style={{fontSize:11,color:g>=0?"#059669":"#dc2626",fontWeight:600}}>{g>=0?"+":""}{((g/c)*100).toFixed(2)}%</span>}</div>:null;})()}
                  </div>
                ):(
                  <>
                    <div style={{fontSize:20,fontWeight:800,color:totalGainCAD>=0?"#059669":"#dc2626",letterSpacing:"-0.5px"}}>{totalGainCAD>=0?"+":""}{hasUSD?fmtUSD(totalGainCAD/fxRate):fmt(totalGainCAD)}</div>
                    {totalCostCAD>0&&<div style={{fontSize:11,fontWeight:600,color:totalGainCAD>=0?"#059669":"#dc2626",marginTop:3}}>{totalGainCAD>=0?"+":""}{((totalGainCAD/totalCostCAD)*100).toFixed(2)}%</div>}
                  </>
                )}
              </div>
            )}
          </div>
          {/* Combined CAD subcard — only when mixed currencies */}
          {isMixed&&(
            <div style={{marginTop:8,padding:"10px 16px",borderRadius:12,background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #bae6fd",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:11,fontWeight:700,color:"#0369a1",textTransform:"uppercase",letterSpacing:"0.07em"}}>Combined Value</span>
                <span style={{fontSize:11,color:"#64748b",background:"#fff",border:"1px solid #bae6fd",padding:"1px 7px",borderRadius:20,fontWeight:600}}>CAD · 1 USD = {fmt(fxRate)}</span>
              </div>
              <div style={{display:"flex",gap:24,alignItems:"baseline"}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:600}}>Portfolio</div>
                  <div style={{fontSize:18,fontWeight:800,color:"#0369a1",letterSpacing:"-0.4px"}}>{fmt(totalValueCAD)}</div>
                </div>
                {totalGainCAD!=null&&<div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:600}}>Gain / Loss</div>
                  <div style={{fontSize:18,fontWeight:800,color:totalGainCAD>=0?"#059669":"#dc2626",letterSpacing:"-0.4px"}}>{totalGainCAD>=0?"+":""}{fmt(totalGainCAD)}</div>
                </div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Holdings table */}
      {holdings.length>0&&(
        <div style={CA}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:quickId?"10px":"14px"}}>
            <div style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>Holdings</div>
            {!quickId
              ?<button onClick={()=>{setQuickId(holdings[0].id);setQuickShares("");setEditId(null);}} style={{padding:"4px 12px",borderRadius:8,border:"1.5px solid #bbf7d0",background:"#f0fdf4",color:"#059669",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>+ Add Shares</button>
              :<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <select value={quickId} onChange={e=>setQuickId(e.target.value)} style={{...IS,padding:"4px 8px",fontSize:12,width:"auto"}}>
                  {holdings.map(h=><option key={h.id} value={h.id}>{h.ticker}{prices[h.ticker]?.price!=null?" — "+fmtN(prices[h.ticker].price,getCur(h.ticker)):""}</option>)}
                </select>
                <input type="number" min="0" step="any" value={quickShares} onChange={e=>setQuickShares(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")confirmQuickAdd();if(e.key==="Escape"){setQuickId(null);setQuickShares("");} }} placeholder="# shares" style={{...IS,width:90,padding:"4px 8px",fontSize:12}} autoFocus/>
                {(()=>{const h=holdings.find(x=>x.id===quickId);const p=h&&prices[h.ticker]?.price;const c=h&&getCur(h.ticker);return p?<span style={{fontSize:11,color:"#94a3b8",whiteSpace:"nowrap"}}>@ {fmtN(p,c)}</span>:null;})()}
                <button onClick={confirmQuickAdd} disabled={!quickShares} style={{padding:"4px 12px",borderRadius:8,border:"none",background:"#059669",color:"#fff",cursor:quickShares?"pointer":"not-allowed",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:quickShares?1:0.5}}>Add</button>
                <button onClick={()=>{setQuickId(null);setQuickShares("");}} style={{padding:"4px 8px",borderRadius:8,border:"1px solid #e2e8f0",background:"none",color:"#94a3b8",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>✕</button>
              </div>
            }
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{borderBottom:"1px solid #f1f5f9"}}>
                  {["Symbol","Name","Shares","Price","Value","Gain / Loss",""].map(h=>(
                    <th key={h} style={{textAlign:h===""||h==="Shares"||h==="Price"||h==="Value"||h==="Gain / Loss"?"right":"left",padding:"0 12px 10px 0",color:"#94a3b8",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h=>{
                  const q=prices[h.ticker];
                  const cur=getCur(h.ticker);
                  const val=(q?.price??0)*h.shares;
                  const gain=h.costBasis!=null?val-h.costBasis*h.shares:null;
                  const gainPct=h.costBasis!=null&&h.costBasis>0?((gain/(h.costBasis*h.shares))*100):null;
                  return editId===h.id?(
                    <tr key={h.id} style={{borderBottom:"1px solid #f1f5f9",background:"#f8fbff"}}>
                      <td style={{padding:"10px 12px 10px 0",fontWeight:700,color:"#0284C7"}}>{h.ticker}</td>
                      <td colSpan={4} style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                          <input type="number" value={editF.shares} onChange={e=>setEditF(p=>({...p,shares:e.target.value}))} placeholder="Shares" style={{...IS,width:90}} autoFocus/>
                          <input type="number" value={editF.costBasis} onChange={e=>setEditF(p=>({...p,costBasis:e.target.value}))} placeholder="Cost/share (opt)" style={{...IS,width:130}}/>
                          <Btn sm onClick={saveEdit}>Save</Btn>
                          <Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn>
                        </div>
                      </td>
                      <td/><td/>
                    </tr>
                  ):(
                    <tr key={h.id} style={{borderBottom:"1px solid #f8fafc",background:quickId===h.id?"#f0fdf4":"transparent",transition:"background .15s"}}>
                      <td style={{padding:"12px 12px 12px 0",fontWeight:700,color:"#0284C7",whiteSpace:"nowrap"}}>
                        {h.ticker}
                        {q?.marketState==="REGULAR"&&<span style={{marginLeft:5,fontSize:9,background:"#dcfce7",color:"#059669",padding:"1px 5px",borderRadius:20,fontWeight:600}}>LIVE</span>}
                      </td>
                      <td style={{padding:"12px",color:"#374151",fontSize:12,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q?.name||"—"}</td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:500}}>{h.shares}</td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:700,color:"#1E293B"}}>
                        {q?.price!=null?<><span>{fmtN(q.price,cur)}</span>{isMixed&&<span style={{fontSize:9,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 4px",borderRadius:8,marginLeft:4}}>{cur}</span>}</>:<span style={{color:"#94a3b8"}}>—</span>}
                      </td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:700}}>
                        {q?.price!=null?<><span>{fmtN(val,cur)}</span>{isMixed&&<span style={{fontSize:9,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 4px",borderRadius:8,marginLeft:4}}>{cur}</span>}</>:<span style={{color:"#94a3b8"}}>—</span>}
                      </td>
                      <td style={{padding:"12px",textAlign:"right",whiteSpace:"nowrap"}}>
                        {gain!=null?<><span style={{fontWeight:600,color:gain>=0?"#059669":"#dc2626"}}>{gain>=0?"+":""}{fmtN(gain,cur)}</span>{isMixed&&<span style={{fontSize:9,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 4px",borderRadius:8,marginLeft:4}}>{cur}</span>}{gainPct!=null&&<span style={{fontSize:11,color:gain>=0?"#059669":"#dc2626",marginLeft:4}}>({gainPct>=0?"+":""}{gainPct.toFixed(2)}%)</span>}</>:<span style={{color:"#e2e8f0",fontSize:12}}>no cost</span>}
                      </td>
                      <td style={{padding:"12px 0 12px 8px",textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{display:"flex",gap:5,justifyContent:"flex-end"}}>
                          <button onClick={()=>{setEditId(h.id);setEditF({shares:String(h.shares),costBasis:h.costBasis!=null?String(h.costBasis):""});setQuickId(null);}} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
                          <button onClick={()=>remove(h.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CSV Import ────────────────────────────────────────────────────────────────
const BANK_PROFILES={
  td:{name:"TD Bank",cols:{date:0,desc:1,debit:2,credit:3},dateFormat:"YYYY-MM-DD",skipRows:1},
  rbc:{name:"RBC",cols:{date:0,desc:4,debit:3,credit:2},dateFormat:"MM/DD/YYYY",skipRows:1},
  bmo:{name:"BMO",cols:{date:0,desc:2,debit:3,credit:4},dateFormat:"YYYY-MM-DD",skipRows:1},
  scotiabank:{name:"Scotiabank",cols:{date:0,desc:1,debit:3,credit:4},dateFormat:"DD-MMM-YYYY",skipRows:1},
  cibc:{name:"CIBC",cols:{date:0,desc:1,debit:2,credit:3},dateFormat:"YYYY-MM-DD",skipRows:1},
  tangerine:{name:"Tangerine",cols:{date:0,desc:1,amount:2},dateFormat:"YYYY-MM-DD",skipRows:1},
  custom:{name:"Custom",cols:{date:0,desc:1,amount:2},dateFormat:"YYYY-MM-DD",skipRows:1},
};
function parseCSVDate(raw,fmt){
  if(!raw) return "";
  raw=raw.trim().replace(/"/g,"");
  if(fmt==="MM/DD/YYYY"){const p=raw.split("/");if(p.length===3)return p[2]+"-"+p[0].padStart(2,"0")+"-"+p[1].padStart(2,"0");}
  if(fmt==="DD-MMM-YYYY"){const ms={Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"};const p=raw.split("-");if(p.length===3)return p[2]+"-"+(ms[p[1]]||"01")+"-"+p[0].padStart(2,"0");}
  return raw.slice(0,10);
}
function parseCSV(text){
  const rows=[];let cur="",inQ=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){inQ=!inQ;}else if(c===','&&!inQ){rows[rows.length-1]?rows[rows.length-1].push(cur):rows.push([cur]);cur="";}else if((c==='\n'||c==='\r')&&!inQ){if(cur||rows.length){const last=rows[rows.length-1];if(last)last.push(cur);else rows.push([cur]);rows.push([]);}cur="";}else cur+=c;}
  if(cur){const last=rows[rows.length-1];if(last)last.push(cur);else rows.push([cur]);}
  return rows.filter(r=>r.some(c=>c.trim())).map(r=>r.map(c=>c.trim().replace(/^"|"$/g,"")));
}
function CSVImport({txns,cats,onImport}){
  const [profile,setProfile]=useState("td");
  const [step,setStep]=useState("upload"); // upload | map | review
  const [rawRows,setRawRows]=useState([]);
  const [headers,setHeaders]=useState([]);
  const [mapping,setMapping]=useState({date:"",desc:"",debit:"",credit:"",amount:""});
  const [skipRows,setSkipRows]=useState(1);
  const [preview,setPreview]=useState([]); // parsed+deduped rows for review
  const [checked,setChecked]=useState({});
  const [imported,setImported]=useState(null);
  const fileRef=useRef();

  const onFile=e=>{
    const f=e.target.files[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const rows=parseCSV(ev.target.result);
      setRawRows(rows);
      setHeaders(rows[0]||[]);
      const p=BANK_PROFILES[profile];
      const autoMap={};
      if(p.cols.date!==undefined) autoMap.date=String(p.cols.date);
      if(p.cols.desc!==undefined) autoMap.desc=String(p.cols.desc);
      if(p.cols.debit!==undefined) autoMap.debit=String(p.cols.debit);
      if(p.cols.credit!==undefined) autoMap.credit=String(p.cols.credit);
      if(p.cols.amount!==undefined) autoMap.amount=String(p.cols.amount);
      setMapping(autoMap);
      setSkipRows(p.skipRows||1);
      setStep("map");
    };
    reader.readAsText(f);
  };

  const buildPreview=()=>{
    const p=BANK_PROFILES[profile];
    const data=rawRows.slice(skipRows);
    const parsed=data.map((row,i)=>{
      const rawDate=mapping.date!==""?row[+mapping.date]:"";
      const date=parseCSVDate(rawDate,p.dateFormat);
      const merchant=(mapping.desc!==""?row[+mapping.desc]:"").replace(/\s+/g," ").trim();
      let amount=0,type="expense";
      if(mapping.amount!==""){
        const raw=+(row[+mapping.amount]||"0").replace(/[,$]/g,"");
        if(raw<0){amount=Math.abs(raw);type="expense";}else{amount=raw;type=raw>0?"income":"expense";}
      } else {
        const debit=+(mapping.debit!==""?(row[+mapping.debit]||"0").replace(/[,$]/g,""):0)||0;
        const credit=+(mapping.credit!==""?(row[+mapping.credit]||"0").replace(/[,$]/g,""):0)||0;
        if(debit>0){amount=debit;type="expense";}else if(credit>0){amount=credit;type="income";}
      }
      const cat=cats[0]||"Other";
      // duplicate detection: same date + amount + merchant (fuzzy)
      const isDupe=txns.some(t=>t.date===date&&Math.abs(t.amount-amount)<0.01&&(t.merchant||t.source||"").toLowerCase()===merchant.toLowerCase());
      return {_id:i,date,merchant,amount,type,category:cat,isDupe,_raw:row};
    }).filter(r=>r.amount>0&&r.date);
    setPreview(parsed);
    const sel={};parsed.forEach(r=>{if(!r.isDupe)sel[r._id]=true;});
    setChecked(sel);
    setStep("review");
  };

  const doImport=()=>{
    const toImport=preview.filter(r=>checked[r._id]).map(r=>({
      id:uid(),type:r.type,merchant:r.merchant,source:r.type==="income"?r.merchant:undefined,
      amount:r.amount,date:r.date,category:r.type==="expense"?r.category:undefined,note:"CSV import",hasReceipt:false
    }));
    onImport(toImport);
    setImported(toImport.length);
    setStep("done");
  };

  const HL={background:"#f0f9ff",borderRadius:16,border:"1px solid #bae6fd",padding:24};
  const selCount=Object.values(checked).filter(Boolean).length;

  if(step==="done") return(
    <div style={HL}>
      <div style={{fontSize:32,marginBottom:12}}>✅</div>
      <div style={{fontSize:20,fontWeight:700,color:"#0f172a",marginBottom:8}}>Import complete</div>
      <div style={{color:"#475569",marginBottom:20}}>{imported} transaction{imported!==1?"s":""} added to your history.</div>
      <Btn onClick={()=>{setStep("upload");setRawRows([]);setImported(null);if(fileRef.current)fileRef.current.value="";}}>Import another file</Btn>
    </div>
  );

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>CSV Import</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Import transactions from your bank's CSV export. Duplicates are detected automatically.</div>

      {/* Step pills */}
      <div style={{display:"flex",gap:8,marginBottom:28}}>
        {["upload","map","review"].map((s,i)=>(
          <div key={s} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:24,height:24,borderRadius:"50%",background:step===s?"#0284C7":["upload","map","review"].indexOf(step)>i?"#059669":"#e2e8f0",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700}}>{["upload","map","review"].indexOf(step)>i?"✓":i+1}</div>
            <span style={{fontSize:12,fontWeight:600,color:step===s?"#0284C7":"#94a3b8",textTransform:"capitalize"}}>{s==="map"?"Map Columns":s==="review"?"Review & Import":s.charAt(0).toUpperCase()+s.slice(1)}</span>
            {i<2&&<span style={{color:"#cbd5e1",fontSize:16}}>›</span>}
          </div>
        ))}
      </div>

      {step==="upload"&&(
        <div style={HL}>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:11,fontWeight:700,color:"#0369a1",textTransform:"uppercase",letterSpacing:"0.08em",display:"block",marginBottom:8}}>Bank / Institution</label>
            <select value={profile} onChange={e=>setProfile(e.target.value)} style={{...IS,width:"auto",minWidth:200}}>
              {Object.entries(BANK_PROFILES).map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
          <div style={{border:"2px dashed #bae6fd",borderRadius:12,padding:40,textAlign:"center",cursor:"pointer",background:"#f8fafc"}} onClick={()=>fileRef.current?.click()}>
            <div style={{fontSize:36,marginBottom:8}}>📂</div>
            <div style={{fontWeight:600,color:"#0369a1",marginBottom:4}}>Click to select your CSV file</div>
            <div style={{fontSize:12,color:"#94a3b8"}}>Exported from your online banking portal</div>
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={onFile}/>
          </div>
          <div style={{marginTop:16,fontSize:12,color:"#94a3b8"}}>
            💡 In TD: Accounts → Download → CSV &nbsp;|&nbsp; RBC: My Accounts → Download Transactions → CSV &nbsp;|&nbsp; BMO: Accounts → Download → Spreadsheet
          </div>
        </div>
      )}

      {step==="map"&&(
        <div style={HL}>
          <div style={{fontWeight:700,fontSize:15,color:"#0f172a",marginBottom:16}}>Map CSV Columns</div>
          <div style={{marginBottom:12,fontSize:12,color:"#64748b"}}>Auto-detected from <strong>{BANK_PROFILES[profile].name}</strong> format. Adjust if needed.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            {[["date","Date *"],["desc","Merchant / Description *"],["debit","Debit Amount"],["credit","Credit Amount"],["amount","Single Amount Column"]].map(([k,label])=>(
              <div key={k}>
                <label style={{fontSize:11,fontWeight:700,color:"#0369a1",textTransform:"uppercase",letterSpacing:"0.06em",display:"block",marginBottom:4}}>{label}</label>
                <select value={mapping[k]||""} onChange={e=>setMapping(p=>({...p,[k]:e.target.value}))} style={{...IS,width:"100%"}}>
                  <option value="">— not used —</option>
                  {headers.map((h,i)=><option key={i} value={String(i)}>{h||`Column ${i+1}`}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:11,fontWeight:700,color:"#0369a1",textTransform:"uppercase",letterSpacing:"0.06em",display:"block",marginBottom:4}}>Skip header rows</label>
            <input type="number" min={0} max={5} value={skipRows} onChange={e=>setSkipRows(+e.target.value)} style={{...IS,width:80}}/>
          </div>
          {/* Raw preview */}
          <div style={{overflowX:"auto",marginBottom:16}}>
            <table style={{borderCollapse:"collapse",fontSize:11,width:"100%"}}>
              <tbody>{rawRows.slice(0,4).map((row,i)=><tr key={i} style={{background:i<skipRows?"#fef9c3":"#fff"}}>{row.map((c,j)=><td key={j} style={{padding:"4px 8px",border:"1px solid #e2e8f0",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div style={{display:"flex",gap:10}}>
            <Btn v="secondary" onClick={()=>setStep("upload")}>← Back</Btn>
            <Btn onClick={buildPreview} disabled={!mapping.date||!mapping.desc}>Preview Transactions →</Btn>
          </div>
        </div>
      )}

      {step==="review"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div>
              <span style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>{preview.length} transactions found</span>
              <span style={{fontSize:12,color:"#64748b",marginLeft:12}}>{preview.filter(r=>r.isDupe).length} duplicates (unchecked) · {selCount} selected</span>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{const a={};preview.forEach(r=>{if(!r.isDupe)a[r._id]=true;});setChecked(a);}} style={{fontSize:11,padding:"5px 10px",border:"1px solid #bae6fd",borderRadius:7,cursor:"pointer",background:"#f0f9ff",color:"#0369a1",fontFamily:"inherit"}}>Select Non-Dupes</button>
              <button onClick={()=>{const a={};preview.forEach(r=>a[r._id]=true);setChecked(a);}} style={{fontSize:11,padding:"5px 10px",border:"1px solid #bae6fd",borderRadius:7,cursor:"pointer",background:"#f0f9ff",color:"#0369a1",fontFamily:"inherit"}}>Select All</button>
              <button onClick={()=>setChecked({})} style={{fontSize:11,padding:"5px 10px",border:"1px solid #e2e8f0",borderRadius:7,cursor:"pointer",background:"#f8fafc",color:"#64748b",fontFamily:"inherit"}}>Deselect All</button>
            </div>
          </div>
          <div style={{borderRadius:12,border:"1px solid #e2e8f0",overflow:"hidden",marginBottom:20}}>
            <div style={{display:"grid",gridTemplateColumns:"36px 100px 1fr 100px 120px 36px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",padding:"8px 12px",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.06em"}}>
              <div/>
              <div>Date</div><div>Merchant</div><div>Amount</div><div>Category</div><div/>
            </div>
            <div style={{maxHeight:420,overflowY:"auto"}}>
              {preview.map(r=>(
                <div key={r._id} style={{display:"grid",gridTemplateColumns:"36px 100px 1fr 100px 120px 36px",alignItems:"center",padding:"8px 12px",borderBottom:"1px solid #f1f5f9",background:r.isDupe?"#fffbeb":checked[r._id]?"#f0fdf4":"#fff",opacity:r.isDupe&&!checked[r._id]?0.5:1}}>
                  <input type="checkbox" checked={!!checked[r._id]} onChange={e=>setChecked(p=>({...p,[r._id]:e.target.checked}))} style={{accentColor:"#0284C7"}}/>
                  <div style={{fontSize:12,color:"#64748b"}}>{r.date}</div>
                  <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.merchant}</div>
                  <div style={{fontSize:12,fontWeight:700,color:r.type==="income"?"#059669":"#111827"}}>{r.type==="income"?"+":""}{fmt(r.amount)}</div>
                  <select value={r.category||cats[0]} onChange={e=>setPreview(p=>p.map(x=>x._id===r._id?{...x,category:e.target.value}:x))} style={{fontSize:11,border:"1px solid #e2e8f0",borderRadius:6,padding:"2px 4px",background:"#fff",fontFamily:"inherit"}}>
                    {r.type==="income"?<option value="income">Income</option>:cats.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  {r.isDupe&&<span title="Possible duplicate" style={{fontSize:14}}>⚠️</span>}
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn v="secondary" onClick={()=>setStep("map")}>← Back</Btn>
            <Btn onClick={doImport} disabled={selCount===0}>Import {selCount} Transaction{selCount!==1?"s":""} →</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cash Flow Forecast ────────────────────────────────────────────────────────
function CashFlowForecast({txns,bills,billPayments,expected,accounts,settings}){
  const DAYS=90;
  // Current balance: sum of all accounts
  const startBalance=accounts.reduce((s,a)=>s+(+a.balance||0),0);
  const [threshold,setThreshold]=useState(()=>Math.round(startBalance*0.1/100)*100||500);
  const [extraExpense,setExtraExpense]=useState("");
  const [extraLabel,setExtraLabel]=useState("");

  // Build day-by-day projection
  const projection=useMemo(()=>{
    const today_str=today();
    const days=[];
    let balance=startBalance;

    // Average daily spend from last 60 days of transactions
    const since=new Date();since.setDate(since.getDate()-60);
    const sinceStr=since.toISOString().split("T")[0];
    const recentSpend=txns.filter(t=>t.type==="expense"&&t.date>=sinceStr).reduce((s,t)=>s+t.amount,0);
    const dailySpend=recentSpend/60;

    // Build a map of scheduled events per date
    const events={};
    const addEvent=(date,label,amount,type)=>{
      if(!events[date]) events[date]=[];
      events[date].push({label,amount,type});
    };

    // Bills — find next due date for each unpaid bill
    const curMonth=today_str.slice(0,7);
    bills.forEach(b=>{
      for(let m=0;m<3;m++){
        const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+m);
        const ym=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
        const dueDay=String(b.dueDay||15).padStart(2,"0");
        const dueDate=ym+"-"+dueDay;
        const paid=billPayments.some(p=>p.billId===b.id&&p.month===ym);
        if(!paid&&dueDate>=today_str) addEvent(dueDate,b.name,+(b.amount)||0,"bill");
      }
    });

    // Expected income
    expected.filter(e=>!e.confirmed&&e.date>=today_str).forEach(e=>{
      addEvent(e.date,e.source,+e.amount||0,"income");
    });

    // Extra what-if expense
    if(+extraExpense>0&&extraLabel){
      const midDate=new Date();midDate.setDate(midDate.getDate()+30);
      addEvent(midDate.toISOString().split("T")[0],extraLabel,+extraExpense,"extra");
    }

    for(let i=0;i<DAYS;i++){
      const d=new Date();d.setDate(d.getDate()+i);
      const dateStr=d.toISOString().split("T")[0];
      balance-=dailySpend;
      const dayEvents=events[dateStr]||[];
      dayEvents.forEach(ev=>{
        if(ev.type==="bill"||ev.type==="extra") balance-=ev.amount;
        else balance+=ev.amount;
      });
      days.push({date:dateStr,balance:+balance.toFixed(2),events:dayEvents,day:i});
    }
    return days;
  },[txns,bills,billPayments,expected,accounts,startBalance,extraExpense,extraLabel]);

  const minBalance=Math.min(...projection.map(d=>d.balance));
  const dangerDays=projection.filter(d=>d.balance<threshold);
  const firstDanger=dangerDays[0];

  // Chart data — weekly points
  const chartData=projection.filter((_,i)=>i%7===0||i===DAYS-1).map(d=>({
    date:new Date(d.date).toLocaleDateString("en-CA",{month:"short",day:"numeric"}),
    Balance:+d.balance.toFixed(0),
    Threshold:threshold,
  }));

  const GREEN="#059669",RED="#ef4444",AMBER="#f59e0b";
  const healthColor=minBalance>=threshold?GREEN:minBalance>0?AMBER:RED;

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Cash Flow Forecast</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>90-day projection based on your spending patterns, upcoming bills, and expected income.</div>

      {/* Summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:28}}>
        {[
          {label:"Starting Balance",val:fmt(startBalance),color:"#0284C7",sub:accounts.length+" account"+(accounts.length!==1?"s":"")},
          {label:"Lowest Point",val:fmt(minBalance),color:healthColor,sub:minBalance<threshold?"Below threshold":"Looking good"},
          {label:"90-Day Outlook",val:fmt(projection[DAYS-1]?.balance||0),color:projection[DAYS-1]?.balance>startBalance?GREEN:RED,sub:projection[DAYS-1]?.balance>startBalance?"Net positive":"Net negative"},
        ].map(c=>(
          <div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:c.color}}>{c.val}</div>
            <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{c.sub}</div>
          </div>
        ))}
      </div>

      {firstDanger&&(
        <div style={{background:"#fef9c3",borderRadius:12,border:"1px solid #fde047",padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>⚠️</span>
          <div><strong>Balance warning:</strong> your balance is projected to drop below {fmt(threshold)} around <strong>{new Date(firstDanger.date).toLocaleDateString("en-CA",{month:"long",day:"numeric"})}</strong>.</div>
        </div>
      )}

      {/* Chart */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:16}}>Projected Balance</div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{top:4,right:16,bottom:0,left:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="date" tick={{fontSize:10}} tickLine={false}/>
            <YAxis tick={{fontSize:10}} tickLine={false} tickFormatter={v=>"$"+Math.round(v/1000)+"k"}/>
            <Tooltip formatter={(v,n)=>[fmt(v),n]} contentStyle={{fontSize:12,borderRadius:8}}/>
            <Area type="monotone" dataKey="Balance" stroke="#0284C7" fill="#bae6fd" fillOpacity={0.4} strokeWidth={2}/>
            <Line type="monotone" dataKey="Threshold" stroke={RED} strokeDasharray="4 2" strokeWidth={1.5} dot={false}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Controls */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>⚠️ Warning Threshold</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:8}}>Alert when balance drops below:</div>
          <input type="number" min={0} step={100} value={threshold} onChange={e=>setThreshold(+e.target.value)} style={{...IS,width:"100%"}}/>
        </div>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>🧮 What-If Scenario</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:8}}>Add a hypothetical one-time expense:</div>
          <div style={{display:"flex",gap:8}}>
            <input placeholder="Label" value={extraLabel} onChange={e=>setExtraLabel(e.target.value)} style={{...IS,flex:1}}/>
            <input type="number" placeholder="$0" value={extraExpense} onChange={e=>setExtraExpense(e.target.value)} style={{...IS,width:90}}/>
          </div>
        </div>
      </div>

      {/* Upcoming events */}
      <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>Upcoming Events</div>
        <div style={{maxHeight:240,overflowY:"auto"}}>
          {projection.filter(d=>d.events.length>0).slice(0,20).map(d=>d.events.map((ev,i)=>(
            <div key={d.date+i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f1f5f9",fontSize:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span>{ev.type==="bill"?"🧾":ev.type==="income"?"💰":"🔮"}</span>
                <div>
                  <div style={{fontWeight:600}}>{ev.label}</div>
                  <div style={{color:"#94a3b8"}}>{new Date(d.date).toLocaleDateString("en-CA",{month:"short",day:"numeric"})}</div>
                </div>
              </div>
              <div style={{fontWeight:700,color:ev.type==="income"?GREEN:RED}}>{ev.type==="income"?"+":"-"}{fmt(ev.amount)}</div>
            </div>
          )))}
          {projection.every(d=>d.events.length===0)&&<div style={{fontSize:12,color:"#94a3b8",textAlign:"center",padding:16}}>No scheduled events found. Add bills and expected income to see them here.</div>}
        </div>
      </div>
    </div>
  );
}

// ── Debt Tracker ─────────────────────────────────────────────────────────────
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
            {label:"Total Debt",val:fmt(totalDebt),color:"#ef4444"},
            {label:"Total Interest (projected)",val:fmt(totalInterest),color:"#f59e0b"},
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
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>{editing?"✏️ Edit Debt":"➕ Add Debt"}</div>
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
                <div style={{fontWeight:700,color:"#ef4444",fontSize:13}}>{fmt(d.balance)}</div>
                <div style={{fontSize:13,color:"#f59e0b",fontWeight:600}}>{d.rate}%</div>
                <div style={{fontSize:13}}>{fmt(d.minPayment)}/mo</div>
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
            {[["avalanche","🏔️ Avalanche","Highest rate first — minimises total interest"],["snowball","⛄ Snowball","Lowest balance first — fastest wins, best for motivation"]].map(([k,l,d])=>(
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
                  <span style={{color:"#64748b"}}>Paid off {d.payoffDate} · {fmt(d.totalInterest)} interest</span>
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
function Reports({txns,bills,billPayments,cats,catBudgets,goals,vacations,vacationTxns,settings}){
  const [reportType,setReportType]=useState("monthly");
  const [year,setYear]=useState(()=>new Date().getFullYear());
  const [month,setMonth]=useState(()=>today().slice(0,7));
  const [catFilter,setCatFilter]=useState("all");
  const [typeFilter,setTypeFilter]=useState("all");

  const years=useMemo(()=>{
    const ys=new Set(txns.map(t=>t.date?.slice(0,4)).filter(Boolean));
    ys.add(String(new Date().getFullYear()));
    return [...ys].sort((a,b)=>b-a);
  },[txns]);

  // Escape CSV value
  const esc=v=>`"${String(v||"").replace(/"/g,'""')}"`;

  const downloadCSV=(rows,filename)=>{
    const csv=rows.map(r=>r.map(esc).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=filename;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const exportTransactions=()=>{
    let data=txns;
    if(reportType==="monthly") data=data.filter(t=>t.date?.startsWith(month));
    else if(reportType==="annual"||reportType==="tax") data=data.filter(t=>t.date?.startsWith(String(year)));
    if(catFilter!=="all") data=data.filter(t=>t.category===catFilter||t.type===catFilter);
    if(typeFilter!=="all") data=data.filter(t=>t.type===typeFilter);
    const rows=[["Date","Type","Merchant/Source","Amount","Category","Note"],...data.map(t=>[t.date,t.type,t.merchant||t.source||"",t.amount,t.category||"Income",t.note||""])];
    const label=reportType==="monthly"?month:String(year);
    downloadCSV(rows,`cashheap-transactions-${label}.csv`);
  };

  const exportMonthlySummary=()=>{
    const months=[];
    const allTxns=[...txns,...vacationTxns];
    // Build list of unique months in range
    const ms=new Set(allTxns.map(t=>t.date?.slice(0,7)).filter(Boolean));
    [...ms].filter(m=>m.startsWith(String(year))).sort().forEach(m=>{
      const mt=allTxns.filter(t=>t.date?.startsWith(m));
      const income=mt.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
      const expenses=mt.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
      const net=income-expenses;
      months.push([m,income.toFixed(2),expenses.toFixed(2),net.toFixed(2)]);
    });
    downloadCSV([["Month","Income","Expenses","Net"],...months],`cashheap-summary-${year}.csv`);
  };

  const exportCategoryBreakdown=()=>{
    const allTxns=[...txns,...vacationTxns].filter(t=>t.date?.startsWith(String(year))&&t.type==="expense");
    const byCat={};
    allTxns.forEach(t=>{const c=t.category||"Uncategorized";byCat[c]=(byCat[c]||0)+t.amount;});
    const rows=[["Category","Total","Budget","% of Budget"],...Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([c,v])=>{
      const budget=(catBudgets[c]||0)*12;
      return[c,v.toFixed(2),budget?budget.toFixed(2):"—",budget?(v/budget*100).toFixed(1)+"%":"—"];
    })];
    downloadCSV(rows,`cashheap-categories-${year}.csv`);
  };

  const totalIncome=txns.filter(t=>t.type==="income"&&t.date?.startsWith(String(year))).reduce((s,t)=>s+t.amount,0);
  const totalExpenses=[...txns,...vacationTxns].filter(t=>t.type==="expense"&&t.date?.startsWith(String(year))).reduce((s,t)=>s+t.amount,0);
  const savingsRate=totalIncome>0?((totalIncome-totalExpenses)/totalIncome*100):0;

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Reports & Export</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Download summaries and transaction data as CSV files.</div>

      {/* Annual snapshot */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:28}}>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em"}}>Year</span>
            <select value={year} onChange={e=>setYear(+e.target.value)} style={{fontSize:12,border:"1px solid #e2e8f0",borderRadius:6,padding:"2px 6px",fontFamily:"inherit"}}>
              {years.map(y=><option key={y}>{y}</option>)}
            </select>
          </div>
          <div style={{fontSize:22,fontWeight:800,color:"#0f172a"}}>{year}</div>
        </div>
        {[
          {label:"Income",val:fmt(totalIncome),color:"#059669"},
          {label:"Expenses",val:fmt(totalExpenses),color:"#ef4444"},
          {label:"Savings Rate",val:savingsRate.toFixed(1)+"%",color:savingsRate>=20?"#059669":savingsRate>=10?"#f59e0b":"#ef4444"},
        ].map(c=>(
          <div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}>
            <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:c.color}}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* Export cards */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>

        {/* Transactions export */}
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:4}}>📋 Transaction Export</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>Export a filtered list of transactions to CSV.</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
            {[["monthly","Monthly"],["annual","Annual"],["tax","Tax Year"]].map(([k,l])=>(
              <button key={k} onClick={()=>setReportType(k)} style={{fontSize:11,padding:"5px 12px",borderRadius:20,border:`1.5px solid ${reportType===k?"#0284C7":"#e2e8f0"}`,background:reportType===k?"#0284C7":"#f8fafc",color:reportType===k?"#fff":"#64748b",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>{l}</button>
            ))}
          </div>
          {reportType==="monthly"&&(
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{...IS,width:"100%",marginBottom:8}}/>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={IS}>
              <option value="all">All Types</option><option value="expense">Expenses</option><option value="income">Income</option>
            </select>
            <select value={catFilter} onChange={e=>setCatFilter(e.target.value)} style={IS}>
              <option value="all">All Categories</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Btn full onClick={exportTransactions}>⬇ Download CSV</Btn>
        </div>

        {/* Summary reports */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:4}}>📅 Monthly Summary</div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>All months in {year} — income, expenses, net per month.</div>
            <Btn full onClick={exportMonthlySummary}>⬇ Download CSV</Btn>
          </div>
          <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:4}}>🏷️ Category Breakdown</div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>Annual spending by category vs budget for {year}.</div>
            <Btn full onClick={exportCategoryBreakdown}>⬇ Download CSV</Btn>
          </div>
        </div>

      </div>

      {/* Tax summary table */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>🧾 {year} Tax Year Summary</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
          {[
            {label:"Total Income",val:fmt(totalIncome)},
            {label:"Total Expenses",val:fmt(totalExpenses)},
            {label:"Net Saved",val:fmt(Math.max(0,totalIncome-totalExpenses))},
          ].map(r=>(
            <div key={r.label} style={{background:"#f8fafc",borderRadius:10,padding:12}}>
              <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>{r.label}</div>
              <div style={{fontSize:16,fontWeight:700,color:"#0f172a"}}>{r.val}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:12,color:"#94a3b8",fontStyle:"italic"}}>
          💡 For tax deductions tracking, tag individual transactions as deductible (coming in Phase 2 Tax Tracker feature).
        </div>
      </div>
    </div>
  );
}

// ── Alerts & Notifications ────────────────────────────────────────────────────
function AlertsPanel({txns,bills,billPayments,catBudgets,goals,month,settings,onUpdateSettings}){
  const alerts=useMemo(()=>{
    const found=[];
    const curMonth=month||today().slice(0,7);

    // 1. Unpaid bills due within 3 days
    const todayStr=today();
    bills.filter(b=>b.active!==false).forEach(b=>{
      const paid=billPayments.some(p=>p.billId===b.id&&p.month===curMonth);
      if(paid) return;
      const dueStr=curMonth+"-"+String(b.dueDay||15).padStart(2,"0");
      const daysUntil=Math.ceil((new Date(dueStr)-new Date(todayStr))/(1000*60*60*24));
      if(daysUntil<=3&&daysUntil>=-3){
        found.push({id:"bill-"+b.id,type:daysUntil<0?"overdue":"due-soon",icon:daysUntil<0?"🔴":"🟡",title:`${b.name} is ${daysUntil<0?"overdue":"due soon"}`,detail:`${fmt(b.amount)} ${daysUntil<0?Math.abs(daysUntil)+" days overdue":`due in ${daysUntil} day${daysUntil!==1?"s":""}`}`,severity:daysUntil<0?"high":"medium"});
      }
    });

    // 2. Category budget overages
    const mt=[...txns].filter(t=>t.type==="expense"&&t.date?.startsWith(curMonth));
    Object.entries(catBudgets).forEach(([cat,budget])=>{
      if(!budget) return;
      const spent=mt.filter(t=>t.category===cat).reduce((s,t)=>s+t.amount,0);
      const pct=spent/budget*100;
      if(pct>=100) found.push({id:"budget-over-"+cat,type:"budget-over",icon:"🔴",title:`${cat} budget exceeded`,detail:`${fmt(spent)} spent of ${fmt(budget)} budget (${pct.toFixed(0)}%)`,severity:"high"});
      else if(pct>=80) found.push({id:"budget-warn-"+cat,type:"budget-warn",icon:"🟡",title:`${cat} budget at ${pct.toFixed(0)}%`,detail:`${fmt(spent)} of ${fmt(budget)} used this month`,severity:"medium"});
    });

    // 3. Goals close to target
    goals.forEach(g=>{
      if(!g.target||!g.saved) return;
      const pct=g.saved/g.target*100;
      if(pct>=100) found.push({id:"goal-done-"+g.id,type:"goal-done",icon:"🎉",title:`Goal "${g.name}" reached!`,detail:`You saved ${fmt(g.saved)} — goal complete.`,severity:"info"});
      else if(pct>=75) found.push({id:"goal-near-"+g.id,type:"goal-near",icon:"🟢",title:`Goal "${g.name}" is ${pct.toFixed(0)}% complete`,detail:`${fmt(g.target-g.saved)} to go`,severity:"info"});
    });

    // 4. Large transaction alert
    const largeThreshold=settings?.largeTransactionAlert||500;
    const bigTxns=mt.filter(t=>t.amount>=largeThreshold);
    bigTxns.forEach(t=>{
      found.push({id:"large-"+t.id,type:"large",icon:"💸",title:`Large transaction: ${t.merchant||"Unknown"}`,detail:`${fmt(t.amount)} on ${t.date}`,severity:"medium"});
    });

    return found;
  },[txns,bills,billPayments,catBudgets,goals,month,settings]);

  const [dismissed,setDismissed]=useState(new Set());
  const visible=alerts.filter(a=>!dismissed.has(a.id));
  const highCount=visible.filter(a=>a.severity==="high").length;
  const medCount=visible.filter(a=>a.severity==="medium").length;

  const severityBg={high:"#fef2f2",medium:"#fffbeb",info:"#f0fdf4"};
  const severityBorder={high:"#fecaca",medium:"#fde047",info:"#bbf7d0"};

  return(
    <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"#0f172a"}}>🔔 Alerts</div>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{visible.length===0?"All clear":""+highCount+" urgent · "+medCount+" warnings"}</div>
        </div>
        {visible.length>0&&<button onClick={()=>setDismissed(new Set(alerts.map(a=>a.id)))} style={{fontSize:11,padding:"4px 10px",border:"1px solid #e2e8f0",borderRadius:7,cursor:"pointer",background:"#f8fafc",color:"#64748b",fontFamily:"inherit"}}>Dismiss all</button>}
      </div>
      {visible.length===0&&(
        <div style={{textAlign:"center",padding:"24px 0",color:"#94a3b8",fontSize:13}}>✅ No alerts right now — you're on track!</div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {visible.map(a=>(
          <div key={a.id} style={{display:"flex",alignItems:"flex-start",gap:10,background:severityBg[a.severity]||"#f8fafc",border:`1px solid ${severityBorder[a.severity]||"#e2e8f0"}`,borderRadius:10,padding:"10px 12px"}}>
            <span style={{fontSize:18,flexShrink:0}}>{a.icon}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13,color:"#0f172a"}}>{a.title}</div>
              <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{a.detail}</div>
            </div>
            <button onClick={()=>setDismissed(p=>new Set([...p,a.id]))} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8",padding:"0 2px",fontFamily:"inherit",lineHeight:1}}>×</button>
          </div>
        ))}
      </div>
      {/* Alert preferences */}
      <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid #f1f5f9"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Alert Preferences</div>
        <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12}}>
          <label style={{color:"#374151",whiteSpace:"nowrap"}}>Large transaction threshold:</label>
          <input type="number" min={50} step={50} value={settings?.largeTransactionAlert||500} onChange={e=>onUpdateSettings({...settings,largeTransactionAlert:+e.target.value})} style={{...IS,width:100}}/>
        </div>
      </div>
    </div>
  );
}

// ── Financial Health Score ────────────────────────────────────────────────────
function HealthScore({txns,accounts,holdings,catBudgets,goals,bills,billPayments,month,fxRate,stockPrices}){
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
    {label:"Savings Rate",val:score.savingsRate+"%",target:"20%",score:score.savingsScore,tip:"Aim to save at least 20% of income"},
    {label:"Emergency Fund",val:score.emergencyMonths+"mo",target:"3mo",score:score.emergencyScore,tip:"Target 3 months of expenses in cash"},
    {label:"Budget Adherence",val:score.adherePct+"%",target:"100%",score:score.adherePct2,tip:"Stay under budget in all categories"},
    {label:"Goal Progress",val:score.goalPct+"%",target:"100%",score:score.goalPct2,tip:"Average progress across your savings goals"},
  ];

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
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {metrics.map(m=>(
          <div key={m.label} style={{background:"#f8fafc",borderRadius:10,padding:10}}>
            <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{m.label}</div>
            <div style={{fontSize:15,fontWeight:800,color:"#0f172a"}}>{m.val} <span style={{fontSize:10,color:"#94a3b8",fontWeight:400}}>/ {m.target}</span></div>
            <div style={{background:"#e2e8f0",borderRadius:99,height:4,marginTop:6}}>
              <div style={{height:4,borderRadius:99,background:m.score>=80?"#059669":m.score>=50?"#f59e0b":"#ef4444",width:`${Math.min(100,m.score)}%`,transition:"width .4s"}}/>
            </div>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4,lineHeight:1.3}}>{m.tip}</div>
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
      <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:12}}>🔍 Spending Insights</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {anomalies.catAnomalies.map(a=>(
          <div key={a.cat} style={{display:"flex",alignItems:"center",gap:10,fontSize:12,padding:"8px 10px",background:a.type==="high"?"#fffbeb":"#f0fdf4",borderRadius:8,border:`1px solid ${a.type==="high"?"#fde047":"#bbf7d0"}`}}>
            <span>{a.type==="high"?"⬆️":"⬇️"}</span>
            <div style={{flex:1}}>
              <strong>{a.cat}</strong> spending is <strong>{a.type==="high"?"+"+((a.ratio-1)*100).toFixed(0):"-"+((1-a.ratio)*100).toFixed(0)}%</strong> vs your 3-month average
            </div>
            <div style={{color:"#64748b",whiteSpace:"nowrap"}}>{fmt(a.curSpend)} vs {fmt(a.avg)} avg</div>
          </div>
        ))}
        {anomalies.dupes.length>0&&(
          <div style={{fontSize:12,padding:"8px 10px",background:"#fef2f2",borderRadius:8,border:"1px solid #fecaca",display:"flex",alignItems:"center",gap:8}}>
            <span>⚠️</span>
            <span><strong>{anomalies.dupes.length}</strong> possible duplicate transaction{anomalies.dupes.length!==1?"s":""} this month — check your history.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subscription Manager ──────────────────────────────────────────────────────
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
          {label:"Monthly Cost",val:fmt(totalMo),color:"#ef4444"},
          {label:"Annual Cost",val:fmt(totalMo*12),color:"#f59e0b"},
          {label:"Active",val:subscriptions.filter(s=>s.active!==false).length+" subs",color:"#0284C7"},
        ].map(c=><div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:18}}><div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div><div style={{fontSize:22,fontWeight:800,color:c.color}}>{c.val}</div></div>)}
      </div>

      {/* Auto-detect banner */}
      {detected.length>0&&(
        <div style={{background:"#f0f9ff",borderRadius:14,border:"1px solid #bae6fd",padding:16,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showDetect?12:0}}>
            <div style={{fontSize:13,fontWeight:700,color:"#0369a1"}}>🔍 {detected.length} potential subscription{detected.length!==1?"s":""} detected from your history</div>
            <button onClick={()=>setShowDetect(p=>!p)} style={{fontSize:11,padding:"4px 10px",border:"1px solid #bae6fd",borderRadius:7,cursor:"pointer",background:"#fff",color:"#0369a1",fontFamily:"inherit"}}>{showDetect?"Hide":"Review"}</button>
          </div>
          {showDetect&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {detected.map(d=>(
                <div key={d.merchant} style={{display:"flex",alignItems:"center",gap:10,background:"#fff",borderRadius:8,padding:"8px 12px",border:"1px solid #e2e8f0"}}>
                  <div style={{flex:1,fontSize:12}}><strong>{d.merchant}</strong> · {fmt(d.amount)}/{d.cadence} · seen {d.count}× (last: {d.lastDate})</div>
                  <button onClick={()=>{setForm({...blank,name:d.merchant,amount:String(d.amount),cadence:d.cadence});setEditing(true);setShowDetect(false);window.scrollTo(0,0);}} style={{fontSize:11,padding:"4px 10px",border:"1px solid #0284C7",borderRadius:7,cursor:"pointer",background:"#0284C7",color:"#fff",fontFamily:"inherit"}}>Add</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add/Edit form */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>{editing?"✏️ Edit Subscription":"➕ Add Subscription"}</div>
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
                {s.active===false?"⏸️":"🔄"}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <span style={{fontWeight:700,fontSize:14}}>{s.name}</span>
                  {isTrialSoon&&<span style={{fontSize:10,background:"#fef9c3",color:"#92400e",padding:"2px 6px",borderRadius:99,fontWeight:600}}>Trial ends soon</span>}
                  {s.active===false&&<span style={{fontSize:10,background:"#f1f5f9",color:"#64748b",padding:"2px 6px",borderRadius:99,fontWeight:600}}>Paused</span>}
                </div>
                <div style={{fontSize:11,color:"#64748b"}}>{fmt(s.amount)}/{s.cadence} · {fmt(mo)}/mo · {s.category}{s.trialEnd?` · Trial ends ${s.trialEnd}`:""}</div>
              </div>
              <div style={{fontWeight:800,fontSize:15,color:"#ef4444",marginRight:8}}>{fmt(mo)}<span style={{fontSize:10,fontWeight:400,color:"#94a3b8"}}>/mo</span></div>
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

// ── Tax Tracker ───────────────────────────────────────────────────────────────
const TAX_CATS=["Medical","Charitable Donation","Business Expense","Home Office","Childcare","Education","Moving","Investment","Other Deductible"];
const RRSP_LIMIT_2026=32490; // CRA 2026 limit
function TaxTracker({txns,taxItems,onSaveTaxItems,settings}){
  const [year,setYear]=useState(()=>new Date().getFullYear());
  const [rrspContrib,setRrspContrib]=useState(()=>taxItems.find(t=>t.type==="rrsp")?.amount||"");
  const [rrspRoom,setRrspRoom]=useState(()=>taxItems.find(t=>t.type==="rrsp")?.room||"");
  const [tfsa,setTfsa]=useState(()=>taxItems.find(t=>t.type==="tfsa")?.amount||"");
  const [marked,setMarked]=useState(()=>taxItems.filter(t=>t.type==="deductible")||[]);

  // persist on change
  useEffect(()=>{
    const items=[
      {type:"rrsp",amount:+rrspContrib||0,room:+rrspRoom||0},
      {type:"tfsa",amount:+tfsa||0},
      ...marked,
    ];
    onSaveTaxItems(items);
  },[rrspContrib,rrspRoom,tfsa,marked]);

  const yearTxns=txns.filter(t=>t.date?.startsWith(String(year)));
  const income=yearTxns.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const expenses=yearTxns.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);

  const markDeductible=(txnId,taxCat)=>{
    setMarked(prev=>{
      const existing=prev.find(m=>m.txnId===txnId);
      if(existing) return prev.map(m=>m.txnId===txnId?{...m,taxCat}:m);
      return[...prev,{type:"deductible",txnId,taxCat,year}];
    });
  };
  const unmark=txnId=>setMarked(prev=>prev.filter(m=>m.txnId!==txnId));
  const isMarked=txnId=>marked.find(m=>m.txnId===txnId);

  const deductByCategory={};
  marked.filter(m=>m.year===year||!m.year).forEach(m=>{
    const txn=txns.find(t=>t.id===m.txnId);
    if(!txn) return;
    deductByCategory[m.taxCat]=(deductByCategory[m.taxCat]||0)+txn.amount;
  });
  const totalDeductible=Object.values(deductByCategory).reduce((s,v)=>s+v,0);
  const rrspPct=rrspRoom>0?(+rrspContrib/+rrspRoom)*100:0;

  const years=[...new Set(txns.map(t=>t.date?.slice(0,4)).filter(Boolean))].sort((a,b)=>b-a);
  if(!years.includes(String(year))) years.unshift(String(year));

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div>
          <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Tax Tracker</div>
          <div style={{fontSize:13,color:"#64748b"}}>Tag deductible transactions and track RRSP/TFSA contributions.</div>
        </div>
        <select value={year} onChange={e=>setYear(+e.target.value)} style={{...IS,width:"auto",minWidth:100}}>
          {years.map(y=><option key={y}>{y}</option>)}
        </select>
      </div>

      {/* Summary row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
        {[
          {label:"Total Income",val:fmt(income),color:"#059669"},
          {label:"Total Expenses",val:fmt(expenses),color:"#ef4444"},
          {label:"Deductible Expenses",val:fmt(totalDeductible),color:"#0284C7"},
          {label:"RRSP Contributed",val:fmt(+rrspContrib||0),color:"#8b5cf6"},
        ].map(c=><div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div><div style={{fontSize:20,fontWeight:800,color:c.color}}>{c.val}</div></div>)}
      </div>

      {/* RRSP & TFSA */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:12}}>📊 RRSP ({year})</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <Fld label="Contribution Room ($)"><input type="number" style={IS} value={rrspRoom} onChange={e=>setRrspRoom(e.target.value)} placeholder={String(RRSP_LIMIT_2026)}/></Fld>
            <Fld label="Amount Contributed ($)"><input type="number" style={IS} value={rrspContrib} onChange={e=>setRrspContrib(e.target.value)} placeholder="0"/></Fld>
          </div>
          {rrspRoom>0&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                <span style={{color:"#64748b"}}>Room used</span>
                <span style={{fontWeight:700}}>{rrspPct.toFixed(1)}%</span>
              </div>
              <div style={{background:"#f1f5f9",borderRadius:99,height:8}}>
                <div style={{height:8,borderRadius:99,background:rrspPct>=100?"#ef4444":"#8b5cf6",width:`${Math.min(100,rrspPct)}%`,transition:"width .4s"}}/>
              </div>
              <div style={{fontSize:11,color:"#64748b",marginTop:6}}>{fmt(Math.max(0,+rrspRoom-+rrspContrib))} room remaining · Deadline: Mar 1 {year+1}</div>
            </>
          )}
        </div>
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
          <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:12}}>🏦 TFSA ({year})</div>
          <Fld label="Amount Contributed ($)"><input type="number" style={IS} value={tfsa} onChange={e=>setTfsa(e.target.value)} placeholder="0"/></Fld>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:8}}>2026 TFSA annual limit: $7,000 · Lifetime limit varies by birth year.</div>
        </div>
      </div>

      {/* Deductible categories summary */}
      {Object.keys(deductByCategory).length>0&&(
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:12}}>Deductible by Category</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(deductByCategory).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>(
              <div key={cat} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:12}}>
                <span style={{fontWeight:600}}>{cat}</span>
                <span style={{fontWeight:700,color:"#0284C7"}}>{fmt(amt)}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",fontSize:13,fontWeight:700}}>
              <span>Total Deductible</span>
              <span style={{color:"#0284C7"}}>{fmt(totalDeductible)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Transaction tagger */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:4}}>Tag Deductible Transactions</div>
        <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>Mark any expense as tax-deductible and assign a CRA category.</div>
        <div style={{maxHeight:400,overflowY:"auto"}}>
          {yearTxns.filter(t=>t.type==="expense").sort((a,b)=>b.date?.localeCompare(a.date)).map(t=>{
            const m=isMarked(t.id);
            return(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f1f5f9",background:m?"#f0f9ff":"transparent",borderRadius:m?8:0,paddingLeft:m?8:0,paddingRight:m?8:0,marginBottom:m?2:0}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant}</div>
                  <div style={{fontSize:11,color:"#94a3b8"}}>{t.date} · {fmt(t.amount)}</div>
                </div>
                {m?(
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <select value={m.taxCat} onChange={e=>markDeductible(t.id,e.target.value)} style={{fontSize:11,border:"1px solid #bae6fd",borderRadius:6,padding:"2px 4px",fontFamily:"inherit"}}>
                      {TAX_CATS.map(c=><option key={c}>{c}</option>)}
                    </select>
                    <button onClick={()=>unmark(t.id)} style={{fontSize:11,padding:"3px 7px",border:"1px solid #fecaca",borderRadius:6,cursor:"pointer",background:"#fff5f5",color:"#ef4444",fontFamily:"inherit"}}>Untag</button>
                  </div>
                ):(
                  <select defaultValue="" onChange={e=>{if(e.target.value)markDeductible(t.id,e.target.value);}} style={{fontSize:11,border:"1px solid #e2e8f0",borderRadius:6,padding:"2px 4px",fontFamily:"inherit",color:"#94a3b8"}}>
                    <option value="">Tag as deductible…</option>
                    {TAX_CATS.map(c=><option key={c}>{c}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Retirement Planner ────────────────────────────────────────────────────────
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
                  {l:"Projected at "+retireAge,v:fmt(projected),c:projected>=retireTarget?GREEN:RED},
                  {l:"Target",v:fmt(retireTarget),c:"#0f172a"},
                  {l:"Gap",v:gap>0?fmt(gap):"None 🎉",c:gap>0?RED:GREEN},
                  {l:"Extra needed/mo",v:extraNeeded>0?fmt(extraNeeded):"-",c:extraNeeded>0?"#f59e0b":GREEN},
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
                <Tooltip formatter={(v,n)=>[fmt(v),n]} contentStyle={{fontSize:12,borderRadius:8}}/>
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
        add(dueDate,{type:"bill",label:b.name,amount:b.amount,paid,color:paid?"#059669":"#f59e0b",icon:"🧾"});
      }
    });

    // Expected income
    expected.filter(e=>e.date?.startsWith(ym)).forEach(e=>{
      add(e.date,{type:"income",label:e.source,amount:e.amount,confirmed:e.confirmed,color:e.confirmed?"#059669":"#0284C7",icon:"💰"});
    });

    // Actual transactions
    txns.filter(t=>t.date?.startsWith(ym)).forEach(t=>{
      add(t.date,{type:"txn",label:t.merchant||t.source,amount:t.amount,txnType:t.type,color:t.type==="income"?"#059669":"#94a3b8",icon:t.type==="income"?"💚":"💸"});
    });

    // Vacations
    vacations.forEach(v=>{
      if(!v.startDate||!v.endDate) return;
      const s=new Date(v.startDate),e=new Date(v.endDate);
      for(let d=new Date(s);d<=e;d.setDate(d.getDate()+1)){
        const ds=d.toISOString().split("T")[0];
        if(ds.startsWith(ym)) add(ds,{type:"vacation",label:v.name,color:"#8b5cf6",icon:"✈️"});
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
            {[["🧾","#f59e0b","Bill due"],["🧾","#059669","Bill paid"],["💰","#0284C7","Expected income"],["💚","#059669","Income received"],["💸","#94a3b8","Expense"],["✈️","#8b5cf6","Vacation"]].map(([icon,color,label])=>(
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
                    {ev.amount&&<div style={{color:"#64748b",marginTop:2}}>{ev.type==="income"||ev.txnType==="income"?"+":"-"}{fmt(ev.amount)}</div>}
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

  const priorities=[["essential","🔴 Essential"],["want","🟡 Want"],["nice-to-have","🟢 Nice to Have"]];
  const sorted=[...wishlist].sort((a,b)=>{const o={essential:0,want:1,"nice-to-have":2};return(o[a.priority]||2)-(o[b.priority]||2);});

  return(
    <div>
      <div style={{fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4}}>Wishlist</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Track planned purchases and see when you can afford them based on your savings rate.</div>

      {monthlySavings>0&&(
        <div style={{background:"#f0f9ff",borderRadius:12,border:"1px solid #bae6fd",padding:"12px 16px",marginBottom:20,fontSize:12,display:"flex",alignItems:"center",gap:8}}>
          <span>💡</span>
          <span>You're currently saving <strong>{fmt(monthlySavings)}/month</strong> on average. Affordability estimates are based on this rate.</span>
        </div>
      )}

      {/* Form */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:20,marginBottom:24}}>
        <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:14}}>{editing?"✏️ Edit Item":"➕ Add to Wishlist"}</div>
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
                  <span style={{fontWeight:700,fontSize:14}}>{item.purchased?"✅ ":""}{item.name}</span>
                  {item.promotedToGoal&&<span style={{fontSize:10,background:"#f0fdf4",color:"#059669",padding:"2px 6px",borderRadius:99,fontWeight:600}}>→ Goal created</span>}
                </div>
                <div style={{fontSize:11,color:"#64748b"}}>{fmt(item.cost)}{item.note?` · ${item.note}`:""}{affordDate&&!item.purchased?` · Affordable in ~${months} month${months!==1?"s":""} (${affordDate})`:""}</div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                {item.url&&<a href={item.url} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"4px 8px",border:"1px solid #e2e8f0",borderRadius:6,textDecoration:"none",color:"#64748b"}}>🔗</a>}
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
              {label:`${freqMap[freq].l} Payment`,val:fmt(payment),color:"#0284C7",sub:`${freqMap[freq].l} installment`},
              {label:"Total Interest",val:fmt(Math.round(totalInterest)),color:"#ef4444",sub:"Over full amortization"},
              {label:"Total Cost",val:fmt(Math.round(totalCost+down)),color:"#0f172a",sub:"Principal + interest + down"},
              {label:"Down Payment",val:fmt(down),color:"#059669",sub:`${downPct}% of purchase price`},
            ].map(c=><div key={c.label} style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{c.label}</div><div style={{fontSize:20,fontWeight:800,color:c.color}}>{c.val}</div><div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{c.sub}</div></div>)}
          </div>

          {extra>0&&(
            <div style={{background:"#f0fdf4",borderRadius:14,border:"1px solid #bbf7d0",padding:16}}>
              <div style={{fontSize:13,fontWeight:700,color:"#059669",marginBottom:8}}>💡 Extra Payment Impact</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,fontSize:12}}>
                <div style={{background:"#fff",borderRadius:10,padding:10}}><div style={{color:"#64748b",marginBottom:2}}>Years saved</div><div style={{fontWeight:800,fontSize:16,color:"#059669"}}>{yearsSaved} yrs</div></div>
                <div style={{background:"#fff",borderRadius:10,padding:10}}><div style={{color:"#64748b",marginBottom:2}}>Interest saved</div><div style={{fontWeight:800,fontSize:16,color:"#059669"}}>{fmt(+intSaved)}</div></div>
                <div style={{background:"#fff",borderRadius:10,padding:10}}><div style={{color:"#64748b",marginBottom:2}}>New payoff</div><div style={{fontWeight:800,fontSize:16,color:"#059669"}}>{Math.floor(extraPayoff/periodsPerYear)}y {Math.round(extraPayoff%periodsPerYear/(periodsPerYear/12))}m</div></div>
              </div>
            </div>
          )}

          {/* Principal vs Interest donut-ish bar */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:16}}>
            <div style={{fontSize:12,fontWeight:700,color:"#0f172a",marginBottom:10}}>Principal vs Interest breakdown</div>
            <div style={{display:"flex",borderRadius:8,overflow:"hidden",height:20,marginBottom:8}}>
              <div style={{background:"#0284C7",flex:principal}} title={`Principal: ${fmt(principal)}`}/>
              <div style={{background:"#ef4444",flex:totalInterest>0?totalInterest:0}} title={`Interest: ${fmt(Math.round(totalInterest))}`}/>
            </div>
            <div style={{display:"flex",gap:16,fontSize:11}}>
              <span style={{color:"#0284C7"}}>■ Principal: {fmt(principal)} ({(principal/(principal+totalInterest)*100).toFixed(0)}%)</span>
              <span style={{color:"#ef4444"}}>■ Interest: {fmt(Math.round(totalInterest))} ({(totalInterest/(principal+totalInterest)*100).toFixed(0)}%)</span>
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
                    {[r.period,fmt(r.payment),fmt(r.principal),fmt(r.interest),fmt(r.balance)].map((v,i)=><td key={i} style={{padding:"5px 10px",textAlign:"right",color:i===0?"#94a3b8":i===4?"#0284C7":"#374151"}}>{v}</td>)}
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

const MEMBER_COLORS=["#0284C7","#7C3AED","#059669","#D97706","#DB2777","#0891B2"];
const MEMBER_AVATARS=["👤","👩","👨","🧑","👧","👦","🧔","👩‍💼","👨‍💼","🧑‍💻"];

function Household({members,onSaveMembers,txns,onSaveTxns,splits,onSaveSplits,settlements,onSaveSettlements}){
  const [tab,setTab]=useState("members"); // members | splits | balances
  const [form,setForm]=useState({name:"",avatar:"👤",color:MEMBER_COLORS[0],monthlyIncome:""});
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState({});
  const setF=(k,v)=>setForm(p=>({...p,[k]:v}));
  const setEF=(k,v)=>setEditForm(p=>({...p,[k]:v}));

  const addMember=()=>{
    if(!form.name.trim()) return;
    const usedColors=members.map(m=>m.color);
    const nextColor=MEMBER_COLORS.find(c=>!usedColors.includes(c))||MEMBER_COLORS[members.length%MEMBER_COLORS.length];
    onSaveMembers([...members,{id:uid(),name:form.name.trim(),avatar:form.avatar,color:form.color||nextColor,monthlyIncome:parseFloat(form.monthlyIncome)||0,joinedDate:today()}]);
    setForm({name:"",avatar:"👤",color:nextColor,monthlyIncome:""});
  };
  const removeMember=id=>onSaveMembers(members.filter(m=>m.id!==id));
  const startEdit=m=>{setEditId(m.id);setEditForm({name:m.name,avatar:m.avatar,color:m.color,monthlyIncome:String(m.monthlyIncome||"")});};
  const saveEdit=()=>{
    onSaveMembers(members.map(m=>m.id===editId?{...m,name:editForm.name.trim()||m.name,avatar:editForm.avatar,color:editForm.color,monthlyIncome:parseFloat(editForm.monthlyIncome)||0}:m));
    setEditId(null);
  };

  const totalIncome=members.reduce((s,m)=>s+m.monthlyIncome,0);
  const incomePct=m=>totalIncome>0?+(m.monthlyIncome/totalIncome*100).toFixed(1):+(100/members.length).toFixed(1);

  // ── Split helpers ──────────────────────────────────────────────────────────
  const getSplit=id=>splits[id]||null;
  const txnMember=t=>t.assignedTo?members.find(m=>m.id===t.assignedTo):null;

  // Compute balances: shared expenses where each member paid different amounts
  const month=today().slice(0,7);
  const sharedTxns=txns.filter(t=>splits[t.id]&&splits[t.id].type!=="assigned"&&t.date&&t.date.startsWith(month));
  // For each shared txn: member who "paid" is assignedTo; others owe their split share
  const balances={};
  members.forEach(m=>{balances[m.id]=0;});
  sharedTxns.forEach(t=>{
    const sp=splits[t.id];
    if(!sp||!sp.payer) return;
    sp.shares.forEach(sh=>{
      if(sh.memberId===sp.payer) return; // payer doesn't owe themselves
      balances[sh.memberId]=(balances[sh.memberId]||0)-sh.amount; // owes payer
      balances[sp.payer]=(balances[sp.payer]||0)+sh.amount;       // is owed by them
    });
  });
  // Settle: already-settled amounts
  settlements.filter(s=>s.date&&s.date.startsWith(month)).forEach(s=>{
    balances[s.fromMemberId]=(balances[s.fromMemberId]||0)+s.amount;
    balances[s.toMemberId]=(balances[s.toMemberId]||0)-s.amount;
  });

  const [settleForm,setSettleForm]=useState({from:"",to:"",amount:"",note:""});
  const addSettlement=()=>{
    if(!settleForm.from||!settleForm.to||!settleForm.amount) return;
    onSaveSettlements([...settlements,{id:uid(),fromMemberId:settleForm.from,toMemberId:settleForm.to,amount:parseFloat(settleForm.amount)||0,date:today(),note:settleForm.note}]);
    setSettleForm({from:"",to:"",amount:"",note:""});
  };

  const tabBtn=(k,l)=><button onClick={()=>setTab(k)} style={{padding:"7px 18px",borderRadius:8,border:"none",background:tab===k?"#0284C7":"transparent",color:tab===k?"#fff":"#64748b",fontWeight:tab===k?700:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>;

  return(
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Household</h2>
      <div style={{display:"flex",gap:4,marginBottom:20,background:"#f8fafc",borderRadius:10,padding:4,width:"fit-content"}}>
        {tabBtn("members","Members")}{tabBtn("splits","Split Transactions")}{tabBtn("balances","Balances")}
      </div>

      {tab==="members"&&(
        <div>
          {/* Member cards */}
          {members.length>0&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:14,marginBottom:20}}>
              {members.map(m=>(
                <div key={m.id} style={{...CA,borderTop:`3px solid ${m.color}`}}>
                  {editId===m.id?(
                    <div>
                      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                        {MEMBER_AVATARS.map(a=><button key={a} onClick={()=>setEF("avatar",a)} style={{fontSize:20,background:editForm.avatar===a?"#f0f9ff":"transparent",border:`2px solid ${editForm.avatar===a?"#0284C7":"transparent"}`,borderRadius:8,padding:4,cursor:"pointer"}}>{a}</button>)}
                      </div>
                      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                        {MEMBER_COLORS.map(c=><button key={c} onClick={()=>setEF("color",c)} style={{width:22,height:22,borderRadius:"50%",background:c,border:`3px solid ${editForm.color===c?"#1e293b":"transparent"}`,cursor:"pointer"}}/>)}
                      </div>
                      <input style={{...IS,marginBottom:8}} value={editForm.name} onChange={e=>setEF("name",e.target.value)} placeholder="Name"/>
                      <input style={{...IS,marginBottom:10}} type="number" value={editForm.monthlyIncome} onChange={e=>setEF("monthlyIncome",e.target.value)} placeholder="Monthly income ($)"/>
                      <div style={{display:"flex",gap:8}}><Btn sm onClick={saveEdit} disabled={!editForm.name.trim()}>Save</Btn><Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn></div>
                    </div>
                  ):(
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                        <div style={{width:40,height:40,borderRadius:"50%",background:m.color+"22",border:`2px solid ${m.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{m.avatar}</div>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:15,color:"#1e293b"}}>{m.name}</div>
                          <div style={{fontSize:11,color:"#94a3b8"}}>Joined {m.joinedDate}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <span style={{fontSize:12,color:"#64748b"}}>Monthly income</span>
                        <span style={{fontSize:13,fontWeight:700,color:"#1e293b"}}>{m.monthlyIncome>0?fmt(m.monthlyIncome):"Not set"}</span>
                      </div>
                      {totalIncome>0&&m.monthlyIncome>0&&(
                        <div style={{marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <span style={{fontSize:11,color:"#94a3b8"}}>Income share</span>
                            <span style={{fontSize:11,fontWeight:600,color:m.color}}>{incomePct(m)}%</span>
                          </div>
                          <div style={{height:5,borderRadius:99,background:"#f1f5f9"}}><div style={{height:"100%",borderRadius:99,width:incomePct(m)+"%",background:m.color}}/></div>
                        </div>
                      )}
                      <div style={{display:"flex",gap:6}}><Btn sm onClick={()=>startEdit(m)}>Edit</Btn><Btn sm v="danger" onClick={()=>removeMember(m.id)}>Remove</Btn></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Add member form */}
          <div style={CA}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1e293b"}}>Add Household Member</div>
            <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
              {MEMBER_AVATARS.map(a=><button key={a} onClick={()=>setF("avatar",a)} style={{fontSize:20,background:form.avatar===a?"#f0f9ff":"transparent",border:`2px solid ${form.avatar===a?"#0284C7":"transparent"}`,borderRadius:8,padding:4,cursor:"pointer"}}>{a}</button>)}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
              {MEMBER_COLORS.map(c=><button key={c} onClick={()=>setF("color",c)} style={{width:22,height:22,borderRadius:"50%",background:c,border:`3px solid ${form.color===c?"#1e293b":"transparent"}`,cursor:"pointer"}}/>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <Fld label="Name"><input style={IS} value={form.name} onChange={e=>setF("name",e.target.value)} placeholder="e.g. Alex, Jordan"/></Fld>
              <Fld label="Monthly Income ($)"><input style={IS} type="number" value={form.monthlyIncome} onChange={e=>setF("monthlyIncome",e.target.value)} placeholder="0.00"/></Fld>
            </div>
            <Btn onClick={addMember} disabled={!form.name.trim()} full>Add Member</Btn>
          </div>
          {/* Household income summary */}
          {members.length>1&&totalIncome>0&&(
            <div style={{...CA,marginTop:14}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1e293b"}}>Household Income Split</div>
              <div style={{display:"flex",height:16,borderRadius:99,overflow:"hidden",marginBottom:10}}>
                {members.filter(m=>m.monthlyIncome>0).map(m=><div key={m.id} style={{flex:m.monthlyIncome,background:m.color}} title={`${m.name}: ${incomePct(m)}%`}/>)}
              </div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                {members.map(m=>(
                  <div key={m.id} style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:m.color,flexShrink:0}}/>
                    <span style={{fontSize:12,color:"#64748b"}}>{m.name}: <strong style={{color:"#1e293b"}}>{incomePct(m)}%</strong>{m.monthlyIncome>0?` (${fmt(m.monthlyIncome)}/mo)`:""}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,fontSize:12,color:"#94a3b8"}}>Combined household income: <strong style={{color:"#1e293b"}}>{fmt(totalIncome)}/mo</strong></div>
            </div>
          )}
        </div>
      )}

      {tab==="splits"&&(
        <SplitTransactions txns={txns} members={members} splits={splits} onSaveSplits={onSaveSplits}/>
      )}

      {tab==="balances"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:14,marginBottom:20}}>
            {members.map(m=>{
              const bal=balances[m.id]||0;
              return(
                <div key={m.id} style={{...CA,borderTop:`3px solid ${m.color}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:m.color+"22",border:`2px solid ${m.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{m.avatar}</div>
                    <span style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{m.name}</span>
                  </div>
                  <div style={{fontSize:22,fontWeight:800,color:bal>0?"#059669":bal<0?"#dc2626":"#94a3b8",letterSpacing:"-0.5px"}}>{bal>0?"+":""}{fmt(bal)}</div>
                  <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>{bal>0?"is owed this month":bal<0?"owes this month":"settled up"}</div>
                </div>
              );
            })}
          </div>
          {members.length>=2&&(
            <div style={CA}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1e293b"}}>Log Settlement</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <Fld label="From">
                  <select style={{...IS,background:"#fff"}} value={settleForm.from} onChange={e=>setSettleForm(p=>({...p,from:e.target.value}))}>
                    <option value="">Select member</option>
                    {members.map(m=><option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
                  </select>
                </Fld>
                <Fld label="To">
                  <select style={{...IS,background:"#fff"}} value={settleForm.to} onChange={e=>setSettleForm(p=>({...p,to:e.target.value}))}>
                    <option value="">Select member</option>
                    {members.filter(m=>m.id!==settleForm.from).map(m=><option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
                  </select>
                </Fld>
                <Fld label="Amount ($)"><input style={IS} type="number" value={settleForm.amount} onChange={e=>setSettleForm(p=>({...p,amount:e.target.value}))}/></Fld>
                <Fld label="Note (optional)"><input style={IS} value={settleForm.note} onChange={e=>setSettleForm(p=>({...p,note:e.target.value}))} placeholder="e.g. e-transfer"/></Fld>
              </div>
              <Btn onClick={addSettlement} disabled={!settleForm.from||!settleForm.to||!settleForm.amount} full>Record Settlement</Btn>
            </div>
          )}
          {settlements.length>0&&(
            <div style={{...CA,marginTop:14}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1e293b"}}>Settlement History</div>
              {[...settlements].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20).map(s=>{
                const from=members.find(m=>m.id===s.fromMemberId);
                const to=members.find(m=>m.id===s.toMemberId);
                if(!from||!to) return null;
                return(
                  <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid #f8fafc"}}>
                    <span style={{fontSize:13}}>{from.avatar} <strong>{from.name}</strong> → {to.avatar} <strong>{to.name}</strong></span>
                    <span style={{flex:1,fontSize:11,color:"#94a3b8"}}>{s.date}{s.note?" · "+s.note:""}</span>
                    <span style={{fontWeight:700,fontSize:13,color:"#059669"}}>{fmt(s.amount)}</span>
                    <button onClick={()=>onSaveSettlements(settlements.filter(x=>x.id!==s.id))} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"2px 7px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SplitTransactions({txns,members,splits,onSaveSplits}){
  const [search,setSearch]=useState("");
  const [splitModal,setSplitModal]=useState(null); // txn being split
  const [splitType,setSplitType]=useState("equal"); // equal | proportional | custom
  const [customShares,setCustomShares]=useState({});
  const [payer,setPayer]=useState("");

  const expenses=txns.filter(t=>t.type==="expense"&&(!search||((t.merchant||"")+" "+(t.category||"")).toLowerCase().includes(search.toLowerCase()))).slice(0,100);
  const totalIncome=members.reduce((s,m)=>s+m.monthlyIncome,0);

  const openSplit=t=>{
    setSplitModal(t);
    const sp=splits[t.id];
    setSplitType(sp?.type||"equal");
    setPayer(sp?.payer||members[0]?.id||"");
    if(sp?.type==="custom"){
      const map={};sp.shares.forEach(s=>{map[s.memberId]=String(s.amount);});setCustomShares(map);
    } else {
      setCustomShares({});
    }
  };
  const closeSplit=()=>setSplitModal(null);

  const computeShares=(t,type)=>{
    if(!t||members.length===0) return[];
    const amt=t.amount;
    if(type==="equal"){
      const each=+(amt/members.length).toFixed(2);
      const remainder=+(amt-each*(members.length-1)).toFixed(2);
      return members.map((m,i)=>({memberId:m.id,amount:i===members.length-1?remainder:each,pct:+(100/members.length).toFixed(1)}));
    }
    if(type==="proportional"&&totalIncome>0){
      let used=0;
      return members.map((m,i)=>{
        const pct=totalIncome>0?m.monthlyIncome/totalIncome:1/members.length;
        const share=i===members.length-1?+(amt-used).toFixed(2):+(amt*pct).toFixed(2);
        used+=share;
        return{memberId:m.id,amount:share,pct:+(pct*100).toFixed(1)};
      });
    }
    if(type==="custom"){
      return members.map(m=>({memberId:m.id,amount:parseFloat(customShares[m.id])||0,pct:+((parseFloat(customShares[m.id])||0)/amt*100).toFixed(1)}));
    }
    return[];
  };

  const saveSplit=()=>{
    if(!splitModal) return;
    const shares=computeShares(splitModal,splitType);
    onSaveSplits({...splits,[splitModal.id]:{type:splitType,payer,shares}});
    closeSplit();
  };
  const clearSplit=id=>{const n={...splits};delete n[id];onSaveSplits(n);};

  const shares=splitModal?computeShares(splitModal,splitType):[];
  const customTotal=Object.values(customShares).reduce((s,v)=>s+(parseFloat(v)||0),0);

  return(
    <div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search expenses…" style={{...IS,marginBottom:14,borderRadius:10}}/>
      {members.length<2&&<div style={{...CA,color:"#94a3b8",fontSize:13}}>Add at least 2 household members to split transactions.</div>}
      {members.length>=2&&(
        <div style={CA}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1e293b"}}>Expense Transactions</div>
          {expenses.length===0&&<div style={{color:"#94a3b8",fontSize:13}}>No expenses found.</div>}
          {expenses.map(t=>{
            const sp=splits[t.id];
            const payerMember=sp?members.find(m=>m.id===sp.payer):null;
            return(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f8fafc",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:160}}>
                  <div style={{fontSize:13,fontWeight:500}}>{t.merchant||t.source}</div>
                  <div style={{fontSize:11,color:"#94a3b8"}}>{t.date} · {t.category||"Uncategorized"}</div>
                  {sp&&(
                    <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                      {sp.shares.map(sh=>{const m=members.find(x=>x.id===sh.memberId);return m?<span key={sh.memberId} style={{fontSize:10,padding:"1px 6px",borderRadius:99,background:m.color+"22",color:m.color,fontWeight:600,border:`1px solid ${m.color}44`}}>{m.name}: {fmt(sh.amount)}</span>:null;})}
                      {payerMember&&<span style={{fontSize:10,color:"#94a3b8",padding:"1px 6px"}}>paid by {payerMember.name}</span>}
                    </div>
                  )}
                </div>
                <div style={{fontWeight:700,fontSize:13,color:"#dc2626"}}>{fmt(t.amount)}</div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>openSplit(t)} style={{background:sp?"#f0fdf4":"#f0f9ff",border:`1px solid ${sp?"#86efac":"#7dd3fc"}`,borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:11,color:sp?"#15803d":"#0284C7",fontFamily:"inherit",fontWeight:600}}>{sp?"Edit Split":"Split"}</button>
                  {sp&&<button onClick={()=>clearSplit(t.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:6,padding:"3px 7px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Split modal */}
      {splitModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:440,boxShadow:"0 20px 60px rgba(0,0,0,0.18)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:"#1e293b"}}>{splitModal.merchant}</div>
                <div style={{fontSize:13,color:"#94a3b8"}}>{fmt(splitModal.amount)} · {splitModal.date}</div>
              </div>
              <button onClick={closeSplit} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8",fontFamily:"inherit",lineHeight:1}}>×</button>
            </div>
            {/* Split type */}
            <div style={{display:"flex",gap:6,marginBottom:16}}>
              {[["equal","Equal"],["proportional","By Income"],["custom","Custom"]].map(([v,l])=>(
                <button key={v} onClick={()=>setSplitType(v)} style={{flex:1,padding:"7px 0",borderRadius:8,border:`2px solid ${splitType===v?"#0284C7":"#e2e8f0"}`,background:splitType===v?"#f0f9ff":"#fff",color:splitType===v?"#0284C7":"#64748b",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  {l}
                </button>
              ))}
            </div>
            {splitType==="proportional"&&totalIncome===0&&<div style={{fontSize:12,color:"#f59e0b",marginBottom:10,background:"#fffbeb",padding:"8px 12px",borderRadius:8,border:"1px solid #fde68a"}}>Set monthly incomes on member cards to use proportional split.</div>}
            {/* Who paid */}
            <Fld label="Who paid?" style={{marginBottom:14}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {members.map(m=>(
                  <button key={m.id} onClick={()=>setPayer(m.id)} style={{padding:"6px 12px",borderRadius:8,border:`2px solid ${payer===m.id?m.color:"#e2e8f0"}`,background:payer===m.id?m.color+"22":"#fff",color:payer===m.id?m.color:"#64748b",fontWeight:payer===m.id?700:400,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                    {m.avatar} {m.name}
                  </button>
                ))}
              </div>
            </Fld>
            {/* Share preview / custom inputs */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Split Breakdown</div>
              {members.map((m,i)=>{
                const sh=shares.find(s=>s.memberId===m.id);
                return(
                  <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:m.color+"22",border:`2px solid ${m.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{m.avatar}</div>
                    <span style={{fontSize:13,fontWeight:500,flex:1,color:"#1e293b"}}>{m.name}</span>
                    {splitType==="custom"?(
                      <input type="number" value={customShares[m.id]||""} onChange={e=>setCustomShares(p=>({...p,[m.id]:e.target.value}))} style={{...IS,width:90,padding:"5px 8px",fontSize:13}} placeholder="0.00"/>
                    ):(
                      <span style={{fontSize:14,fontWeight:700,color:m.color}}>{sh?fmt(sh.amount):"-"}</span>
                    )}
                    {splitType!=="custom"&&sh&&<span style={{fontSize:11,color:"#94a3b8",width:36,textAlign:"right"}}>{sh.pct}%</span>}
                  </div>
                );
              })}
              {splitType==="custom"&&(
                <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderTop:"1px solid #f1f5f9",fontSize:12}}>
                  <span style={{color:"#64748b"}}>Total assigned</span>
                  <span style={{fontWeight:700,color:Math.abs(customTotal-splitModal.amount)<0.02?"#059669":"#dc2626"}}>{fmt(customTotal)} / {fmt(splitModal.amount)}</span>
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={saveSplit} full disabled={!payer||(splitType==="proportional"&&totalIncome===0)||(splitType==="custom"&&Math.abs(customTotal-splitModal.amount)>=0.02)}>Save Split</Btn>
              <Btn v="secondary" onClick={closeSplit}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Bills({bills,billPayments,onSaveBills,onSaveBillPayments,cats}){
  const [form,setForm]=useState({name:"",amount:"",category:cats[0]||"Other",dueDay:"15",note:""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const monthOpts=Array.from({length:13},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-12+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const ml=m=>new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"});
  const [viewMonth,setViewMonth]=useState(today().slice(0,7));
  const [editId,setEditId]=useState(null);
  const [editBill,setEditBill]=useState({});
  const active=bills.filter(b=>b.active!==false);
  const isPaid=(id,mo=viewMonth)=>billPayments.some(p=>p.billId===id&&p.month===mo);
  const togglePaid=id=>{
    if(isPaid(id)){onSaveBillPayments(billPayments.filter(p=>!(p.billId===id&&p.month===viewMonth)));}
    else{const b=bills.find(x=>x.id===id);onSaveBillPayments([...billPayments,{id:uid(),billId:id,month:viewMonth,paidDate:today(),amount:b.amount}]);}
  };
  const add=()=>{
    if(!form.name.trim()||!form.amount)return;
    onSaveBills([...bills,{id:uid(),name:form.name.trim(),amount:parseFloat(form.amount)||0,category:form.category,dueDay:parseInt(form.dueDay)||15,note:form.note,active:true}]);
    setForm({name:"",amount:"",category:cats[0]||"Other",dueDay:"15",note:""});
  };
  const remove=id=>onSaveBills(bills.filter(b=>b.id!==id));
  const startEdit=b=>{setEditId(b.id);setEditBill({name:b.name,amount:String(b.amount),category:b.category||cats[0]||"Other",dueDay:String(b.dueDay||15),note:b.note||""});};
  const saveEdit=()=>{
    if(!editBill.name.trim()||!editBill.amount)return;
    onSaveBills(bills.map(b=>b.id===editId?{...b,name:editBill.name.trim(),amount:parseFloat(editBill.amount)||0,category:editBill.category,dueDay:parseInt(editBill.dueDay)||15,note:editBill.note}:b));
    setEditId(null);
  };
  const paidAmt=active.filter(b=>isPaid(b.id)).reduce((s,b)=>s+b.amount,0);
  const totalAmt=active.reduce((s,b)=>s+b.amount,0);
  const sorted=[...active].sort((a,b)=>a.dueDay-b.dueDay);
  const ordinal=n=>n+(n===1?"st":n===2?"nd":n===3?"rd":"th");
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Bills</h2>
        <select value={viewMonth} onChange={e=>setViewMonth(e.target.value)} style={{padding:"8px 14px",borderRadius:10,border:"1.5px solid #e2e8f0",fontSize:13,background:"#fff",fontFamily:"inherit",color:"#1E293B",fontWeight:500}}>
          {monthOpts.map(m=><option key={m} value={m}>{ml(m)}</option>)}
        </select>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:16}}>
        {[{l:"Monthly Total",v:totalAmt,c:"#1E293B"},{l:"Paid",v:paidAmt,c:"#059669"},{l:"Remaining",v:totalAmt-paidAmt,c:totalAmt-paidAmt>0?"#dc2626":"#059669"}].map(card=>(
          <div key={card.l} style={{...CA,padding:"16px 20px"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{card.l}</div>
            <div style={{fontSize:22,fontWeight:800,color:card.c,letterSpacing:"-0.5px"}}>{fmt(card.v)}</div>
          </div>
        ))}
      </div>
      <div style={{...CA,marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Add Recurring Bill</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fld label="Bill Name"><input style={IS} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Netflix, Rent, Phone"/></Fld>
          <Fld label="Amount ($)"><input style={IS} type="number" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Category"><select style={{...IS,background:"#fff"}} value={form.category} onChange={e=>set("category",e.target.value)}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>
          <Fld label="Due Day of Month"><input style={IS} type="number" min="1" max="28" value={form.dueDay} onChange={e=>set("dueDay",e.target.value)}/></Fld>
        </div>
        <Fld label="Note (optional)" style={{marginBottom:12}}><input style={IS} value={form.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
        <Btn onClick={add} disabled={!form.name.trim()||!form.amount} full>Add Bill</Btn>
      </div>
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Bills for {ml(viewMonth)}</div>
        {sorted.length===0?<div style={{color:"#94a3b8",fontSize:13}}>No bills yet. Add recurring bills above.</div>:sorted.map(b=>{
          const paid=isPaid(b.id);
          if(editId===b.id) return(
            <div key={b.id} style={{padding:"14px 0",borderBottom:"1px solid #f1f5f9"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <Fld label="Bill Name"><input style={IS} value={editBill.name} onChange={e=>setEditBill(p=>({...p,name:e.target.value}))} autoFocus/></Fld>
                <Fld label="Amount ($)"><input style={IS} type="number" value={editBill.amount} onChange={e=>setEditBill(p=>({...p,amount:e.target.value}))}/></Fld>
                <Fld label="Category"><select style={{...IS,background:"#fff"}} value={editBill.category} onChange={e=>setEditBill(p=>({...p,category:e.target.value}))}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>
                <Fld label="Due Day of Month"><input style={IS} type="number" min="1" max="28" value={editBill.dueDay} onChange={e=>setEditBill(p=>({...p,dueDay:e.target.value}))}/></Fld>
                <Fld label="Note" style={{gridColumn:"1/-1"}}><input style={IS} value={editBill.note} onChange={e=>setEditBill(p=>({...p,note:e.target.value}))} placeholder="Optional"/></Fld>
              </div>
              <div style={{display:"flex",gap:8}}>
                <Btn sm onClick={saveEdit} disabled={!editBill.name.trim()||!editBill.amount}>Save</Btn>
                <Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn>
              </div>
            </div>
          );
          return(
            <div key={b.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid #f8fafc"}}>
              <button onClick={()=>togglePaid(b.id)} style={{width:26,height:26,borderRadius:"50%",background:paid?"#d1fae5":"transparent",border:`2px solid ${paid?"#059669":"#e2e8f0"}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all 0.15s",fontFamily:"inherit"}}>
                {paid&&<span style={{fontSize:11,color:"#059669"}}>✓</span>}
              </button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:paid?"#94a3b8":"#1E293B",textDecoration:paid?"line-through":"none"}}>{b.name}</div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>Due {ordinal(b.dueDay)} · {b.category}{b.note?" · "+b.note:""}</div>
              </div>
              <div style={{fontSize:14,fontWeight:700,color:paid?"#94a3b8":"#dc2626"}}>{fmt(b.amount)}</div>
              <button onClick={()=>startEdit(b)} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit",flexShrink:0}}>Edit</button>
              <button onClick={()=>remove(b.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit",flexShrink:0}}>Remove</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Goals({goals,onSaveGoals}){
  const [form,setForm]=useState({name:"",emoji:"🎯",targetAmount:"",currentAmount:"",monthlyTarget:"",deadline:"",color:"#0284C7"});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const [contrib,setContrib]=useState({});
  const GOAL_COLORS=["#0284C7","#059669","#d97706","#7c3aed","#db2777","#0891b2"];
  const add=()=>{
    if(!form.name.trim()||!form.targetAmount)return;
    onSaveGoals([...goals,{id:uid(),name:form.name.trim(),emoji:form.emoji||"🎯",targetAmount:parseFloat(form.targetAmount)||0,currentAmount:parseFloat(form.currentAmount)||0,monthlyTarget:parseFloat(form.monthlyTarget)||0,deadline:form.deadline,color:form.color,createdAt:today()}]);
    setForm({name:"",emoji:"🎯",targetAmount:"",currentAmount:"",monthlyTarget:"",deadline:"",color:"#0284C7"});
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
                  <span style={{fontSize:22,fontWeight:800,color:g.color||"#0284C7",letterSpacing:"-0.5px"}}>{fmt(g.currentAmount)}</span>
                  <span style={{fontSize:13,color:"#94a3b8",alignSelf:"flex-end",marginBottom:2}}>of {fmt(g.targetAmount)}</span>
                </div>
                <div style={{height:8,borderRadius:99,background:"#f1f5f9",overflow:"hidden",marginBottom:6}}>
                  <div style={{height:"100%",borderRadius:99,width:(pct*100)+"%",background:pct>=1?"#059669":g.color||"#0284C7",transition:"width 0.4s ease"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:pct<1?12:0}}>
                  <span style={{fontSize:11,color:"#94a3b8"}}>{Math.round(pct*100)}% saved</span>
                  {pct<1&&<span style={{fontSize:11,color:"#94a3b8"}}>{fmt(remaining)} to go{monthsLeft?" · ~"+monthsLeft+" mo":""}</span>}
                  {pct>=1&&<span style={{fontSize:11,color:"#059669",fontWeight:600}}>Goal reached! 🎉</span>}
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
          <Fld label="Emoji"><input style={{...IS}} value={form.emoji} onChange={e=>set("emoji",e.target.value)} placeholder="🎯"/></Fld>
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

function NetWorth({accounts,accountHistory,onSaveAccounts,onSaveAccountHistory,holdings=[],stockPrices={},fxRate=1.38}){
  const [form,setForm]=useState({name:"",type:"chequing",balance:""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const [editId,setEditId]=useState(null);
  const [editBal,setEditBal]=useState("");
  const TYPES=[{v:"chequing",l:"Chequing",asset:true},{v:"savings",l:"Savings",asset:true},{v:"investment",l:"Investment / RRSP",asset:true},{v:"credit",l:"Credit Card",asset:false},{v:"loan",l:"Loan / Mortgage",asset:false},{v:"other",l:"Other",asset:true}];
  const isAsset=t=>TYPES.find(x=>x.v===t)?.asset!==false;
  const add=()=>{
    if(!form.name.trim())return;
    const bal=parseFloat(form.balance)||0;
    const acc={id:uid(),name:form.name.trim(),type:form.type,balance:bal};
    onSaveAccounts([...accounts,acc]);
    onSaveAccountHistory([...accountHistory,{id:uid(),accountId:acc.id,date:today(),balance:bal}]);
    setForm({name:"",type:"chequing",balance:""});
  };
  const saveBalance=id=>{
    const bal=parseFloat(editBal)||0;
    onSaveAccounts(accounts.map(a=>a.id===id?{...a,balance:bal}:a));
    onSaveAccountHistory([...accountHistory,{id:uid(),accountId:id,date:today(),balance:bal}]);
    setEditId(null);
  };
  const remove=id=>{onSaveAccounts(accounts.filter(a=>a.id!==id));onSaveAccountHistory(accountHistory.filter(h=>h.accountId!==id));};
  const assets=accounts.filter(a=>isAsset(a.type));
  const liabilities=accounts.filter(a=>!isAsset(a.type));
  const totalAssets=assets.reduce((s,a)=>s+a.balance,0);
  const totalLiab=liabilities.reduce((s,a)=>s+a.balance,0);
  const portfolioValue=holdings.reduce((s,h)=>{const cur=stockPrices[h.ticker]?.currency??(h.ticker.toUpperCase().endsWith('.TO')?'CAD':'USD');return s+(stockPrices[h.ticker]?.price??0)*h.shares*(cur==='USD'?fxRate:1);},0);
  const netWorth=totalAssets+portfolioValue-totalLiab;
  const AccountRow=({a})=>(
    <div style={{display:"flex",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #f8fafc",gap:10}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:500}}>{a.name}</div>
        <div style={{fontSize:11,color:"#94a3b8"}}>{TYPES.find(t=>t.v===a.type)?.l||a.type}</div>
      </div>
      {editId===a.id
        ?<div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="number" value={editBal} onChange={e=>setEditBal(e.target.value)} style={{...IS,width:100}} onKeyDown={e=>e.key==="Enter"&&saveBalance(a.id)} autoFocus/>
            <Btn sm onClick={()=>saveBalance(a.id)}>Save</Btn>
            <Btn sm v="secondary" onClick={()=>setEditId(null)}>✕</Btn>
          </div>
        :<>
          <div style={{fontSize:14,fontWeight:700,color:isAsset(a.type)?"#059669":"#dc2626"}}>{fmt(a.balance)}</div>
          <button onClick={()=>{setEditId(a.id);setEditBal(String(a.balance));}} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
          <button onClick={()=>remove(a.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
        </>}
    </div>
  );
  return(
    <div>
      <h2 style={{margin:"0 0 22px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Accounts & Net Worth</h2>
      {(accounts.length>0||holdings.length>0)&&(
        <div style={{...CA,padding:"24px 28px",marginBottom:16,borderLeft:`4px solid ${netWorth>=0?"#0284C7":"#dc2626"}`}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Net Worth</div>
          <div style={{fontSize:40,fontWeight:800,color:netWorth>=0?"#059669":"#dc2626",letterSpacing:"-1.5px",marginBottom:10}}>{fmt(netWorth)}</div>
          <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
            {totalAssets>0&&<span style={{fontSize:13,color:"#94a3b8"}}>Assets <span style={{color:"#059669",fontWeight:700}}>{fmt(totalAssets)}</span></span>}
            {portfolioValue>0&&<span style={{fontSize:13,color:"#94a3b8"}}>Portfolio <span style={{color:"#0284C7",fontWeight:700}}>{fmt(portfolioValue)}</span></span>}
            {totalLiab>0&&<span style={{fontSize:13,color:"#94a3b8"}}>Liabilities <span style={{color:"#dc2626",fontWeight:700}}>{fmt(totalLiab)}</span></span>}
          </div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:assets.length>0&&liabilities.length>0?"1fr 1fr":"1fr",gap:16,marginBottom:16}}>
        {assets.length>0&&<div style={CA}><div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1E293B"}}>Assets <span style={{color:"#94a3b8",fontWeight:400,fontSize:12}}>· {fmt(totalAssets)}</span></div>{assets.map(a=><AccountRow key={a.id} a={a}/>)}</div>}
        {liabilities.length>0&&<div style={CA}><div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1E293B"}}>Liabilities <span style={{color:"#94a3b8",fontWeight:400,fontSize:12}}>· {fmt(totalLiab)}</span></div>{liabilities.map(a=><AccountRow key={a.id} a={a}/>)}</div>}
      </div>
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Add Account</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fld label="Account Name"><input style={IS} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. TD Chequing, Visa"/></Fld>
          <Fld label="Type"><select style={{...IS,background:"#fff"}} value={form.type} onChange={e=>set("type",e.target.value)}>{TYPES.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}</select></Fld>
        </div>
        <Fld label="Current Balance ($)" style={{marginBottom:12}}><input style={IS} type="number" value={form.balance} onChange={e=>set("balance",e.target.value)} placeholder="0.00"/></Fld>
        <Btn onClick={add} disabled={!form.name.trim()} full>Add Account</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT SCHEMA  (FinanceLookML)
// ─────────────────────────────────────────────────────────────────────────────
const MEASURE_TYPES=[
  {v:"count",    l:"count",    color:"#8b5cf6"},
  {v:"sum",      l:"sum",      color:"#0284C7"},
  {v:"subtract", l:"subtract", color:"#ef4444"},
  {v:"multiply", l:"multiply", color:"#f59e0b"},
  {v:"divide",   l:"divide",   color:"#06b6d4"},
  {v:"average",  l:"average",  color:"#059669"},
];
const DIM_TYPES=["string","number","date","boolean","currency"];

const DEFAULT_SCHEMA={views:{
  transactions:{
    label:"Transactions",description:"All income and expense transactions",source:"txns",table:"transactions",
    dimensions:{
      date:    {type:"date",   label:"Date",     description:"Date the transaction occurred",   field:"date",    sql:"${TABLE}.date"},
      month:   {type:"string", label:"Month",    description:"Year-month of the transaction",   field:"date",    sql:"strftime('%Y-%m', ${TABLE}.date)"},
      amount:  {type:"currency",label:"Amount",  description:"Transaction amount in CAD",       field:"amount",  sql:"${TABLE}.amount"},
      category:{type:"string", label:"Category", description:"Spending / income category",      field:"category",sql:"${TABLE}.category"},
      type:    {type:"string", label:"Type",     description:"'income' or 'expense'",           field:"type",    sql:"${TABLE}.type"},
      merchant:{type:"string", label:"Merchant", description:"Merchant name or income source",  field:"merchant",sql:"${TABLE}.merchant"},
      note:    {type:"string", label:"Note",     description:"Optional transaction note",       field:"note",    sql:"${TABLE}.note"},
    },
    measures:{
      count:          {type:"count",   label:"Count",         description:"Total number of transactions",              query:"data.txns.length",                                                                                                                                                                                                                                                                                                                          sql:"COUNT(*)"},
      total_expenses: {type:"sum",     label:"Total Expenses",description:"Sum of all expense amounts",                query:"data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)",                                                                                                                                                                                                                                                                       sql:"SUM(CASE WHEN ${TABLE}.type='expense' THEN ${TABLE}.amount ELSE 0 END)"},
      total_income:   {type:"sum",     label:"Total Income",  description:"Sum of all income amounts",                 query:"data.txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0)",                                                                                                                                                                                                                                                                        sql:"SUM(CASE WHEN ${TABLE}.type='income' THEN ${TABLE}.amount ELSE 0 END)"},
      net_position:   {type:"subtract",label:"Net Position",  description:"Total income minus total expenses",         query:"data.txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0)-data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)",                                                                                                                                                                                                   sql:"SUM(CASE WHEN ${TABLE}.type='income' THEN ${TABLE}.amount ELSE -${TABLE}.amount END)"},
      avg_expense:    {type:"divide",  label:"Avg Expense",   description:"Average expense amount per transaction",    query:"(()=>{const e=data.txns.filter(t=>t.type==='expense');return e.length?e.reduce((s,t)=>s+t.amount,0)/e.length:0})()",                                                                                                                                                                                                                       sql:"AVG(CASE WHEN ${TABLE}.type='expense' THEN ${TABLE}.amount ELSE NULL END)"},
      avg_income:     {type:"divide",  label:"Avg Income",    description:"Average income amount per transaction",     query:"(()=>{const i=data.txns.filter(t=>t.type==='income');return i.length?i.reduce((s,t)=>s+t.amount,0)/i.length:0})()",                                                                                                                                                                                                                        sql:"AVG(CASE WHEN ${TABLE}.type='income' THEN ${TABLE}.amount ELSE NULL END)"},
      spend_x_income: {type:"multiply",label:"Expense Ratio", description:"Total expenses ÷ total income × 100 (%)",  query:"(()=>{const i=data.txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);const e=data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);return i>0?Math.round(e/i*100):0})()",                                                                                                                                        sql:"ROUND(SUM(CASE WHEN ${TABLE}.type='expense' THEN ${TABLE}.amount ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${TABLE}.type='income' THEN ${TABLE}.amount ELSE 0 END),0),1)"},
    }
  },
  bills:{
    label:"Bills",description:"Recurring monthly bills and subscriptions",source:"bills",table:"bills",
    dimensions:{
      name:    {type:"string", label:"Name",     description:"Bill name (e.g. Rent, Netflix)",         field:"name",    sql:"${TABLE}.name"},
      amount:  {type:"currency",label:"Amount",  description:"Monthly bill amount in CAD",             field:"amount",  sql:"${TABLE}.amount"},
      category:{type:"string", label:"Category", description:"Bill category",                          field:"category",sql:"${TABLE}.category"},
      due_day: {type:"number", label:"Due Day",  description:"Day of month the bill is due (1–31)",    field:"dueDay",  sql:"${TABLE}.dueDay"},
      active:  {type:"boolean",label:"Active",   description:"Whether the bill is currently active",   field:"active",  sql:"${TABLE}.active"},
    },
    measures:{
      count:         {type:"count",   label:"Active Count",  description:"Number of active bills",                     query:"data.bills.filter(b=>b.active!==false).length",                                                                                                            sql:"COUNT(*) FILTER (WHERE ${TABLE}.active=1)"},
      total_monthly: {type:"sum",     label:"Total Monthly", description:"Sum of all active monthly bill amounts",     query:"data.bills.filter(b=>b.active!==false).reduce((s,b)=>s+b.amount,0)",                                                                                       sql:"SUM(CASE WHEN ${TABLE}.active=1 THEN ${TABLE}.amount ELSE 0 END)"},
      total_yearly:  {type:"multiply",label:"Total Yearly",  description:"Monthly total × 12 — annual bill cost",     query:"data.bills.filter(b=>b.active!==false).reduce((s,b)=>s+b.amount,0)*12",                                                                                    sql:"SUM(CASE WHEN ${TABLE}.active=1 THEN ${TABLE}.amount ELSE 0 END)*12"},
      avg_bill:      {type:"divide",  label:"Avg Bill",      description:"Average monthly bill amount",               query:"(()=>{const a=data.bills.filter(b=>b.active!==false);return a.length?a.reduce((s,b)=>s+b.amount,0)/a.length:0})()",                                        sql:"AVG(CASE WHEN ${TABLE}.active=1 THEN ${TABLE}.amount ELSE NULL END)"},
    }
  },
  expected_income:{
    label:"Expected Income",description:"Scheduled and recurring expected income payments",source:"expected",table:"expected_income",
    dimensions:{
      source:       {type:"string", label:"Source",       description:"Income source / payer name",                     field:"source",      sql:"${TABLE}.source"},
      amount:       {type:"currency",label:"Amount",      description:"Expected payment amount in CAD",                 field:"amount",      sql:"${TABLE}.amount"},
      expected_date:{type:"date",   label:"Expected Date",description:"When the payment is expected",                   field:"expectedDate",sql:"${TABLE}.expectedDate"},
      month:        {type:"string", label:"Month",        description:"Year-month the payment is expected",             field:"expectedDate",sql:"strftime('%Y-%m', ${TABLE}.expectedDate)"},
      confirmed:    {type:"boolean",label:"Confirmed",    description:"Whether the payment has been received",          field:"confirmed",   sql:"${TABLE}.confirmed"},
      cadence:      {type:"string", label:"Cadence",      description:"Recurrence frequency",                          field:"cadence",     sql:"${TABLE}.cadence"},
    },
    measures:{
      count_pending:    {type:"count",  label:"Pending Count",   description:"Number of unconfirmed upcoming payments",       query:"data.expected.filter(e=>!e.confirmed).length",                                                                                                                                               sql:"COUNT(*) FILTER (WHERE ${TABLE}.confirmed=0)"},
      total_pending:    {type:"sum",    label:"Total Pending",   description:"Sum of all unconfirmed expected amounts",       query:"data.expected.filter(e=>!e.confirmed).reduce((s,e)=>s+e.amount,0)",                                                                                                                           sql:"SUM(CASE WHEN ${TABLE}.confirmed=0 THEN ${TABLE}.amount ELSE 0 END)"},
      total_confirmed:  {type:"sum",    label:"Total Confirmed", description:"Sum of all confirmed received payments",        query:"data.expected.filter(e=>e.confirmed).reduce((s,e)=>s+e.amount,0)",                                                                                                                            sql:"SUM(CASE WHEN ${TABLE}.confirmed=1 THEN ${TABLE}.amount ELSE 0 END)"},
      confirmation_rate:{type:"divide", label:"Confirmation %",  description:"% of payments confirmed",                      query:"(()=>{const t=data.expected.length;return t?Math.round(data.expected.filter(e=>e.confirmed).length/t*100):0})()",                                                                              sql:"ROUND(SUM(${TABLE}.confirmed)*100.0/NULLIF(COUNT(*),0),1)"},
    }
  },
  goals:{
    label:"Goals",description:"Financial savings goals and progress",source:"goals",table:"goals",
    dimensions:{
      name:          {type:"string", label:"Name",           description:"Goal name",                                   field:"name",          sql:"${TABLE}.name"},
      target_amount: {type:"currency",label:"Target Amount", description:"Goal target amount in CAD",                   field:"targetAmount",  sql:"${TABLE}.targetAmount"},
      current_amount:{type:"currency",label:"Current Amount",description:"Amount saved so far in CAD",                  field:"currentAmount", sql:"${TABLE}.currentAmount"},
      deadline:      {type:"date",   label:"Deadline",       description:"Target completion date",                      field:"deadline",      sql:"${TABLE}.deadline"},
      progress_pct:  {type:"number", label:"Progress %",     description:"Completion % — currentAmount/targetAmount×100",field:"currentAmount", sql:"ROUND(${TABLE}.currentAmount*100.0/NULLIF(${TABLE}.targetAmount,0),1)"},
    },
    measures:{
      count:           {type:"count",   label:"Count",           description:"Total number of goals",                    query:"data.goals.length",                                                                                                                                        sql:"COUNT(*)"},
      total_target:    {type:"sum",     label:"Total Target",    description:"Sum of all goal target amounts",           query:"data.goals.reduce((s,g)=>s+g.targetAmount,0)",                                                                                                            sql:"SUM(${TABLE}.targetAmount)"},
      total_saved:     {type:"sum",     label:"Total Saved",     description:"Sum of all current amounts saved",         query:"data.goals.reduce((s,g)=>s+g.currentAmount,0)",                                                                                                           sql:"SUM(${TABLE}.currentAmount)"},
      total_remaining: {type:"subtract",label:"Total Remaining", description:"Total still needed to reach all goals",   query:"data.goals.reduce((s,g)=>s+(g.targetAmount-g.currentAmount),0)",                                                                                          sql:"SUM(${TABLE}.targetAmount-${TABLE}.currentAmount)"},
      avg_progress:    {type:"divide",  label:"Avg Progress %",  description:"Average completion % across all goals",   query:"(()=>{const gs=data.goals;return gs.length?Math.round(gs.reduce((s,g)=>s+(g.currentAmount/Math.max(g.targetAmount,1)*100),0)/gs.length):0})()",           sql:"ROUND(AVG(${TABLE}.currentAmount*100.0/NULLIF(${TABLE}.targetAmount,0)),1)"},
    }
  },
  accounts:{
    label:"Accounts",description:"Bank and financial accounts",source:"accounts",table:"accounts",
    dimensions:{
      name:   {type:"string", label:"Name",    description:"Account name (e.g. TD Chequing, Visa)",    field:"name",   sql:"${TABLE}.name"},
      type:   {type:"string", label:"Type",    description:"chequing, savings, credit_card, loan, etc",field:"type",   sql:"${TABLE}.type"},
      balance:{type:"currency",label:"Balance",description:"Current balance in CAD",                   field:"balance",sql:"${TABLE}.balance"},
    },
    measures:{
      count:             {type:"count",   label:"Count",             description:"Total number of accounts",                                                                                                                          query:"data.accounts.length",                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          sql:"COUNT(*)"},
      total_assets:      {type:"sum",     label:"Total Assets",      description:"Sum of asset account balances",                                                                                                                     query:"data.accounts.filter(a=>['chequing','savings','investment','property','other_asset'].includes(a.type)).reduce((s,a)=>s+a.balance,0)",                                                                                                                                                                                                                                                                                 sql:"SUM(CASE WHEN ${TABLE}.type IN ('chequing','savings','investment','property','other_asset') THEN ${TABLE}.balance ELSE 0 END)"},
      total_liabilities: {type:"sum",     label:"Total Liabilities", description:"Sum of liability balances",                                                                                                                        query:"data.accounts.filter(a=>['credit_card','loan','mortgage','other_liability'].includes(a.type)).reduce((s,a)=>s+a.balance,0)",                                                                                                                                                                                                                                                                                             sql:"SUM(CASE WHEN ${TABLE}.type IN ('credit_card','loan','mortgage','other_liability') THEN ${TABLE}.balance ELSE 0 END)"},
      net_worth:         {type:"subtract",label:"Net Worth",         description:"Total assets minus total liabilities",                                                                                                              query:"data.accounts.filter(a=>['chequing','savings','investment','property','other_asset'].includes(a.type)).reduce((s,a)=>s+a.balance,0)-data.accounts.filter(a=>['credit_card','loan','mortgage','other_liability'].includes(a.type)).reduce((s,a)=>s+a.balance,0)",                                                                                                                                                          sql:"SUM(CASE WHEN ${TABLE}.type IN ('chequing','savings','investment','property','other_asset') THEN ${TABLE}.balance WHEN ${TABLE}.type IN ('credit_card','loan','mortgage','other_liability') THEN -${TABLE}.balance ELSE 0 END)"},
    }
  },
  holdings:{
    label:"Stock Holdings",description:"Investment portfolio — stock holdings and cost basis",source:"holdings",table:"holdings",
    dimensions:{
      ticker:    {type:"string", label:"Ticker",     description:"Stock ticker (e.g. TSLA, XEQT.TO)",            field:"ticker",   sql:"${TABLE}.ticker"},
      shares:    {type:"number", label:"Shares",     description:"Number of shares held",                        field:"shares",   sql:"${TABLE}.shares"},
      cost_basis:{type:"currency",label:"Cost Basis",description:"Weighted average purchase price per share",    field:"costBasis",sql:"${TABLE}.costBasis"},
      total_cost:{type:"currency",label:"Total Cost",description:"Cost basis × shares for this holding",         field:"costBasis",sql:"${TABLE}.costBasis * ${TABLE}.shares"},
    },
    measures:{
      count:        {type:"count",label:"Holdings Count",description:"Number of distinct stock holdings",         query:"data.holdings.length",                                                                                                                                                                                    sql:"COUNT(*)"},
      total_cost:   {type:"sum",  label:"Total Cost",    description:"Sum of cost basis × shares for all holdings",query:"data.holdings.filter(h=>h.costBasis!=null).reduce((s,h)=>s+h.costBasis*h.shares,0)",                                                                                                                   sql:"SUM(${TABLE}.costBasis * ${TABLE}.shares)"},
      total_shares: {type:"sum",  label:"Total Shares",  description:"Total share count across all holdings",    query:"data.holdings.reduce((s,h)=>s+h.shares,0)",                                                                                                                                                               sql:"SUM(${TABLE}.shares)"},
    }
  },
  vacations:{
    label:"Vacations",description:"Vacation budgets and date ranges",source:"vacations",table:"vacations",
    dimensions:{
      name:      {type:"string", label:"Name",       description:"Vacation name (e.g. Paris 2026)",  field:"name",      sql:"${TABLE}.name"},
      start_date:{type:"date",   label:"Start Date", description:"Vacation start date",              field:"startDate", sql:"${TABLE}.startDate"},
      end_date:  {type:"date",   label:"End Date",   description:"Vacation end date",                field:"endDate",   sql:"${TABLE}.endDate"},
      budget:    {type:"currency",label:"Budget",    description:"Total budget in CAD",              field:"budget",    sql:"${TABLE}.budget"},
      notes:     {type:"string", label:"Notes",      description:"Optional notes",                   field:"notes",     sql:"${TABLE}.notes"},
    },
    measures:{
      count:          {type:"count",   label:"Count",           description:"Total number of vacations",                              query:"data.vacations.length",                                                                                                                                                               sql:"COUNT(*)"},
      total_budget:   {type:"sum",     label:"Total Budget",    description:"Sum of all vacation budgets",                            query:"(data.vacations||[]).reduce((s,v)=>s+v.budget,0)",                                                                                                                                   sql:"SUM(${TABLE}.budget)"},
      total_spent:    {type:"sum",     label:"Total Spent",     description:"Sum of all vacation transaction amounts",                query:"(data.vacationTxns||[]).reduce((s,t)=>s+t.amount,0)",                                                                                                                                sql:"(SELECT SUM(vt.amount) FROM vacation_txns vt)"},
      total_remaining:{type:"subtract",label:"Total Remaining", description:"Total budgets minus total spending",                     query:"(data.vacations||[]).reduce((s,v)=>s+v.budget,0)-(data.vacationTxns||[]).reduce((s,t)=>s+t.amount,0)",                                                                             sql:"SUM(${TABLE}.budget)-(SELECT COALESCE(SUM(vt.amount),0) FROM vacation_txns vt)"},
    }
  },
  vacation_txns:{
    label:"Vacation Transactions",description:"Individual spending entries recorded against a vacation",source:"vacationTxns",table:"vacation_txns",
    dimensions:{
      vacation_id:{type:"string", label:"Vacation ID",description:"ID of the parent vacation",                     field:"vacationId",sql:"${TABLE}.vacationId"},
      date:       {type:"date",   label:"Date",        description:"Date the vacation expense occurred",           field:"date",      sql:"${TABLE}.date"},
      month:      {type:"string", label:"Month",       description:"Year-month of the expense",                    field:"date",      sql:"strftime('%Y-%m', ${TABLE}.date)"},
      amount:     {type:"currency",label:"Amount",     description:"Expense amount in CAD",                        field:"amount",    sql:"${TABLE}.amount"},
      category:   {type:"string", label:"Category",   description:"Spending category",                            field:"category",  sql:"${TABLE}.category"},
      merchant:   {type:"string", label:"Merchant",   description:"Merchant or vendor name",                      field:"merchant",  sql:"${TABLE}.merchant"},
      note:       {type:"string", label:"Note",       description:"Optional note",                                field:"note",      sql:"${TABLE}.note"},
    },
    measures:{
      count:  {type:"count", label:"Count",       description:"Total vacation transactions",                       query:"(data.vacationTxns||[]).length",                                                                                                                                                                         sql:"COUNT(*)"},
      total:  {type:"sum",   label:"Total Spent", description:"Total amount spent across all vacation transactions",query:"(data.vacationTxns||[]).reduce((s,t)=>s+t.amount,0)",                                                                                                                                                  sql:"SUM(${TABLE}.amount)"},
      avg_txn:{type:"divide",label:"Avg per Txn", description:"Average vacation transaction amount",              query:"(()=>{const t=data.vacationTxns||[];return t.length?t.reduce((s,x)=>s+x.amount,0)/t.length:0})()",                                                                                                     sql:"AVG(${TABLE}.amount)"},
    }
  },
  bill_payments:{
    label:"Bill Payments",description:"History of bills marked as paid each month",source:"billPayments",table:"bill_payments",
    dimensions:{
      bill_id:  {type:"string", label:"Bill ID",   description:"ID of the parent bill",                            field:"billId",  sql:"${TABLE}.billId"},
      month:    {type:"string", label:"Month",     description:"Month the bill was paid (YYYY-MM)",                field:"month",   sql:"${TABLE}.month"},
      amount:   {type:"currency",label:"Amount",   description:"Amount paid",                                     field:"amount",  sql:"${TABLE}.amount"},
      paid_date:{type:"date",   label:"Paid Date", description:"Date the payment was recorded",                   field:"paidDate",sql:"${TABLE}.paidDate"},
      note:     {type:"string", label:"Note",      description:"Optional payment note",                           field:"note",    sql:"${TABLE}.note"},
    },
    measures:{
      count:      {type:"count", label:"Payment Count",description:"Total bill payment records",                  query:"(data.billPayments||[]).length",                                                                                                                                                                           sql:"COUNT(*)"},
      total_paid: {type:"sum",   label:"Total Paid",   description:"Sum of all recorded bill payments",           query:"(data.billPayments||[]).reduce((s,p)=>s+p.amount,0)",                                                                                                                                                    sql:"SUM(${TABLE}.amount)"},
      avg_payment:{type:"divide",label:"Avg Payment",  description:"Average bill payment amount",                query:"(()=>{const p=data.billPayments||[];return p.length?p.reduce((s,x)=>s+x.amount,0)/p.length:0})()",                                                                                                      sql:"AVG(${TABLE}.amount)"},
    }
  },
  account_history:{
    label:"Account History",description:"Point-in-time account balance snapshots",source:"accountHistory",table:"account_history",
    dimensions:{
      date:      {type:"date",   label:"Date",       description:"Date the balance snapshot was recorded",         field:"date",     sql:"${TABLE}.date"},
      month:     {type:"string", label:"Month",      description:"Year-month of the snapshot",                    field:"date",     sql:"strftime('%Y-%m', ${TABLE}.date)"},
      balance:   {type:"currency",label:"Balance",   description:"Account balance at the snapshot date in CAD",   field:"balance",  sql:"${TABLE}.balance"},
      account_id:{type:"string", label:"Account ID", description:"ID of the account this snapshot belongs to",   field:"accountId",sql:"${TABLE}.accountId"},
      note:      {type:"string", label:"Note",       description:"Optional note about this balance entry",        field:"note",     sql:"${TABLE}.note"},
    },
    measures:{
      count:       {type:"count",label:"Snapshots",      description:"Total number of balance snapshots",         query:"(data.accountHistory||[]).length",                                                                                                                                                                         sql:"COUNT(*)"},
      total_balance:{type:"sum", label:"Total Balance",  description:"Sum of all balance values in the table",   query:"(data.accountHistory||[]).reduce((s,e)=>s+e.balance,0)",                                                                                                                                                   sql:"SUM(${TABLE}.balance)"},
      latest_total:{type:"sum",  label:"Latest Snapshot",description:"Sum of the most recent balance per account",query:"(()=>{const h=data.accountHistory||[];const byAcc={};h.forEach(e=>{if(!byAcc[e.accountId||'default']||e.date>byAcc[e.accountId||'default'].date)byAcc[e.accountId||'default']=e;});return Object.values(byAcc).reduce((s,e)=>s+e.balance,0)})()", sql:"SUM(${TABLE}.balance) FILTER (WHERE ${TABLE}.date=(SELECT MAX(ah2.date) FROM account_history ah2 WHERE ah2.accountId=${TABLE}.accountId))"},
    }
  }
}};

// DEFAULT_SETTINGS imported from ./constants/index.js

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function Settings({settings,onSave,authConfig,onSaveAuthConfig}){
  const [f,setF]=useState({...DEFAULT_SETTINGS,...settings});
  const [ollamaStatus,setOllamaStatus]=useState(()=>settings.ollamaStatus||null); // null | "ok" | "error"
  const [testing,setTesting]=useState(false);
  const [copied,setCopied]=useState("");
  const set=(k,v)=>setF(p=>({...p,[k]:v}));

  // ── Update state ──────────────────────────────────────────────────────────
  const isElectron=!!window.electronLocalUpdate;
  // Local update
  const [localStatus,setLocalStatus]=useState(null); // null|'building'|'done'|'error'
  const [localLog,setLocalLog]=useState([]);
  const triggerLocalUpdate=()=>{
    if(!window.electronLocalUpdate) return;
    setLocalStatus('building'); setLocalLog([]);
    window.electronLocalUpdate.onProgress(msg=>{ if(msg.trim()) setLocalLog(p=>[...p.slice(-30),msg.trim()]); });
    window.electronLocalUpdate.onDone((ok,err)=>{ setLocalStatus(ok?'done':'error'); if(!ok) setLocalLog(p=>[...p,`Error: ${err}`]); });
    window.electronLocalUpdate.trigger();
  };
  // GitHub update
  const [ghStatus,setGhStatus]=useState(null); // null|'checking'|'available'|'downloading'|'ready'|'up-to-date'|'error'
  const [ghVersion,setGhVersion]=useState('');
  const [ghError,setGhError]=useState('');
  useEffect(()=>{
    if(!window.electronUpdater) return;
    window.electronUpdater.onUpdateAvailable(info=>{ setGhStatus('downloading'); setGhVersion(info.version); });
    window.electronUpdater.onUpdateNotAvailable(()=>setGhStatus('up-to-date'));
    window.electronUpdater.onUpdateDownloaded(info=>{ setGhStatus('ready'); setGhVersion(info.version); });
    window.electronUpdater.onUpdateError(err=>{ setGhStatus('error'); setGhError(err); });
  },[]);
  const checkGithub=()=>{
    if(!window.electronUpdater) return;
    setGhStatus('checking'); setGhError('');
    window.electronUpdater.checkForUpdates();
  };

  // Gemini key state
  const [geminiKeyInput,setGeminiKeyInput]=useState("");
  const [geminiKeySet,setGeminiKeySet]=useState(null); // null=loading, bool
  const [geminiKeySource,setGeminiKeySource]=useState("none");
  const [geminiSaving,setGeminiSaving]=useState(false);
  const [geminiMsg,setGeminiMsg]=useState(null); // {type:"ok"|"err", text}
  const [geminiExpanded,setGeminiExpanded]=useState(()=>settings.geminiExpanded!==false);
  const [ollamaExpanded,setOllamaExpanded]=useState(()=>settings.ollamaExpanded!==false);

  useEffect(()=>{
    fetch("/api/config/gemini-key").then(r=>r.json()).then(d=>{
      setGeminiKeySet(d.set);
      setGeminiKeySource(d.source||"none");
      if(d.set) setGeminiExpanded(false);
    }).catch(()=>setGeminiKeySet(false));
  },[]);

  const saveGeminiKey=async()=>{
    if(!geminiKeyInput.trim()){return;}
    setGeminiSaving(true);setGeminiMsg(null);
    try{
      const r=await fetch("/api/config/gemini-key",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:geminiKeyInput.trim()})});
      if(r.ok){setGeminiKeySet(true);setGeminiKeySource("db");setGeminiKeyInput("");setGeminiMsg({type:"ok",text:"Key saved — Gemini AI is now active."});setTimeout(()=>{setGeminiExpanded(false);onSave({...f,geminiExpanded:false});},1200);}
      else{const d=await r.json();setGeminiMsg({type:"err",text:d.error||"Failed to save key."});}
    }catch(e){setGeminiMsg({type:"err",text:e.message});}
    setGeminiSaving(false);
    setTimeout(()=>setGeminiMsg(null),4000);
  };

  const resetGeminiKey=async()=>{
    setGeminiSaving(true);setGeminiMsg(null);
    try{
      await fetch("/api/config/gemini-key",{method:"DELETE"});
      setGeminiKeySet(false);setGeminiKeySource("none");setGeminiKeyInput("");
      setGeminiMsg({type:"ok",text:"Key removed."});
    }catch(e){setGeminiMsg({type:"err",text:e.message});}
    setGeminiSaving(false);
    setTimeout(()=>setGeminiMsg(null),3000);
  };

  const save=()=>onSave(f);

  const testOllama=async()=>{
    setTesting(true);setOllamaStatus(null);
    try{
      const r=await fetch("/api/llm/models");
      if(r.ok){setOllamaStatus("ok");setTimeout(()=>{setOllamaExpanded(false);onSave({...f,ollamaStatus:'ok',ollamaExpanded:false});},1200);}
      else{setOllamaStatus("error");}
    }catch{setOllamaStatus("error");}
    setTesting(false);
  };

  const copy=text=>{navigator.clipboard?.writeText(text);setCopied(text);setTimeout(()=>setCopied(""),2000);};

  const CodeBlock=({cmd})=>(
    <div style={{display:"flex",alignItems:"center",gap:8,background:"#0f172a",borderRadius:8,padding:"10px 14px",marginTop:6,marginBottom:4}}>
      <code style={{flex:1,fontSize:12,color:"#a5f3fc",fontFamily:"'Menlo','Monaco','Courier New',monospace"}}>{cmd}</code>
      <button onClick={()=>copy(cmd)} style={{background:copied===cmd?"#059669":"rgba(255,255,255,0.1)",border:"none",cursor:"pointer",color:"#fff",fontSize:11,padding:"3px 9px",borderRadius:6,fontFamily:"inherit",flexShrink:0,transition:"background .2s"}}>
        {copied===cmd?"✓ Copied":"Copy"}
      </button>
    </div>
  );

  return(
    <div>
      <h2 style={{margin:"0 0 22px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Settings</h2>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"start"}}>

        {/* Left column */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Personal */}
          <div style={CA}>
            <div style={{fontSize:13,fontWeight:700,color:"#1E293B",marginBottom:14}}>Personal</div>
            <Fld label="Your Name">
              <input style={IS} value={f.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Gabe"/>
            </Fld>
            <Btn onClick={save} full>Save Settings</Btn>
          </div>

          {/* Appearance */}
          <div style={CA}>
            <div style={{fontSize:13,fontWeight:700,color:"#1E293B",marginBottom:14}}>Appearance</div>

            {/* Dark Mode */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:"#1E293B"}}>🌙 Dark Mode</div>
                <div style={{fontSize:11,color:"#64748b",marginTop:1}}>Switch to a dark colour scheme</div>
              </div>
              <button onClick={()=>{const v=!f.darkMode;set("darkMode",v);setTimeout(()=>onSave({...f,darkMode:v}),50);}} style={{width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",background:f.darkMode?"#0284C7":"#cbd5e1",position:"relative",transition:"background .2s",flexShrink:0}}>
                <span style={{position:"absolute",top:3,left:f.darkMode?22:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
              </button>
            </div>

            {/* Color Blind Mode */}
            <div>
              <div style={{fontSize:12,fontWeight:600,color:"#1E293B",marginBottom:6}}>👁 Colour Blind Mode</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {[
                  {v:"none",       l:"None",         d:"Default colours"},
                  {v:"deuteranopia",l:"Deuteranopia", d:"Red-green (most common)"},
                  {v:"protanopia",  l:"Protanopia",   d:"Red-green (red weak)"},
                  {v:"tritanopia",  l:"Tritanopia",   d:"Blue-yellow"},
                  {v:"achromatopsia",l:"Greyscale",   d:"Full colour blindness"},
                ].map(({v,l,d})=>(
                  <label key={v} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"7px 10px",borderRadius:8,background:f.colorBlindMode===v?"#eff6ff":"transparent",border:f.colorBlindMode===v?"1px solid #bae6fd":"1px solid transparent",transition:"all .15s"}}>
                    <input type="radio" name="colorBlind" value={v} checked={f.colorBlindMode===v} onChange={()=>{set("colorBlindMode",v);setTimeout(()=>onSave({...f,colorBlindMode:v}),50);}} style={{accentColor:"#0284C7"}}/>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:"#1e293b"}}>{l}</div>
                      <div style={{fontSize:10,color:"#94a3b8"}}>{d}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Developer Access */}
          <div style={{...CA,background:f.devMode?"linear-gradient(135deg,#fefce8,#fef9c3)":"#fff",border:f.devMode?"1px solid #fde047":"1px solid #e2e8f0"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>Developer Access</div>
                <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Unlocks the Data Model editor tab</div>
              </div>
              <button onClick={()=>{set("devMode",!f.devMode);setTimeout(()=>onSave({...f,devMode:!f.devMode}),50);}} style={{width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",background:f.devMode?"#0284C7":"#cbd5e1",position:"relative",transition:"background .2s",flexShrink:0}}>
                <span style={{position:"absolute",top:3,left:f.devMode?22:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
              </button>
            </div>
            {f.devMode&&<div style={{fontSize:11,color:"#854d0e",background:"#fef9c3",border:"1px solid #fde047",borderRadius:8,padding:"7px 10px"}}>⚠ Dev mode enabled — Data Model tab is now visible in the nav.</div>}
          </div>

        </div>

        {/* Right column — Gemini + Ollama */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Gemini API Key */}
          <div style={{...CA,border:geminiKeySet?"1px solid #bbf7d0":"1px solid #e2e8f0",background:geminiKeySet?"linear-gradient(135deg,#f0fdf4,#f7fffe)":"#fff"}}>
            <div onClick={()=>setGeminiExpanded(p=>{onSave({...f,geminiExpanded:!!p?false:true});return !p;})} style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",marginBottom:geminiExpanded?4:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>Gemini API Key</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {geminiKeySet===null?<span style={{fontSize:11,color:"#94a3b8"}}>checking…</span>
                 :geminiKeySet?<span style={{fontSize:11,color:"#059669",fontWeight:600,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"2px 8px"}}>✓ Active{geminiKeySource==="env"?" (env)":""}</span>
                 :<span style={{fontSize:11,color:"#f59e0b",fontWeight:600,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"2px 8px"}}>Not set</span>}
                <span style={{fontSize:12,color:"#94a3b8",transition:"transform .2s",display:"inline-block",transform:geminiExpanded?"rotate(0deg)":"rotate(-90deg)"}}>▾</span>
              </div>
            </div>
            {geminiExpanded&&<>
            <div style={{fontSize:11,color:"#64748b",marginBottom:12,lineHeight:1.6}}>Used for receipt scanning and Jarvis AI. Keys are stored server-side and never exposed to the browser.</div>
            {!geminiKeySet&&<>
              <Fld label="Paste your key">
                <input
                  type="password"
                  style={{...IS,letterSpacing:geminiKeyInput?"0.15em":"normal",fontFamily:geminiKeyInput?"monospace":"inherit"}}
                  value={geminiKeyInput}
                  onChange={e=>setGeminiKeyInput(e.target.value)}
                  placeholder="AIza…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Fld>
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button onClick={saveGeminiKey} disabled={geminiSaving||!geminiKeyInput.trim()} style={{flex:1,padding:"8px",borderRadius:10,border:"1.5px solid #bbf7d0",background:"#f0fdf4",color:"#059669",cursor:geminiSaving||!geminiKeyInput.trim()?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:geminiSaving||!geminiKeyInput.trim()?0.5:1}}>
                  {geminiSaving?"Saving…":"Save Key"}
                </button>
              </div>
            </>}
            {geminiKeySet&&<div style={{display:"flex",gap:8,marginTop:4}}>
              <div style={{flex:1,fontSize:12,color:"#64748b",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"8px 12px",letterSpacing:"0.2em",fontFamily:"monospace"}}>
                {"•".repeat(32)}
              </div>
              <button onClick={resetGeminiKey} disabled={geminiSaving||geminiKeySource==="env"} title={geminiKeySource==="env"?"Key comes from .env file — remove GEMINI_API_KEY from .env to reset":""} style={{padding:"8px 14px",borderRadius:10,border:"1.5px solid #fecaca",background:"#fef2f2",color:"#dc2626",cursor:geminiSaving||geminiKeySource==="env"?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:geminiSaving||geminiKeySource==="env"?0.5:1,whiteSpace:"nowrap",flexShrink:0}}>
                {geminiSaving?"…":"Reset Key"}
              </button>
            </div>}
            {geminiMsg&&<div style={{marginTop:8,fontSize:12,color:geminiMsg.type==="ok"?"#059669":"#dc2626",background:geminiMsg.type==="ok"?"#f0fdf4":"#fef2f2",border:`1px solid ${geminiMsg.type==="ok"?"#bbf7d0":"#fecaca"}`,borderRadius:8,padding:"7px 12px",fontWeight:500}}>
              {geminiMsg.type==="ok"?"✓ ":"✗ "}{geminiMsg.text}
            </div>}
            <div style={{marginTop:10,fontSize:11,color:"#94a3b8"}}>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{color:"#0284C7"}}>aistudio.google.com/apikey</a></div>
            </>}
          </div>

          <div style={CA}>
            <div onClick={()=>setOllamaExpanded(p=>{onSave({...f,ollamaExpanded:!!p?false:true});return !p;})} style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",marginBottom:ollamaExpanded?4:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>Local AI (Ollama)</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {ollamaStatus==="ok"&&<span style={{fontSize:11,color:"#059669",fontWeight:600,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"2px 8px"}}>✓ Connected</span>}
                <span style={{fontSize:12,color:"#94a3b8",transition:"transform .2s",display:"inline-block",transform:ollamaExpanded?"rotate(0deg)":"rotate(-90deg)"}}>▾</span>
              </div>
            </div>
            {ollamaExpanded&&<>
            <div style={{fontSize:11,color:"#64748b",marginTop:4,marginBottom:14,lineHeight:1.6}}>All processing runs on your machine. Your financial data never leaves this device.</div>

            <Fld label="Ollama URL">
              <input style={IS} value={f.ollamaUrl} onChange={e=>set("ollamaUrl",e.target.value)} placeholder="http://localhost:11434"/>
            </Fld>
            <Fld label="Model">
              <input style={IS} value={f.ollamaModel} onChange={e=>set("ollamaModel",e.target.value)} placeholder="phi3:mini"/>
              <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>Recommended: <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>phi3:mini</code> (fast, 3.8B) · <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>llama3.2:3b</code> · <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>mistral:7b</code></div>
            </Fld>
            <div style={{display:"flex",gap:8,marginTop:4,marginBottom:12}}>
              <button onClick={testOllama} disabled={testing} style={{flex:1,padding:"8px",borderRadius:10,border:"1.5px solid #bae6fd",background:"#f0f9ff",color:"#0284C7",cursor:testing?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:testing?0.6:1}}>
                {testing?"Testing…":"⚡ Test Connection"}
              </button>
              <Btn onClick={save}>Save</Btn>
            </div>
            {ollamaStatus==="ok"&&<div style={{fontSize:12,color:"#059669",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"7px 12px",fontWeight:500}}>✓ Ollama is running and reachable</div>}
            {ollamaStatus==="error"&&<div style={{fontSize:12,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"7px 12px"}}>✗ Could not reach Ollama — see install steps below</div>}
            </>}
          </div>

          {/* Install instructions — hidden once Ollama connects */}
          {!ollamaStatus&&<div style={CA}>
            <div style={{fontSize:13,fontWeight:700,color:"#1E293B",marginBottom:12}}>Install Ollama</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>

              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>macOS / Linux</div>
                <CodeBlock cmd="curl -fsSL https://ollama.ai/install.sh | sh"/>
                <div style={{fontSize:11,color:"#94a3b8"}}>Or download from <a href="https://ollama.ai" target="_blank" rel="noreferrer" style={{color:"#0284C7"}}>ollama.ai</a></div>
              </div>

              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Windows</div>
                <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Download the installer from <a href="https://ollama.ai/download" target="_blank" rel="noreferrer" style={{color:"#0284C7"}}>ollama.ai/download</a> and run it.</div>
              </div>

              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Pull a model (after installing)</div>
                <CodeBlock cmd="ollama pull phi3:mini"/>
                <CodeBlock cmd="ollama pull llama3.2:3b"/>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>phi3:mini is ~2.3GB and runs well on most machines. llama3.2:3b is ~2.0GB and slightly stronger at reasoning.</div>
              </div>

              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Start Ollama (if not auto-started)</div>
                <CodeBlock cmd="ollama serve"/>
              </div>

            </div>
          </div>}
        </div>

      </div>

      {/* ── App Update ─────────────────────────────────────────────────── */}
      {isElectron&&(
        <div style={{background:"#fff",borderRadius:12,padding:"20px 24px",boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginTop:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1E293B",marginBottom:2}}>App Update</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:16}}>Choose how to update the app.</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>

            {/* ── Local ── */}
            <div style={{border:"1.5px solid #e2e8f0",borderRadius:10,padding:"16px"}}>
              <div style={{fontSize:12,fontWeight:700,color:"#1e293b",marginBottom:4}}>💻 Local</div>
              <div style={{fontSize:11,color:"#64748b",marginBottom:12,lineHeight:1.5}}>Rebuild from your local source code changes. App quits, updates, and relaunches.</div>
              <button
                onClick={triggerLocalUpdate}
                disabled={localStatus==='building'}
                style={{width:"100%",padding:"8px 0",borderRadius:7,background:localStatus==='building'?"#94a3b8":localStatus==='error'?"#dc2626":"#0f172a",color:"#fff",border:"none",fontWeight:700,fontSize:12,cursor:localStatus==='building'?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}
              >
                {localStatus==='building'
                  ?<><span style={{display:"inline-block",width:11,height:11,border:"2px solid rgba(255,255,255,0.35)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>Building…</>
                  :localStatus==='error'?'↺ Retry':'🔄 Build & Install'}
              </button>
              {localLog.length>0&&(
                <div style={{marginTop:10,background:"#0f172a",borderRadius:7,padding:"8px 12px",maxHeight:130,overflowY:"auto",fontFamily:"monospace",fontSize:10,lineHeight:1.6}}>
                  {localLog.map((l,i)=><div key={i} style={{color:l.startsWith('Error')?'#f87171':l.includes('✓')||l.includes('built')||l.includes('✅')?"#4ade80":"#94a3b8"}}>{l}</div>)}
                </div>
              )}
            </div>

            {/* ── GitHub ── */}
            <div style={{border:"1.5px solid #e2e8f0",borderRadius:10,padding:"16px"}}>
              <div style={{fontSize:12,fontWeight:700,color:"#1e293b",marginBottom:4}}>🐙 GitHub</div>
              <div style={{fontSize:11,color:"#64748b",marginBottom:12,lineHeight:1.5}}>Check GitHub Releases for a new published version and download it in the background.</div>
              <button
                onClick={ghStatus==='ready'?()=>window.electronUpdater.restartAndInstall():checkGithub}
                disabled={ghStatus==='checking'||ghStatus==='downloading'}
                style={{width:"100%",padding:"8px 0",borderRadius:7,background:ghStatus==='checking'||ghStatus==='downloading'?"#94a3b8":ghStatus==='ready'?"#16a34a":ghStatus==='error'?"#dc2626":"#0284C7",color:"#fff",border:"none",fontWeight:700,fontSize:12,cursor:(ghStatus==='checking'||ghStatus==='downloading')?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}
              >
                {ghStatus==='checking'
                  ?<><span style={{display:"inline-block",width:11,height:11,border:"2px solid rgba(255,255,255,0.35)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>Checking…</>
                  :ghStatus==='downloading'
                  ?<><span style={{display:"inline-block",width:11,height:11,border:"2px solid rgba(255,255,255,0.35)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>Downloading…</>
                  :ghStatus==='ready'?`✅ Restart to install v${ghVersion}`
                  :ghStatus==='up-to-date'?'✓ Up to date'
                  :ghStatus==='error'?'↺ Retry'
                  :'Check for Updates'}
              </button>
              {ghStatus==='up-to-date'&&<div style={{marginTop:8,fontSize:11,color:"#16a34a"}}>You're on the latest version.</div>}
              {ghStatus==='downloading'&&<div style={{marginTop:8,fontSize:11,color:"#0284C7"}}>Downloading v{ghVersion} in background…</div>}
              {ghStatus==='error'&&<div style={{marginTop:8,fontSize:11,color:"#dc2626",wordBreak:"break-word"}}>{ghError||"Update check failed."}</div>}
            </div>

          </div>
        </div>
      )}

      {/* ── Security ── */}
      {authConfig!==undefined&&<SecuritySettingsSection authConfig={authConfig} onSave={onSaveAuthConfig}/>}

    </div>
  );
}

// ── Security Settings Section ─────────────────────────────────────────────────
function SecuritySettingsSection({authConfig,onSave}){
  const AC=(authConfig&&typeof authConfig==="object")?authConfig:{enabled:false};
  const [enabled,setEnabled]=useState(!!AC.enabled);
  const [phase,setPhase]=useState("idle"); // idle | setpin | bioEnroll | totpSetup | changePIN
  // PIN setup
  const [pinA,setPinA]=useState("");
  const [pinB,setPinB]=useState("");
  const [pinErr,setPinErr]=useState("");
  const [pinSaving,setPinSaving]=useState(false);
  // Biometric
  const [bioStatus,setBioStatus]=useState(AC.webauthnCredId?"enrolled":"none"); // none|enrolling|enrolled|error
  const [bioErr,setBioErr]=useState("");
  // TOTP
  const [totpSecret,setTotpSecret]=useState(AC.totpSecret||"");
  const [totpInput,setTotpInput]=useState("");
  const [totpVerified,setTotpVerified]=useState(false);
  const [totpErr,setTotpErr]=useState("");
  // Auto-lock
  const [autoLock,setAutoLock]=useState(AC.autoLockMinutes||0);

  const cfg=(patch)=>{const n={...AC,...patch};onSave(n);return n;};

  const toggleEnabled=async(val)=>{
    if(val&&!AC.pinHash){setPhase("setpin");return;}
    setEnabled(val);cfg({enabled:val});
  };

  // ─ PIN setup ─
  const savePIN=async()=>{
    if(pinA.length<4){setPinErr("PIN must be at least 4 digits");return;}
    if(pinA!==pinB){setPinErr("PINs don't match");return;}
    setPinSaving(true);setPinErr("");
    const salt=genSalt();
    const hash=await hashPin(pinA,salt);
    const n=cfg({pinHash:hash,pinSalt:salt,enabled:true});
    setEnabled(true);setPinA("");setPinB("");setPhase("idle");setPinSaving(false);
    onSave(n);
  };

  // ─ Biometric / WebAuthn ─
  const enrollBio=async()=>{
    setBioStatus("enrolling");setBioErr("");
    try{
      const challenge=crypto.getRandomValues(new Uint8Array(32));
      const cred=await navigator.credentials.create({publicKey:{
        challenge,
        rp:{name:"CashHeap",id:"localhost"},
        user:{id:new TextEncoder().encode("cashheap-user"),name:"cashheap",displayName:"CashHeap"},
        pubKeyCredParams:[{alg:-7,type:"public-key"},{alg:-257,type:"public-key"}],
        authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required",residentKey:"preferred"},
        timeout:60000,
      }});
      const credId=_b64ue(cred.rawId);
      cfg({webauthnCredId:credId,webauthnEnabled:true});
      setBioStatus("enrolled");setPhase("idle");
    }catch(e){
      setBioErr(e.name==="NotAllowedError"?"Cancelled.":`Error: ${e.message}`);
      setBioStatus(AC.webauthnCredId?"enrolled":"none");
    }
  };

  const removeBio=()=>{cfg({webauthnCredId:null,webauthnEnabled:false});setBioStatus("none");};

  // ─ TOTP ─
  const startTOTP=()=>{setTotpSecret(genTOTPSecret());setTotpInput("");setTotpVerified(false);setTotpErr("");setPhase("totpSetup");};
  const verifyAndSaveTOTP=async()=>{
    const now=await calcTOTP(totpSecret);
    const prev=await calcTOTP(totpSecret,Date.now()-30000);
    if(totpInput===now||totpInput===prev){
      cfg({totpSecret,totpEnabled:true});
      setTotpVerified(true);setPhase("idle");
    } else{setTotpErr("Incorrect code — try again");}
  };
  const disableTOTP=()=>{cfg({totpSecret:null,totpEnabled:false});setTotpSecret("");};

  const saveAutoLock=(v)=>{setAutoLock(v);cfg({autoLockMinutes:v});};

  const CA2={background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:"18px 20px"};
  const IS2={width:"100%",padding:"8px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"};

  return(
    <div style={{marginTop:20}}>
      <div style={{...CA2}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>🔒 Security &amp; App Lock</div>
            <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Protect CashHeap with a PIN, biometrics, or two-factor authentication.</div>
          </div>
          <button onClick={()=>toggleEnabled(!enabled)}
            style={{width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",background:enabled?"#0284C7":"#cbd5e1",position:"relative",transition:"background .2s",flexShrink:0}}>
            <span style={{position:"absolute",top:3,left:enabled?22:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
          </button>
        </div>

        {/* Set PIN prompt */}
        {phase==="setpin"&&(
          <div style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:"#1e293b",marginBottom:10}}>Create a PIN</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input type="password" inputMode="numeric" placeholder="PIN (4–6 digits)" maxLength={6} value={pinA} onChange={e=>setPinA(e.target.value.replace(/\D/g,""))} style={IS2}/>
              <input type="password" inputMode="numeric" placeholder="Confirm PIN" maxLength={6} value={pinB} onChange={e=>setPinB(e.target.value.replace(/\D/g,""))} style={IS2}/>
              {pinErr&&<div style={{color:"#dc2626",fontSize:11}}>{pinErr}</div>}
              <div style={{display:"flex",gap:8}}>
                <button onClick={savePIN} disabled={pinSaving} style={{flex:1,padding:"8px 0",background:"#0284C7",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{pinSaving?"Saving…":"Save PIN"}</button>
                <button onClick={()=>setPhase("idle")} style={{flex:1,padding:"8px 0",background:"#f1f5f9",color:"#374151",border:"none",borderRadius:8,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Change PIN */}
        {phase==="changePIN"&&(
          <div style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:"#1e293b",marginBottom:10}}>Change PIN</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input type="password" inputMode="numeric" placeholder="New PIN (4–6 digits)" maxLength={6} value={pinA} onChange={e=>setPinA(e.target.value.replace(/\D/g,""))} style={IS2}/>
              <input type="password" inputMode="numeric" placeholder="Confirm new PIN" maxLength={6} value={pinB} onChange={e=>setPinB(e.target.value.replace(/\D/g,""))} style={IS2}/>
              {pinErr&&<div style={{color:"#dc2626",fontSize:11}}>{pinErr}</div>}
              <div style={{display:"flex",gap:8}}>
                <button onClick={savePIN} disabled={pinSaving} style={{flex:1,padding:"8px 0",background:"#0284C7",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{pinSaving?"Saving…":"Update PIN"}</button>
                <button onClick={()=>setPhase("idle")} style={{flex:1,padding:"8px 0",background:"#f1f5f9",color:"#374151",border:"none",borderRadius:8,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* TOTP setup */}
        {phase==="totpSetup"&&(
          <div style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:"#1e293b",marginBottom:6}}>Set up Authenticator App</div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>Scan the QR code with Google Authenticator, Authy, or any TOTP app.</div>
            <div style={{textAlign:"center",marginBottom:12}}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`otpauth://totp/CashHeap?secret=${totpSecret}&issuer=CashHeap`)}`} alt="QR Code" style={{borderRadius:8,border:"3px solid #fff",boxShadow:"0 2px 8px rgba(0,0,0,0.1)"}}/>
              <div style={{marginTop:8,fontSize:10,color:"#64748b"}}>Or enter manually:</div>
              <div style={{marginTop:4,background:"#0f172a",borderRadius:6,padding:"8px 12px",fontFamily:"monospace",fontSize:12,color:"#a5f3fc",letterSpacing:1,wordBreak:"break-all"}}>{totpSecret}</div>
            </div>
            <input placeholder="Enter 6-digit code to verify" maxLength={6} value={totpInput} onChange={e=>setTotpInput(e.target.value.replace(/\D/g,""))} style={{...IS2,textAlign:"center",fontSize:20,letterSpacing:6,fontFamily:"monospace",marginBottom:8}}/>
            {totpErr&&<div style={{color:"#dc2626",fontSize:11,marginBottom:6}}>{totpErr}</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={verifyAndSaveTOTP} disabled={totpInput.length!==6} style={{flex:1,padding:"8px 0",background:totpInput.length===6?"#0284C7":"#94a3b8",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:totpInput.length===6?"pointer":"default",fontFamily:"inherit"}}>Verify &amp; Enable</button>
              <button onClick={()=>setPhase("idle")} style={{flex:1,padding:"8px 0",background:"#f1f5f9",color:"#374151",border:"none",borderRadius:8,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            </div>
          </div>
        )}

        {/* Main controls (when enabled) */}
        {enabled&&phase==="idle"&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>

            {/* PIN row */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"#f8fafc",borderRadius:8}}>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:"#1e293b"}}>🔑 PIN</div>
                <div style={{fontSize:11,color:"#64748b"}}>{AC.pinHash?"PIN is set":"No PIN configured"}</div>
              </div>
              <button onClick={()=>setPhase("changePIN")} style={{padding:"6px 14px",background:"#0284C7",color:"#fff",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                {AC.pinHash?"Change":"Set PIN"}
              </button>
            </div>

            {/* Biometric row */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"#f8fafc",borderRadius:8}}>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:"#1e293b"}}>👆 Biometrics</div>
                <div style={{fontSize:11,color:bioStatus==="enrolled"?"#16a34a":"#64748b"}}>
                  {bioStatus==="enrolled"?"Touch ID / Windows Hello enrolled":bioStatus==="enrolling"?"Enrolling…":"Not enrolled"}
                </div>
                {bioErr&&<div style={{fontSize:11,color:"#dc2626"}}>{bioErr}</div>}
              </div>
              {bioStatus==="enrolled"
                ?<button onClick={removeBio} style={{padding:"6px 14px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Remove</button>
                :<button onClick={enrollBio} disabled={bioStatus==="enrolling"} style={{padding:"6px 14px",background:"#0284C7",color:"#fff",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{bioStatus==="enrolling"?"…":"Enroll"}</button>
              }
            </div>

            {/* TOTP row */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"#f8fafc",borderRadius:8}}>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:"#1e293b"}}>📱 Two-Factor (TOTP)</div>
                <div style={{fontSize:11,color:AC.totpEnabled?"#16a34a":"#64748b"}}>{AC.totpEnabled?"Authenticator app enabled":"Not enabled"}</div>
              </div>
              {AC.totpEnabled
                ?<button onClick={disableTOTP} style={{padding:"6px 14px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Disable</button>
                :<button onClick={startTOTP} style={{padding:"6px 14px",background:"#0284C7",color:"#fff",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Set Up</button>
              }
            </div>

            {/* Auto-lock */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"#f8fafc",borderRadius:8}}>
              <div style={{fontSize:12,fontWeight:600,color:"#1e293b"}}>⏱ Auto-lock</div>
              <select value={autoLock} onChange={e=>saveAutoLock(Number(e.target.value))} style={{padding:"6px 10px",borderRadius:7,border:"1.5px solid #e2e8f0",fontSize:12,fontFamily:"inherit",outline:"none",background:"#fff",color:"#1e293b"}}>
                <option value={0}>On launch only</option>
                <option value={1}>After 1 minute</option>
                <option value={5}>After 5 minutes</option>
                <option value={15}>After 15 minutes</option>
                <option value={30}>After 30 minutes</option>
              </select>
            </div>

          </div>
        )}

        {!enabled&&phase==="idle"&&(
          <div style={{fontSize:11,color:"#94a3b8",textAlign:"center",padding:"8px 0"}}>Enable app lock to protect your financial data.</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA MODEL COMPONENT  (dev mode only)
// ─────────────────────────────────────────────────────────────────────────────
function DataModel({schema,onSave}){
  const [activeView,setActiveView]=useState(()=>Object.keys(schema.views)[0]);
  const [mode,setMode]=useState("visual"); // "visual" | "raw"
  const [rawText,setRawText]=useState(()=>JSON.stringify(schema,null,2));
  const [rawError,setRawError]=useState(null);
  const [editingDim,setEditingDim]=useState(null); // {viewKey, dimKey} or null
  const [editingMsr,setEditingMsr]=useState(null); // {viewKey, msrKey} or null
  const [dimForm,setDimForm]=useState({});
  const [msrForm,setMsrForm]=useState({});
  const [addingView,setAddingView]=useState(false);
  const [newViewForm,setNewViewForm]=useState({key:"",label:"",description:"",source:"",table:""});

  const views=schema.views;
  const vKeys=Object.keys(views);

  const saveRaw=()=>{
    try{const parsed=JSON.parse(rawText);onSave(parsed);setRawError(null);}
    catch(e){setRawError(e.message);}
  };

  const resetToDefault=()=>{
    onSave(DEFAULT_SCHEMA);
    setRawText(JSON.stringify(DEFAULT_SCHEMA,null,2));
    setActiveView(Object.keys(DEFAULT_SCHEMA.views)[0]);
  };

  // Edit dimension
  const startEditDim=(vk,dk)=>{
    setEditingDim({vk,dk});
    setDimForm({...views[vk].dimensions[dk],key:dk});
    setEditingMsr(null);
  };
  const saveDim=()=>{
    const{key,...rest}=dimForm;
    const v={...views[activeView]};
    const dims={...v.dimensions};
    if(editingDim.dk!==key){delete dims[editingDim.dk];}
    dims[key||editingDim.dk]=rest;
    v.dimensions=dims;
    onSave({...schema,views:{...views,[activeView]:v}});
    setEditingDim(null);
  };
  const deleteDim=(vk,dk)=>{
    const v={...views[vk]};
    const dims={...v.dimensions};
    delete dims[dk];
    v.dimensions=dims;
    onSave({...schema,views:{...views,[vk]:v}});
  };
  const addDim=()=>{
    const k=`new_dimension_${Date.now()}`;
    const v={...views[activeView]};
    v.dimensions={...v.dimensions,[k]:{type:"string",label:"New Dimension",description:"",field:""}};
    onSave({...schema,views:{...views,[activeView]:v}});
    startEditDim(activeView,k);
  };

  // Edit measure
  const startEditMsr=(vk,mk)=>{
    setEditingMsr({vk,mk});
    setMsrForm({...views[vk].measures[mk],key:mk});
    setEditingDim(null);
  };
  const saveMsr=()=>{
    const{key,...rest}=msrForm;
    const v={...views[activeView]};
    const msrs={...v.measures};
    if(editingMsr.mk!==key){delete msrs[editingMsr.mk];}
    msrs[key||editingMsr.mk]=rest;
    v.measures=msrs;
    onSave({...schema,views:{...views,[activeView]:v}});
    setEditingMsr(null);
  };
  const deleteMsr=(vk,mk)=>{
    const v={...views[vk]};
    const msrs={...v.measures};
    delete msrs[mk];
    v.measures=msrs;
    onSave({...schema,views:{...views,[vk]:v}});
  };
  const addMsr=()=>{
    const k=`new_measure_${Date.now()}`;
    const v={...views[activeView]};
    v.measures={...v.measures,[k]:{type:"sum",label:"New Measure",description:"",query:""}};
    onSave({...schema,views:{...views,[activeView]:v}});
    startEditMsr(activeView,k);
  };

  // Add view
  const saveNewView=()=>{
    if(!newViewForm.key.trim()||!newViewForm.source.trim())return;
    onSave({...schema,views:{...views,[newViewForm.key.trim()]:{label:newViewForm.label||newViewForm.key,description:newViewForm.description,source:newViewForm.source.trim(),table:newViewForm.table.trim()||newViewForm.source.trim(),dimensions:{},measures:{}}}});
    setActiveView(newViewForm.key.trim());
    setAddingView(false);
    setNewViewForm({key:"",label:"",description:"",source:""});
  };
  const deleteView=vk=>{
    const v={...views};delete v[vk];
    onSave({...schema,views:v});
    setActiveView(Object.keys(v)[0]||"");
  };

  const tv=views[activeView];
  const msrColor=t=>(MEASURE_TYPES.find(m=>m.v===t)||{color:"#94a3b8"}).color;

  // Field editors
  const DimEditor=()=>(
    <div style={{...CA,border:"2px solid #0284C7",marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:700,color:"#0284C7",marginBottom:12}}>Edit Dimension</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <Fld label="Key (field name)"><input style={IS} value={dimForm.key||""} onChange={e=>setDimForm(p=>({...p,key:e.target.value.replace(/\s/g,"_").toLowerCase()}))} placeholder="field_key"/></Fld>
        <Fld label="Label (display name)"><input style={IS} value={dimForm.label||""} onChange={e=>setDimForm(p=>({...p,label:e.target.value}))} placeholder="Field Label"/></Fld>
        <Fld label="Data Type"><select style={{...IS,background:"#fff"}} value={dimForm.type||"string"} onChange={e=>setDimForm(p=>({...p,type:e.target.value}))}>{DIM_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></Fld>
        <Fld label="Source Field (SQLite column)"><input style={IS} value={dimForm.field||""} onChange={e=>setDimForm(p=>({...p,field:e.target.value}))} placeholder="columnName in SQLite table"/></Fld>
      </div>
      <Fld label="Description"><input style={IS} value={dimForm.description||""} onChange={e=>setDimForm(p=>({...p,description:e.target.value}))} placeholder="What does this field represent?"/></Fld>
      <Fld label="SQL Expression (use ${TABLE} for the table reference, e.g. ${TABLE}.date or strftime('%Y-%m', ${TABLE}.date))">
        <input style={{...IS,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11}} value={dimForm.sql||""} onChange={e=>setDimForm(p=>({...p,sql:e.target.value}))} placeholder={"e.g. ${TABLE}.amount"}/>
      </Fld>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <Btn sm onClick={saveDim}>Save</Btn>
        <Btn sm v="secondary" onClick={()=>setEditingDim(null)}>Cancel</Btn>
      </div>
    </div>
  );

  const MsrEditor=()=>(
    <div style={{...CA,border:"2px solid #8b5cf6",marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:700,color:"#8b5cf6",marginBottom:12}}>Edit Measure</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <Fld label="Key"><input style={IS} value={msrForm.key||""} onChange={e=>setMsrForm(p=>({...p,key:e.target.value.replace(/\s/g,"_").toLowerCase()}))} placeholder="measure_key"/></Fld>
        <Fld label="Label"><input style={IS} value={msrForm.label||""} onChange={e=>setMsrForm(p=>({...p,label:e.target.value}))} placeholder="Measure Label"/></Fld>
        <Fld label="Type"><select style={{...IS,background:"#fff"}} value={msrForm.type||"sum"} onChange={e=>setMsrForm(p=>({...p,type:e.target.value}))}>{MEASURE_TYPES.map(m=><option key={m.v} value={m.v}>{m.l}</option>)}</select></Fld>
      </div>
      <Fld label="Description"><input style={IS} value={msrForm.description||""} onChange={e=>setMsrForm(p=>({...p,description:e.target.value}))} placeholder="What does this measure calculate?"/></Fld>
      <Fld label="Query (JavaScript — 'data' is the full SQLite dataset: txns, bills, vacations, holdings, expected, goals, accounts, billPayments, vacationTxns, accountHistory)">
        <textarea style={{...IS,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11,minHeight:64,resize:"vertical"}} value={msrForm.query||""} onChange={e=>setMsrForm(p=>({...p,query:e.target.value}))} placeholder={"e.g. data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)"}/>
      </Fld>
      <Fld label="SQL Expression (use ${TABLE} for the table reference, e.g. SUM(${TABLE}.amount) or COUNT(*))">
        <input style={{...IS,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11}} value={msrForm.sql||""} onChange={e=>setMsrForm(p=>({...p,sql:e.target.value}))} placeholder={"e.g. SUM(${TABLE}.amount)"}/>
      </Fld>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <Btn sm onClick={saveMsr}>Save</Btn>
        <Btn sm v="secondary" onClick={()=>setEditingMsr(null)}>Cancel</Btn>
      </div>
    </div>
  );

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Data Model</h2>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>Define views, dimensions, and measures for your AI agent</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",background:"#f1f5f9",borderRadius:8,padding:2}}>
            {["visual","raw"].map(m=>(
              <button key={m} onClick={()=>{setMode(m);if(m==="raw")setRawText(JSON.stringify(schema,null,2));}} style={{padding:"5px 14px",borderRadius:6,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit",background:mode===m?"#fff":"transparent",color:mode===m?"#0284C7":"#64748b",boxShadow:mode===m?"0 1px 3px rgba(0,0,0,0.1)":"none",transition:"all .15s"}}>
                {m==="visual"?"Visual":"Raw JSON"}
              </button>
            ))}
          </div>
          <button onClick={resetToDefault} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #fde68a",background:"#fefce8",color:"#92400e",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>↺ Reset to Default</button>
        </div>
      </div>

      {mode==="raw"?(
        <div style={CA}>
          <div style={{fontSize:12,fontWeight:600,color:"#1E293B",marginBottom:8}}>Schema JSON</div>
          {rawError&&<div style={{fontSize:12,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"7px 12px",marginBottom:10}}>JSON Error: {rawError}</div>}
          <textarea style={{width:"100%",minHeight:500,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11,padding:14,borderRadius:10,border:"1.5px solid #e2e8f0",background:"#0f172a",color:"#a5f3fc",lineHeight:1.6,boxSizing:"border-box",resize:"vertical"}} value={rawText} onChange={e=>setRawText(e.target.value)}/>
          <Btn onClick={saveRaw} full style={{marginTop:10}}>Apply JSON</Btn>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:16,alignItems:"start"}}>

          {/* View sidebar */}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4,paddingLeft:4}}>Views</div>
            {vKeys.map(vk=>(
              <button key={vk} onClick={()=>{setActiveView(vk);setEditingDim(null);setEditingMsr(null);}} style={{textAlign:"left",padding:"10px 12px",borderRadius:10,border:"1.5px solid "+(activeView===vk?"#0284C7":"#e2e8f0"),background:activeView===vk?"#eff6ff":"#fff",cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
                <div style={{fontWeight:600,fontSize:12,color:activeView===vk?"#0284C7":"#1E293B"}}>{views[vk].label}</div>
                <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>source: <code style={{fontSize:10}}>{views[vk].source}</code></div>
                {views[vk].table&&<div style={{fontSize:10,color:"#94a3b8"}}>table: <code style={{fontSize:10}}>{views[vk].table}</code></div>}
                <div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>{Object.keys(views[vk].dimensions||{}).length}d · {Object.keys(views[vk].measures||{}).length}m</div>
              </button>
            ))}
            {addingView?(
              <div style={{...CA,padding:12}}>
                <Fld label="Key"><input style={IS} value={newViewForm.key} onChange={e=>setNewViewForm(p=>({...p,key:e.target.value.replace(/\s/g,"_").toLowerCase()}))} placeholder="view_key" autoFocus/></Fld>
                <Fld label="Label"><input style={IS} value={newViewForm.label} onChange={e=>setNewViewForm(p=>({...p,label:e.target.value}))} placeholder="Display Name"/></Fld>
                <Fld label="Source (SQLite table key)"><input style={IS} value={newViewForm.source} onChange={e=>setNewViewForm(p=>({...p,source:e.target.value}))} placeholder="e.g. txns, bills, vacations, holdings"/></Fld>
                <Fld label="SQLite Table Name"><input style={IS} value={newViewForm.table} onChange={e=>setNewViewForm(p=>({...p,table:e.target.value}))} placeholder="e.g. transactions, bills, vacation_txns"/></Fld>
                <Fld label="Description"><input style={IS} value={newViewForm.description} onChange={e=>setNewViewForm(p=>({...p,description:e.target.value}))} placeholder="What is this view?"/></Fld>
                <div style={{display:"flex",gap:6,marginTop:8}}>
                  <Btn sm onClick={saveNewView}>Add</Btn>
                  <Btn sm v="secondary" onClick={()=>setAddingView(false)}>Cancel</Btn>
                </div>
              </div>
            ):(
              <button onClick={()=>setAddingView(true)} style={{padding:"8px 12px",borderRadius:10,border:"1.5px dashed #cbd5e1",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:11,fontFamily:"inherit",textAlign:"center"}}>+ Add View</button>
            )}
          </div>

          {/* View detail */}
          {tv&&(
            <div>
              <div style={{...CA,marginBottom:16}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15,color:"#1E293B"}}>{tv.label}</div>
                    <div style={{fontSize:12,color:"#64748b",marginTop:3}}>{tv.description}</div>
                    <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>data source: <code style={{background:"#f1f5f9",padding:"1px 6px",borderRadius:4,fontSize:11}}>data.{tv.source}[ ]</code></div>
                  </div>
                  <button onClick={()=>deleteView(activeView)} style={{background:"none",border:"1px solid #fecaca",borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit",flexShrink:0,marginTop:2}}>Delete View</button>
                </div>
              </div>

              {/* Dimensions */}
              <div style={{...CA,marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>Dimensions <span style={{fontSize:11,color:"#94a3b8",fontWeight:400}}>— raw fields from the data</span></div>
                  <button onClick={addDim} style={{padding:"4px 12px",borderRadius:8,border:"1.5px solid #bae6fd",background:"#f0f9ff",color:"#0284C7",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>+ Add</button>
                </div>
                {editingDim?.vk===activeView&&<DimEditor/>}
                {Object.entries(tv.dimensions||{}).map(([dk,d])=>(
                  <div key={dk} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 0",borderBottom:"1px solid #f1f5f9"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                        <span style={{fontWeight:600,fontSize:12,color:"#1E293B"}}>{d.label}</span>
                        <code style={{fontSize:10,background:"#f1f5f9",padding:"1px 6px",borderRadius:4,color:"#64748b"}}>{dk}</code>
                        <span style={{fontSize:10,fontWeight:600,background:"#ede9fe",color:"#7c3aed",padding:"1px 6px",borderRadius:10}}>{d.type}</span>
                      </div>
                      <div style={{fontSize:11,color:"#64748b"}}>{d.description}</div>
                      <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>field: <code style={{fontSize:10}}>{d.field}</code></div>
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button onClick={()=>startEditDim(activeView,dk)} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
                      <button onClick={()=>deleteDim(activeView,dk)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Measures */}
              <div style={CA}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>Measures <span style={{fontSize:11,color:"#94a3b8",fontWeight:400}}>— calculations over the data</span></div>
                  <button onClick={addMsr} style={{padding:"4px 12px",borderRadius:8,border:"1.5px solid #ede9fe",background:"#faf5ff",color:"#7c3aed",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>+ Add</button>
                </div>
                {editingMsr?.vk===activeView&&<MsrEditor/>}
                {Object.entries(tv.measures||{}).map(([mk,m])=>(
                  <div key={mk} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 0",borderBottom:"1px solid #f1f5f9"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                        <span style={{fontWeight:600,fontSize:12,color:"#1E293B"}}>{m.label}</span>
                        <code style={{fontSize:10,background:"#f1f5f9",padding:"1px 6px",borderRadius:4,color:"#64748b"}}>{mk}</code>
                        <span style={{fontSize:10,fontWeight:700,background:msrColor(m.type)+"22",color:msrColor(m.type),padding:"1px 8px",borderRadius:10,border:`1px solid ${msrColor(m.type)}44`}}>{m.type}</span>
                      </div>
                      <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>{m.description}</div>
                      <code style={{fontSize:10,background:"#0f172a",color:"#a5f3fc",padding:"4px 8px",borderRadius:6,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.query}</code>
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button onClick={()=>startEditMsr(activeView,mk)} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
                      <button onClick={()=>deleteMsr(activeView,mk)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INSIGHTS & ANALYTICS  — agent-powered chart builder
// ─────────────────────────────────────────────────────────────────────────────

// Parse <tool>{...}</tool> blocks from LLM text
function parseToolCalls(text){
  const out=[];
  const re=/<tool>([\s\S]*?)<\/tool>/g;
  let m;
  while((m=re.exec(text))!==null){
    try{out.push(JSON.parse(m[1].trim()));}catch{}
  }
  return out;
}

function InsightWidget({w,onRemove}){
  const CHART_H=220;
  const colors=COLORS;
  const fmtVal=(v,fmt_)=>{
    if(fmt_==="currency")return fmt(Number(v));
    if(fmt_==="percent")return Number(v).toFixed(1)+"%";
    if(typeof v==="number")return Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
    return String(v);
  };
  return(
    <div style={{...CA,position:"relative",padding:"16px 18px"}}>
      <button onClick={()=>onRemove(w.id)} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",fontSize:15,color:"#cbd5e1",lineHeight:1,zIndex:2,fontFamily:"inherit"}}>×</button>
      {w.title&&<div style={{fontSize:12,fontWeight:600,color:"#64748b",marginBottom:10,paddingRight:24}}>{fmtLabel(w.title)}</div>}

      {w.type==="metric"&&(
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <div style={{fontSize:34,fontWeight:800,color:"#0284C7",letterSpacing:"-1.5px",lineHeight:1}}>{fmtVal(w.value,w.format)}</div>
          {w.label&&<div style={{fontSize:12,color:"#94a3b8",fontWeight:500}}>{w.label}</div>}
        </div>
      )}

      {w.type==="bar"&&(
        <ResponsiveContainer width="100%" height={CHART_H}>
          <BarChart data={w.data} margin={{top:4,right:4,left:0,bottom:30}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey={w.xKey||"name"} tick={{fontSize:10}} angle={-30} textAnchor="end" interval={0}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>w.format==="currency"?("$"+Math.round(v)):v}/>
            <Tooltip formatter={(v)=>fmtVal(v,w.format)} contentStyle={{borderRadius:8,fontSize:12}}/>
            {(w.multiKeys||[w.yKey||"value"]).map((k,i)=>(
              <Bar key={k} dataKey={k} fill={w.colors?.[i]||w.color||colors[i%colors.length]} radius={[4,4,0,0]}>
                {!w.multiKeys&&w.data.map((_,ci)=><Cell key={ci} fill={w.color||colors[ci%colors.length]}/>)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {w.type==="line"&&(
        <ResponsiveContainer width="100%" height={CHART_H}>
          <LineChart data={w.data} margin={{top:4,right:4,left:0,bottom:20}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey={w.xKey||"name"} tick={{fontSize:10}}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>w.format==="currency"?("$"+Math.round(v)):v}/>
            <Tooltip formatter={(v)=>fmtVal(v,w.format)} contentStyle={{borderRadius:8,fontSize:12}}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            {(w.multiKeys||[w.yKey||"value"]).map((k,i)=>(
              <Line key={k} type="monotone" dataKey={k} stroke={w.colors?.[i]||w.color||colors[i%colors.length]} strokeWidth={2} dot={false}/>
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {w.type==="area"&&(
        <ResponsiveContainer width="100%" height={CHART_H}>
          <AreaChart data={w.data} margin={{top:4,right:4,left:0,bottom:20}}>
            <defs>
              {(w.multiKeys||[w.yKey||"value"]).map((k,i)=>(
                <linearGradient key={k} id={`ag${w.id}${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={w.colors?.[i]||w.color||colors[i%colors.length]} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={w.colors?.[i]||w.color||colors[i%colors.length]} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey={w.xKey||"name"} tick={{fontSize:10}}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>w.format==="currency"?("$"+Math.round(v)):v}/>
            <Tooltip formatter={(v)=>fmtVal(v,w.format)} contentStyle={{borderRadius:8,fontSize:12}}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            {(w.multiKeys||[w.yKey||"value"]).map((k,i)=>(
              <Area key={k} type="monotone" dataKey={k} stroke={w.colors?.[i]||w.color||colors[i%colors.length]} strokeWidth={2} fill={`url(#ag${w.id}${i})`}/>
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {w.type==="pie"&&(
        <ResponsiveContainer width="100%" height={320}>
          <PieChart margin={{top:20,right:90,bottom:20,left:90}}>
            <Pie
              data={w.data}
              dataKey={w.yKey||"value"}
              nameKey={w.xKey||"name"}
              cx="50%" cy="50%"
              outerRadius={75}
              paddingAngle={2}
              labelLine={{stroke:"#94a3b8",strokeWidth:1}}
              label={({name,percent,x,y,textAnchor})=>{
                if(percent<0.05) return <text/>;
                const short=name.length>9?name.slice(0,9)+"…":name;
                return(
                  <text x={x} y={y} textAnchor={textAnchor} fill="#374151" fontSize={11} fontFamily="system-ui,sans-serif">
                    {`${short} ${(percent*100).toFixed(0)}%`}
                  </text>
                );
              }}
            >
              {(w.data||[]).map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}
            </Pie>
            <Tooltip formatter={(v)=>fmtVal(v,w.format)} contentStyle={{borderRadius:8,fontSize:12}}/>
            <Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>
          </PieChart>
        </ResponsiveContainer>
      )}

      {w.type==="table"&&(
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>{(w.columns||[]).map(c=><th key={c} style={{textAlign:"left",padding:"6px 10px 6px 0",color:"#94a3b8",fontWeight:600,borderBottom:"1px solid #f1f5f9",whiteSpace:"nowrap"}}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {(w.rows||[]).map((row,i)=>(
                <tr key={i} style={{borderBottom:"1px solid #f8fafc"}}>
                  {row.map((cell,j)=><td key={j} style={{padding:"6px 10px 6px 0",color:"#374151"}}>{typeof cell==="number"&&w.format==="currency"?fmtVal(cell,"currency"):String(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Simple markdown-lite renderer for assistant responses
function RenderMD({text}){
  if(!text) return null;
  const parseBold=str=>{
    const parts=str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p,i)=>p.startsWith("**")&&p.endsWith("**")?<strong key={i} style={{fontWeight:700}}>{p.slice(2,-2)}</strong>:p);
  };
  const lines=text.split("\n");
  const out=[];
  let listItems=[];
  let keyIdx=0;
  const k=()=>keyIdx++;
  const flushList=()=>{
    if(!listItems.length) return;
    const items=[...listItems]; listItems=[];
    out.push(<ul key={k()} style={{margin:"6px 0 6px 4px",paddingLeft:16,display:"flex",flexDirection:"column",gap:3}}>{items.map((li,i)=><li key={i} style={{fontSize:13,color:"#1E293B",lineHeight:1.55}}>{parseBold(li)}</li>)}</ul>);
  };
  lines.forEach(line=>{
    const t=line.trim();
    if(!t){flushList();return;}
    if(t.startsWith("### ")){flushList();out.push(<div key={k()} style={{fontSize:13,fontWeight:700,color:"#0284C7",marginTop:8,marginBottom:2}}>{t.slice(4)}</div>);return;}
    if(t.startsWith("## ")){flushList();out.push(<div key={k()} style={{fontSize:15,fontWeight:800,color:"#0f172a",marginTop:10,marginBottom:4}}>{t.slice(3)}</div>);return;}
    if(t.startsWith("# ")){flushList();out.push(<div key={k()} style={{fontSize:17,fontWeight:800,color:"#0f172a",marginTop:10,marginBottom:6}}>{t.slice(2)}</div>);return;}
    if(t.startsWith("- ")||t.startsWith("* ")){listItems.push(t.slice(2));return;}
    if(/^\d+\.\s/.test(t)){listItems.push(t.replace(/^\d+\.\s/,""));return;}
    flushList();
    out.push(<p key={k()} style={{margin:"2px 0",fontSize:13,color:"#1E293B",lineHeight:1.6}}>{parseBold(t)}</p>);
  });
  flushList();
  return <div style={{display:"flex",flexDirection:"column"}}>{out}</div>;
}

// Format a snake_case or raw query id into a readable label
function fmtLabel(s){
  return s.replace(/[_-]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

// Detect preferred chart type from a user message string
function detectChartType(msg){
  const m=(msg||"").toLowerCase();
  if(m.includes("pie")) return "pie";
  if(m.includes("line")) return "line";
  if(m.includes("area")) return "area";
  if(m.includes("bar")) return "bar";
  if(m.includes("table")) return "table";
  return null; // no preference — autoWidget picks best
}

// Auto-generate a widget from a raw query result
function autoWidget(id,label,result,preferredType){
  label=fmtLabel(label);
  if(result===null||result===undefined) return null;
  // Plain number → always metric regardless of preference
  if(typeof result==="number"){
    const isCurrency=/(spend|income|total|amount|balance|value|paid|net|bill|cost|price)/i.test(label);
    return{id:uid(),type:"metric",title:label,value:result,format:isCurrency?"currency":"number"};
  }
  // Normalise plain object → array
  let data=null;
  if(typeof result==="object"&&!Array.isArray(result)){
    const entries=Object.entries(result);
    if(entries.length>0&&entries.every(([,v])=>typeof v==="number")){
      data=entries.map(([k,v])=>({name:k,value:v}));
    }
  }
  if(!data&&Array.isArray(result)&&result.length>0){
    if(typeof result[0]==="object"&&result[0]!==null){
      const keys=Object.keys(result[0]);
      const numKey=keys.find(k=>typeof result[0][k]==="number");
      const strKey=keys.find(k=>typeof result[0][k]==="string");
      if(numKey&&strKey){
        data=result.slice(0,20).map(r=>({name:String(r[strKey]),value:r[numKey]}));
      } else {
        // table fallback
        return{id:uid(),type:"table",title:label,columns:keys,rows:result.slice(0,20).map(r=>keys.map(k=>r[k]??"")),format:"currency"};
      }
    } else if(typeof result[0]==="number"){
      data=result.map((v,i)=>({name:String(i+1),value:v}));
    }
  }
  if(!data) return null;
  // Apply preferred type or fall back to sensible defaults
  const chartType=preferredType||(data.length<=8?"pie":"bar");
  if(chartType==="table"){
    return{id:uid(),type:"table",title:label,columns:["Category","Amount"],rows:data.map(d=>[d.name,d.value]),format:"currency"};
  }
  return{id:uid(),type:chartType,title:label,data,xKey:"name",yKey:"value",format:"currency"};
}

function Insights({schema,settings,onNavigate,widgets,onSetWidgets,messages,onSetMessages}){
  const setMessages = onSetMessages;
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const chatEndRef=useRef(null);
  const inputRef=useRef(null);

  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);

  // ─── Tool library: named functions the LLM can call by name + params ──────────
  // The LLM never writes JavaScript — it just picks a tool name and fills params.
  // _df and _label are imported from ./utils/dateUtils.js

  // Helper: wrap a SQL string in the __SQL__: marker that executeTool/preloaded runner detect
  const _sql=(sqlStr,params=[])=>`__SQL__:${JSON.stringify({sql:sqlStr,params})}`;

  // All expenses = regular transactions + vacation_txns (both count as spending)
  // Returns a SQL subquery alias usable anywhere you'd write "FROM transactions WHERE type='expense'"
  const _allExp=(df='1=1')=>
    `(SELECT amount,date,COALESCE(category,'Other') as category,COALESCE(merchant,'?') as merchant FROM transactions WHERE type='expense' AND ${df} `+
    `UNION ALL `+
    `SELECT amount,date,COALESCE(category,'Vacation') as category,COALESCE(merchant,'?') as merchant FROM vacation_txns WHERE ${df})`;

  const TOOL_LIBRARY={
    // ── Spending & Income ──────────────────────────────────────────────────────
    // expenses(month?|from?,to?) — total expenses including vacation spending
    expenses:(args={})=>{
      const df=_sqlDf(args);
      return _sql(`SELECT ROUND(COALESCE(SUM(amount),0),2) as value FROM ${_allExp(df)}`);
    },
    // income(month?|from?,to?) — total income
    income:(args={})=>{
      const df=_sqlDf(args);
      return _sql(`SELECT ROUND(COALESCE(SUM(amount),0),2) as value FROM transactions WHERE type='income' AND ${df}`);
    },
    // net(month?|from?,to?) — income minus all expenses (including vacation)
    net:(args={})=>{
      const df=_sqlDf(args);
      return _sql(`SELECT ROUND(COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0),2) as value FROM (SELECT amount,date,'income' as type FROM transactions WHERE type='income' AND ${df} UNION ALL SELECT amount,date,'expense' as type FROM ${_allExp(df)})`);
    },
    // categories(month?|from?,to?) — expense totals grouped by category (includes vacation)
    categories:(args={})=>{
      const df=_sqlDf(args);
      return _sql(`SELECT category as name, ROUND(SUM(amount),2) as value FROM ${_allExp(df)} GROUP BY category ORDER BY value DESC`);
    },
    // top_category(month?|from?,to?) — single highest-spend category
    top_category:(args={})=>{
      const df=_sqlDf(args);
      return _sql(`SELECT category as name, ROUND(SUM(amount),2) as value FROM ${_allExp(df)} GROUP BY category ORDER BY value DESC LIMIT 1`);
    },
    // monthly(months?|from?,to?) — income & expenses per month (expenses include vacation)
    monthly:(args={})=>{
      const n=args.months||99;
      const df=_sqlDf(args);
      return _sql(`SELECT mo as name, ROUND(Income,2) as Income, ROUND(Expenses,2) as Expenses FROM (SELECT strftime('%Y-%m',date) as mo, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as Income, 0 as Expenses FROM transactions WHERE ${df} GROUP BY mo UNION ALL SELECT strftime('%Y-%m',date) as mo, 0 as Income, SUM(amount) as Expenses FROM ${_allExp(df)} GROUP BY mo) GROUP BY mo ORDER BY mo LIMIT ${n}`);
    },
    // bills(type?) — "total"=sum, default=list [{name,value}]
    bills:(args={})=>{
      if(args.type==="total") return _sql(`SELECT ROUND(COALESCE(SUM(amount),0),2) as value FROM bills WHERE active=1`);
      return _sql(`SELECT name, amount as value FROM bills WHERE active=1 ORDER BY amount DESC`);
    },
    // portfolio(type?) — cost-basis total or holdings list (live price not in DB)
    portfolio:(args={})=>{
      if(args.type==="total") return _sql(`SELECT ROUND(COALESCE(SUM(costBasis*shares),0),2) as value FROM holdings WHERE costBasis IS NOT NULL`);
      return _sql(`SELECT ticker as name, ROUND(costBasis*shares,2) as value, shares, costBasis FROM holdings WHERE costBasis IS NOT NULL ORDER BY value DESC`);
    },
    // merchants(month?|from?,to?, limit?) — top merchants by spend (includes vacation)
    merchants:(args={})=>{
      const df=_sqlDf(args);
      const n=args.limit||10;
      return _sql(`SELECT merchant as name, ROUND(SUM(amount),2) as value FROM ${_allExp(df)} GROUP BY merchant ORDER BY value DESC LIMIT ${n}`);
    },
    // transactions(month?|from?,to?, limit?) — recent transactions list
    transactions:(args={})=>{
      const df=_sqlDf(args);
      const n=args.limit||10;
      return _sql(`SELECT COALESCE(merchant,'?')||' ('||date||')' as name, amount as value, type, category FROM transactions WHERE ${df} ORDER BY date DESC LIMIT ${n}`);
    },

    // ── Expected Income ────────────────────────────────────────────────────────
    // pending_income(month?|from?,to?) — unconfirmed expected income items
    pending_income:(args={})=>{
      const df=_sqlDf(args,'expectedDate');
      return _sql(`SELECT source as name, amount as value, expectedDate as date FROM expected_income WHERE confirmed=0 AND ${df} ORDER BY expectedDate`);
    },
    // confirmed_income(month?|from?,to?) — confirmed received payments
    confirmed_income:(args={})=>{
      const df=_sqlDf(args,'expectedDate');
      return _sql(`SELECT source as name, amount as value, COALESCE(confirmedDate,expectedDate) as date FROM expected_income WHERE confirmed=1 AND ${df} ORDER BY expectedDate`);
    },
    // all_expected_income(month?|from?,to?) — all expected income with confirmation status
    all_expected_income:(args={})=>{
      const df=_sqlDf(args,'expectedDate');
      return _sql(`SELECT source as name, amount as value, expectedDate, confirmed, confirmedDate FROM expected_income WHERE ${df} ORDER BY expectedDate`);
    },

    // ── Budgets ────────────────────────────────────────────────────────────────
    // budgets() — all category budgets
    budgets:()=>_sql(`SELECT category as name, budget as value FROM cat_budgets ORDER BY budget DESC`),
    // budget_vs_actual(month?|from?,to?) — category budget vs actual spend (includes vacation)
    budget_vs_actual:(args={})=>{
      const df=_sqlDf(args);
      return _sql(`SELECT cb.category as name, cb.budget, ROUND(COALESCE(t.spent,0),2) as spent, ROUND(cb.budget-COALESCE(t.spent,0),2) as remaining, CASE WHEN cb.budget>0 THEN ROUND(COALESCE(t.spent,0)*100.0/cb.budget,1) ELSE NULL END as percentUsed FROM cat_budgets cb LEFT JOIN (SELECT category as cat, SUM(amount) as spent FROM ${_allExp(df)} GROUP BY cat) t ON t.cat=cb.category ORDER BY percentUsed DESC NULLS LAST`);
    },
    // budget_remaining(category, month?|from?,to?) — remaining budget for one category
    budget_remaining:(args={})=>{
      const cat=(args.category||"").replace(/'/g,"''");
      const df=_sqlDf(args);
      return _sql(`SELECT cb.category, cb.budget, ROUND(COALESCE(t.spent,0),2) as spent, ROUND(cb.budget-COALESCE(t.spent,0),2) as remaining, CASE WHEN cb.budget>0 THEN ROUND(COALESCE(t.spent,0)*100.0/cb.budget,1) ELSE NULL END as percentUsed FROM cat_budgets cb LEFT JOIN (SELECT SUM(amount) as spent FROM ${_allExp(df)} WHERE category='${cat}') t ON 1=1 WHERE cb.category='${cat}'`);
    },
    // over_budget(month?|from?,to?) — categories where actual spend exceeds budget (includes vacation)
    over_budget:(args={})=>{
      const df=_sqlDf(args);
      return _sql(`SELECT cb.category as name, cb.budget, ROUND(t.spent,2) as spent, ROUND(t.spent-cb.budget,2) as over FROM cat_budgets cb JOIN (SELECT category as cat, SUM(amount) as spent FROM ${_allExp(df)} GROUP BY cat) t ON t.cat=cb.category WHERE t.spent>cb.budget ORDER BY over DESC`);
    },

    // ── Bills ─────────────────────────────────────────────────────────────────
    // bills_due(month?) — bills not yet paid this month
    bills_due:(args={})=>{
      const m=args.month||new Date().toISOString().slice(0,7);
      return _sql(`SELECT b.name, b.amount as value, b.dueDay, b.category FROM bills b WHERE b.active=1 AND b.id NOT IN (SELECT billId FROM bill_payments WHERE month='${m}') ORDER BY b.dueDay`);
    },
    // bills_paid(month?) — bills paid this month
    bills_paid:(args={})=>{
      const m=args.month||new Date().toISOString().slice(0,7);
      return _sql(`SELECT b.name, b.amount as value, b.dueDay FROM bills b WHERE b.active=1 AND b.id IN (SELECT billId FROM bill_payments WHERE month='${m}') ORDER BY b.dueDay`);
    },

    // ── Holdings / Portfolio ───────────────────────────────────────────────────
    // holdings_detail() — each holding with shares, cost basis, total cost
    holdings_detail:()=>_sql(`SELECT ticker as name, shares, costBasis, ROUND(costBasis*shares,2) as totalCost FROM holdings ORDER BY totalCost DESC NULLS LAST`),
    // portfolio_gain() — total portfolio cost basis (market price not stored in DB)
    portfolio_gain:()=>_sql(`SELECT ROUND(COALESCE(SUM(costBasis*shares),0),2) as totalCost, COUNT(*) as holdings, ROUND(AVG(costBasis),2) as avgCostBasis FROM holdings WHERE costBasis IS NOT NULL`),
    // holding(ticker) — detail for one ticker
    holding:(args={})=>{
      const t=(args.ticker||"").replace(/'/g,"''");
      return _sql(`SELECT ticker, shares, costBasis, ROUND(costBasis*shares,2) as totalCost FROM holdings WHERE UPPER(ticker)=UPPER('${t}') LIMIT 1`);
    },

    // ── Vacations ─────────────────────────────────────────────────────────────
    // vacations() — all vacations with dates and budgets
    vacations:()=>_sql(`SELECT name, startDate, endDate, budget FROM vacations ORDER BY startDate`),
    // vacation_spending(name) — budget vs actual spend for a named vacation
    vacation_spending:(args={})=>{
      const name=(args.name||"").replace(/'/g,"''");
      return _sql(`SELECT v.name, v.startDate, v.endDate, v.budget, ROUND(COALESCE(SUM(vt.amount),0),2) as spent, ROUND(v.budget-COALESCE(SUM(vt.amount),0),2) as remaining FROM vacations v LEFT JOIN vacation_txns vt ON vt.vacationId=v.id WHERE LOWER(v.name) LIKE LOWER('%${name}%') GROUP BY v.id ORDER BY v.startDate`);
    },

    // ── Account History ────────────────────────────────────────────────────────
    // account_balance() — most recent balance snapshot
    account_balance:()=>_sql(`SELECT date, balance as value FROM account_history ORDER BY date DESC LIMIT 1`),
    // balance_history(from?,to?) — all balance snapshots ordered by date
    balance_history:(args={})=>{
      const df=_sqlDf(args);
      return _sql(`SELECT date as name, balance as value FROM account_history WHERE ${df} ORDER BY date`);
    },

    // ── Transactions (extended) ────────────────────────────────────────────────
    // txns_by_category(category, month?|from?,to?) — all transactions in a category (includes vacation)
    txns_by_category:(args={})=>{
      const cat=(args.category||"").replace(/'/g,"''");
      const df=_sqlDf(args);
      return _sql(`SELECT merchant||' ('||date||')' as name, amount as value, category FROM ${_allExp(df)} WHERE category='${cat}' ORDER BY date DESC`);
    },
    // txns_by_merchant(merchant, month?|from?,to?) — all transactions from a merchant (includes vacation)
    txns_by_merchant:(args={})=>{
      const merch=(args.merchant||"").replace(/'/g,"''");
      const df=_sqlDf(args);
      return _sql(`SELECT merchant||' ('||date||')' as name, amount as value FROM ${_allExp(df)} WHERE LOWER(merchant) LIKE LOWER('%${merch}%') ORDER BY date DESC`);
    },
    // largest_expenses(month?|from?,to?, limit?) — top N expenses (includes vacation)
    largest_expenses:(args={})=>{
      const df=_sqlDf(args);
      const n=args.limit||10;
      return _sql(`SELECT merchant||' ('||date||')' as name, amount as value, category FROM ${_allExp(df)} ORDER BY amount DESC LIMIT ${n}`);
    },

    // ── Math / Comparison tools ────────────────────────────────────────────────
    // compare_expenses(month1, month2) — {month1,value1,month2,value2,change,changePercent}
    compare_expenses:(args={})=>{
      const m1=args.month1||new Date().toISOString().slice(0,7);
      const m2=args.month2||new Date().toISOString().slice(0,7);
      const src=_allExp(`strftime('%Y-%m',date) IN ('${m1}','${m2}')`);
      return _sql(`WITH v AS (SELECT ROUND(SUM(CASE WHEN strftime('%Y-%m',date)='${m1}' THEN amount ELSE 0 END),2) as value1, ROUND(SUM(CASE WHEN strftime('%Y-%m',date)='${m2}' THEN amount ELSE 0 END),2) as value2 FROM ${src}) SELECT '${m1}' as month1, value1, '${m2}' as month2, value2, ROUND(value2-value1,2) as change, CASE WHEN value1!=0 THEN ROUND((value2-value1)*100.0/ABS(value1),1) ELSE NULL END as changePercent FROM v`);
    },
    // compare_income(month1, month2) — same shape for income
    compare_income:(args={})=>{
      const m1=args.month1||new Date().toISOString().slice(0,7);
      const m2=args.month2||new Date().toISOString().slice(0,7);
      return _sql(`WITH v AS (SELECT ROUND(SUM(CASE WHEN strftime('%Y-%m',date)='${m1}' THEN amount ELSE 0 END),2) as value1, ROUND(SUM(CASE WHEN strftime('%Y-%m',date)='${m2}' THEN amount ELSE 0 END),2) as value2 FROM transactions WHERE type='income' AND strftime('%Y-%m',date) IN ('${m1}','${m2}')) SELECT '${m1}' as month1, value1, '${m2}' as month2, value2, ROUND(value2-value1,2) as change, CASE WHEN value1!=0 THEN ROUND((value2-value1)*100.0/ABS(value1),1) ELSE NULL END as changePercent FROM v`);
    },
    // compare_net(month1, month2) — net position comparison (expenses include vacation)
    compare_net:(args={})=>{
      const m1=args.month1||new Date().toISOString().slice(0,7);
      const m2=args.month2||new Date().toISOString().slice(0,7);
      const src=_allExp(`strftime('%Y-%m',date) IN ('${m1}','${m2}')`);
      return _sql(`WITH inc AS (SELECT strftime('%Y-%m',date) as mo, SUM(amount) as total FROM transactions WHERE type='income' AND strftime('%Y-%m',date) IN ('${m1}','${m2}') GROUP BY mo), exp AS (SELECT strftime('%Y-%m',date) as mo, SUM(amount) as total FROM ${src} GROUP BY mo), v AS (SELECT ROUND(COALESCE((SELECT total FROM inc WHERE mo='${m1}'),0)-COALESCE((SELECT total FROM exp WHERE mo='${m1}'),0),2) as value1, ROUND(COALESCE((SELECT total FROM inc WHERE mo='${m2}'),0)-COALESCE((SELECT total FROM exp WHERE mo='${m2}'),0),2) as value2) SELECT '${m1}' as month1, value1, '${m2}' as month2, value2, ROUND(value2-value1,2) as change, CASE WHEN value1!=0 THEN ROUND((value2-value1)*100.0/ABS(value1),1) ELSE NULL END as changePercent FROM v`);
    },
    // savings_rate(month?|from?,to?) — {period, income, expenses, saved, rate%} (expenses include vacation)
    savings_rate:(args={})=>{
      const df=_sqlDf(args);
      const label=_label(args);
      return _sql(`WITH inc AS (SELECT ROUND(COALESCE(SUM(amount),0),2) as v FROM transactions WHERE type='income' AND ${df}), exp AS (SELECT ROUND(COALESCE(SUM(amount),0),2) as v FROM ${_allExp(df)}) SELECT '${label}' as period, inc.v as income, exp.v as expenses, ROUND(inc.v-exp.v,2) as saved, CASE WHEN inc.v>0 THEN ROUND((inc.v-exp.v)*100.0/inc.v,1) ELSE NULL END as rate FROM inc, exp`);
    },
    // expense_share(category, month?|from?,to?) — what % of spending is one category (includes vacation)
    expense_share:(args={})=>{
      const cat=(args.category||"").replace(/'/g,"''");
      const df=_sqlDf(args);
      return _sql(`SELECT '${cat}' as category, ROUND(COALESCE(SUM(CASE WHEN category='${cat}' THEN amount ELSE 0 END),0),2) as amount, ROUND(COALESCE(SUM(amount),0),2) as total, CASE WHEN SUM(amount)>0 THEN ROUND(SUM(CASE WHEN category='${cat}' THEN amount ELSE 0 END)*100.0/SUM(amount),1) ELSE NULL END as percent FROM ${_allExp(df)}`);
    },

    // ── Raw SQL ────────────────────────────────────────────────────────────────
    // sql_query(sql, params?) — execute any SELECT directly against SQLite
    sql_query:(args={})=>_sql(args.sql||'SELECT 1', args.params||[]),
  };

  // Build compact system prompt — just tool names, no raw JS examples
  const buildSystemPrompt=()=>{
    const curMonth=new Date().toISOString().slice(0,7);
    return `You are CashHeap Assistant. Answer finance questions by calling the tools below. NEVER invent or estimate numbers — only state values returned by tools.

RULES:
- Always call a tool before answering any financial question.
- Never refuse. Never say "I can't" — just call the right tool.
- After getting results, respond in 1-2 sentences using ONLY the returned values.

DATE ARGS (apply to most tools):
  month="YYYY-MM"          — single month
  from="YYYY-MM",to="YYYY-MM" — sum over a range of months
  (omit both for all-time)

AVAILABLE TOOLS:

SPENDING & INCOME:
expenses(month?|from?,to?) — total expenses
income(month?|from?,to?) — total income
net(month?|from?,to?) — income minus expenses
categories(month?|from?,to?) — expenses by category
top_category(month?|from?,to?) — highest-spend category
monthly(months?|from?,to?) — income & expenses per month
merchants(month?|from?,to?, limit?) — top merchants by spend
transactions(month?|from?,to?, limit?) — recent transactions
txns_by_category(category, month?|from?,to?) — all transactions in a category
txns_by_merchant(merchant, month?|from?,to?) — all transactions from a merchant
largest_expenses(month?|from?,to?, limit?) — top N expenses by amount

BUDGETS:
budgets() — all category budgets
budget_vs_actual(month?|from?,to?) — each category: budget, spent, remaining, % used
budget_remaining(category, month?|from?,to?) — remaining budget for one category
over_budget(month?) — categories exceeding their budget

EXPECTED INCOME:
pending_income(month?|from?,to?) — unconfirmed expected income: {total, items[]}
confirmed_income(month?|from?,to?) — confirmed expected income: {total, items[]}
all_expected_income(month?|from?,to?) — all expected income with status

BILLS:
bills(type?) — "total"=sum; default=list [{name,value}]
bills_due(month?) — unpaid bills this month
bills_paid(month?) — paid bills this month

PORTFOLIO:
portfolio(type?) — "total"=value; default=holdings [{name,value}]
holdings_detail() — each holding with cost, market value, gain/loss
portfolio_gain() — total unrealised gain/loss: {marketValue, totalCost, gain, gainPercent}
holding(ticker) — detail for one ticker

VACATIONS:
vacations() — all vacations with dates and budgets
vacation_spending(name) — actual spend vs budget for a vacation

ACCOUNT:
account_balance() — most recent balance snapshot
balance_history() — all balance snapshots over time

ACCOUNT:
account_balance() — most recent balance snapshot
balance_history(from?,to?) — balance snapshots over time

MATH (never do arithmetic yourself — always call these):
compare_expenses(month1, month2) — {value1, value2, change, changePercent}
compare_income(month1, month2) — same for income
compare_net(month1, month2) — net position comparison
savings_rate(month?|from?,to?) — {income, expenses, saved, rate%}
expense_share(category, month?|from?,to?) — what % of spending is one category

SQL:
sql_query(sql, params?) — execute any SELECT against SQLite for custom analysis

NAVIGATION:
navigate(tab) — home/bills/history/stocks/budget/networth/settings

RULES:
- NEVER do arithmetic. Use a math tool instead.
- Call exactly ONE tool per response.
- Report returned values directly in 1-2 sentences only.

HOW TO CALL: <tool>{"name":"TOOL_NAME","args":{"param":"value"}}</tool>

EXAMPLES:
User: what did I spend in ${curMonth}
<tool>{"name":"expenses","args":{"month":"${curMonth}"}}</tool>

User: show unconfirmed expected income this month
<tool>{"name":"pending_income","args":{"month":"${curMonth}"}}</tool>

User: am I over budget anywhere this month
<tool>{"name":"over_budget","args":{"month":"${curMonth}"}}</tool>

User: how did expenses change from 2026-05 to 2026-06
<tool>{"name":"compare_expenses","args":{"month1":"2026-05","month2":"2026-06"}}</tool>

User: show my portfolio gain/loss
<tool>{"name":"portfolio_gain","args":{}}</tool>

User: how much did I spend on my Montreal vacation
<tool>{"name":"vacation_spending","args":{"name":"Montreal"}}</tool>

User: total expenses from January to March 2026
<tool>{"name":"expenses","args":{"from":"2026-01","to":"2026-03"}}</tool>

User: what was my savings rate for Q1 2026
<tool>{"name":"savings_rate","args":{"from":"2026-01","to":"2026-03"}}</tool>

SQL TOOL — use when no named tool fits:
sql_query(sql, params?) — run any SELECT against SQLite.
${Object.entries((schema&&schema.views)||{}).map(([,v])=>{
  const tbl=v.table||v.source||'?';
  const fields=Object.entries(v.dimensions||{}).filter(([,d])=>d.sql).map(([dk,d])=>`${dk}:${d.sql.replace(/\$\{TABLE\}/g,tbl)}`);
  return `${tbl}: ${fields.join(', ')}`;
}).join('\n')}
Example:
User: expenses by category in 2026-05
<tool>{"name":"sql_query","args":{"sql":"SELECT category, ROUND(SUM(amount),2) as total FROM transactions WHERE type='expense' AND strftime('%Y-%m',date)='2026-05' GROUP BY category ORDER BY total DESC"}}</tool>

Current month: ${curMonth}`;
  };

  const executeTool=async(tool)=>{
    const{name,args}=tool;
    if(name==="navigate"){
      onNavigate(args.tab);
      return{success:true,navigatedTo:args.tab};
    }
    // Named library tool — all tools now return __SQL__: markers
    if(TOOL_LIBRARY[name]){
      try{
        const marker=TOOL_LIBRARY[name](args||{});
        const{sql,params}=JSON.parse(marker.slice(8));
        const r=await fetch("/api/db/sql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sql,params})});
        const d=await r.json();
        if(d.error)return{id:name,error:d.error};
        // Normalize: 1 row × 1 column → scalar value (e.g. expenses → 1234.56)
        if(d.rows.length===1&&d.columns.length===1)return{id:name,result:d.rows[0][d.columns[0]]};
        return{id:name,result:d.rows,columns:d.columns,count:d.count};
      }catch(e){return{id:name,error:e.message};}
    }
    // Legacy raw query tool (fallback only)
    if(name==="query"){
      try{
        const r=await fetch("/api/llm/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:args.js})});
        const d=await r.json();
        return{id:args.id||"result",result:d.result,error:d.error};
      }catch(e){return{id:args.id||"result",error:e.message};}
    }
    if(name==="chart"){
      return{widget:{id:uid(),type:args.type,title:args.title,data:args.data||[],xKey:args.xKey||"name",yKey:args.yKey||"value",multiKeys:args.multiKeys,format:args.format,color:args.color,colors:args.colors}};
    }
    if(name==="metric"){
      return{widget:{id:uid(),type:"metric",title:args.title,value:args.value,label:args.label,format:args.format||"number"}};
    }
    if(name==="table"){
      return{widget:{id:uid(),type:"table",title:args.title,columns:args.columns||[],rows:args.rows||[],format:args.format}};
    }
    return{error:"Unknown tool: "+name};
  };

  // Returns true if text contains financial figures that may be hallucinated
  const looksLikeFinancialClaim=text=>/\$[\d,]+|\d[\d,]*\.\d{2}|\b\d{3,}[\d,]*\b/.test(text);

  // ─── Preloaded queries: instant answers for known question patterns ──────────
  // Each entry has: test(msg)→bool, and either action() for side-effects
  // or queries:[{label, chartType, js(), buildWidget?(result)→widget}]
  // The fast-path runs these BEFORE hitting the LLM, making responses instant.
  const PRELOADED_QUERIES=[
    // Navigate
    {
      test:msg=>/navigate.*net.?worth|go.*net.?worth/i.test(msg),
      action:()=>{ onNavigate("networth"); setMessages(prev=>[...prev,{role:"assistant",display:"Navigating to Net Worth…",content:"",widgets:[]}]); }
    },
    // Spending this month
    {
      test:msg=>/(how much|total).*(spent|spend|spending)|spent.*(this month|month)/i.test(msg),
      queries:[{
        label:"Spent This Month",chartType:null,
        js:()=>TOOL_LIBRARY.expenses({month:new Date().toISOString().slice(0,7)}),
      }]
    },
    // Monthly income vs expenses (bar) — check before generic "income" or "bar"
    {
      test:msg=>/monthly.*(income|expense)|income.*vs.*expense|expense.*vs.*income|income.*expense.*bar|monthly.*bar/i.test(msg),
      queries:[{
        label:"Monthly Income vs Expenses",chartType:"bar",multiSeries:true,
        js:()=>TOOL_LIBRARY.monthly({months:8}),
        buildWidget:(result)=>({id:uid(),type:"bar",title:"Monthly Income vs Expenses",data:result,xKey:"name",multiKeys:["Income","Expenses"],format:"currency"})
      }]
    },
    // Spending by category (pie)
    {
      test:msg=>/categor|pie chart|breakdown/i.test(msg),
      queries:[{
        label:"Spending by Category",chartType:"pie",
        js:()=>TOOL_LIBRARY.categories({}),
      }]
    },
    // Net position this month
    {
      test:msg=>/net.*(position|worth|this month)|what.*net/i.test(msg),
      queries:[
        {label:"Income This Month",chartType:null,
          js:()=>TOOL_LIBRARY.income({month:new Date().toISOString().slice(0,7)}),
        },
        {label:"Expenses This Month",chartType:null,
          js:()=>TOOL_LIBRARY.expenses({month:new Date().toISOString().slice(0,7)}),
        },
        {label:"Net Position This Month",chartType:null,
          js:()=>TOOL_LIBRARY.net({month:new Date().toISOString().slice(0,7)}),
        },
      ]
    },
    // Bills
    {
      test:msg=>/bill/i.test(msg),
      queries:[
        {label:"Monthly Bills Total",chartType:null,js:()=>TOOL_LIBRARY.bills({type:"total"})},
        {label:"Bills Breakdown",chartType:"bar",js:()=>TOOL_LIBRARY.bills({})},
      ]
    },
    // Pending / unconfirmed expected income
    {
      test:msg=>/(income|pay|salary).*(pending|unconfirmed|expected|not.*confirmed|hasn.?t.*confirmed)|(pending|unconfirmed|expected|hasn.?t.*confirmed).*(income|pay|salary)/i.test(msg),
      queries:[{
        label:"Pending Income This Month",chartType:"bar",
        js:()=>TOOL_LIBRARY.pending_income({month:new Date().toISOString().slice(0,7)}),
        buildWidget:(result)=>{
          const items=result?.items||[];
          const total=result?.total||0;
          if(items.length===0) return {id:uid(),type:"metric",title:"Pending Income This Month",value:0,format:"currency"};
          return {id:uid(),type:"bar",title:`Pending Income This Month · $${total.toLocaleString()} total`,data:items,xKey:"name",yKey:"value",format:"currency"};
        }
      }]
    },
    // Portfolio value
    {
      test:msg=>/portfolio|stock.*value|total.*stock/i.test(msg),
      queries:[
        {label:"Total Portfolio Value",chartType:null,js:()=>TOOL_LIBRARY.portfolio({type:"total"})},
        {label:"Holdings by Value",chartType:"bar",js:()=>TOOL_LIBRARY.portfolio({})},
      ]
    },
  ];

  const runAgent=async(userMsg)=>{
    setLoading(true);setError(null);
    const userEntry={role:"user",display:userMsg,content:userMsg,widgets:[]};
    setMessages(prev=>[...prev,userEntry]);

    // ── Fast path: preloaded queries bypass the LLM entirely ──────────────────
    const preloaded=PRELOADED_QUERIES.find(p=>p.test(userMsg));
    if(preloaded){
      if(preloaded.action){
        preloaded.action();
      } else {
        const widgets=[];
        for(const q of preloaded.queries){
          try{
            const marker=q.js();
            let result;
            if(typeof marker==="string"&&marker.startsWith("__SQL__:")){
              const{sql,params}=JSON.parse(marker.slice(8));
              const r=await fetch("/api/db/sql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sql,params})});
              const d=await r.json();
              if(d.error)continue;
              // Normalize single-value result to scalar
              result=d.rows.length===1&&d.columns.length===1?d.rows[0][d.columns[0]]:d.rows;
            } else {
              const r=await fetch("/api/llm/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:marker})});
              const d=await r.json();
              if(d.result===undefined||d.error)continue;
              result=d.result;
            }
            const w=q.buildWidget?q.buildWidget(result):autoWidget(uid(),q.label,result,q.chartType);
            if(w) widgets.push(w);
          }catch(e){}
        }
        if(widgets.length>0){
          setMessages(prev=>[...prev,{role:"assistant",display:null,content:"",widgets}]);
        }
      }
      setLoading(false);
      setTimeout(()=>inputRef.current?.focus(),50);
      return;
    }
    // ── End fast path ──────────────────────────────────────────────────────────

    const systemPrompt=buildSystemPrompt();
    const histForLLM=[
      {role:"system",content:systemPrompt},
      ...messages.map(m=>({role:m.role,content:m.content})),
      {role:"user",content:userMsg}
    ];

    let llmMsgs=[...histForLLM];
    const MAX_ITER=3;
    let iter=0;
    let queriesRan=0;
    let queriesSucceeded=0;
    const preferredChartType=detectChartType(userMsg); // honour user's explicit chart preference

    try{
      while(iter<MAX_ITER){
        iter++;
        const res=await fetch("/api/llm/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:settings?.ollamaModel||"phi3:mini",messages:llmMsgs,options:{num_predict:400,temperature:0.1}})});
        if(!res.ok){const e=await res.json();throw new Error(e.error||"LLM error");}
        const llmData=await res.json();
        const assistantText=llmData.message?.content||"(no response)";
        const toolCalls=parseToolCalls(assistantText);
        // Strip tool tags, code fences, and all meta/privacy boilerplate
        let cleanText=assistantText
          .replace(/<tool>[\s\S]*?<\/tool>/g,"")
          .replace(/```[\w]*\n?[\s\S]*?```/g,"")   // closed code fences
          .replace(/```[\s\S]*/g,"")                // unclosed code fences → strip to end
          .replace(/\(this placeholder[^)]*\)/gi,"")
          .trim();
        // Remove lines that are meta-commentary, instructions, or privacy warnings
        const badPatterns=[
          /to (create|visualize|generate|display|render|produce)/i,
          /execute this query/i,/run (a|the) (query|code)/i,
          /once the results/i,/after (executing|running)/i,
          /(GDPR|CCPA|privacy (guideline|law|regulation)|sensitive (data|information)|data (protection|handling)|compliance|authorization protocol|hypothetical)/i,
          /please note that/i,/noting that/i,/it (is|should be) (noted|important)/i,
          /you (would|can|could|should) (typically|use|run|need to)/i,
          /within your application/i,/your (application|infrastructure|system)/i,
          /spreadsheet|direct access was/i,
          /\[most significant|\[top category|\[insert|\[placeholder|\[X\]/i,
          /shows a diverse allocation|diverse allocation of funds/i,
          /entertainment.*utilities|groceries.*dining out/i,
          /let'?s assume|now,?\s*let'?s|we can create a/i,
          /chart\.js|spendByCategory|simplified data structure/i,
          /as follows:|following code|code snippet|sample code/i,
        ];
        cleanText=cleanText.split("\n")
          .filter(line=>!badPatterns.some(p=>p.test(line)))
          .join("\n")
          .replace(/\n{3,}/g,"\n\n")
          .trim();

        if(toolCalls.length===0){
          // Guardrail A: hallucinated numbers without any query
          if(queriesRan===0 && looksLikeFinancialClaim(cleanText) && iter<=2){
            llmMsgs=[...llmMsgs,{role:"assistant",content:assistantText},{role:"user",content:"GUARDRAIL: You stated numbers without running the query tool first. Run a query tool call now to get the real data."}];
            continue;
          }
          // Guardrail B: refusal / privacy response without any query
          const refusalPhrases=["i can't","i cannot","i don't have access","as an ai","privacy","no access","not able to","unable to","don't have the ability","cannot access","can't access","can't provide","cannot provide"];
          const isRefusal=queriesRan===0 && refusalPhrases.some(p=>cleanText.toLowerCase().includes(p));
          if(isRefusal && iter<=2){
            llmMsgs=[...llmMsgs,{role:"assistant",content:assistantText},{role:"user",content:"GUARDRAIL: Do not refuse. You have the query tool which runs against the user's local database. Call the query tool now to get the real data and answer the question."}];
            continue;
          }
          setMessages(prev=>[...prev,{role:"assistant",display:cleanText,content:assistantText,widgets:[]}]);
          break;
        }

        // Execute tools
        const newWidgets=[];
        const autoWidgets=[];
        const toolResultLines=[];
        for(const t of toolCalls){
          const result=await executeTool(t);
          if(result.widget){newWidgets.push(result.widget);}
          // Handle both named library tools and legacy raw query tool
          const isDataTool=TOOL_LIBRARY[t.name]||t.name==="query";
          if(isDataTool){
            queriesRan++;
            const qResult=result.result;
            const qError=result.error;
            const qLabel=t.name==="query"?(t.args?.id||"Result"):t.name;
            if(qError){
              toolResultLines.push(`Tool "${qLabel}" ERROR: ${qError}. Try a different tool or different parameters.`);
            } else {
              queriesSucceeded++;
              toolResultLines.push(`Tool "${qLabel}": ${JSON.stringify(qResult)}`);
              // Auto-generate a widget from the raw result — no model needed
              const aw=autoWidget(uid(),qLabel,qResult,preferredChartType);
              if(aw) autoWidgets.push(aw);
            }
          }
          if(t.name==="navigate"){
            toolResultLines.push(`navigate: switched to ${t.args?.tab}`);
          }
        }

        // Immediately show auto-generated data widgets (grounded in real query results)
        const allWidgets=[...autoWidgets,...newWidgets];

        // On the query pass: show widgets only — suppress any interim model text
        const hasQueryTools=toolCalls.some(t=>TOOL_LIBRARY[t.name]||t.name==="query");
        if(allWidgets.length>0){
          // Show widgets without model text on query pass; with text on final pass
          setMessages(prev=>[...prev,{role:"assistant",display:hasQueryTools?null:cleanText||null,content:assistantText,widgets:allWidgets}]);
        } else if(!hasQueryTools&&cleanText){
          setMessages(prev=>[...prev,{role:"assistant",display:cleanText,content:assistantText,widgets:[]}]);
        }

        // If no data tools were called (only navigate/chart/etc), done
        if(!hasQueryTools) break;

        // After successful queries, generate a brief client-side summary from widgets
        // instead of looping back to the model (which causes context overflow + hallucinations)
        if(queriesSucceeded>0){
          const summaryLines=allWidgets.map(w=>{
            if(w.type==="metric"){
              const val=w.format==="currency"?"$"+Number(w.value).toFixed(2):Number(w.value).toFixed(2);
              return `**${w.title}:** ${val}`;
            }
            if(w.type==="pie"||w.type==="bar"||w.type==="line"||w.type==="area"){
              const top=w.data&&w.data[0];
              return top?`Top category: **${top.name}** at $${Number(top.value).toFixed(2)}`:`Here is your ${w.title} breakdown.`;
            }
            if(w.type==="table"&&w.rows&&w.rows.length>0){
              return `Found ${w.rows.length} results.`;
            }
            return null;
          }).filter(Boolean);
          // Update last message to include summary text if we have it
          if(summaryLines.length>0){
            const summaryText=summaryLines.join("\n");
            setMessages(prev=>{
              const copy=[...prev];
              // Find the last assistant message we just added and give it display text
              for(let idx=copy.length-1;idx>=0;idx--){
                if(copy[idx].role==="assistant"){
                  copy[idx]={...copy[idx],display:summaryText};
                  break;
                }
              }
              return copy;
            });
          }
          break;
        }
        // No successful queries yet — feed results back for model to retry/fix its query
        llmMsgs=[
          ...llmMsgs,
          {role:"assistant",content:assistantText},
          {role:"user",content:`QUERY RESULTS:\n${toolResultLines.join("\n")}\n\nIf there were errors, fix the JavaScript and try again with a corrected query call.`}
        ];
      }
    }catch(e){
      setError(e.message);
      setMessages(prev=>[...prev,{role:"assistant",display:"⚠ "+e.message,content:"",widgets:[]}]);
    }

    // Last-resort fallback: if no query succeeded (refused, errored, or never tried)
    // run a reliable pre-built query directly — no model involvement
    // Also clear any model text shown, since it's boilerplate not real data
    if(queriesSucceeded===0){
      setMessages(prev=>{
        const copy=[...prev];
        for(let i=copy.length-1;i>=0;i--){
          if(copy[i].role==="assistant"&&copy[i].display){
            copy[i]={...copy[i],display:null};
            break;
          }
        }
        return copy;
      });
      const q=userMsg.toLowerCase();
      const curM=new Date().toISOString().slice(0,7);
      // Ordered by specificity — first match wins
      const FALLBACKS=[
        {
          test:q=>q.includes("most")&&(q.includes("categor")||q.includes("spend")),
          js:`(function(){var acc={};data.txns.filter(function(t){return t.type==='expense';}).forEach(function(t){var c=t.category||'Other';acc[c]=(acc[c]||0)+t.amount;});var sorted=Object.entries(acc).sort(function(a,b){return b[1]-a[1];});return sorted.map(function(e){return {name:e[0],value:e[1]};});})()`,
          label:"Spending by category"
        },
        {
          test:q=>q.includes("categor")||q.includes("breakdown"),
          js:`(function(){var acc={};data.txns.filter(function(t){return t.type==='expense';}).forEach(function(t){var c=t.category||'Other';acc[c]=(acc[c]||0)+t.amount;});return Object.entries(acc).sort(function(a,b){return b[1]-a[1];}).map(function(e){return {name:e[0],value:e[1]};});})()`,
          label:"Spending by category"
        },
        {
          test:q=>(q.includes("spend")||q.includes("spent"))&&q.includes("month"),
          js:`(function(){var m='${curM}';return data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);})()`,
          label:"Spending this month"
        },
        {
          test:q=>q.includes("income")&&q.includes("month"),
          js:`(function(){var m='${curM}';return data.txns.filter(function(t){return t.type==='income'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);})()`,
          label:"Income this month"
        },
        {
          test:q=>q.includes("bill"),
          js:`data.bills.filter(function(b){return b.active!==false;}).map(function(b){return {name:b.name,value:b.amount};})`,
          label:"Monthly bills"
        },
        {
          test:q=>q.includes("net")||(q.includes("income")&&q.includes("expense")),
          js:`(function(){var m='${curM}';var inc=data.txns.filter(function(t){return t.type==='income'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);var exp=data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);return inc-exp;})()`,
          label:"Net position this month"
        },
        {
          test:q=>q.includes("spend")||q.includes("spent"),
          js:`data.txns.filter(function(t){return t.type==='expense';}).reduce(function(s,t){return s+t.amount;},0)`,
          label:"Total spending"
        },
        {
          test:q=>q.includes("income"),
          js:`data.txns.filter(function(t){return t.type==='income';}).reduce(function(s,t){return s+t.amount;},0)`,
          label:"Total income"
        },
      ];
      const match=FALLBACKS.find(f=>f.test(q));
      if(match){
        try{
          const r=await fetch("/api/llm/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:match.js})});
          const d=await r.json();
          if(d.result!==undefined&&!d.error){
            const aw=autoWidget(uid(),match.label,d.result,preferredChartType);
            if(aw) setMessages(prev=>[...prev,{role:"assistant",display:null,content:"",widgets:[aw]}]);
          }
        }catch{}
      }
    }

    setLoading(false);
    setTimeout(()=>inputRef.current?.focus(),50);
  };

  const send=()=>{
    const msg=input.trim();
    if(!msg||loading)return;
    setInput("");
    runAgent(msg);
  };

  const SUGGESTIONS=["How much have I spent this month?","Show spending by category as a pie chart","What's my net position?","Show my monthly income vs expenses as a bar chart","How much do I pay in bills per month?","What's my total portfolio value?","Navigate to net worth"];

  const hasMsgs=messages.length>0;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 120px)",minHeight:500}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexShrink:0}}>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Insights &amp; Analytics</h2>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>Local processing only · powered by {settings?.ollamaModel||"phi3:mini"}</div>
        </div>
        {(widgets.length>0||hasMsgs)&&(
          <div style={{display:"flex",gap:8}}>
            {widgets.length>0&&<button onClick={()=>onSetWidgets([])} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #fecaca",background:"#fef2f2",color:"#dc2626",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>Clear Charts</button>}
            {hasMsgs&&<button onClick={()=>setMessages([])} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",color:"#64748b",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>Clear Chat</button>}
          </div>
        )}
      </div>

      {/* Pinned widgets board */}
      {widgets.length>0&&(
        <div style={{marginBottom:16,flexShrink:0}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Pinned Charts</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
            {widgets.map(w=><InsightWidget key={`pin-${w.id}`} w={w} onRemove={id=>onSetWidgets(prev=>prev.filter(x=>x.id!==id))}/>)}
          </div>
        </div>
      )}

      {/* Chat area */}
      <div style={{flex:1,overflowY:"auto",marginBottom:12,display:"flex",flexDirection:"column",gap:12}}>
        {/* Welcome / suggestions */}
        {!hasMsgs&&(
          <div style={{...CA,textAlign:"center",padding:"32px 24px"}}>
            <div style={{fontWeight:700,fontSize:16,color:"#1E293B",marginBottom:6}}>Ask anything about your finances</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>Runs locally — your data stays on your machine.</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center"}}>
              {SUGGESTIONS.map(s=>(
                <button key={s} onClick={()=>{setInput(s);inputRef.current?.focus();}} style={{padding:"7px 14px",borderRadius:20,border:"1.5px solid #bae6fd",background:"#f0f9ff",color:"#0284C7",cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:500}}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((m,i)=>{
          const isUser=m.role==="user";
          const hasWidgets=m.widgets&&m.widgets.length>0;
          const isMetricOnly=hasWidgets&&m.widgets.every(w=>w.type==="metric")&&!m.display;
          return(
            <div key={i} style={{display:"flex",flexDirection:"column",alignItems:isUser?"flex-end":"flex-start",gap:10}}>
              {/* User bubble */}
              {isUser&&m.display&&(
                <div style={{maxWidth:"72%",padding:"9px 15px",borderRadius:"18px 18px 4px 18px",background:"linear-gradient(135deg,#0284C7,#0369a1)",color:"#fff",fontSize:13,lineHeight:1.6,boxShadow:"0 1px 6px rgba(2,132,199,0.25)"}}>
                  {m.display}
                </div>
              )}
              {/* Assistant text bubble */}
              {!isUser&&m.display&&(
                <div style={{maxWidth:"82%",padding:"12px 16px",borderRadius:"4px 18px 18px 18px",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",border:"1px solid #e2e8f0"}}>
                  <RenderMD text={m.display}/>
                </div>
              )}
              {/* Widgets — full-width standalone cards */}
              {hasWidgets&&(
                <div style={{width:"100%",display:"grid",gridTemplateColumns:isMetricOnly?"repeat(auto-fill,minmax(180px,1fr))":"1fr",gap:10}}>
                  {m.widgets.map(w=>(
                    <div key={`msg-${i}-${w.id}`} style={{position:"relative"}}>
                      <InsightWidget w={w} onRemove={id=>setMessages(prev=>prev.map(msg=>({...msg,widgets:(msg.widgets||[]).filter(x=>x.id!==id)})))}/>
                      <button
                        onClick={()=>onSetWidgets(prev=>[...prev,w])}
                        title="Pin to board"
                        style={{position:"absolute",top:8,right:32,background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:10,color:"#0284C7",fontFamily:"inherit",fontWeight:600}}
                      >Pin</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Loading indicator */}
        {loading&&(
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{display:"flex",gap:4}}>
              {[0,1,2].map(i=><span key={i} style={{width:7,height:7,borderRadius:"50%",background:"#0284C7",display:"inline-block",animation:`bounce 1.2s ${i*0.2}s infinite`}}/>)}
            </div>
            <span style={{fontSize:12,color:"#94a3b8"}}>Thinking…</span>
          </div>
        )}
        <div ref={chatEndRef}/>
      </div>

      {/* Input bar */}
      <div style={{flexShrink:0,display:"flex",gap:10,alignItems:"flex-end",background:"#fff",borderRadius:14,border:"1.5px solid #e2e8f0",padding:"10px 14px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="Ask anything… e.g. 'Show my spending by category' or 'Navigate to net worth'"
          style={{flex:1,border:"none",outline:"none",resize:"none",fontSize:13,fontFamily:"inherit",lineHeight:1.5,maxHeight:120,minHeight:24,overflow:"auto",background:"transparent",color:"#1E293B"}}
          rows={1}
          disabled={loading}
        />
        <button onClick={send} disabled={loading||!input.trim()} style={{flexShrink:0,padding:"8px 18px",borderRadius:10,border:"none",background:loading||!input.trim()?"#e2e8f0":"linear-gradient(135deg,#0284C7,#0369a1)",color:loading||!input.trim()?"#94a3b8":"#fff",cursor:loading||!input.trim()?"not-allowed":"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",transition:"all .15s"}}>
          Send
        </button>
      </div>

      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
    </div>
  );
}

// NAV_ITEMS imported from ./constants/index.js

// ── SelectableWrapper ─────────────────────────────────────────────────────────
function SelectableWrapper({item,inDepthMode,onSelectItem,children}){
  if(!inDepthMode) return children;
  return (
    <div
      onClick={e=>{e.stopPropagation();onSelectItem(item);}}
      style={{position:"relative",cursor:"crosshair",outline:"2px dashed #93c5fd",borderRadius:8,transition:"outline-color .15s"}}
      onMouseEnter={e=>e.currentTarget.style.outlineColor="#0284C7"}
      onMouseLeave={e=>e.currentTarget.style.outlineColor="#93c5fd"}
    >
      {children}
      <div style={{position:"absolute",top:6,right:6,width:20,height:20,borderRadius:"50%",background:"#0284C7",color:"#fff",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,pointerEvents:"none",zIndex:10,boxShadow:"0 2px 6px rgba(2,132,199,0.45)"}}>+</div>
    </div>
  );
}

// ── Global Chat FAB + slide-up panel ─────────────────────────────────────────
function GlobalChat({view,onNavigate,settings,inDepthMode,onSetInDepthMode,selectedItems,onSetSelectedItems,open,onSetOpen}){
  const [input,setInput]=useState("");
  const [messages,setMessages]=useState([]);
  const [loading,setLoading]=useState(false);
  const [listening,setListening]=useState(false);
  const [speaking,setSpeaking]=useState(false);
  const msgsEndRef=useRef(null);
  const inputRef=useRef(null);

  useEffect(()=>{msgsEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);
  useEffect(()=>{if(open) setTimeout(()=>inputRef.current?.focus(),100);},[open]);

  const TODAY=new Date().toISOString().slice(0,10);
  const sysPrompt=`You are Jarvis, a sharp financial AI. Speak like Jarvis from Iron Man: concise, precise, no pleasantries.
RULES: Call one tool before answering any data question. NEVER invent numbers. Reply in ONE short sentence using only the returned values. No preamble, no sign-off.
TODAY: ${TODAY}
Tool call format: <tool>{"name":"expenses","args":{"month":"2026-06"}}</tool>
DATE ARGS: month="YYYY-MM" or from/to="YYYY-MM"
TOOLS: expenses, income, net, categories, top_category, monthly, merchants, transactions, txns_by_category(category), txns_by_merchant(merchant), largest_expenses, budgets, budget_vs_actual, budget_remaining(category), over_budget, pending_income, confirmed_income, all_expected_income, bills, bills_due, bills_paid, portfolio, holdings_detail, portfolio_gain, holding(ticker), vacations, vacation_spending(name), account_balance, balance_history, compare_expenses(month1,month2), compare_income, compare_net, savings_rate, expense_share(category), navigate(tab)
TABS: dashboard, history, bills, stocks, networth, settings, expected, categories, vacations, goals`;

  const callLLM=async(msgs)=>{
    const model=settings?.globalChatModel||"gemini";
    if(model==="gemini"){
      const r=await fetch("/api/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:sysPrompt}]},contents:msgs.map(m=>({role:m.role==="assistant"?"model":m.role,parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:512}})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error?.message||"Gemini error");
      return d.candidates?.[0]?.content?.parts?.[0]?.text||"No response.";
    } else {
      const r=await fetch("/api/llm/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:settings?.ollamaModel||"phi3:mini",messages:[{role:"system",content:sysPrompt},...msgs],stream:false})});
      const d=await r.json();
      return d.message?.content||"No response.";
    }
  };

  const execTool=async(name,args={})=>{
    const fn=TOOL_LIBRARY[name];
    if(!fn) return null;
    try{
      const marker=fn(args);
      const{sql,params}=JSON.parse(marker.slice(8));
      const r=await fetch("/api/db/sql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sql,params})});
      const d=await r.json();
      if(d.error) return null;
      if(d.rows.length===1&&d.columns.length===1) return d.rows[0][d.columns[0]];
      return d.rows;
    }catch(e){return null;}
  };

  const fmtCurrency=v=>"$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

  const renderWidget=(w)=>{
    if(!w) return null;
    if(w.type==="metric") return (
      <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"10px 14px",marginTop:6}}>
        <div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>{w.title}</div>
        <div style={{fontSize:20,fontWeight:800,color:"#0284C7",marginTop:2}}>{w.format==="currency"?fmtCurrency(w.value):w.value}</div>
      </div>
    );
    const rows=w.rows||(w.data?.map(d=>[d.name,d.value]))||[];
    const cols=w.columns||["Name","Value"];
    if(!rows.length) return null;
    return (
      <div style={{marginTop:6,overflowX:"auto",borderRadius:8,border:"1px solid #e2e8f0"}}>
        <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
          <thead><tr>{cols.map(c=><th key={c} style={{textAlign:"left",padding:"6px 10px",color:"#64748b",borderBottom:"1px solid #e2e8f0",fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",background:"#f8fafc"}}>{c}</th>)}</tr></thead>
          <tbody>{rows.slice(0,8).map((row,i)=><tr key={i} style={{borderBottom:i<rows.length-1?"1px solid #f1f5f9":""}}>{(Array.isArray(row)?row:[row]).map((cell,j)=><td key={j} style={{padding:"5px 10px",color:"#1e293b"}}>{typeof cell==="number"?fmtCurrency(cell):cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  };

  const buildToolSummary=(name,args,result)=>{
    const fmt=v=>typeof v==='number'?'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):String(v??'');
    const period=args.month?` for ${args.month}`:args.from?` from ${args.from} to ${args.to||'now'}`:'';
    if(result===null||result===undefined) return 'No data found.';
    if(typeof result==='number') return `${name==='expenses'?'Total spending':name==='income'?'Total income':name==='net'?'Net position':name==='bills'?'Bills total':'Result'}${period}: ${fmt(result)}.`;
    if(name==='savings_rate') return `Savings rate${period}: ${result.rate??'N/A'}% — saved ${fmt(result.saved)} of ${fmt(result.income)} income.`;
    if(name==='compare_expenses'||name==='compare_income'||name==='compare_net') return `${result.month1}: ${fmt(result.value1)} → ${result.month2}: ${fmt(result.value2)} (${result.change>=0?'+':''}${fmt(result.change)}, ${result.changePercent!=null?result.changePercent+'%':'N/A'}).`;
    if(name==='expense_share') return `${result.category} is ${result.percent??'N/A'}% of total spending${period} (${fmt(result.amount)} of ${fmt(result.total)}).`;
    if(name==='budget_remaining') return `${result.category}: spent ${fmt(result.spent)} of ${fmt(result.budget)} budget, ${fmt(result.remaining)} remaining (${result.percentUsed??0}% used).`;
    if(name==='account_balance') return result?`Account balance as of ${result.date}: ${fmt(result.balance)}.`:'No balance data found.';
    if(name==='portfolio_gain') return `Portfolio: ${fmt(result.marketValue)} market value, ${result.gain>=0?'+':''}${fmt(result.gain)} gain (${result.gainPercent!=null?result.gainPercent+'%':'N/A'}).`;
    if(name==='holding') return result?`${result.ticker}: ${result.shares} shares, market value ${fmt(result.marketValue)}, gain ${result.gain>=0?'+':''}${fmt(result.gain)}.`:'Ticker not found.';
    if(name==='top_category') return result?`Top spending category${period}: ${result.name} at ${fmt(result.value)}.`:'No spending data found.';
    if((name==='pending_income'||name==='confirmed_income'||name==='all_expected_income')&&typeof result?.total==='number'){
      const label=name==='pending_income'?'Pending':name==='confirmed_income'?'Confirmed':'Total expected';
      return `${label} income${period}: ${fmt(result.total)} across ${result.items?.length??0} item(s).`;
    }
    if(Array.isArray(result)){
      if(!result.length) return `No results found${period}.`;
      const top=result[0];
      if(name==='categories') return `Top spending categories${period}: ${result.slice(0,3).map(r=>`${r.name} (${fmt(r.value)})`).join(', ')}.`;
      if(name==='over_budget') return `${result.length} categor${result.length===1?'y':'ies'} over budget: ${result.map(r=>r.name).join(', ')}.`;
      if(name==='largest_expenses'||name==='txns_by_category'||name==='txns_by_merchant') return `Top result: ${top.name} — ${fmt(top.value)}.`;
      if(name==='merchants') return `Top merchant${period}: ${top.name} (${fmt(top.value)}).`;
      if(name==='bills') return `${result.length} active bill(s) totalling ${fmt(result.reduce((s,b)=>s+b.value,0))}.`;
      if(name==='bills_due') return result.length?`${result.length} bill(s) due: ${result.map(b=>b.name).join(', ')}.`:'All bills paid this month.';
      if(name==='bills_paid') return result.length?`${result.length} bill(s) paid: ${result.map(b=>b.name).join(', ')}.`:'No bills paid yet this month.';
      if(name==='holdings_detail') return `${result.length} holding(s). Top: ${top.name} worth ${fmt(top.marketValue)}.`;
      if(name==='transactions') return `${result.length} transaction(s). Latest: ${top.name} — ${fmt(top.value)}.`;
      if(name==='budget_vs_actual') return `${result.length} budget categor${result.length===1?'y':'ies'}. Highest spend: ${top.name} — ${fmt(top.spent)} of ${fmt(top.budget)} budget.`;
      if(name==='monthly') return `${result.length} month(s) of data. Latest: ${result[result.length-1]?.name} — income ${fmt(result[result.length-1]?.Income)}, expenses ${fmt(result[result.length-1]?.Expenses)}.`;
      return `${result.length} result(s) found.`;
    }
    return 'Here is the data.';
  };

  const parseToolCall=(text)=>{
    const xmlM=text.match(/<tool>([\s\S]*?)<\/tool>/);
    if(xmlM){try{const d=JSON.parse(xmlM[1]);if(d?.name)return d;}catch{}}
    const blockMs=[...text.matchAll(/```[a-z]*\s*(\{[\s\S]*?\})\s*```/g)];
    for(const bm of blockMs){
      try{
        const d=JSON.parse(bm[1]);
        if(d?.name) return {name:d.name,args:d.args||d.arguments||d.parameters||{}};
        if(d?.tool?.name) return {name:d.tool.name,args:d.tool.args||d.tool.arguments||d.tool.parameters||{}};
      }catch{}
    }
    const allJson=[...text.matchAll(/(\{[^{}]*"name"\s*:[^{}]*\})/g)];
    for(const jm of allJson){
      try{const d=JSON.parse(jm[1]);if(d?.name&&TOOL_LIBRARY[d.name])return{name:d.name,args:d.args||d.arguments||{}};}catch{}
    }
    const nestedM=text.match(/"tool"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
    if(nestedM){const name=nestedM[1];if(TOOL_LIBRARY[name])return{name,args:{}};}
    return null;
  };

  const curMonth=new Date().toISOString().slice(0,7);

  const QUICK=[
    {test:/main contributors?|top categor|spending categor|categor.*breakdown|breakdown.*categor|where.*spending|what.*spending on|spending by categor/i,
     name:'categories',args:()=>({month:curMonth}),
     reply:r=>r?.length?`Your top spending categories this month are ${r.slice(0,3).map(x=>`${x.name} ($${x.value.toFixed(2)})`).join(', ')}.`:"No spending data yet this month."},
    {test:/most expensive in (.+)|top (?:expense|spend) in (.+)|highest.+in (.+)/i,
     name:'txns_by_category',
     args:(t)=>{const m=(t||"").match(/most expensive in (.+)|top (?:expense|spend) in (.+)|highest.+in (.+)/i);const cat=(m?.[1]||m?.[2]||m?.[3]||"").replace(/[?.!]/g,"").trim();return {category:cat,month:curMonth};},
     reply:r=>{if(!r?.length)return "No transactions found for that category this month.";const top=r.sort((a,b)=>b.value-a.value)[0];return `The most expensive transaction in that category is ${top.name} at $${top.value.toFixed(2)}.`;}},
    {test:/top merchant|largest expense|biggest expense|biggest spend|top expense/i,
     name:'largest_expenses',args:()=>({month:curMonth,limit:8}),
     reply:r=>r?.length?`Your largest expenses this month are ${r.slice(0,3).map(x=>`${x.name} ($${x.value.toFixed(2)})`).join(', ')}.`:"No expenses found."},
    {test:/pending income|unconfirmed income|income.*pending|income.*not confirmed/i,
     name:'pending_income',args:()=>({month:curMonth}),
     reply:r=>`You have $${Number(r?.total||0).toLocaleString('en-US',{minimumFractionDigits:2})} in pending income this month across ${r?.items?.length||0} item(s).`},
    {test:/net position|what.*my net|net this month/i,
     name:'net',args:()=>({month:curMonth}),
     reply:r=>`Your net position this month is $${Number(r).toLocaleString('en-US',{minimumFractionDigits:2})}.`},
    {test:/how much.*spent|total.*spent|how much.*spending|spent this month|spending this month/i,
     name:'expenses',args:()=>({month:curMonth}),
     reply:r=>`You've spent $${Number(r).toLocaleString('en-US',{minimumFractionDigits:2})} this month.`},
    {test:/income this month|how much.*income|total.*income/i,
     name:'income',args:()=>({month:curMonth}),
     reply:r=>`Your income this month is $${Number(r).toLocaleString('en-US',{minimumFractionDigits:2})}.`},
    {test:/\bbills?\b.*due|due.*\bbills?\b|monthly bills?|show.*bills?/i,
     name:'bills',args:()=>({}),
     reply:r=>r?.length?`Your active bills total $${r.reduce((s,b)=>s+b.value,0).toFixed(2)} across ${r.length} bills.`:"No bills found."},
    {test:/portfolio.*worth|stock.*value|holdings? value|portfolio total/i,
     name:'portfolio',args:()=>({type:'total'}),
     reply:r=>`Your portfolio is currently worth $${Number(r||0).toLocaleString('en-US',{minimumFractionDigits:2})}.`},
  ];

  const NAV_TABS={
    dashboard:'dashboard',home:'dashboard',
    bills:'bills',bill:'bills',
    history:'history',transactions:'history',transaction:'history','spending history':'history',
    stocks:'stocks',stock:'stocks',portfolio:'stocks',holdings:'stocks',holding:'stocks',
    'net worth':'networth',networth:'networth',
    settings:'settings',setting:'settings',preferences:'settings',
    expected:'expected','expected income':'expected',
    categories:'categories',category:'categories',budget:'categories',budgets:'categories',
    vacations:'vacations',vacation:'vacations','vacation tab':'vacations',trips:'vacations',
    goals:'goals',goal:'goals','savings goals':'goals',
    insights:'insights',insight:'insights','ai chat':'insights','data model':'datamodel',datamodel:'datamodel',
  };

  const voiceModeRef=useRef(false);

  const speakAndResume=useCallback((text)=>{
    if(!settings?.jarvisVoice||!text){
      if(voiceModeRef.current) setTimeout(startVoice,300);
      return;
    }
    const synth=window.speechSynthesis;
    synth.cancel();
    const utter=new SpeechSynthesisUtterance(text);
    const loadVoice=()=>{
      const voices=synth.getVoices();
      const pick=voices.find(v=>v.name==='Zarvox')
        ||voices.find(v=>v.name==='Daniel')
        ||voices.find(v=>v.name.includes('Google UK English Male'))
        ||voices.find(v=>v.lang==='en-GB'&&!v.name.toLowerCase().includes('female'))
        ||voices.find(v=>v.lang==='en-GB')
        ||voices.find(v=>v.lang.startsWith('en')&&!v.name.toLowerCase().includes('female'));
      if(pick) utter.voice=pick;
      utter.pitch=0.6;
      utter.rate=0.95;
      utter.volume=1;
      utter.onstart=()=>setSpeaking(true);
      utter.onend=()=>{ setSpeaking(false); if(voiceModeRef.current) setTimeout(startVoice,400); };
      utter.onerror=()=>{ setSpeaking(false); if(voiceModeRef.current) setTimeout(startVoice,400); };
      synth.speak(utter);
    };
    if(synth.getVoices().length) loadVoice();
    else synth.addEventListener('voiceschanged',loadVoice,{once:true});
  },[settings?.jarvisVoice]);

  const sendText=async(text,isVoice=false)=>{
    if(!text&&selectedItems.length===0) return;
    if(isVoice) voiceModeRef.current=true;
    let userContent=text;
    if(selectedItems.length>0) userContent="[ATTACHED]\n"+selectedItems.map(i=>i.llmContext).join("\n")+"\n\n"+text;
    const history=messages.map(m=>({role:m.role==="assistant"?"assistant":"user",content:m.fullText||m.text}));
    const userMsg={role:"user",text,items:[...selectedItems]};
    setMessages(p=>[...p,userMsg]);
    setInput("");
    onSetSelectedItems([]);
    setLoading(true);

    const reply_=(replyTxt)=>{ speakAndResume(replyTxt); };

    try{
      const navMatch=text.match(/\bnavigate\s+to\s+([a-z\s]+)/i)||text.match(/\bgo\s+to\s+([a-z\s]+)/i)||text.match(/\bopen\s+([a-z\s]+)/i);
      if(navMatch){
        const dest=navMatch[1].trim().toLowerCase();
        const tab=NAV_TABS[dest]||Object.entries(NAV_TABS).find(([k])=>dest.includes(k))?.[1];
        if(tab){onNavigate(tab);const navTxt=`Navigating to ${dest}.`;setMessages(p=>[...p,{role:"assistant",text:navTxt}]);reply_(navTxt);setLoading(false);return;}
      }

      const quick=QUICK.find(q=>q.test.test(text)&&selectedItems.length===0);
      if(quick){
        const result=await execTool(quick.name,quick.args(text));
        const widget=autoWidget(uid(),quick.name,result,null);
        const quickTxt=quick.reply(result);
        setMessages(p=>[...p,{role:"assistant",text:quickTxt,widget}]);
        reply_(quickTxt);
        setLoading(false);setTimeout(()=>inputRef.current?.focus(),50);return;
      }

      const callMsgs=[...history,{role:"user",content:userContent}];
      let llmReply=await callLLM(callMsgs);
      const toolData=parseToolCall(llmReply);

      if(toolData){
        if(toolData.name==="navigate"){
          const tab=toolData.args?.tab||"dashboard";
          onNavigate(tab);
          const cleanText=llmReply.replace(/<tool>[\s\S]*?<\/tool>/g,"").replace(/```[\s\S]*?```/g,"").trim()||`Navigating to ${tab}…`;
          setMessages(p=>[...p,{role:"assistant",text:cleanText,fullText:llmReply}]);
          reply_(cleanText);
        } else if(TOOL_LIBRARY[toolData.name]){
          const result=await execTool(toolData.name,toolData.args||{});
          const widget=autoWidget(uid(),toolData.name,result,null);
          const summary=buildToolSummary(toolData.name,toolData.args||{},result);
          setMessages(p=>[...p,{role:"assistant",text:summary,widget}]);
          reply_(summary);
        } else {
          const fallbackTxt=llmReply.replace(/<tool>[\s\S]*?<\/tool>/g,"").replace(/```[\s\S]*?```/g,"").trim();
          setMessages(p=>[...p,{role:"assistant",text:fallbackTxt,fullText:llmReply}]);
          reply_(fallbackTxt);
        }
      } else {
        const plainTxt=llmReply.replace(/<tool>[\s\S]*?<\/tool>/g,"").replace(/```[\s\S]*?```/g,"").trim()||llmReply;
        setMessages(p=>[...p,{role:"assistant",text:plainTxt,fullText:llmReply}]);
        reply_(plainTxt);
      }
    }catch(e){
      setMessages(p=>[...p,{role:"assistant",text:"Error: "+e.message}]);
      if(voiceModeRef.current) setTimeout(startVoice,400);
    }
    setLoading(false);
    if(!voiceModeRef.current) setTimeout(()=>inputRef.current?.focus(),50);
  };

  const send=()=>sendText(input.trim(),false);

  const recRef=useRef(null);
  const stopVoice=()=>{
    voiceModeRef.current=false;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    if(recRef.current){recRef.current.abort();recRef.current=null;}
    setListening(false);
  };
  const startVoice=()=>{
    if(speaking){stopVoice();return;}
    if(listening){stopVoice();return;}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert("Voice input not supported in this browser.");return;}
    window.speechSynthesis?.cancel();
    const rec=new SR();
    recRef.current=rec;
    rec.interimResults=false;
    rec.lang="en-US";
    rec.onstart=()=>setListening(true);
    rec.onerror=e=>{
      if(e.error!=="aborted") setListening(false);
      recRef.current=null;
    };
    rec.onresult=e=>{
      const transcript=e.results[0][0].transcript.trim();
      if(!transcript) return;
      setInput(transcript);
      sendText(transcript,true);
    };
    rec.onend=()=>{setListening(false);recRef.current=null;};
    rec.start();
  };

  if(view==="insights") return null;

  return(
    <>
      <style>{`@keyframes gcSlideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}@keyframes gcDot{0%,80%,100%{transform:scale(0.7);opacity:0.4}40%{transform:scale(1.1);opacity:1}}`}</style>

      {/* FAB */}
      <button
        onClick={()=>onSetOpen(!open)}
        title={open?"Close Jarvis":"Open Jarvis"}
        style={{position:"fixed",bottom:24,right:24,width:56,height:56,borderRadius:"50%",background:open?"#475569":"#0284C7",border:"none",cursor:"pointer",color:"#fff",fontSize:open?18:22,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 18px rgba(2,132,199,0.5)",zIndex:9999,transition:"background .2s,transform .15s",fontFamily:"inherit"}}
        onMouseEnter={e=>e.currentTarget.style.transform="scale(1.09)"}
        onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}
      >{open?"✕":"💬"}</button>

      {/* Panel */}
      {open&&(
        <div style={{position:"fixed",bottom:92,right:24,width:390,maxHeight:550,borderRadius:18,background:"#fff",boxShadow:"0 10px 48px rgba(0,0,0,0.2)",zIndex:9998,display:"flex",flexDirection:"column",overflow:"hidden",animation:"gcSlideUp .22s ease"}}>

          {/* Header */}
          <div style={{display:"flex",alignItems:"center",gap:9,padding:"13px 16px 11px",borderBottom:"1px solid #f1f5f9",background:"linear-gradient(135deg,#f8fafc,#eff6ff)",flexShrink:0}}>
            <div style={{width:30,height:30,borderRadius:"50%",background:"#0284C7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>💬</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"#1e293b",lineHeight:1}}>Jarvis</div>
              <div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>{(settings?.globalChatModel||"ollama")==="gemini"?"Gemini":"Ollama · "+(settings?.ollamaModel||"phi3:mini")}{settings?.jarvisVoice?" · 🔊":""}</div>
            </div>
            <button
              onClick={()=>onSetInDepthMode(!inDepthMode)}
              title="Toggle In-Depth Mode: click any card to attach as context"
              style={{padding:"5px 11px",borderRadius:8,border:"1.5px solid",borderColor:inDepthMode?"#0284C7":"#e2e8f0",background:inDepthMode?"#eff6ff":"#fff",color:inDepthMode?"#0284C7":"#94a3b8",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4,transition:"all .15s",flexShrink:0}}
            >⊕{inDepthMode?" Active":" In-Depth"}</button>
            {messages.length>0&&<button onClick={()=>setMessages([])} title="Clear chat" style={{padding:"5px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#fff",color:"#94a3b8",fontSize:11,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",flexShrink:0}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#dc2626";e.currentTarget.style.color="#dc2626";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#94a3b8";}}>✕ Clear</button>}
          </div>

          {/* Messages */}
          <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:8,minHeight:0}}>
            {messages.length===0&&(
              <div style={{textAlign:"center",color:"#94a3b8",fontSize:12,marginTop:32,lineHeight:1.8}}>
                At your service.<br/>Ask me anything, or say <em>"navigate to bills"</em>.
                {inDepthMode&&<div style={{marginTop:8,color:"#0284C7",fontWeight:600,fontSize:11}}>⊕ Click any card on the page to attach it.</div>}
              </div>
            )}
            {messages.map((m,i)=>(
              <div key={i} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start",gap:4}}>
                {m.items?.length>0&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                    {m.items.map(it=><span key={it.id} style={{background:"#eff6ff",border:"1px solid #bae6fd",color:"#0369a1",fontSize:10,padding:"2px 8px",borderRadius:12,fontWeight:500}}>{it.label}</span>)}
                  </div>
                )}
                <div style={{maxWidth:"88%",background:m.role==="user"?"#0284C7":"#f1f5f9",color:m.role==="user"?"#fff":"#1e293b",padding:"9px 13px",borderRadius:m.role==="user"?"14px 14px 2px 14px":"14px 14px 14px 2px",fontSize:12,lineHeight:1.55,wordBreak:"break-word"}}>
                  {m.text}
                </div>
                {m.widget&&<div style={{maxWidth:"100%",width:"88%",alignSelf:m.role==="user"?"flex-end":"flex-start"}}>{renderWidget(m.widget)}</div>}
              </div>
            ))}
            {loading&&(
              <div style={{alignSelf:"flex-start",background:"#f1f5f9",padding:"10px 14px",borderRadius:"14px 14px 14px 2px",display:"flex",gap:5,alignItems:"center"}}>
                {[0,1,2].map(i=><span key={i} style={{width:6,height:6,borderRadius:"50%",background:"#94a3b8",display:"inline-block",animation:`gcDot 1.2s ${i*0.18}s infinite ease-in-out`}}/>)}
              </div>
            )}
            <div ref={msgsEndRef}/>
          </div>

          {/* Attached items chips */}
          {selectedItems.length>0&&(
            <div style={{padding:"7px 14px",borderTop:"1px solid #f1f5f9",display:"flex",flexWrap:"wrap",gap:5,alignItems:"center",background:"#f8fafc",flexShrink:0}}>
              <span style={{fontSize:10,color:"#94a3b8",fontWeight:700,letterSpacing:"0.05em",marginRight:2}}>ATTACHED:</span>
              {selectedItems.map(it=>(
                <span key={it.id} style={{display:"inline-flex",alignItems:"center",gap:4,background:"#eff6ff",border:"1px solid #bae6fd",color:"#0369a1",fontSize:11,padding:"3px 8px 3px 9px",borderRadius:12}}>
                  {it.label}
                  <button onClick={()=>onSetSelectedItems(p=>p.filter(x=>x.id!==it.id))} style={{background:"none",border:"none",cursor:"pointer",color:"#64748b",fontSize:14,lineHeight:1,padding:"0 0 1px",fontFamily:"inherit",display:"flex",alignItems:"center"}}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{padding:"10px 12px 13px",borderTop:"1px solid #f1f5f9",display:"flex",gap:7,alignItems:"flex-end",flexShrink:0}}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
              placeholder="Ask about your finances…"
              rows={2}
              style={{flex:1,resize:"none",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 11px",fontSize:12,fontFamily:"inherit",outline:"none",lineHeight:1.45,color:"#1e293b",background:"#fff",transition:"border-color .15s"}}
              onFocus={e=>e.target.style.borderColor="#0284C7"}
              onBlur={e=>e.target.style.borderColor="#e2e8f0"}
            />
            <button onClick={startVoice} title={speaking?"Jarvis is speaking (tap to stop)":listening?"Listening… (tap to stop)":"Start voice conversation"} style={{width:34,height:34,borderRadius:"50%",border:"1.5px solid",borderColor:speaking?"#f59e0b":listening?"#dc2626":"#e2e8f0",background:speaking?"#fffbeb":listening?"#fef2f2":"#f8fafc",cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,opacity:speaking?0.6:1,transition:"all .15s"}}>{speaking?"🔊":"🎤"}</button>
            <button onClick={send} disabled={loading||(!input.trim()&&selectedItems.length===0)} style={{width:34,height:34,borderRadius:"50%",background:"#0284C7",border:"none",cursor:"pointer",color:"#fff",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,opacity:loading||(!input.trim()&&selectedItems.length===0)?0.4:1,transition:"opacity .15s"}}>↑</button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Dev Update Button ─────────────────────────────────────────────────────────
function DevUpdateButton(){
  const [status,setStatus]=useState(null); // null|'building'|'done'|'error'
  const trigger=()=>{
    if(status==='building') return;
    setStatus('building');
    window.electronLocalUpdate.onProgress(()=>{});
    window.electronLocalUpdate.onDone((ok)=>setStatus(ok?'done':'error'));
    window.electronLocalUpdate.trigger();
  };
  return(
    <button
      onClick={trigger}
      disabled={status==='building'}
      title="Build & reinstall app from local source"
      style={{width:"100%",padding:"7px 8px",borderRadius:8,border:"1.5px solid",borderColor:status==='error'?"#fecaca":status==='building'?"#bae6fd":"#fde047",background:status==='error'?"#fef2f2":status==='building'?"#f0f9ff":"#fefce8",color:status==='error'?"#dc2626":status==='building'?"#0284C7":"#854d0e",fontSize:11,fontWeight:700,cursor:status==='building'?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all .15s"}}
    >
      {status==='building'
        ?<><span style={{display:"inline-block",width:10,height:10,border:"2px solid currentColor",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>Building…</>
        :status==='error'?'✗ Build failed'
        :'🔄 Update App'}
    </button>
  );
}

// ── Sidebar component ─────────────────────────────────────────────────────────
function Sidebar({ view, onNavigate, favourites, onToggleFavourite, pendingCount, unpaidBillCount, devMode, onShowWhatsNew }) {
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [hoveredApp, setHoveredApp] = useState(null);
  const flyoutRef = useRef(null);
  const appsButtonRef = useRef(null);
  const flyoutTimer = useRef(null);

  const appItems = NAV_ITEMS.filter(n => !n.alwaysShow && !n.isBottom);
  const devItems = devMode ? [{ k:"datamodel", l:"Data Model", icon:"⚙", desc:"Directly edit the FinanceLookML schema used by the Insights agent.", isBottom:true }] : [];
  const bottomItems = [...NAV_ITEMS.filter(n=>n.isBottom), ...devItems];
  const pinnedItems = NAV_ITEMS.filter(n => !n.alwaysShow && !n.isBottom && favourites.includes(n.k));

  const badge = k => {
    if (k==="expected" && pendingCount>0) return pendingCount;
    if (k==="bills" && unpaidBillCount>0) return unpaidBillCount;
    return null;
  };

  const [flyoutTop, setFlyoutTop] = useState(0);
  const openFlyout = () => {
    clearTimeout(flyoutTimer.current);
    if (appsButtonRef.current) {
      const r = appsButtonRef.current.getBoundingClientRect();
      setFlyoutTop(r.top);
    }
    setFlyoutOpen(true);
  };
  const closeFlyout = () => { flyoutTimer.current = setTimeout(()=>setFlyoutOpen(false), 120); };

  const NavBtn = ({ item, indent=false }) => {
    const b = badge(item.k);
    const active = view === item.k;
    return (
      <button
        onClick={() => { onNavigate(item.k); setFlyoutOpen(false); }}
        title={item.desc}
        style={{
          display:"flex", alignItems:"center", gap:10, width:"100%",
          padding: indent ? "7px 14px 7px 20px" : "7px 14px",
          borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:500,
          background: active ? "rgba(2,132,199,0.12)" : "transparent",
          color: active ? "#0284C7" : "#334155",
          textAlign:"left", fontFamily:"inherit", position:"relative",
          transition:"background 0.12s, color 0.12s",
        }}
        onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(0,0,0,0.04)"; }}
        onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}
      >
        <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0, opacity:0.7 }}>{item.icon}</span>
        <span style={{ flex:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.l}</span>
        {b && <span style={{ minWidth:16,height:16,borderRadius:8,background:item.k==="bills"?"#dc2626":"#06B6D4",color:"#fff",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px",flexShrink:0 }}>{b}</span>}
      </button>
    );
  };

  return (
    <div style={{ width:220, flexShrink:0, background:"#fff", borderRight:"1px solid #e2e8f0", display:"flex", flexDirection:"column", height:"100vh", position:"sticky", top:0, zIndex:30, userSelect:"none" }}>
      {/* Logo */}
      <div style={{ padding:"0 14px", height:56, display:"flex", alignItems:"center", gap:10, borderBottom:"1px solid #f1f5f9", flexShrink:0 }}>
        <div style={{ width:28, height:28, borderRadius:8, background:"#000000", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon points="2,27 16,5 30,27" fill="#FFFFFF"/>
            <rect x="2" y="27" width="28" height="2.5" rx="1" fill="#FFFFFF"/>
          </svg>
        </div>
        <span style={{ fontWeight:800, fontSize:14, color:"#0f172a", letterSpacing:"-0.3px" }}>CashHeap</span>
        <button onClick={onShowWhatsNew} title="What's new" style={{ marginLeft:"auto", background:"#f0f9ff", border:"1px solid #bae6fd", cursor:"pointer", padding:"3px 7px", borderRadius:12, fontSize:10, color:"#0284C7", fontFamily:"inherit", fontWeight:600, flexShrink:0, whiteSpace:"nowrap" }}>New</button>
      </div>

      {/* Scrollable nav */}
      <div style={{ flex:1, overflowY:"auto", padding:"8px 6px", display:"flex", flexDirection:"column", gap:1 }}>
        {/* Always-visible: Home + Insights */}
        {NAV_ITEMS.filter(n=>n.alwaysShow).map(item=>(
          <NavBtn key={item.k} item={item} />
        ))}

        {/* Favourites */}
        {pinnedItems.length > 0 && (
          <>
            <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.07em", padding:"10px 14px 4px" }}>Favourites</div>
            {pinnedItems.map(item=><NavBtn key={item.k} item={item} />)}
          </>
        )}

        {/* Applications flyout trigger */}
        <div
          ref={appsButtonRef}
          onMouseEnter={openFlyout}
          onMouseLeave={closeFlyout}
          style={{ position:"relative", marginTop:4 }}
        >
          <button
            style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"7px 14px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:500, background: flyoutOpen ? "rgba(2,132,199,0.08)" : "transparent", color: flyoutOpen ? "#0284C7" : "#334155", textAlign:"left", fontFamily:"inherit", transition:"background 0.12s" }}
            onMouseEnter={e=>{ openFlyout(); e.currentTarget.style.background="rgba(2,132,199,0.08)"; e.currentTarget.style.color="#0284C7"; }}
            onMouseLeave={e=>{ closeFlyout(); if(!flyoutOpen){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#334155"; } }}
          >
            <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0, opacity:0.7 }}>▦</span>
            <span style={{ flex:1 }}>Applications</span>
            <span style={{ fontSize:11, opacity:0.5 }}>›</span>
          </button>

          {/* Flyout panel */}
          {flyoutOpen && (
            <div
              ref={flyoutRef}
              onMouseEnter={openFlyout}
              onMouseLeave={closeFlyout}
              style={{ position:"fixed", left:220, top:flyoutTop, background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, boxShadow:"0 8px 32px rgba(15,23,42,0.14)", width:260, padding:"8px 6px", zIndex:40, maxHeight:`calc(100vh - ${flyoutTop+16}px)`, overflowY:"auto" }}
            >
              <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.07em", padding:"4px 12px 8px" }}>All Applications</div>
              {appItems.map(item => {
                const isFav = favourites.includes(item.k);
                return (
                  <div
                    key={item.k}
                    onMouseEnter={() => setHoveredApp(item.k)}
                    onMouseLeave={() => setHoveredApp(null)}
                    style={{ display:"flex", alignItems:"center", gap:4, borderRadius:8, padding:"2px 4px 2px 8px", background: hoveredApp===item.k ? "#f8fafc" : "transparent", transition:"background 0.1s" }}
                  >
                    <button
                      onClick={() => { onNavigate(item.k); setFlyoutOpen(false); }}
                      style={{ display:"flex", alignItems:"center", gap:9, flex:1, padding:"6px 6px 6px 0", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight: view===item.k ? 600 : 500, color: view===item.k ? "#0284C7" : "#1e293b", textAlign:"left", fontFamily:"inherit" }}
                    >
                      <span style={{ fontSize:13, width:18, textAlign:"center", flexShrink:0, opacity:0.6 }}>{item.icon}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ lineHeight:1.3 }}>{item.l}</div>
                        {hoveredApp===item.k && <div style={{ fontSize:11, color:"#64748b", marginTop:2, lineHeight:1.4 }}>{item.desc}</div>}
                      </div>
                    </button>
                    {/* Star / favourite toggle */}
                    <button
                      onClick={() => onToggleFavourite(item.k)}
                      title={isFav ? "Remove from favourites" : "Add to favourites"}
                      style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color: isFav ? "#f59e0b" : "#cbd5e1", padding:"4px", borderRadius:6, flexShrink:0, lineHeight:1, transition:"color 0.12s" }}
                      onMouseEnter={e=>e.currentTarget.style.color=isFav?"#d97706":"#94a3b8"}
                      onMouseLeave={e=>e.currentTarget.style.color=isFav?"#f59e0b":"#cbd5e1"}
                    >★</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: settings / dev */}
      <div style={{ padding:"8px 6px", borderTop:"1px solid #f1f5f9", display:"flex", flexDirection:"column", gap:1, flexShrink:0 }}>
        {bottomItems.map(item => <NavBtn key={item.k} item={item} />)}
      </div>
    </div>
  );
}

// ── Lock Screen ───────────────────────────────────────────────────────────────
function LockScreen({authConfig,onUnlock}){
  const [pin,setPin]=useState("");
  const [totpCode,setTotpCode]=useState("");
  const [phase,setPhase]=useState("pin"); // "pin" | "totp"
  const [err,setErr]=useState("");
  const [bioBusy,setBioBusy]=useState(false);
  const [shaking,setShaking]=useState(false);
  const MAX=6;

  const shake=()=>{setShaking(true);setTimeout(()=>setShaking(false),500);};

  const verifyPin=async(candidate)=>{
    const h=await hashPin(candidate,authConfig.pinSalt);
    if(h===authConfig.pinHash){
      if(authConfig.totpEnabled&&authConfig.totpSecret){setPhase("totp");setPin("");}
      else onUnlock();
    } else{shake();setErr("Incorrect PIN");setPin("");}
  };

  const verifyTotp=async()=>{
    const now=await calcTOTP(authConfig.totpSecret);
    const prev=await calcTOTP(authConfig.totpSecret,Date.now()-30000);
    if(totpCode===now||totpCode===prev){onUnlock();}
    else{shake();setErr("Invalid code");setTotpCode("");}
  };

  const pressKey=async(k)=>{
    if(phase==="totp") return;
    setErr("");
    if(k==="del"){setPin(p=>p.slice(0,-1));return;}
    const next=pin+k;
    setPin(next);
    if(next.length===MAX) await verifyPin(next);
  };

  const tryBiometric=async()=>{
    if(!authConfig.webauthnCredId){return;}
    setBioBusy(true);setErr("");
    try{
      const credId=_b64ud(authConfig.webauthnCredId);
      const challenge=crypto.getRandomValues(new Uint8Array(32));
      await navigator.credentials.get({publicKey:{
        challenge,
        allowCredentials:[{type:"public-key",id:credId}],
        userVerification:"required",
        timeout:60000,
        rpId:"localhost",
      }});
      if(authConfig.totpEnabled&&authConfig.totpSecret){setPhase("totp");}
      else onUnlock();
    }catch(e){
      if(e.name!=="NotAllowedError") setErr("Biometric failed. Use your PIN.");
    }
    setBioBusy(false);
  };

  const keys=["1","2","3","4","5","6","7","8","9","","0","del"];

  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"#0a0a0f",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      {/* Mountain icon */}
      <div style={{marginBottom:16}}>
        <svg viewBox="0 0 80 80" width={64} height={64}>
          <rect width={80} height={80} rx={16} fill="#111"/>
          <polygon points="6,62 18,44 22,48 28,36 34,44 40,16 46,44 52,36 58,48 62,44 74,62" fill="#fff"/>
          <rect x={6} y={62} width={68} height={4} fill="#fff"/>
        </svg>
      </div>
      <div style={{color:"#fff",fontSize:22,fontWeight:800,letterSpacing:"-0.5px",marginBottom:4}}>CashHeap</div>
      <div style={{color:"#6b7280",fontSize:13,marginBottom:36}}>
        {phase==="totp"?"Enter your authenticator code":"Enter your PIN to continue"}
      </div>

      {phase==="pin"&&(
        <>
          {/* PIN dots */}
          <div style={{display:"flex",gap:14,marginBottom:32,animation:shaking?"shake 0.4s ease":"none"}}>
            <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
            {Array.from({length:MAX}).map((_,i)=>(
              <div key={i} style={{width:16,height:16,borderRadius:"50%",background:i<pin.length?"#3b82f6":"rgba(255,255,255,0.15)",border:"2px solid",borderColor:i<pin.length?"#3b82f6":"rgba(255,255,255,0.25)",transition:"background .15s,border-color .15s"}}/>
            ))}
          </div>

          {/* Numpad */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,72px)",gap:12,marginBottom:20}}>
            {keys.map((k,i)=>(
              <button key={i} onClick={()=>k&&pressKey(k)}
                style={{height:72,borderRadius:50,border:"none",cursor:k?"pointer":"default",
                  background:k?"rgba(255,255,255,0.08)":"transparent",
                  color:"#fff",fontSize:k==="del"?18:24,fontWeight:700,fontFamily:"inherit",
                  transition:"background .1s, transform .1s",
                  opacity:k?1:0
                }}
                onMouseDown={e=>{if(k)e.currentTarget.style.background="rgba(255,255,255,0.18)";}}
                onMouseUp={e=>{if(k)e.currentTarget.style.background="rgba(255,255,255,0.08)";}}
                onMouseLeave={e=>{if(k)e.currentTarget.style.background="rgba(255,255,255,0.08)";}}
              >
                {k==="del"?"⌫":k}
              </button>
            ))}
          </div>

          {/* Biometric */}
          {authConfig.webauthnCredId&&(
            <button onClick={tryBiometric} disabled={bioBusy}
              style={{background:"none",border:"1.5px solid rgba(255,255,255,0.2)",color:"rgba(255,255,255,0.7)",borderRadius:24,padding:"10px 22px",fontSize:13,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,marginBottom:12,transition:"border-color .2s,color .2s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.5)";e.currentTarget.style.color="#fff";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.2)";e.currentTarget.style.color="rgba(255,255,255,0.7)";}}
            >
              {bioBusy?<span style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",display:"inline-block",animation:"spin 0.8s linear infinite"}}/>:"👆"}
              {bioBusy?"Verifying…":"Use Touch ID / Biometrics"}
            </button>
          )}
        </>
      )}

      {phase==="totp"&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <div style={{animation:shaking?"shake 0.4s ease":"none"}}>
            <input
              autoFocus
              value={totpCode}
              onChange={e=>setTotpCode(e.target.value.replace(/\D/g,"").slice(0,6))}
              placeholder="000000"
              style={{width:160,textAlign:"center",fontSize:28,fontWeight:700,letterSpacing:8,padding:"14px 0",background:"rgba(255,255,255,0.08)",border:"2px solid rgba(255,255,255,0.15)",borderRadius:12,color:"#fff",fontFamily:"monospace",outline:"none"}}
              onKeyDown={e=>e.key==="Enter"&&totpCode.length===6&&verifyTotp()}
            />
          </div>
          <button onClick={verifyTotp} disabled={totpCode.length!==6}
            style={{background:totpCode.length===6?"#3b82f6":"rgba(255,255,255,0.1)",color:"#fff",border:"none",borderRadius:10,padding:"12px 32px",fontSize:14,fontWeight:700,cursor:totpCode.length===6?"pointer":"default",fontFamily:"inherit",transition:"background .2s"}}
          >Verify</button>
          <button onClick={()=>{setPhase("pin");setTotpCode("");setErr("");}} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>← Back to PIN</button>
        </div>
      )}

      {err&&<div style={{marginTop:8,color:"#f87171",fontSize:12,fontWeight:600}}>{err}</div>}
    </div>
  );
}

// ── Terms of Service Modal ────────────────────────────────────────────────────
function TermsOfServiceModal({onAccept,onDecline}){
  const [scrolled,setScrolled]=useState(false);
  const [checked,setChecked]=useState(false);
  const bodyRef=useRef(null);
  const onScroll=()=>{
    const el=bodyRef.current;
    if(!el) return;
    if(el.scrollTop+el.clientHeight>=el.scrollHeight-20) setScrolled(true);
  };
  const canAccept=scrolled&&checked;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.75)",zIndex:99999,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <div style={{background:"#fff",borderRadius:20,boxShadow:"0 32px 80px rgba(15,23,42,0.35)",width:"min(680px,95vw)",maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Header */}
        <div style={{background:"linear-gradient(135deg,#0f172a,#1e3a5f)",padding:"28px 32px 24px",flexShrink:0}}>
          <div style={{fontSize:11,fontWeight:700,color:"#93c5fd",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8}}>Before You Continue</div>
          <div style={{fontSize:22,fontWeight:800,color:"#fff",letterSpacing:"-0.4px",marginBottom:4}}>Terms of Service & Privacy Policy</div>
          <div style={{fontSize:12,color:"#94a3b8"}}>CashHeap · Effective {new Date().toLocaleDateString("en-CA",{year:"numeric",month:"long",day:"numeric"})}</div>
        </div>

        {/* Scrollable body */}
        <div ref={bodyRef} onScroll={onScroll} style={{flex:1,overflowY:"auto",padding:"28px 32px",fontSize:12.5,color:"#334155",lineHeight:1.75}}>

          {[
            {h:"1. Acceptance of Terms",
             b:`By accessing or using CashHeap ("the Application"), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Application. These terms apply to all users of the Application, including users who are contributors of content or other services.`},

            {h:"2. Description of Service",
             b:`CashHeap is a personal financial management application designed to help individuals track income, expenses, bills, investments, and net worth. The Application runs locally on your device and may communicate with third-party AI services (such as Google Gemini or Ollama) when those features are enabled by the user.`},

            {h:"3. User Data & Privacy",
             b:`All financial data you enter is stored locally on your device in a SQLite database. CashHeap does not transmit your financial data to any remote server operated by the Application's developers. When AI features are used, transaction summaries or queries may be sent to third-party AI providers (Google Gemini or a local Ollama instance) solely to generate responses. You are solely responsible for the accuracy, legality, and appropriateness of all data you enter. You acknowledge that you have the right to enter any financial information you input into the Application.`},

            {h:"4. No Financial Advice",
             b:`The Application and its AI features (including the Jarvis assistant) provide informational summaries and calculations only. Nothing in the Application constitutes financial, investment, legal, or tax advice. You should consult a qualified professional before making any financial decisions. The developers of CashHeap are not liable for any financial decisions made based on information provided by the Application.`},

            {h:"5. AI-Generated Content",
             b:`Responses generated by integrated AI models (Google Gemini, Ollama, or any other configured model) are automated and may contain errors, inaccuracies, or omissions. AI-generated content is provided "as-is" without any warranty of accuracy. You agree not to rely solely on AI-generated responses for financial planning or decision-making.`},

            {h:"6. Acceptable Use",
             b:`You agree to use the Application only for lawful personal financial management purposes. You agree not to: (a) use the Application to track, conceal, or facilitate unlawful financial activity; (b) reverse-engineer, decompile, or modify the Application for malicious purposes; (c) use the Application to infringe any intellectual property rights; (d) attempt to gain unauthorised access to any systems or networks connected to the Application.`},

            {h:"7. Intellectual Property",
             b:`The Application, including its source code, design, and documentation, is the intellectual property of the developer. All rights are reserved. You are granted a limited, non-exclusive, non-transferable licence to use the Application for personal, non-commercial purposes only. You may not distribute, sell, or sublicense the Application without express written permission.`},

            {h:"8. Third-Party Services",
             b:`The Application integrates with optional third-party services including Google Gemini AI and Ollama. Your use of these services is governed by their respective terms of service and privacy policies. The developers of CashHeap are not responsible for the practices, availability, or content of third-party services. API keys you provide are stored locally on your device and are not accessible to the Application's developers.`},

            {h:"9. Disclaimer of Warranties",
             b:`The Application is provided "as is" and "as available" without warranties of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. The developers do not warrant that the Application will be uninterrupted, error-free, or free of viruses or other harmful components. You assume full responsibility for all risks associated with your use of the Application.`},

            {h:"10. Limitation of Liability",
             b:`To the fullest extent permitted by applicable law, the developers of CashHeap shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, loss of profits, or financial losses, arising out of or related to your use of the Application, even if advised of the possibility of such damages. In no event shall the developers' total liability exceed the amount you paid for the Application.`},

            {h:"11. Data Loss & Backups",
             b:`You are solely responsible for backing up your data. The Application stores data in a local database file. The developers are not liable for any data loss resulting from software bugs, hardware failure, accidental deletion, or any other cause. You are strongly encouraged to maintain regular backups of your database file.`},

            {h:"12. Updates & Modifications",
             b:`The developers reserve the right to modify, update, or discontinue the Application at any time without notice. These Terms of Service may be updated periodically. Continued use of the Application after any changes constitutes acceptance of the new terms. Material changes will be communicated through the Application's update notifications where possible.`},

            {h:"13. Governing Law",
             b:`These Terms of Service shall be governed by and construed in accordance with the laws of the jurisdiction in which the developer is located, without regard to its conflict of law provisions. Any disputes arising under these terms shall be subject to the exclusive jurisdiction of the courts of that jurisdiction.`},

            {h:"14. Severability",
             b:`If any provision of these Terms of Service is found to be unenforceable or invalid under applicable law, that provision shall be modified to the minimum extent necessary to make it enforceable, and the remaining provisions shall continue in full force and effect.`},

            {h:"15. Entire Agreement",
             b:`These Terms of Service constitute the entire agreement between you and the developers regarding your use of the Application and supersede all prior agreements, understandings, and representations relating to the Application.`},

            {h:"16. Contact",
             b:`If you have any questions about these Terms of Service or the Application, you may reach out through the project's GitHub repository at github.com/gchaplik/cashheap.`},
          ].map(({h,b})=>(
            <div key={h} style={{marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:6}}>{h}</div>
              <div style={{color:"#475569"}}>{b}</div>
            </div>
          ))}

          <div style={{borderTop:"1px solid #e2e8f0",paddingTop:16,marginTop:8,color:"#64748b",fontSize:11,fontStyle:"italic"}}>
            Last updated: {new Date().toLocaleDateString("en-CA",{year:"numeric",month:"long",day:"numeric"})} · CashHeap is a personal project. Use at your own discretion.
          </div>
        </div>

        {/* Footer */}
        <div style={{padding:"16px 32px 24px",borderTop:"1px solid #f1f5f9",flexShrink:0,background:"#f8fafc"}}>
          {!scrolled&&(
            <div style={{fontSize:11,color:"#94a3b8",textAlign:"center",marginBottom:12}}>
              ↓ Scroll to the bottom to enable acceptance
            </div>
          )}
          <label style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:16,cursor:"pointer",opacity:scrolled?1:0.4,pointerEvents:scrolled?"auto":"none"}}>
            <input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} style={{marginTop:2,width:15,height:15,accentColor:"#0284C7",flexShrink:0}}/>
            <span style={{fontSize:12,color:"#334155",lineHeight:1.5}}>I have read and agree to the Terms of Service and Privacy Policy. I understand that this application provides no financial advice and I am solely responsible for my financial decisions.</span>
          </label>
          <button
            onClick={canAccept?onAccept:undefined}
            disabled={!canAccept}
            style={{width:"100%",padding:"13px",borderRadius:10,background:canAccept?"linear-gradient(135deg,#0284C7,#0369a1)":"#e2e8f0",color:canAccept?"#fff":"#94a3b8",border:"none",fontSize:14,fontWeight:800,cursor:canAccept?"pointer":"not-allowed",transition:"all .2s",letterSpacing:"0.01em",fontFamily:"inherit"}}
          >
            {canAccept?"Accept & Continue →":"Read the full terms above to continue"}
          </button>
          <button
            onClick={onDecline}
            style={{width:"100%",padding:"10px",marginTop:8,borderRadius:10,background:"transparent",color:"#94a3b8",border:"1px solid #e2e8f0",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}}
            onMouseOver={e=>{e.currentTarget.style.background="#fef2f2";e.currentTarget.style.color="#ef4444";e.currentTarget.style.borderColor="#fecaca";}}
            onMouseOut={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";e.currentTarget.style.borderColor="#e2e8f0";}}
          >
            Decline &amp; Close App
          </button>
        </div>

      </div>
    </div>
  );
}

function WhatsNewModal({onClose}){
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",zIndex:100,display:"flex",alignItems:"flex-start",justifyContent:"flex-start",padding:"66px 0 0 20px",backdropFilter:"blur(2px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,border:"1px solid #eef0f6",boxShadow:"0 24px 64px rgba(15,23,42,0.22)",width:348,maxHeight:"78vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"18px 20px 14px",borderBottom:"1px solid #e0f2fe",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,background:"linear-gradient(135deg,#0284C7,#0369a1)",borderRadius:"20px 20px 0 0"}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:"#fff",letterSpacing:"-0.2px"}}>What's New</div>
            <div style={{fontSize:11,color:"#bae6fd",marginTop:2,fontWeight:500}}>Features you can try right now</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"none",cursor:"pointer",fontSize:16,color:"#e0f2fe",padding:"4px 8px",borderRadius:8,lineHeight:1,fontFamily:"inherit"}}>×</button>
        </div>
        <div style={{overflowY:"auto",padding:"8px 0"}}>
          {WHATS_NEW.map((f,i)=>(
            <div key={i} style={{padding:"11px 20px",borderBottom:i<WHATS_NEW.length-1?"1px solid #f0f9ff":"none"}}>
              <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}>
                <span style={{color:"#06B6D4",fontSize:9,flexShrink:0,fontWeight:800}}>{f.icon}</span>
                <span style={{fontWeight:700,fontSize:13,color:"#1E293B",letterSpacing:"-0.1px"}}>{f.title}</span>
              </div>
              <div style={{fontSize:12,color:"#64748b",lineHeight:1.6,paddingLeft:17}}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UpdateBanner() {
  const [status, setStatus] = useState(null); // 'available' | 'ready'
  const [version, setVersion] = useState('');
  useEffect(() => {
    if (!window.electronUpdater) return;
    window.electronUpdater.onUpdateAvailable(info => { setStatus('available'); setVersion(info.version); });
    window.electronUpdater.onUpdateDownloaded(info => { setStatus('ready'); setVersion(info.version); });
  }, []);
  if (!status) return null;
  return (
    <div style={{position:'fixed',top:0,left:0,right:0,zIndex:99999,background:status==='ready'?'#0284C7':'#0f172a',color:'#fff',fontSize:12,fontWeight:600,padding:'8px 20px',display:'flex',alignItems:'center',justifyContent:'center',gap:12,fontFamily:'system-ui,sans-serif'}}>
      {status==='available' ? `⬇️ Downloading update v${version}…` : `✅ Update v${version} ready — `}
      {status==='ready' && <button onClick={()=>window.electronUpdater.restartAndInstall()} style={{background:'#fff',color:'#0284C7',border:'none',borderRadius:6,padding:'3px 12px',fontWeight:700,cursor:'pointer',fontSize:12}}>Restart now</button>}
    </div>
  );
}

export default function App(){
  const [view,setView]=useState("dashboard");
  const [txns,setTxns]=useState([]);
  const [cats,setCats]=useState(DEFAULT_CATS);
  const [expected,setExpected]=useState([]);
  const [catBudgets,setCatBudgets]=useState({});
  const [vacations,setVacations]=useState([]);
  const [vacationTxns,setVacationTxns]=useState([]);
  const [receiptFPs,setReceiptFPs]=useState(new Set());
  const [bills,setBills]=useState([]);
  const [billPayments,setBillPayments]=useState([]);
  const [goals,setGoals]=useState([]);
  const [accounts,setAccounts]=useState([]);
  const [accountHistory,setAccountHistory]=useState([]);
  const [holdings,setHoldings]=useState([]);
  const [stockPrices,setStockPrices]=useState({});
  const [fxRate,setFxRate]=useState(1.38);
  const [debts,setDebts]=useState([]);
  const [subscriptions,setSubscriptions]=useState([]);
  const [taxItems,setTaxItems]=useState([]);
  const [wishlist,setWishlist]=useState([]);
  const [members,setMembers]=useState([]);
  const [splits,setSplits]=useState({});
  const [settlements,setSettlements]=useState([]);
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const [schema,setSchema]=useState(DEFAULT_SCHEMA);
  const [insightWidgets,setInsightWidgets]=useState([]);
  const [insightMessages,setInsightMessages]=useState([]);
  const [favourites,setFavourites]=useState(["bills","history","stocks"]);
  const toggleFavourite=k=>setFavourites(prev=>{const next=prev.includes(k)?prev.filter(x=>x!==k):[...prev,k];saveServerData({favourites:next});return next;});
  const [inDepthMode,setInDepthMode]=useState(false);
  const [selectedItems,setSelectedItems]=useState([]);
  const [globalChatOpen,setGlobalChatOpen]=useState(false);
  const [ready,setReady]=useState(false);
  const [month,setMonth]=useState(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const [historyMonth,setHistoryMonth]=useState(today().slice(0,7));
  const [showWhatsNew,setShowWhatsNew]=useState(false);
  const [tosAccepted,setTosAccepted]=useState(false);
  const [authConfig,setAuthConfig]=useState({});
  const [isUnlocked,setIsUnlocked]=useState(true); // becomes false once authConfig.enabled is confirmed
  const lastActivityRef=useRef(Date.now());
  const lockTimerRef=useRef(null);
  const [toast,setToast]=useState(null);
  const toastTimer=useRef(null);
  const showToast=(msg,undoFn)=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast({msg,undoFn});toastTimer.current=setTimeout(()=>setToast(null),5000);};
  const dismissToast=()=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast(null);};

  // Auto-lock on inactivity
  useEffect(()=>{
    if(!authConfig.enabled||!authConfig.autoLockMinutes) return;
    const ms=authConfig.autoLockMinutes*60*1000;
    const onActivity=()=>{lastActivityRef.current=Date.now();};
    document.addEventListener("mousemove",onActivity,{passive:true});
    document.addEventListener("keydown",onActivity,{passive:true});
    lockTimerRef.current=setInterval(()=>{
      if(isUnlocked&&Date.now()-lastActivityRef.current>ms){setIsUnlocked(false);}
    },15000);
    return()=>{document.removeEventListener("mousemove",onActivity);document.removeEventListener("keydown",onActivity);clearInterval(lockTimerRef.current);};
  },[authConfig.enabled,authConfig.autoLockMinutes,isUnlocked]);

  useEffect(()=>{
    loadServerData().then(d => {
      if(d.txns) setTxns(d.txns);
      if(d.cats) setCats(d.cats);
      if(d.expected) setExpected(d.expected);
      if(d.catBudgets) setCatBudgets(d.catBudgets);
      if(d.vacations) setVacations(d.vacations);
      if(d.vacationTxns) setVacationTxns(d.vacationTxns);
      if(d.receiptFPs) setReceiptFPs(new Set(d.receiptFPs));
      if(d.bills) setBills(d.bills);
      if(d.billPayments) setBillPayments(d.billPayments);
      if(d.goals) setGoals(d.goals);
      if(d.accounts) setAccounts(d.accounts);
      if(d.accountHistory) setAccountHistory(d.accountHistory);
      if(d.holdings) setHoldings(d.holdings);
      if(d.favourites) setFavourites(d.favourites);
      if(d.settings) setSettings({...DEFAULT_SETTINGS,...d.settings});
      if(d.schema) setSchema(d.schema);
      if(d.insightMessages) setInsightMessages(d.insightMessages);
      if(d.insightWidgets) setInsightWidgets(d.insightWidgets);
      if(d.debts) setDebts(d.debts);
      if(d.subscriptions) setSubscriptions(d.subscriptions);
      if(d.taxItems) setTaxItems(d.taxItems);
      if(d.wishlist) setWishlist(d.wishlist);
      if(d.members) setMembers(d.members);
      if(d.splits) setSplits(d.splits);
      if(d.settlements) setSettlements(d.settlements);
      if(d.tosAccepted) setTosAccepted(true);
      if(d.authConfig&&typeof d.authConfig==="object"){
        setAuthConfig(d.authConfig);
        if(d.authConfig.enabled) setIsUnlocked(false);
      }
      setReady(true);
    });
  },[]);

  const saveTxns=t=>{setTxns(t);saveServerData({txns:t});};
  const saveCats=c=>{setCats(c);saveServerData({cats:c});};
  const saveExpected=e=>{setExpected(e);saveServerData({expected:e});};
  const saveCatBudgets=b=>{setCatBudgets(b);saveServerData({catBudgets:b})};
  const saveVacations=v=>{setVacations(v);saveServerData({vacations:v})};
  const saveVacationTxns=t=>{setVacationTxns(t);saveServerData({vacationTxns:t})};
  const saveReceiptFPs=fps=>{setReceiptFPs(fps);saveServerData({receiptFPs:[...fps]})};
  const saveBills=b=>{setBills(b);saveServerData({bills:b})};
  const saveBillPayments=p=>{setBillPayments(p);saveServerData({billPayments:p})};
  const saveGoals=g=>{setGoals(g);saveServerData({goals:g})};
  const saveAccounts=a=>{setAccounts(a);saveServerData({accounts:a})};
  const saveAccountHistory=h=>{setAccountHistory(h);saveServerData({accountHistory:h})};
  const saveHoldings=h=>{setHoldings(h);saveServerData({holdings:h})};
  const saveDebts=d=>{setDebts(d);saveServerData({debts:d})};
  const saveSubscriptions=s=>{setSubscriptions(s);saveServerData({subscriptions:s})};
  const saveTaxItems=t=>{setTaxItems(t);saveServerData({taxItems:t})};
  const saveWishlist=w=>{setWishlist(w);saveServerData({wishlist:w})};
  const saveMembers=m=>{setMembers(m);saveServerData({members:m})};
  const saveSplits=s=>{setSplits(s);saveServerData({splits:s})};
  const saveSettlements=s=>{setSettlements(s);saveServerData({settlements:s})};
  const saveAuthConfig=c=>{setAuthConfig(c);saveServerData({authConfig:c});if(!c.enabled)setIsUnlocked(true);};
  const saveSettings=s=>{setSettings(s);saveServerData({settings:s})};
  const saveSchema=s=>{setSchema(s);saveServerData({schema:s})};
  // Auto-persist insight chat & widgets whenever they change (skip initial empty load)
  const insightMsgsReady=useRef(false);
  useEffect(()=>{if(!insightMsgsReady.current){insightMsgsReady.current=true;return;}saveServerData({insightMessages});},[insightMessages]);
  const insightWgtsReady=useRef(false);
  useEffect(()=>{if(!insightWgtsReady.current){insightWgtsReady.current=true;return;}saveServerData({insightWidgets});},[insightWidgets]);
  const toggleBill=id=>{
    const paid=billPayments.some(p=>p.billId===id&&p.month===month);
    if(paid){saveBillPayments(billPayments.filter(p=>!(p.billId===id&&p.month===month)));}
    else{const b=bills.find(x=>x.id===id);if(b)saveBillPayments([...billPayments,{id:uid(),billId:id,month,paidDate:today(),amount:b.amount}]);}
  };

  const confirmPayment=id=>{
    const item=expected.find(e=>e.id===id);if(!item)return;
    const txnId=uid();
    saveTxns([...txns,{id:txnId,type:"income",merchant:item.source,source:item.source,amount:item.amount,date:today(),note:item.note||""}]);
    saveExpected(expected.map(e=>e.id===id?{...e,confirmed:true,confirmedDate:today(),confirmedTxnId:txnId}:e));
  };
  const revertPayment=id=>{
    const item=expected.find(e=>e.id===id);if(!item)return;
    if(item.confirmedTxnId) saveTxns(txns.filter(t=>t.id!==item.confirmedTxnId));
    saveExpected(expected.map(e=>e.id===id?{...e,confirmed:false,confirmedDate:null,confirmedTxnId:null}:e));
  };

  if(!ready) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",color:"#9ca3af",fontSize:13}}>Loading...</div>;
  if(!isUnlocked) return <LockScreen authConfig={authConfig} onUnlock={()=>{setIsUnlocked(true);lastActivityRef.current=Date.now();}}/>;

  const pendingCount=expected.filter(e=>!e.confirmed).length;
  const unpaidBillCount=bills.filter(b=>b.active!==false&&!billPayments.some(p=>p.billId===b.id&&p.month===month)).length;

  // Build CSS filter string from settings
  const cbFilters={
    none:         "",
    deuteranopia: "url(#cb-deuteranopia)",
    protanopia:   "url(#cb-protanopia)",
    tritanopia:   "url(#cb-tritanopia)",
    achromatopsia:"url(#cb-achromatopsia)",
  };
  const rootFilter=[
    settings.darkMode?"invert(1) hue-rotate(180deg)":"",
    cbFilters[settings.colorBlindMode]||"",
  ].filter(Boolean).join(" ")||undefined;

  return (
    <>
    {/* SVG colorblind filter definitions (hidden) */}
    <svg style={{position:"absolute",width:0,height:0,overflow:"hidden"}} aria-hidden="true">
      <defs>
        <filter id="cb-deuteranopia"><feColorMatrix type="matrix" values="0.367 0.861 -0.228 0 0  0.280 0.673  0.047 0 0  -0.012 0.043  0.969 0 0  0 0 0 1 0"/></filter>
        <filter id="cb-protanopia">  <feColorMatrix type="matrix" values="0.152 1.053 -0.205 0 0  0.115 0.786  0.099 0 0  -0.004 -0.048 1.052 0 0  0 0 0 1 0"/></filter>
        <filter id="cb-tritanopia">  <feColorMatrix type="matrix" values="1.256 -0.077 -0.180 0 0  -0.078 0.931  0.148 0 0  0.005  0.691  0.304 0 0  0 0 0 1 0"/></filter>
        <filter id="cb-achromatopsia"><feColorMatrix type="saturate" values="0"/></filter>
      </defs>
    </svg>
    <UpdateBanner/>
    {!tosAccepted&&<TermsOfServiceModal onAccept={()=>{setTosAccepted(true);saveServerData({tosAccepted:true});}} onDecline={()=>{ if(window.electronApp?.quit) window.electronApp.quit(); else window.close(); }}/>}
    <div style={{display:"flex",height:"100vh",overflow:"hidden",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",color:"#1E293B",background:"#f0f9ff",filter:rootFilter}}>
      {showWhatsNew&&<WhatsNewModal onClose={()=>setShowWhatsNew(false)}/>}
      {toast&&<Toast msg={toast.msg} undoFn={toast.undoFn} onClose={dismissToast}/>}

      {/* Left sidebar */}
      <Sidebar
        view={view}
        onNavigate={setView}
        favourites={favourites}
        onToggleFavourite={toggleFavourite}
        pendingCount={pendingCount}
        unpaidBillCount={unpaidBillCount}
        devMode={settings.devMode}
        onShowWhatsNew={()=>setShowWhatsNew(v=>!v)}
      />

      {/* Main content */}
      <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>
        {(()=>{const visibleTxns=txns.filter(t=>t.date&&t.date<=today());return(<>
        {view==="dashboard"&&<><Dashboard txns={visibleTxns} expected={expected} cats={cats} catBudgets={catBudgets} month={month} setMonth={setMonth} onConfirm={confirmPayment} onRevert={revertPayment} vacations={vacations} vacationTxns={vacationTxns} bills={bills} billPayments={billPayments} onToggleBill={toggleBill} goals={goals} accounts={accounts} holdings={holdings} stockPrices={stockPrices} fxRate={fxRate}/><div style={{marginTop:24}}><HealthScore txns={visibleTxns} accounts={accounts} holdings={holdings} catBudgets={catBudgets} goals={goals} bills={bills} billPayments={billPayments} month={month} fxRate={fxRate} stockPrices={stockPrices}/></div><div style={{marginTop:8}}><SpendingAnomalies txns={visibleTxns} cats={cats} month={month}/></div><div style={{marginTop:8}}><AlertsPanel txns={visibleTxns} bills={bills} billPayments={billPayments} catBudgets={catBudgets} goals={goals} month={month} settings={settings} onUpdateSettings={saveSettings}/></div></>}
        {view==="expected"&&<ExpectedIncome expected={expected} onUpdate={saveExpected} onConfirm={confirmPayment}/>}
        {view==="folder"&&<LocalFolderSync cats={cats} receiptFPs={receiptFPs} onSaveFPs={saveReceiptFPs} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="upload"&&<UploadReceipts cats={cats} receiptFPs={receiptFPs} onSaveFPs={saveReceiptFPs} onSave={t=>{saveTxns([...txns,...t]);setHistoryMonth(t[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="manual"&&<RecurringForm title="Add Expense" type="expense" cats={cats} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="income"&&<RecurringForm title="Add Income" type="income" cats={cats} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="history"&&<History txns={visibleTxns} cats={cats} onUpdate={saveTxns} fMonth={historyMonth} setFMonth={setHistoryMonth} onToast={showToast}/>}
        {view==="bills"&&<Bills bills={bills} billPayments={billPayments} onSaveBills={saveBills} onSaveBillPayments={saveBillPayments} cats={cats}/>}
        {view==="goals"&&<Goals goals={goals} onSaveGoals={saveGoals}/>}
        {view==="networth"&&<NetWorth accounts={accounts} accountHistory={accountHistory} onSaveAccounts={saveAccounts} onSaveAccountHistory={saveAccountHistory} holdings={holdings} stockPrices={stockPrices} fxRate={fxRate}/>}
        {view==="stocks"&&<Stocks holdings={holdings} onSaveHoldings={saveHoldings} onPricesUpdate={setStockPrices} onFxRateUpdate={setFxRate}/>}
        </>);})()}
        {view==="vacations"&&<Vacations vacations={vacations} vacationTxns={vacationTxns} onSaveVacations={saveVacations} onSaveTxns={saveVacationTxns}/>}
        {view==="categories"&&<Categories cats={cats} onUpdate={saveCats} catBudgets={catBudgets} onUpdateBudgets={saveCatBudgets}/>}
        {view==="import"&&<CSVImport txns={txns} cats={cats} onImport={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));}}/>}
        {view==="reports"&&<Reports txns={txns} bills={bills} billPayments={billPayments} cats={cats} catBudgets={catBudgets} goals={goals} vacations={vacations} vacationTxns={vacationTxns} settings={settings}/>}
        {view==="cashflow"&&<CashFlowForecast txns={txns} bills={bills} billPayments={billPayments} expected={expected} accounts={accounts} settings={settings}/>}
        {view==="debt"&&<DebtTracker debts={debts} onSaveDebts={saveDebts}/>}
        {view==="subscriptions"&&<SubscriptionManager subscriptions={subscriptions} onSave={saveSubscriptions} txns={txns}/>}
        {view==="tax"&&<TaxTracker txns={txns} taxItems={taxItems} onSaveTaxItems={saveTaxItems} settings={settings}/>}
        {view==="retirement"&&<RetirementPlanner txns={txns} accounts={accounts} settings={settings}/>}
        {view==="calendar"&&<FinancialCalendar bills={bills} billPayments={billPayments} expected={expected} goals={goals} vacations={vacations} txns={txns}/>}
        {view==="wishlist"&&<WishlistPage wishlist={wishlist} onSave={saveWishlist} txns={txns} goals={goals} onSaveGoals={saveGoals}/>}
        {view==="mortgage"&&<MortgageCalculator accounts={accounts} onSaveAccounts={saveAccounts}/>}
        {view==="household"&&<Household members={members} onSaveMembers={saveMembers} txns={txns} onSaveTxns={saveTxns} splits={splits} onSaveSplits={saveSplits} settlements={settlements} onSaveSettlements={saveSettlements}/>}
        {view==="settings"&&<Settings settings={settings} onSave={saveSettings} authConfig={authConfig} onSaveAuthConfig={saveAuthConfig}/>}
        {view==="datamodel"&&settings.devMode&&<DataModel schema={schema} onSave={saveSchema}/>}
        {view==="insights"&&<Insights schema={schema} settings={settings} onNavigate={setView} widgets={insightWidgets} onSetWidgets={setInsightWidgets} messages={insightMessages} onSetMessages={setInsightMessages}/>}
      </div>
      <GlobalChat view={view} onNavigate={setView} settings={settings} inDepthMode={inDepthMode} onSetInDepthMode={setInDepthMode} selectedItems={selectedItems} onSetSelectedItems={setSelectedItems} open={globalChatOpen} onSetOpen={setGlobalChatOpen}/>
    </div>
    </>
  );
}

import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell } from "recharts";

const DEFAULT_CATS = ["Groceries","Dining","Transport","Utilities","Entertainment","Health","Shopping","Fuel","Other"];
const COLORS = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#ec4899","#84cc16","#6b7280","#f97316"];
const CADENCES = [
  {v:"once",l:"One-time"},{v:"weekly",l:"Weekly"},{v:"biweekly",l:"Bi-weekly (every 2 weeks)"},
  {v:"every15",l:"Every 15 days"},{v:"monthly",l:"Monthly"},{v:"bimonthly",l:"Every 2 months"},
  {v:"quarterly",l:"Quarterly"},{v:"annually",l:"Annually"},
];

const fmt = n => new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(n||0);
const today = () => new Date().toISOString().split("T")[0];
const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
const toB64 = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});
const cLabel = v => (CADENCES.find(c=>c.v===v)||{l:v}).l;
const isPdf = mtype => mtype === "application/pdf";

let _serverData = null;

const fpHash = b64 => {
  let h = 0;
  const step = Math.max(1, b64.length >> 10);
  for (let i = 0; i < b64.length; i += step) h = (Math.imul(31, h) + b64.charCodeAt(i)) | 0;
  return b64.length + '_' + h;
};
// receiptFPs is now persisted in data.json via App state; these are no-ops kept for safety
const loadFPs = () => new Set();
const saveFPs = () => {};

// IndexedDB helpers for persisting FileSystemDirectoryHandle across page loads
const _idb = () => new Promise((res, rej) => {
  const req = indexedDB.open('spend-tracker-fs', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('handles');
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});
const idbPut = async (key, val) => { const db = await _idb(); return new Promise((res,rej) => { const tx=db.transaction('handles','readwrite'); tx.objectStore('handles').put(val,key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); };
const idbGet = async (key) => { const db = await _idb(); return new Promise((res,rej) => { const tx=db.transaction('handles','readonly'); const req=tx.objectStore('handles').get(key); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); };
const idbDel = async (key) => { const db = await _idb(); return new Promise((res,rej) => { const tx=db.transaction('handles','readwrite'); tx.objectStore('handles').delete(key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); };

async function loadServerData() {
  const res = await fetch("/api/data");
  _serverData = await res.json();
  return _serverData;
}

async function saveServerData(patch) {
  if (!_serverData) _serverData = await fetch("/api/data").then(r => r.json());
  _serverData = { ..._serverData, ...patch };
  await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(_serverData) });
}

function buildDates(start,cadence,count) {
  const out=[start]; let cur=new Date(start+"T12:00:00");
  for(let i=1;i<count;i++){
    const n=new Date(cur);
    if(cadence==="weekly") n.setDate(n.getDate()+7);
    else if(cadence==="biweekly") n.setDate(n.getDate()+14);
    else if(cadence==="every15") n.setDate(n.getDate()+15);
    else if(cadence==="monthly") n.setMonth(n.getMonth()+1);
    else if(cadence==="bimonthly") n.setMonth(n.getMonth()+2);
    else if(cadence==="quarterly") n.setMonth(n.getMonth()+3);
    else if(cadence==="annually") n.setFullYear(n.getFullYear()+1);
    out.push(n.toISOString().split("T")[0]); cur=n;
  }
  return out;
}

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

function Dashboard({txns,expected,cats,catBudgets,month,setMonth,onConfirm,onRevert,vacations=[],vacationTxns=[],bills=[],billPayments=[],onToggleBill,goals=[],accounts=[],holdings=[],stockPrices={}}){
  const opts=Array.from({length:13},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-12+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const ml=m=>new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"});
  const mt=txns.filter(t=>t.date&&t.date.startsWith(month));
  const actualIncome=mt.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const txnSpending=mt.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  // Paid bills for this month count as spending
  const paidBillsTotal=billPayments.filter(p=>p.month===month).reduce((s,p)=>s+p.amount,0);
  const spending=txnSpending+paidBillsTotal;
  const mExp=expected.filter(e=>e.expectedDate&&e.expectedDate.startsWith(month));
  const pendingExp=mExp.filter(e=>!e.confirmed).reduce((s,e)=>s+e.amount,0);
  const totalExp=mExp.reduce((s,e)=>s+e.amount,0);
  const projNet=(actualIncome+pendingExp)-spending;
  const actNet=actualIncome-spending;
  const catData=cats.map(c=>({name:c,amount:mt.filter(t=>t.type==="expense"&&t.category===c).reduce((s,t)=>s+t.amount,0),budget:catBudgets[c]||0})).filter(d=>d.amount>0||d.budget>0).sort((a,b)=>b.amount-a.amount);
  const trend=Array.from({length:6},(_,i)=>{
    const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-5+i);
    const ym=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
    const tx=txns.filter(t=>t.date&&t.date.startsWith(ym));
    const ex=expected.filter(e=>e.expectedDate&&e.expectedDate.startsWith(ym));
    return {name:d.toLocaleString("default",{month:"short"}),Income:+tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0).toFixed(2),Expenses:+tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0).toFixed(2),Expected:+ex.filter(e=>!e.confirmed).reduce((s,e)=>s+e.amount,0).toFixed(2)};
  });
  const recent=[...mt].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,8);
  const activeVacations=vacations.filter(v=>v.startDate&&v.startDate.slice(0,7)<=month&&v.endDate&&v.endDate.slice(0,7)>=month);
  const vacSpend=vacationTxns.filter(t=>t.date&&t.date.startsWith(month)).reduce((s,t)=>s+t.amount,0);
  const budgetTotal=Object.values(catBudgets).reduce((s,v)=>s+(v||0),0);
  const budgetRemaining=budgetTotal-spending;
  const vacSpendLabel=activeVacations.length>0?activeVacations.map(v=>v.name).join(", "):null;
  // Month-over-month
  const prevMonth=(()=>{const d=new Date(month+"-02");d.setMonth(d.getMonth()-1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");})();
  const ptxns=txns.filter(t=>t.date&&t.date.startsWith(prevMonth));
  const prevIncome=ptxns.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const prevSpending=ptxns.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
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
  const portfolioValue=holdings.reduce((s,h)=>s+(stockPrices[h.ticker]?.price??0)*h.shares,0);
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
  const [f,setF]=useState({source:"",amount:"",expectedDate:today(),recurrence:"once",note:""});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const [filter,setFilter]=useState("all");
  const [selectMode,setSelectMode]=useState(false);
  const [selected,setSelected]=useState(new Set());
  const toggleSel=id=>setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const exitSelect=()=>{setSelectMode(false);setSelected(new Set());};
  const deleteSelected=()=>{onUpdate(expected.filter(e=>!selected.has(e.id)));exitSelect();};
  const confirmSelected=()=>{[...selected].forEach(id=>onConfirm(id));exitSelect();};
  const allPendingSelected=[...selected].every(id=>{const e=expected.find(x=>x.id===id);return e&&!e.confirmed;});
  const add=()=>{
    if(!f.source.trim()||!f.amount) return;
    const base={source:f.source.trim(),amount:parseFloat(f.amount)||0,expectedDate:f.expectedDate,note:f.note,confirmed:false,confirmedDate:null};
    const items=[{...base,id:uid()}];
    if(f.recurrence!=="once"){
      const count=f.recurrence==="monthly"?11:3;
      for(let i=1;i<=count;i++){
        const d=new Date(f.expectedDate+"T12:00:00");
        if(f.recurrence==="monthly") d.setMonth(d.getMonth()+i);
        else if(f.recurrence==="biweekly") d.setDate(d.getDate()+i*14);
        else if(f.recurrence==="weekly") d.setDate(d.getDate()+i*7);
        items.push({...base,id:uid(),expectedDate:d.toISOString().split("T")[0]});
      }
    }
    onUpdate([...expected,...items]);
    setF({source:"",amount:"",expectedDate:today(),recurrence:"once",note:""});
  };
  const del=id=>onUpdate(expected.filter(e=>e.id!==id));
  const pending=expected.filter(e=>!e.confirmed);
  const confirmed=expected.filter(e=>e.confirmed);
  const shown=filter==="pending"?pending:filter==="confirmed"?confirmed:expected;
  const sorted=[...shown].sort((a,b)=>(a.expectedDate||"").localeCompare(b.expectedDate||""));
  const sumCards=[{l:"Pending Income",v:pending.reduce((s,e)=>s+e.amount,0),c:"#0284C7",sub:pending.length+" item"+(pending.length!==1?"s":"")},{l:"Confirmed Received",v:confirmed.reduce((s,e)=>s+e.amount,0),c:"#059669",sub:confirmed.length+" item"+(confirmed.length!==1?"s":"")},{l:"Total Scheduled",v:expected.reduce((s,e)=>s+e.amount,0),c:"#111827",sub:expected.length+" total"}];
  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Expected Income</h2>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
        <div style={CA}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Add Expected Income</div>
          <Fld label="Source"><input style={IS} value={f.source} onChange={e=>set("source",e.target.value)} placeholder="e.g. Salary, Client payment"/></Fld>
          <Fld label="Amount ($)"><input style={IS} type="number" value={f.amount} onChange={e=>set("amount",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Expected Date"><input style={IS} type="date" value={f.expectedDate} onChange={e=>set("expectedDate",e.target.value)}/></Fld>
          <Fld label="Recurrence">
            <select style={{...IS,background:"#fff"}} value={f.recurrence} onChange={e=>set("recurrence",e.target.value)}>
              <option value="once">One-time</option>
              <option value="weekly">Weekly (4 weeks)</option>
              <option value="biweekly">Bi-weekly (4 entries)</option>
              <option value="monthly">Monthly (12 months)</option>
            </select>
          </Fld>
          <Fld label="Note (optional)" style={{marginBottom:16}}><input style={IS} value={f.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
          <Btn onClick={add} disabled={!f.source.trim()||!f.amount} full>Add to Schedule</Btn>
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
          return (
            <div key={e.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f3f4f6",flexWrap:"wrap",background:selectMode&&selected.has(e.id)?"#eff6ff":"transparent",borderRadius:4}}>
              {selectMode&&<input type="checkbox" checked={selected.has(e.id)} onChange={()=>toggleSel(e.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}}/>}
              <div style={{flex:1,minWidth:160}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13,fontWeight:500}}>{e.source}</span>
                  {isPast&&<span style={{fontSize:10,background:"#fee2e2",color:"#b91c1c",padding:"1px 7px",borderRadius:20,fontWeight:500}}>Overdue</span>}
                </div>
                <div style={{fontSize:11,color:"#9ca3af",marginTop:1}}>Expected {e.expectedDate}{e.note?" · "+e.note:""}</div>
                {e.confirmed&&<div style={{fontSize:11,color:"#059669",marginTop:1}}>Confirmed {e.confirmedDate}</div>}
              </div>
              <div style={{fontWeight:600,fontSize:13,color:e.confirmed?"#059669":"#0284C7",whiteSpace:"nowrap"}}>{fmt(e.amount)}</div>
              {!selectMode&&<div style={{display:"flex",gap:6,flexShrink:0}}>
                {!e.confirmed&&<Btn v="success" sm onClick={()=>onConfirm(e.id)}>Confirm Payment</Btn>}
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
  const [f,setF]=useState({merchant:"",amount:"",date:today(),category:initCat,note:"",recurrence:"once",occurrences:"12"});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const recurring=f.recurrence!=="once";
  const count=recurring?Math.max(1,parseInt(f.occurrences)||1):1;
  const amtNum=parseFloat(f.amount)||0;
  const submit=()=>{
    if(!f.merchant.trim()||!f.amount) return;
    const base=type==="expense"?{type:"expense",merchant:f.merchant.trim(),amount:amtNum,category:f.category,note:f.note,hasReceipt:false}:{type:"income",merchant:f.merchant.trim(),source:f.merchant.trim(),amount:amtNum,note:f.note};
    const dates=recurring?buildDates(f.date,f.recurrence,count):[f.date];
    const gid=recurring?uid():undefined;
    onSaveMultiple(dates.map(date=>({...base,id:uid(),date,...(gid?{groupId:gid,cadence:f.recurrence}:{})})));
    setF({merchant:"",amount:"",date:today(),category:initCat,note:"",recurrence:"once",occurrences:"12"});
  };
  const lbl=(CADENCES.find(c=>c.v===f.recurrence)||{l:""}).l;
  return (
    <div style={{maxWidth:500}}>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>{title}</h2>
      <div style={CA}>
        <Fld label={type==="income"?"Source":"Merchant / Description"}><input style={IS} value={f.merchant} onChange={e=>set("merchant",e.target.value)} placeholder={type==="income"?"e.g. Salary, Freelance":"e.g. Walmart, Netflix, Rent"}/></Fld>
        <Fld label="Amount per payment ($)"><input style={IS} type="number" value={f.amount} onChange={e=>set("amount",e.target.value)} placeholder="0.00"/></Fld>
        <Fld label={recurring?"Start Date":"Date"}><input style={IS} type="date" value={f.date} onChange={e=>set("date",e.target.value)}/></Fld>
        {type==="expense"&&<Fld label="Category"><select style={{...IS,background:"#fff"}} value={f.category} onChange={e=>set("category",e.target.value)}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>}
        <Fld label="Recurrence"><select style={{...IS,background:"#fff"}} value={f.recurrence} onChange={e=>set("recurrence",e.target.value)}>{CADENCES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></Fld>
        {recurring&&<Fld label="Number of payments"><input style={IS} type="number" min="2" max="120" value={f.occurrences} onChange={e=>set("occurrences",e.target.value)}/></Fld>}
        <Fld label="Note (optional)" style={{marginBottom:recurring&&amtNum?12:16}}><input style={IS} value={f.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
        {recurring&&amtNum>0&&<div style={{background:type==="expense"?"linear-gradient(135deg,#fffbeb,#fef3c7)":"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid "+(type==="expense"?"#fde68a":"#7dd3fc"),borderRadius:12,padding:"11px 14px",marginBottom:16,fontSize:13,color:type==="expense"?"#92400e":"#0369a1",fontWeight:500}}>{count} payments of {fmt(amtNum)} = <strong style={{fontWeight:800}}>{fmt(amtNum*count)}</strong> — {lbl.toLowerCase()}, starting {f.date}</div>}
        <Btn onClick={submit} disabled={!f.merchant.trim()||!f.amount} full>{recurring?"Log "+count+" Entries":"Add "+title}</Btn>
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
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant||t.source}</div><div style={{fontSize:11,color:"#9ca3af"}}>{t.date} · {t.type==="income"?"Income":t.category||"Uncategorized"}{t.note?" · "+t.note:""}</div></div>
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
    const v={id:uid(),name:form.name.trim(),startDate:form.startDate,endDate:form.endDate,budget:parseFloat(form.budget)||0};
    onSaveVacations([...vacations,v]);
    setForm({name:"",startDate:today(),endDate:today(),budget:""});
    setActiveId(v.id);setView("detail");
  };
  const delVacation=id=>{onSaveVacations(vacations.filter(v=>v.id!==id));onSaveTxns(vacationTxns.filter(t=>t.vacationId!==id));};
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
        {[...vacations].sort((a,b)=>(b.startDate||"").localeCompare(a.startDate||""  )).map(v=>{
          const txns=vacationTxns.filter(t=>t.vacationId===v.id);
          const total=txns.reduce((s,t)=>s+t.amount,0);
          const pct=v.budget>0?Math.min(total/v.budget,1):0;
          const over=v.budget>0&&total>v.budget;
          return (
            <div key={v.id} style={{...CA,cursor:"pointer"}} onClick={()=>{setActiveId(v.id);setView("detail");setSelectMode(false);setSelected(new Set());}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:600,marginBottom:2}}>{v.name}</div>
                  <div style={{fontSize:11,color:"#9ca3af"}}>{v.startDate} – {v.endDate}</div>
                  {v.budget>0&&<div style={{marginTop:8,height:6,borderRadius:3,background:"#e0f2fe",overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,width:pct*100+"%",background:over?"#dc2626":"#f59e0b"}}/></div>}
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:15,fontWeight:700,color:"#dc2626"}}>{fmt(total)}</div>
                  {v.budget>0&&<div style={{fontSize:11,color:over?"#dc2626":"#9ca3af"}}>{over?"over ":"of "}{fmt(v.budget)}</div>}
                  <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{txns.length} expense{txns.length!==1?"s":""}</div>
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
  const RANGES=[{l:"1W",v:"5d",iv:"1h"},{l:"1M",v:"1mo",iv:"1d"},{l:"3M",v:"3mo",iv:"1d"},{l:"6M",v:"6mo",iv:"1wk"},{l:"1Y",v:"1y",iv:"1wk"}];
  const [range,setRange]=useState("1mo");
  const [chartData,setChartData]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);

  useEffect(()=>{
    if(!holdings.length){setChartData([]);return;}
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
          seriesMap[p.date][symbol]=base>0?+((p.close-base)/base*100).toFixed(2):0;
        });
      });
      const sorted=Object.values(seriesMap).sort((a,b)=>a.date.localeCompare(b.date));
      setChartData(sorted);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[holdings.map(h=>h.ticker).join(","),range]);

  if(!holdings.length)return null;

  const tickers=holdings.map(h=>h.ticker);

  return(
    <div style={{...CA,marginTop:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>Stock Performance</div>
        <div style={{display:"flex",gap:4}}>
          {RANGES.map(r=>(
            <button key={r.v} onClick={()=>setRange(r.v)} style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(range===r.v?"#3b82f6":"#e2e8f0"),background:range===r.v?"#3b82f6":"#fff",color:range===r.v?"#fff":"#64748b",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{r.l}</button>
          ))}
        </div>
      </div>
      {loading&&<div style={{textAlign:"center",padding:"32px 0",color:"#94a3b8",fontSize:13}}>Loading…</div>}
      {error&&<div style={{color:"#dc2626",fontSize:12,padding:"8px 0"}}>{error}</div>}
      {!loading&&chartData.length>0&&(
        <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{top:4,right:8,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="date" tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={d=>d.slice(5)} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={v=>v+"%"} tickLine={false} axisLine={false} width={40}/>
              <Tooltip formatter={(v,name)=>[(v>=0?"+":"")+Number(v).toFixed(2)+"%",name]} labelStyle={{fontSize:11,color:"#64748b"}} contentStyle={{fontSize:12,borderRadius:8,border:"1px solid #e2e8f0",boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}/>
              <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11,paddingTop:8}}/>
              {tickers.map((tk,i)=>(
                <Line key={tk} type="monotone" dataKey={tk} stroke={STOCK_COLORS[i%STOCK_COLORS.length]} strokeWidth={2} dot={false} activeDot={{r:4}} connectNulls/>
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div style={{fontSize:10,color:"#94a3b8",textAlign:"right",marginTop:2}}>% change from period start · normalized</div>
        </>
      )}
    </div>
  );
}

function Stocks({holdings,onSaveHoldings,onPricesUpdate}){
  const [prices,setPrices]=useState({});
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [lastUpdated,setLastUpdated]=useState(null);
  const [form,setForm]=useState({ticker:"",shares:"",costBasis:""});
  const [editId,setEditId]=useState(null);
  const [editF,setEditF]=useState({});
  const setF=(k,v)=>setForm(p=>({...p,[k]:v}));

  const fetchPrices=async(hdgs=holdings)=>{
    if(!hdgs.length)return;
    setLoading(true);setError(null);
    try{
      const symbols=hdgs.map(h=>h.ticker.toUpperCase()).join(",");
      const res=await fetch(`/api/stocks?symbols=${symbols}`);
      const data=await res.json();
      if(data.error)throw new Error(data.error);
      const map=Object.fromEntries((data.quotes||[]).map(q=>[q.symbol,q]));
      setPrices(map);onPricesUpdate&&onPricesUpdate(map);setLastUpdated(new Date());
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

  const totalValue=holdings.reduce((s,h)=>s+(prices[h.ticker]?.price??0)*h.shares,0);
  const todayChange=holdings.reduce((s,h)=>s+(prices[h.ticker]?.change??0)*h.shares,0);
  const totalCost=holdings.filter(h=>h.costBasis!=null).reduce((s,h)=>s+h.costBasis*h.shares,0);
  const totalGain=totalCost>0?totalValue-totalCost:null;
  const anyOpen=Object.values(prices).some(q=>q.marketState==="REGULAR");

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Stock Portfolio</h2>
          {lastUpdated&&<div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Prices as of {lastUpdated.toLocaleTimeString()} · {anyOpen?<span style={{color:"#059669",fontWeight:600}}>Market Open</span>:<span style={{color:"#94a3b8"}}>Market Closed</span>}</div>}
        </div>
        <button onClick={()=>fetchPrices()} disabled={loading||!holdings.length} style={{padding:"7px 16px",borderRadius:10,border:"1.5px solid #bae6fd",background:"#fff",color:"#0284C7",cursor:loading||!holdings.length?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:loading||!holdings.length?0.5:1}}>
          {loading?"Updating…":"↻ Refresh"}
        </button>
      </div>

      {error&&<div style={{marginBottom:14,padding:"10px 14px",borderRadius:10,background:"#fee2e2",color:"#b91c1c",fontSize:13,border:"1px solid #fecaca"}}>{error}</div>}

      {/* Summary */}
      {holdings.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:16}}>
          {[
            {l:"Portfolio Value",v:fmt(totalValue),c:"#1E293B",bold:true},
            {l:"Today's Change",v:(todayChange>=0?"+":"")+fmt(todayChange),c:todayChange>=0?"#059669":"#dc2626",sub:totalValue>0?(todayChange>=0?"+":"")+((todayChange/totalValue)*100).toFixed(2)+"%":null},
            ...(totalGain!=null?[{l:"Total Gain/Loss",v:(totalGain>=0?"+":"")+fmt(totalGain),c:totalGain>=0?"#059669":"#dc2626",sub:totalCost>0?(totalGain>=0?"+":"")+((totalGain/totalCost)*100).toFixed(2)+"%":null}]:[]),
          ].map(card=>(
            <div key={card.l} style={{...CA,padding:"16px 20px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{card.l}</div>
              <div style={{fontSize:card.bold?22:20,fontWeight:800,color:card.c,letterSpacing:"-0.5px"}}>{card.v}</div>
              {card.sub&&<div style={{fontSize:11,fontWeight:600,color:card.c,marginTop:3}}>{card.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Holdings */}
      {holdings.length>0&&(
        <div style={{...CA,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>Holdings</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{borderBottom:"1px solid #f1f5f9"}}>
                  {["Symbol","Name","Shares","Price","Day Change","Value","Gain / Loss",""].map(h=>(
                    <th key={h} style={{textAlign:h===""||h==="Shares"||h==="Price"||h==="Day Change"||h==="Value"||h==="Gain / Loss"?"right":"left",padding:"0 12px 10px "+(h===""?"0":"0"),color:"#94a3b8",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h=>{
                  const q=prices[h.ticker];
                  const val=(q?.price??0)*h.shares;
                  const gain=h.costBasis!=null?val-h.costBasis*h.shares:null;
                  const gainPct=h.costBasis!=null&&h.costBasis>0?((gain/(h.costBasis*h.shares))*100):null;
                  const dayChange=(q?.change??0)*h.shares;
                  return editId===h.id?(
                    <tr key={h.id} style={{borderBottom:"1px solid #f1f5f9",background:"#f8fbff"}}>
                      <td style={{padding:"10px 12px 10px 0",fontWeight:700,color:"#0284C7"}}>{h.ticker}</td>
                      <td colSpan={5} style={{padding:"10px 12px"}}>
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
                    <tr key={h.id} style={{borderBottom:"1px solid #f8fafc"}}>
                      <td style={{padding:"12px 12px 12px 0",fontWeight:700,color:"#0284C7",whiteSpace:"nowrap"}}>
                        {h.ticker}
                        {q?.marketState==="REGULAR"&&<span style={{marginLeft:5,fontSize:9,background:"#dcfce7",color:"#059669",padding:"1px 5px",borderRadius:20,fontWeight:600}}>LIVE</span>}
                      </td>
                      <td style={{padding:"12px",color:"#374151",fontSize:12,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q?.name||"—"}</td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:500}}>{h.shares}</td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:700,color:"#1E293B"}}>{q?.price!=null?fmt(q.price):<span style={{color:"#94a3b8"}}>—</span>}</td>
                      <td style={{padding:"12px",textAlign:"right",whiteSpace:"nowrap"}}>
                        {q?.change!=null?<><span style={{fontWeight:600,color:q.change>=0?"#059669":"#dc2626"}}>{q.change>=0?"+":""}{fmt(dayChange)}</span><span style={{fontSize:11,color:q.change>=0?"#059669":"#dc2626",marginLeft:4}}>({q.changePercent>=0?"+":""}{q.changePercent?.toFixed(2)}%)</span></>:<span style={{color:"#94a3b8"}}>—</span>}
                      </td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:700}}>{q?.price!=null?fmt(val):<span style={{color:"#94a3b8"}}>—</span>}</td>
                      <td style={{padding:"12px",textAlign:"right",whiteSpace:"nowrap"}}>
                        {gain!=null?<><span style={{fontWeight:600,color:gain>=0?"#059669":"#dc2626"}}>{gain>=0?"+":""}{fmt(gain)}</span>{gainPct!=null&&<span style={{fontSize:11,color:gain>=0?"#059669":"#dc2626",marginLeft:4}}>({gainPct>=0?"+":""}{gainPct.toFixed(2)}%)</span>}</>:<span style={{color:"#e2e8f0",fontSize:12}}>no cost</span>}
                      </td>
                      <td style={{padding:"12px 0 12px 8px",textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{display:"flex",gap:5,justifyContent:"flex-end"}}>
                          <button onClick={()=>{setEditId(h.id);setEditF({shares:String(h.shares),costBasis:h.costBasis!=null?String(h.costBasis):""});}} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
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

      {/* Add form */}
      <div style={CA}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1E293B"}}>{holdings.length===0?"Add Your First Holding":"Add Holding"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <Fld label="Ticker Symbol"><input style={IS} value={form.ticker} onChange={e=>setF("ticker",e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="e.g. AAPL, TSLA"/></Fld>
          <Fld label="Number of Shares"><input style={IS} type="number" min="0" step="any" value={form.shares} onChange={e=>setF("shares",e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="10"/></Fld>
          <Fld label="Cost per Share (optional)"><input style={IS} type="number" min="0" step="any" value={form.costBasis} onChange={e=>setF("costBasis",e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="For gain/loss"/></Fld>
        </div>
        <Btn onClick={add} disabled={!form.ticker.trim()||!form.shares} full>Add &amp; Fetch Price</Btn>
      </div>
    </div>
  );
}

function Bills({bills,billPayments,onSaveBills,onSaveBillPayments,cats}){
  const [form,setForm]=useState({name:"",amount:"",category:cats[0]||"Other",dueDay:"15",note:""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const monthOpts=Array.from({length:13},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-12+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const ml=m=>new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"});
  const [viewMonth,setViewMonth]=useState(today().slice(0,7));
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

function NetWorth({accounts,accountHistory,onSaveAccounts,onSaveAccountHistory,holdings=[],stockPrices={}}){
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
  const portfolioValue=holdings.reduce((s,h)=>s+(stockPrices[h.ticker]?.price??0)*h.shares,0);
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
  const [ready,setReady]=useState(false);
  const [month,setMonth]=useState(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const [historyMonth,setHistoryMonth]=useState(today().slice(0,7));
  const [showWhatsNew,setShowWhatsNew]=useState(false);
  const [toast,setToast]=useState(null);
  const toastTimer=useRef(null);
  const showToast=(msg,undoFn)=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast({msg,undoFn});toastTimer.current=setTimeout(()=>setToast(null),5000);};
  const dismissToast=()=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast(null);};

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

  const nav=[{k:"dashboard",l:"Dashboard"},{k:"bills",l:"Bills"},{k:"goals",l:"Goals"},{k:"networth",l:"Net Worth"},{k:"stocks",l:"Stocks"},{k:"expected",l:"Expected Income"},{k:"folder",l:"Folder Sync"},{k:"upload",l:"Upload Receipts"},{k:"manual",l:"Add Expense"},{k:"income",l:"Add Income"},{k:"history",l:"History"},{k:"vacations",l:"Vacations"},{k:"categories",l:"Categories"}];
  const pendingCount=expected.filter(e=>!e.confirmed).length;
  const unpaidBillCount=bills.filter(b=>b.active!==false&&!billPayments.some(p=>p.billId===b.id&&p.month===month)).length;

  return (
    <div style={{minHeight:"100vh",background:"#f0f9ff",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",color:"#1E293B"}}>
      {showWhatsNew&&<WhatsNewModal onClose={()=>setShowWhatsNew(false)}/>}
      {toast&&<Toast msg={toast.msg} undoFn={toast.undoFn} onClose={dismissToast}/>}
      <header style={{background:"linear-gradient(135deg,#0284C7 0%,#0369a1 100%)",position:"sticky",top:0,zIndex:20,boxShadow:"0 2px 12px rgba(2,132,199,0.3)"}}>
        <div style={{maxWidth:1140,margin:"0 auto",padding:"0 20px",display:"flex",alignItems:"center",height:56,gap:16}}>
          <button onClick={()=>setShowWhatsNew(v=>!v)} title="What's New" style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.25)",cursor:"pointer",padding:"4px 10px",borderRadius:20,fontSize:11,color:"#e0f2fe",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center",gap:5,lineHeight:1,fontWeight:500,whiteSpace:"nowrap"}}>✦ <span>What's new</span></button>
          <span onClick={()=>setView("dashboard")} style={{fontWeight:800,fontSize:15,whiteSpace:"nowrap",color:"#fff",letterSpacing:"-0.3px",flexShrink:0,cursor:"pointer"}}>SpendTracker</span>
          <nav style={{display:"flex",gap:1,overflowX:"auto",flex:1}}>
            {nav.map(n=>(
              <button key={n.k} onClick={()=>setView(n.k)} style={{padding:"6px 13px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:500,whiteSpace:"nowrap",background:view===n.k?"#fff":"transparent",color:view===n.k?"#0284C7":"rgba(255,255,255,0.75)",flexShrink:0,fontFamily:"inherit",position:"relative",transition:"background 0.15s,color 0.15s"}}>
                {n.l}
                {n.k==="expected"&&pendingCount>0&&<span style={{position:"absolute",top:3,right:4,width:13,height:13,borderRadius:"50%",background:"#06B6D4",color:"#fff",fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingCount}</span>}
                {n.k==="bills"&&unpaidBillCount>0&&<span style={{position:"absolute",top:3,right:4,width:13,height:13,borderRadius:"50%",background:"#dc2626",color:"#fff",fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{unpaidBillCount}</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main style={{maxWidth:1140,margin:"0 auto",padding:"24px 20px"}}>
        {(()=>{const visibleTxns=txns.filter(t=>t.date&&t.date<=today());return(<>
        {view==="dashboard"&&<Dashboard txns={visibleTxns} expected={expected} cats={cats} catBudgets={catBudgets} month={month} setMonth={setMonth} onConfirm={confirmPayment} onRevert={revertPayment} vacations={vacations} vacationTxns={vacationTxns} bills={bills} billPayments={billPayments} onToggleBill={toggleBill} goals={goals} accounts={accounts} holdings={holdings} stockPrices={stockPrices}/>}
        {view==="expected"&&<ExpectedIncome expected={expected} onUpdate={saveExpected} onConfirm={confirmPayment}/>}
        {view==="folder"&&<LocalFolderSync cats={cats} receiptFPs={receiptFPs} onSaveFPs={saveReceiptFPs} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="upload"&&<UploadReceipts cats={cats} receiptFPs={receiptFPs} onSaveFPs={saveReceiptFPs} onSave={t=>{saveTxns([...txns,...t]);setHistoryMonth(t[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="manual"&&<RecurringForm title="Add Expense" type="expense" cats={cats} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="income"&&<RecurringForm title="Add Income" type="income" cats={cats} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="history"&&<History txns={visibleTxns} cats={cats} onUpdate={saveTxns} fMonth={historyMonth} setFMonth={setHistoryMonth} onToast={showToast}/>}
        {view==="bills"&&<Bills bills={bills} billPayments={billPayments} onSaveBills={saveBills} onSaveBillPayments={saveBillPayments} cats={cats}/>}
        {view==="goals"&&<Goals goals={goals} onSaveGoals={saveGoals}/>}
        {view==="networth"&&<NetWorth accounts={accounts} accountHistory={accountHistory} onSaveAccounts={saveAccounts} onSaveAccountHistory={saveAccountHistory} holdings={holdings} stockPrices={stockPrices}/>}
        {view==="stocks"&&<Stocks holdings={holdings} onSaveHoldings={saveHoldings} onPricesUpdate={setStockPrices}/>}
        </>);})()}
        {view==="vacations"&&<Vacations vacations={vacations} vacationTxns={vacationTxns} onSaveVacations={saveVacations} onSaveTxns={saveVacationTxns}/>}
        {view==="categories"&&<Categories cats={cats} onUpdate={saveCats} catBudgets={catBudgets} onUpdateBudgets={saveCatBudgets}/>}
      </main>
    </div>
  );
}

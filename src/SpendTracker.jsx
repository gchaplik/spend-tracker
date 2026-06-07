import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell, ReferenceLine, PieChart, Pie, AreaChart, Area } from "recharts";

const DEFAULT_CATS = ["Groceries","Dining","Transport","Utilities","Entertainment","Health","Shopping","Fuel","Other"];
const COLORS = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#ec4899","#84cc16","#6b7280","#f97316"];
const CADENCES = [
  {v:"once",l:"One-time"},{v:"weekly",l:"Weekly"},{v:"biweekly",l:"Bi-weekly (every 2 weeks)"},
  {v:"every15",l:"Every 15 days"},{v:"monthly",l:"Monthly"},{v:"bimonthly",l:"Every 2 months"},
  {v:"quarterly",l:"Quarterly"},{v:"annually",l:"Annually"},
];

const fmt = n => new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(n||0);
const fmtUSD = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n||0);
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

function Dashboard({txns,expected,cats,catBudgets,month,setMonth,onConfirm,onRevert,vacations=[],vacationTxns=[],bills=[],billPayments=[],onToggleBill,goals=[],accounts=[],holdings=[],stockPrices={},fxRate=1.38,inDepthMode=false,onSelectItem=()=>{}}){
  const opts=Array.from({length:13},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-12+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const ml=m=>new Date(m+"-02").toLocaleString("default",{month:"long",year:"numeric"});
  const mt=txns.filter(t=>t.date&&t.date.startsWith(month));
  const actualIncome=mt.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const txnSpending=mt.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  // Paid bills for this month count as spending
  const paidBillsTotal=billPayments.filter(p=>p.month===month).reduce((s,p)=>s+p.amount,0);
  // Vacation transactions in this month count as spending
  const vacationSpending=vacationTxns.filter(t=>t.date&&t.date.startsWith(month)).reduce((s,t)=>s+t.amount,0);
  const spending=txnSpending+paidBillsTotal+vacationSpending;
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
      <SelectableWrapper item={{id:"net-position",label:`Net Position · ${ml(month)}`,llmContext:`Net Position ${month}: ${fmt(actNet)} actual, ${fmt(projNet)} projected, ${fmt(pendingExp)} pending income`}} inDepthMode={inDepthMode} onSelectItem={onSelectItem}>
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
      </SelectableWrapper>

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
        <SelectableWrapper item={{id:"stat-income",label:`Income · ${ml(month)}`,llmContext:`Income ${month}: ${fmt(actualIncome)}`}} inDepthMode={inDepthMode} onSelectItem={onSelectItem}>
        <div style={{...CA,padding:"20px 22px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Income</div>
          <div style={{fontSize:28,fontWeight:800,color:GREEN,letterSpacing:"-0.7px",lineHeight:1}}>{fmt(actualIncome)}</div>
          {incomeDelta&&incomeDelta.d!==0&&<div style={{fontSize:11,fontWeight:600,marginTop:6,color:incomeDelta.up?GREEN:RED}}>{incomeDelta.up?"↑":"↓"} {fmt(Math.abs(incomeDelta.d))} vs last month</div>}
        </div>
        </SelectableWrapper>
        <SelectableWrapper item={{id:"stat-spending",label:`Spending · ${ml(month)}`,llmContext:`Spending ${month}: ${fmt(spending)}, budget: ${fmt(budgetTotal)}, remaining: ${fmt(budgetRemaining)}`}} inDepthMode={inDepthMode} onSelectItem={onSelectItem}>
        <div style={{...CA,padding:"20px 22px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Spending</div>
          <div style={{fontSize:28,fontWeight:800,color:RED,letterSpacing:"-0.7px",lineHeight:1}}>{fmt(spending)}</div>
          {budgetTotal>0&&<div style={{fontSize:11,fontWeight:500,marginTop:6,color:budgetRemaining>=0?GREEN:RED}}>{fmt(Math.abs(budgetRemaining))} {budgetRemaining>=0?"under budget":"over budget"}</div>}
          {spendDelta&&spendDelta.d!==0&&<div style={{fontSize:11,fontWeight:600,marginTop:budgetTotal>0?2:6,color:spendDelta.up?RED:GREEN}}>{spendDelta.up?"↑":"↓"} {fmt(Math.abs(spendDelta.d))} vs last month</div>}
          {vacSpend>0&&<div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>+{fmt(vacSpend)} vacation</div>}
        </div>
        </SelectableWrapper>
        <SelectableWrapper item={{id:"stat-expected",label:`Expected Income · ${ml(month)}`,llmContext:`Expected Income ${month}: ${fmt(totalExp)} total, ${fmt(pendingExp)} pending`}} inDepthMode={inDepthMode} onSelectItem={onSelectItem}>
        <div style={{...CA,padding:"20px 22px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Expected Income</div>
          <div style={{fontSize:28,fontWeight:800,color:YELLOW,letterSpacing:"-0.7px",lineHeight:1}}>{fmt(totalExp)}</div>
          {pendingExp>0
            ?<div style={{fontSize:11,color:YELLOW,fontWeight:600,marginTop:6}}>{fmt(pendingExp)} pending · {mExp.filter(e=>!e.confirmed).length} items</div>
            :mExp.length>0&&<div style={{fontSize:11,color:GREEN,fontWeight:600,marginTop:6}}>All received ✓</div>}
        </div>
        </SelectableWrapper>
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
  const recurring=f.recurrence!=="once";
  const yearCount=recurring?countForYear(f.expectedDate,f.recurrence):1;
  const recurrenceLabel=(CADENCES.find(c=>c.v===f.recurrence)||{l:""}).l;

  const add=()=>{
    if(!f.source.trim()||!f.amount) return;
    const base={source:f.source.trim(),amount:amtNum,expectedDate:f.expectedDate,note:f.note,confirmed:false,confirmedDate:null};
    let items;
    if(recurring){
      const gid=uid();
      const dates=buildDates(f.expectedDate,f.recurrence,yearCount);
      items=dates.map(date=>({...base,id:uid(),expectedDate:date,groupId:gid,cadence:f.recurrence}));
    } else {
      items=[{...base,id:uid()}];
    }
    onUpdate([...expected,...items]);
    setF({source:"",amount:"",expectedDate:today(),recurrence:"once",note:""});
  };
  const del=id=>onUpdate(expected.filter(e=>e.id!==id));
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
          <Fld label="Amount ($)"><input style={IS} type="number" value={f.amount} onChange={e=>set("amount",e.target.value)} placeholder="0.00"/></Fld>
          <Fld label="Expected Date"><input style={IS} type="date" value={f.expectedDate} onChange={e=>set("expectedDate",e.target.value)}/></Fld>
          <Fld label="Recurrence">
            <select style={{...IS,background:"#fff"}} value={f.recurrence} onChange={e=>set("recurrence",e.target.value)}>
              {CADENCES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </Fld>
          {recurring&&amtNum>0&&(
            <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#0369a1",fontWeight:500}}>
              {yearCount} {recurrenceLabel.toLowerCase()} payments of {fmt(amtNum)} = <strong style={{fontWeight:800}}>{fmt(amtNum*yearCount)}</strong> through Dec&nbsp;{new Date(f.expectedDate+"T12:00:00").getFullYear()}
            </div>
          )}
          <Fld label="Note (optional)" style={{marginBottom:16}}><input style={IS} value={f.note} onChange={e=>set("note",e.target.value)} placeholder="Optional"/></Fld>
          <Btn onClick={add} disabled={!f.source.trim()||!f.amount} full>{recurring?`Add ${yearCount} Entries`:"Add to Schedule"}</Btn>
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
    label:"Transactions",description:"All income and expense transactions",source:"txns",
    dimensions:{
      date:    {type:"date",   label:"Date",     description:"Date the transaction occurred",field:"date"},
      amount:  {type:"currency",label:"Amount",  description:"Transaction amount in CAD",field:"amount"},
      category:{type:"string", label:"Category", description:"Spending / income category (e.g. Groceries, Dining)",field:"category"},
      type:    {type:"string", label:"Type",     description:"'income' or 'expense'",field:"type"},
      merchant:{type:"string", label:"Merchant", description:"Merchant name or income source",field:"merchant"},
      note:    {type:"string", label:"Note",     description:"Optional transaction note",field:"note"},
    },
    measures:{
      count:          {type:"count",   label:"Count",         description:"Total number of transactions",                        query:"data.txns.length"},
      total_expenses: {type:"sum",     label:"Total Expenses",description:"Sum of all expense amounts",                         query:"data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)"},
      total_income:   {type:"sum",     label:"Total Income",  description:"Sum of all income amounts",                          query:"data.txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0)"},
      net_position:   {type:"subtract",label:"Net Position",  description:"Total income minus total expenses",                  query:"data.txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0)-data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)"},
      avg_expense:    {type:"divide",  label:"Avg Expense",   description:"Average expense amount per transaction",             query:"(()=>{const e=data.txns.filter(t=>t.type==='expense');return e.length?e.reduce((s,t)=>s+t.amount,0)/e.length:0})()"},
      avg_income:     {type:"divide",  label:"Avg Income",    description:"Average income amount per transaction",              query:"(()=>{const i=data.txns.filter(t=>t.type==='income');return i.length?i.reduce((s,t)=>s+t.amount,0)/i.length:0})()"},
      spend_x_income: {type:"multiply",label:"Expense Ratio", description:"Total expenses × 100 ÷ total income (spend %)",     query:"(()=>{const i=data.txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);const e=data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);return i>0?Math.round(e/i*100):0})()"},
    }
  },
  bills:{
    label:"Bills",description:"Recurring monthly bills and subscriptions",source:"bills",
    dimensions:{
      name:    {type:"string", label:"Name",     description:"Bill name (e.g. Rent, Netflix)",field:"name"},
      amount:  {type:"currency",label:"Amount",  description:"Monthly bill amount in CAD",field:"amount"},
      category:{type:"string", label:"Category", description:"Bill category",field:"category"},
      due_day: {type:"number", label:"Due Day",  description:"Day of month the bill is due (1–31)",field:"dueDay"},
      active:  {type:"boolean",label:"Active",   description:"Whether the bill is currently active",field:"active"},
    },
    measures:{
      count:         {type:"count",   label:"Active Count",  description:"Number of active bills",                                           query:"data.bills.filter(b=>b.active!==false).length"},
      total_monthly: {type:"sum",     label:"Total Monthly", description:"Sum of all active monthly bill amounts",                           query:"data.bills.filter(b=>b.active!==false).reduce((s,b)=>s+b.amount,0)"},
      total_yearly:  {type:"multiply",label:"Total Yearly",  description:"Monthly total × 12 — annual bill cost",                           query:"data.bills.filter(b=>b.active!==false).reduce((s,b)=>s+b.amount,0)*12"},
      avg_bill:      {type:"divide",  label:"Avg Bill",      description:"Average monthly bill amount",                                      query:"(()=>{const a=data.bills.filter(b=>b.active!==false);return a.length?a.reduce((s,b)=>s+b.amount,0)/a.length:0})()"},
    }
  },
  expected_income:{
    label:"Expected Income",description:"Scheduled and recurring expected income payments",source:"expected",
    dimensions:{
      source:       {type:"string", label:"Source",       description:"Income source / payer name",field:"source"},
      amount:       {type:"currency",label:"Amount",      description:"Expected payment amount in CAD",field:"amount"},
      expected_date:{type:"date",   label:"Expected Date",description:"When the payment is expected",field:"expectedDate"},
      confirmed:    {type:"boolean",label:"Confirmed",    description:"Whether the payment has been received",field:"confirmed"},
      cadence:      {type:"string", label:"Cadence",      description:"Recurrence frequency: monthly, weekly, biweekly, quarterly, etc.",field:"cadence"},
    },
    measures:{
      count_pending:   {type:"count",label:"Pending Count",  description:"Number of unconfirmed upcoming payments",             query:"data.expected.filter(e=>!e.confirmed).length"},
      total_pending:   {type:"sum",  label:"Total Pending",  description:"Sum of all unconfirmed expected amounts",             query:"data.expected.filter(e=>!e.confirmed).reduce((s,e)=>s+e.amount,0)"},
      total_confirmed: {type:"sum",  label:"Total Confirmed",description:"Sum of all confirmed received payments",             query:"data.expected.filter(e=>e.confirmed).reduce((s,e)=>s+e.amount,0)"},
      confirmation_rate:{type:"divide",label:"Confirmation %",description:"% of payments confirmed (confirmed ÷ total × 100)",query:"(()=>{const t=data.expected.length;return t?Math.round(data.expected.filter(e=>e.confirmed).length/t*100):0})()"},
    }
  },
  goals:{
    label:"Goals",description:"Financial savings goals and progress",source:"goals",
    dimensions:{
      name:          {type:"string", label:"Name",           description:"Goal name",field:"name"},
      target_amount: {type:"currency",label:"Target Amount", description:"Goal target amount in CAD",field:"targetAmount"},
      current_amount:{type:"currency",label:"Current Amount",description:"Amount saved so far in CAD",field:"currentAmount"},
      deadline:      {type:"date",   label:"Deadline",       description:"Target completion date",field:"deadline"},
    },
    measures:{
      count:           {type:"count",   label:"Count",           description:"Total number of goals",                                         query:"data.goals.length"},
      total_target:    {type:"sum",     label:"Total Target",    description:"Sum of all goal target amounts",                               query:"data.goals.reduce((s,g)=>s+g.targetAmount,0)"},
      total_saved:     {type:"sum",     label:"Total Saved",     description:"Sum of all current amounts saved across goals",               query:"data.goals.reduce((s,g)=>s+g.currentAmount,0)"},
      total_remaining: {type:"subtract",label:"Total Remaining", description:"Total still needed to reach all goals",                       query:"data.goals.reduce((s,g)=>s+(g.targetAmount-g.currentAmount),0)"},
      avg_progress:    {type:"divide",  label:"Avg Progress %",  description:"Average completion percentage across all goals",              query:"(()=>{const gs=data.goals;return gs.length?Math.round(gs.reduce((s,g)=>s+(g.currentAmount/Math.max(g.targetAmount,1)*100),0)/gs.length):0})()"},
    }
  },
  accounts:{
    label:"Accounts",description:"Bank and financial accounts",source:"accounts",
    dimensions:{
      name:   {type:"string", label:"Name",    description:"Account name (e.g. TD Chequing, Visa)",field:"name"},
      type:   {type:"string", label:"Type",    description:"Account type: chequing, savings, credit_card, loan, mortgage, investment, property, other_asset, other_liability",field:"type"},
      balance:{type:"currency",label:"Balance",description:"Current account balance in CAD (positive for assets, negative for debts)",field:"balance"},
    },
    measures:{
      count:             {type:"count",   label:"Count",              description:"Total number of accounts",                                          query:"data.accounts.length"},
      total_assets:      {type:"sum",     label:"Total Assets",       description:"Sum of all asset account balances",                                query:"data.accounts.filter(a=>['chequing','savings','investment','property','other_asset'].includes(a.type)).reduce((s,a)=>s+a.balance,0)"},
      total_liabilities: {type:"sum",     label:"Total Liabilities",  description:"Sum of all liability balances (credit cards, loans, mortgages)",  query:"data.accounts.filter(a=>['credit_card','loan','mortgage','other_liability'].includes(a.type)).reduce((s,a)=>s+a.balance,0)"},
      net_worth:         {type:"subtract",label:"Net Worth",          description:"Total assets minus total liabilities",                            query:"data.accounts.filter(a=>['chequing','savings','investment','property','other_asset'].includes(a.type)).reduce((s,a)=>s+a.balance,0)-data.accounts.filter(a=>['credit_card','loan','mortgage','other_liability'].includes(a.type)).reduce((s,a)=>s+a.balance,0)"},
    }
  },
  holdings:{
    label:"Stock Holdings",description:"Investment portfolio — stock holdings and cost basis",source:"holdings",
    dimensions:{
      ticker:    {type:"string", label:"Ticker",     description:"Stock ticker symbol — append .TO for Canadian stocks (e.g. TSLA, XEQT.TO)",field:"ticker"},
      shares:    {type:"number", label:"Shares",     description:"Number of shares held",field:"shares"},
      cost_basis:{type:"currency",label:"Cost Basis",description:"Weighted average purchase price per share in native currency",field:"costBasis"},
    },
    measures:{
      count:        {type:"count",label:"Holdings Count",description:"Number of distinct stock holdings",                                           query:"data.holdings.length"},
      total_cost:   {type:"sum",  label:"Total Cost",    description:"Sum of (cost basis × shares) for all holdings with a known cost basis",       query:"data.holdings.filter(h=>h.costBasis!=null).reduce((s,h)=>s+h.costBasis*h.shares,0)"},
      total_shares: {type:"sum",  label:"Total Shares",  description:"Total share count across all holdings",                                       query:"data.holdings.reduce((s,h)=>s+h.shares,0)"},
    }
  }
}};

const DEFAULT_SETTINGS={name:"",ollamaUrl:"http://localhost:11434",ollamaModel:"phi3:mini",devMode:false,globalChatModel:"ollama",jarvisVoice:true};

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function Settings({settings,onSave}){
  const [f,setF]=useState({...DEFAULT_SETTINGS,...settings});
  const [ollamaStatus,setOllamaStatus]=useState(null); // null | "ok" | "error"
  const [testing,setTesting]=useState(false);
  const [copied,setCopied]=useState("");
  const set=(k,v)=>setF(p=>({...p,[k]:v}));

  const save=()=>onSave(f);

  const testOllama=async()=>{
    setTesting(true);setOllamaStatus(null);
    try{
      const r=await fetch("/api/llm/models");
      if(r.ok){setOllamaStatus("ok");}
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

        {/* Right column — Ollama */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={CA}>
            <div style={{fontSize:13,fontWeight:700,color:"#1E293B",marginBottom:4}}>Local AI (Ollama)</div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:14,lineHeight:1.6}}>All processing runs on your machine. Your financial data never leaves this device.</div>

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
          </div>

          {/* Global Chat Model */}
          <div style={CA}>
            <div style={{fontSize:13,fontWeight:700,color:"#1E293B",marginBottom:4}}>Assistant (Global Chat)</div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:12,lineHeight:1.6}}>Which AI powers the floating assistant on every page.</div>
            <div style={{display:"flex",gap:8,marginBottom:4}}>
              {["gemini","ollama"].map(m=>(
                <button key={m} onClick={()=>{set("globalChatModel",m);setTimeout(()=>onSave({...f,globalChatModel:m}),50);}}
                  style={{flex:1,padding:"8px",borderRadius:10,border:"1.5px solid",borderColor:f.globalChatModel===m?"#0284C7":"#e2e8f0",background:f.globalChatModel===m?"#eff6ff":"#f8fafc",color:f.globalChatModel===m?"#0284C7":"#64748b",cursor:"pointer",fontSize:12,fontWeight:f.globalChatModel===m?700:500,fontFamily:"inherit",transition:"all .15s"}}>
                  {m==="gemini"?"Gemini (cloud)":"Ollama (local)"}
                </button>
              ))}
            </div>
            {f.globalChatModel==="gemini"&&<div style={{fontSize:11,color:"#0369a1",background:"#eff6ff",border:"1px solid #bae6fd",borderRadius:8,padding:"7px 10px",marginTop:4}}>Requires GEMINI_API_KEY set in your environment.</div>}
          </div>

          {/* Jarvis Voice */}
          <div style={{...CA,background:f.jarvisVoice?"linear-gradient(135deg,#fafafa,#f0f9ff)":"#fff",border:f.jarvisVoice?"1px solid #bae6fd":"1px solid #e2e8f0"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>Jarvis Voice</div>
                <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Jarvis speaks responses aloud using your device's text-to-speech</div>
              </div>
              <button onClick={()=>{set("jarvisVoice",!f.jarvisVoice);setTimeout(()=>onSave({...f,jarvisVoice:!f.jarvisVoice}),50);}} style={{width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",background:f.jarvisVoice?"#0284C7":"#cbd5e1",position:"relative",transition:"background .2s",flexShrink:0}}>
                <span style={{position:"absolute",top:3,left:f.jarvisVoice?22:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
              </button>
            </div>
            {f.jarvisVoice&&<div style={{fontSize:11,color:"#0369a1",background:"#eff6ff",border:"1px solid #bae6fd",borderRadius:8,padding:"7px 10px"}}>Uses a British English voice (Daniel/UK) when available for the Jarvis effect.</div>}
          </div>

          {/* Install instructions */}
          <div style={CA}>
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
          </div>
        </div>

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
  const [newViewForm,setNewViewForm]=useState({key:"",label:"",description:"",source:""});

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
    onSave({...schema,views:{...views,[newViewForm.key.trim()]:{label:newViewForm.label||newViewForm.key,description:newViewForm.description,source:newViewForm.source.trim(),dimensions:{},measures:{}}}});
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
        <Fld label="Source Field (JSON key)"><input style={IS} value={dimForm.field||""} onChange={e=>setDimForm(p=>({...p,field:e.target.value}))} placeholder="fieldName in data.json"/></Fld>
      </div>
      <Fld label="Description"><input style={IS} value={dimForm.description||""} onChange={e=>setDimForm(p=>({...p,description:e.target.value}))} placeholder="What does this field represent?"/></Fld>
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
      <Fld label="Query (JavaScript — 'data' refers to the full data.json object)">
        <textarea style={{...IS,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11,minHeight:64,resize:"vertical"}} value={msrForm.query||""} onChange={e=>setMsrForm(p=>({...p,query:e.target.value}))} placeholder={"e.g. data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)"}/>
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
                <div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>{Object.keys(views[vk].dimensions||{}).length}d · {Object.keys(views[vk].measures||{}).length}m</div>
              </button>
            ))}
            {addingView?(
              <div style={{...CA,padding:12}}>
                <Fld label="Key"><input style={IS} value={newViewForm.key} onChange={e=>setNewViewForm(p=>({...p,key:e.target.value.replace(/\s/g,"_").toLowerCase()}))} placeholder="view_key" autoFocus/></Fld>
                <Fld label="Label"><input style={IS} value={newViewForm.label} onChange={e=>setNewViewForm(p=>({...p,label:e.target.value}))} placeholder="Display Name"/></Fld>
                <Fld label="Source (data.json key)"><input style={IS} value={newViewForm.source} onChange={e=>setNewViewForm(p=>({...p,source:e.target.value}))} placeholder="e.g. txns"/></Fld>
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

// ─── Shared tool helpers — used by Insights (local copies shadow these) and GlobalChat ─
const _df=(args={},field='t.date')=>{
  if(args.month)  return `${field}&&${field}.slice(0,7)==='${args.month}'`;
  if(args.from||args.to){const f=args.from||'0000-00',t=args.to||'9999-99';return `${field}&&${field}.slice(0,7)>='${f}'&&${field}.slice(0,7)<='${t}'`;}
  return 'true';
};
const _label=(args={})=>{
  if(args.month) return args.month;
  if(args.from&&args.to) return `${args.from} – ${args.to}`;
  if(args.from) return `from ${args.from}`;
  if(args.to) return `up to ${args.to}`;
  return 'All Time';
};
const TOOL_LIBRARY={
  expenses:(a={})=>{const df=_df(a);return `(function(){return Math.round(data.txns.filter(function(t){return t.type==='expense'&&${df};}).reduce(function(s,t){return s+t.amount;},0)*100)/100;})()`;},
  income:(a={})=>{const df=_df(a);return `(function(){return Math.round(data.txns.filter(function(t){return t.type==='income'&&${df};}).reduce(function(s,t){return s+t.amount;},0)*100)/100;})()`;},
  net:(a={})=>{const df=_df(a);return `(function(){var df=function(t){return ${df};};var i=data.txns.filter(function(t){return t.type==='income'&&df(t);}).reduce(function(s,t){return s+t.amount;},0);var e=data.txns.filter(function(t){return t.type==='expense'&&df(t);}).reduce(function(s,t){return s+t.amount;},0);return Math.round((i-e)*100)/100;})()`;},
  categories:(a={})=>{const df=_df(a);return `(function(){var a={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';a[c]=(a[c]||0)+t.amount;});return Object.entries(a).sort(function(x,y){return y[1]-x[1];}).map(function(e){return {name:e[0],value:Math.round(e[1]*100)/100};});})()`;},
  top_category:(a={})=>{const df=_df(a);return `(function(){var a={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';a[c]=(a[c]||0)+t.amount;});var s=Object.entries(a).sort(function(x,y){return y[1]-x[1];});return s.length?{name:s[0][0],value:Math.round(s[0][1]*100)/100}:null;})()`;},
  monthly:(a={})=>{const n=a.months||99;const df=_df(a,'d');const rf=(a.from||a.to)?`var d=t.date?t.date.slice(0,7):null;if(!d||!(${df}))return;`:`var d=t.date?t.date.slice(0,7):null;if(!d)return;`;return `(function(){var mo={};data.txns.forEach(function(t){${rf}if(!mo[d])mo[d]={name:d,Income:0,Expenses:0};if(t.type==='income')mo[d].Income+=t.amount;if(t.type==='expense')mo[d].Expenses+=t.amount;});return Object.values(mo).sort(function(a,b){return a.name<b.name?-1:1;}).slice(-${n});})()`;},
  bills:(a={})=>{if(a.type==="total")return `Math.round(data.bills.filter(function(b){return b.active!==false;}).reduce(function(s,b){return s+b.amount;},0)*100)/100`;return `data.bills.filter(function(b){return b.active!==false;}).map(function(b){return {name:b.name,value:b.amount};}).sort(function(a,b){return b.value-a.value;})`;},
  portfolio:(a={})=>{if(a.type==="total")return `(function(){if(!data.holdings||!data.holdings.length)return 0;return Math.round(data.holdings.reduce(function(s,h){return s+(h.shares||0)*(h.price||h.currentPrice||0);},0)*100)/100;})()`;return `(function(){if(!data.holdings||!data.holdings.length)return [];return data.holdings.map(function(h){return {name:h.ticker||h.symbol||'?',value:Math.round((h.shares||0)*(h.price||h.currentPrice||0)*100)/100};}).sort(function(a,b){return b.value-a.value;});})()`;},
  merchants:(a={})=>{const df=_df(a);const n=a.limit||10;return `(function(){var a={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var k=t.merchant||t.description||'Other';a[k]=(a[k]||0)+t.amount;});return Object.entries(a).sort(function(x,y){return y[1]-x[1];}).slice(0,${n}).map(function(e){return {name:e[0],value:Math.round(e[1]*100)/100};});})()`;},
  transactions:(a={})=>{const df=_df(a);const n=a.limit||10;return `data.txns.filter(function(t){return ${df};}).slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,${n}).map(function(t){return {name:(t.merchant||t.description||'?')+' ('+t.date+')',value:t.amount};})`;},
  pending_income:(a={})=>{const df=_df(a,'e.expectedDate');return `(function(){var items=(data.expected||[]).filter(function(e){return !e.confirmed&&${df};});var total=items.reduce(function(s,e){return s+e.amount;},0);return {total:Math.round(total*100)/100,items:items.map(function(e){return {name:e.source,value:e.amount,date:e.expectedDate};})};})()`;},
  confirmed_income:(a={})=>{const df=_df(a,'e.expectedDate');return `(function(){var items=(data.expected||[]).filter(function(e){return e.confirmed&&${df};});var total=items.reduce(function(s,e){return s+e.amount;},0);return {total:Math.round(total*100)/100,items:items.map(function(e){return {name:e.source,value:e.amount,date:e.confirmedDate||e.expectedDate};})};})()`;},
  all_expected_income:(a={})=>{const df=_df(a,'e.expectedDate');return `(function(){var items=(data.expected||[]).filter(function(e){return ${df};});var total=items.reduce(function(s,e){return s+e.amount;},0);var pending=items.filter(function(e){return !e.confirmed;}).reduce(function(s,e){return s+e.amount;},0);var confirmed=items.filter(function(e){return e.confirmed;}).reduce(function(s,e){return s+e.amount;},0);return {total:Math.round(total*100)/100,pending:Math.round(pending*100)/100,confirmed:Math.round(confirmed*100)/100,items:items.map(function(e){return {name:e.source+(e.confirmed?' ✓':' ?'),value:e.amount,date:e.expectedDate};})};})()`;},
  budgets:()=>`Object.entries(data.catBudgets||{}).map(function(e){return {name:e[0],value:e[1]};}).sort(function(a,b){return b.value-a.value;})`,
  budget_vs_actual:(a={})=>{const df=_df(a);return `(function(){var spent={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';spent[c]=(spent[c]||0)+t.amount;});var budgets=data.catBudgets||{};var cats=Array.from(new Set(Object.keys(budgets).concat(Object.keys(spent))));return cats.map(function(c){var b=budgets[c]||0;var s=Math.round((spent[c]||0)*100)/100;var rem=Math.round((b-s)*100)/100;var pct=b>0?Math.round((s/b)*1000)/10:null;return {name:c,budget:b,spent:s,remaining:rem,percentUsed:pct};}).sort(function(a,b){return (b.percentUsed||0)-(a.percentUsed||0);});})()`;},
  budget_remaining:(a={})=>{const cat=(a.category||"").replace(/'/g,"\\'");const df=_df(a);return `(function(){var cat='${cat}';var budget=(data.catBudgets||{})[cat]||0;var spent=data.txns.filter(function(t){return t.type==='expense'&&(t.category||'Other')===cat&&${df};}).reduce(function(s,t){return s+t.amount;},0);var remaining=budget-spent;var pct=budget>0?Math.round((spent/budget)*1000)/10:null;return {category:cat,budget:Math.round(budget*100)/100,spent:Math.round(spent*100)/100,remaining:Math.round(remaining*100)/100,percentUsed:pct};})()`;},
  over_budget:(a={})=>{const df=_df(a);return `(function(){var spent={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';spent[c]=(spent[c]||0)+t.amount;});var budgets=data.catBudgets||{};return Object.keys(budgets).filter(function(c){return (spent[c]||0)>budgets[c];}).map(function(c){return {name:c,budget:Math.round(budgets[c]*100)/100,spent:Math.round(spent[c]*100)/100,over:Math.round((spent[c]-budgets[c])*100)/100};}).sort(function(a,b){return b.over-a.over;});})()`;},
  bills_due:(a={})=>{const m=a.month||new Date().toISOString().slice(0,7);return `(function(){var m='${m}';var paid=new Set((data.billPayments||[]).filter(function(p){return p.month===m;}).map(function(p){return p.billId;}));return (data.bills||[]).filter(function(b){return b.active!==false&&!paid.has(b.id);}).map(function(b){return {name:b.name,value:b.amount,dueDay:b.dueDay,category:b.category};}).sort(function(a,b){return a.dueDay-b.dueDay;});})()`;},
  bills_paid:(a={})=>{const m=a.month||new Date().toISOString().slice(0,7);return `(function(){var m='${m}';var paid=new Set((data.billPayments||[]).filter(function(p){return p.month===m;}).map(function(p){return p.billId;}));return (data.bills||[]).filter(function(b){return paid.has(b.id);}).map(function(b){return {name:b.name,value:b.amount,dueDay:b.dueDay};});})()`;},
  holdings_detail:()=>`(function(){return (data.holdings||[]).map(function(h){var price=h.price||h.currentPrice||0;var mktVal=Math.round((h.shares||0)*price*100)/100;var cost=Math.round((h.shares||0)*(h.costBasis||0)*100)/100;var gain=Math.round((mktVal-cost)*100)/100;var gainPct=cost>0?Math.round((gain/cost)*1000)/10:null;return {name:h.ticker||h.symbol||'?',shares:h.shares,costBasis:h.costBasis,marketValue:mktVal,cost:cost,gain:gain,gainPercent:gainPct};}).sort(function(a,b){return b.marketValue-a.marketValue;});})()`,
  portfolio_gain:()=>`(function(){var total=0,cost=0;(data.holdings||[]).forEach(function(h){var price=h.price||h.currentPrice||0;total+=(h.shares||0)*price;cost+=(h.shares||0)*(h.costBasis||0);});var gain=total-cost;var pct=cost>0?Math.round((gain/cost)*1000)/10:null;return {marketValue:Math.round(total*100)/100,totalCost:Math.round(cost*100)/100,gain:Math.round(gain*100)/100,gainPercent:pct};})()`,
  holding:(a={})=>{const t=(a.ticker||"").replace(/'/g,"\\'");return `(function(){var t='${t}';var h=(data.holdings||[]).find(function(h){return (h.ticker||h.symbol||'').toUpperCase()===t.toUpperCase();});if(!h)return null;var price=h.price||h.currentPrice||0;var mktVal=Math.round((h.shares||0)*price*100)/100;var cost=Math.round((h.shares||0)*(h.costBasis||0)*100)/100;var gain=Math.round((mktVal-cost)*100)/100;var pct=cost>0?Math.round((gain/cost)*1000)/10:null;return {ticker:h.ticker||h.symbol,shares:h.shares,costBasis:h.costBasis,marketValue:mktVal,cost:cost,gain:gain,gainPercent:pct};})()`;},
  vacations:()=>`(data.vacations||[]).map(function(v){return {name:v.name,startDate:v.startDate,endDate:v.endDate,budget:v.budget};})`,
  vacation_spending:(a={})=>{const name=(a.name||"").replace(/'/g,"\\'");return `(function(){var name='${name}';var v=(data.vacations||[]).find(function(v){return v.name.toLowerCase().includes(name.toLowerCase());});if(!v)return null;var txns=data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date>=v.startDate&&t.date<=v.endDate;});var total=txns.reduce(function(s,t){return s+t.amount;},0);var rem=v.budget-total;return {vacation:v.name,startDate:v.startDate,endDate:v.endDate,budget:v.budget,spent:Math.round(total*100)/100,remaining:Math.round(rem*100)/100,transactions:txns.map(function(t){return {name:t.merchant||t.description||'?',value:t.amount,date:t.date,category:t.category};})};})()`;},
  account_balance:()=>`(function(){var h=(data.accountHistory||[]).slice().sort(function(a,b){return b.date.localeCompare(a.date);});return h.length?{balance:h[0].balance,date:h[0].date}:null;})()`,
  balance_history:(a={})=>{const df=_df(a,'h.date');return `(data.accountHistory||[]).filter(function(h){return ${df};}).slice().sort(function(a,b){return a.date.localeCompare(b.date);}).map(function(h){return {name:h.date,value:h.balance};})`;},
  txns_by_category:(a={})=>{const cat=(a.category||"").replace(/'/g,"\\'");const df=_df(a);return `(function(){var cat='${cat}';return data.txns.filter(function(t){return t.type==='expense'&&(t.category||'Other')===cat&&${df};}).sort(function(a,b){return b.date.localeCompare(a.date);}).map(function(t){return {name:(t.merchant||'?')+' ('+t.date+')',value:t.amount,category:t.category};});})()`;},
  txns_by_merchant:(a={})=>{const merch=(a.merchant||"").replace(/'/g,"\\'");const df=_df(a);return `(function(){var m='${merch}';return data.txns.filter(function(t){return (t.merchant||t.description||'').toLowerCase().includes(m.toLowerCase())&&${df};}).sort(function(a,b){return b.date.localeCompare(a.date);}).map(function(t){return {name:(t.merchant||'?')+' ('+t.date+')',value:t.amount,type:t.type};});})()`;},
  largest_expenses:(a={})=>{const df=_df(a);const n=a.limit||10;return `data.txns.filter(function(t){return t.type==='expense'&&${df};}).slice().sort(function(a,b){return b.amount-a.amount;}).slice(0,${n}).map(function(t){return {name:(t.merchant||'?')+' ('+t.date+')',value:t.amount,category:t.category};})`;},
  compare_expenses:(a={})=>{const m1=a.month1||new Date().toISOString().slice(0,7);const m2=a.month2||new Date().toISOString().slice(0,7);return `(function(){function total(m){return data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);}var v1=total('${m1}'),v2=total('${m2}');var change=v2-v1;var pct=v1!==0?Math.round((change/v1)*1000)/10:null;return {month1:'${m1}',value1:Math.round(v1*100)/100,month2:'${m2}',value2:Math.round(v2*100)/100,change:Math.round(change*100)/100,changePercent:pct};})()`;},
  compare_income:(a={})=>{const m1=a.month1||new Date().toISOString().slice(0,7);const m2=a.month2||new Date().toISOString().slice(0,7);return `(function(){function total(m){return data.txns.filter(function(t){return t.type==='income'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);}var v1=total('${m1}'),v2=total('${m2}');var change=v2-v1;var pct=v1!==0?Math.round((change/v1)*1000)/10:null;return {month1:'${m1}',value1:Math.round(v1*100)/100,month2:'${m2}',value2:Math.round(v2*100)/100,change:Math.round(change*100)/100,changePercent:pct};})()`;},
  compare_net:(a={})=>{const m1=a.month1||new Date().toISOString().slice(0,7);const m2=a.month2||new Date().toISOString().slice(0,7);return `(function(){function net(m){var i=data.txns.filter(function(t){return t.type==='income'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);var e=data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);return i-e;}var v1=net('${m1}'),v2=net('${m2}');var change=v2-v1;var pct=v1!==0?Math.round((change/Math.abs(v1))*1000)/10:null;return {month1:'${m1}',value1:Math.round(v1*100)/100,month2:'${m2}',value2:Math.round(v2*100)/100,change:Math.round(change*100)/100,changePercent:pct};})()`;},
  savings_rate:(a={})=>{const df=_df(a);const label=_label(a);return `(function(){var inc=data.txns.filter(function(t){return t.type==='income'&&${df};}).reduce(function(s,t){return s+t.amount;},0);var exp=data.txns.filter(function(t){return t.type==='expense'&&${df};}).reduce(function(s,t){return s+t.amount;},0);var saved=inc-exp;var rate=inc>0?Math.round((saved/inc)*1000)/10:null;return {period:'${label}',income:Math.round(inc*100)/100,expenses:Math.round(exp*100)/100,saved:Math.round(saved*100)/100,rate:rate};})()`;},
  expense_share:(a={})=>{const cat=(a.category||"").replace(/'/g,"\\'");const df=_df(a);return `(function(){var cat='${cat}';var txns=data.txns.filter(function(t){return t.type==='expense'&&${df};});var total=txns.reduce(function(s,t){return s+t.amount;},0);var catTotal=txns.filter(function(t){return (t.category||'Other')===cat;}).reduce(function(s,t){return s+t.amount;},0);var pct=total>0?Math.round((catTotal/total)*1000)/10:null;return {category:cat,amount:Math.round(catTotal*100)/100,total:Math.round(total*100)/100,percent:pct};})()`;},
};

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
  // _df(args, field?) — generates a JS date-filter expression for use inside template strings.
  // Supports: month (exact), from+to (range), or neither (all-time).
  // field defaults to 't.date'; use 'e.expectedDate' for expected-income tools.
  const _df=(args={},field='t.date')=>{
    if(args.month)  return `${field}&&${field}.slice(0,7)==='${args.month}'`;
    if(args.from||args.to){
      const f=args.from||'0000-00', t=args.to||'9999-99';
      return `${field}&&${field}.slice(0,7)>='${f}'&&${field}.slice(0,7)<='${t}'`;
    }
    return 'true';
  };
  // _label(args) — human-readable period label for widget titles
  const _label=(args={})=>{
    if(args.month) return args.month;
    if(args.from&&args.to) return `${args.from} – ${args.to}`;
    if(args.from) return `from ${args.from}`;
    if(args.to)   return `up to ${args.to}`;
    return 'All Time';
  };

  const TOOL_LIBRARY={
    // ── Spending & Income ──────────────────────────────────────────────────────
    // expenses(month?|from?,to?) — total expenses. single month OR range
    expenses:(args={})=>{
      const df=_df(args);
      return `(function(){return Math.round(data.txns.filter(function(t){return t.type==='expense'&&${df};}).reduce(function(s,t){return s+t.amount;},0)*100)/100;})()`;
    },
    // income(month?|from?,to?) — total income
    income:(args={})=>{
      const df=_df(args);
      return `(function(){return Math.round(data.txns.filter(function(t){return t.type==='income'&&${df};}).reduce(function(s,t){return s+t.amount;},0)*100)/100;})()`;
    },
    // net(month?|from?,to?) — income minus expenses
    net:(args={})=>{
      const df=_df(args);
      return `(function(){var df=function(t){return ${df};};var i=data.txns.filter(function(t){return t.type==='income'&&df(t);}).reduce(function(s,t){return s+t.amount;},0);var e=data.txns.filter(function(t){return t.type==='expense'&&df(t);}).reduce(function(s,t){return s+t.amount;},0);return Math.round((i-e)*100)/100;})()`;
    },
    // categories(month?|from?,to?) — expense totals grouped by category
    categories:(args={})=>{
      const df=_df(args);
      return `(function(){var a={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';a[c]=(a[c]||0)+t.amount;});return Object.entries(a).sort(function(x,y){return y[1]-x[1];}).map(function(e){return {name:e[0],value:Math.round(e[1]*100)/100};});})()`;
    },
    // top_category(month?|from?,to?) — single highest-spend category
    top_category:(args={})=>{
      const df=_df(args);
      return `(function(){var a={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';a[c]=(a[c]||0)+t.amount;});var s=Object.entries(a).sort(function(x,y){return y[1]-x[1];});return s.length?{name:s[0][0],value:Math.round(s[0][1]*100)/100}:null;})()`;
    },
    // monthly(months?|from?,to?) — income & expenses per month
    monthly:(args={})=>{
      const n=args.months||99;
      const df=_df(args,'d');
      const rangeFilter=(args.from||args.to)?`var d=t.date?t.date.slice(0,7):null;if(!d||!(${df}))return;`:`var d=t.date?t.date.slice(0,7):null;if(!d)return;`;
      return `(function(){var mo={};data.txns.forEach(function(t){${rangeFilter}if(!mo[d])mo[d]={name:d,Income:0,Expenses:0};if(t.type==='income')mo[d].Income+=t.amount;if(t.type==='expense')mo[d].Expenses+=t.amount;});return Object.values(mo).sort(function(a,b){return a.name<b.name?-1:1;}).slice(-${n});})()`;
    },
    // bills(type?) — "total"=sum, default=list [{name,value}]
    bills:(args={})=>{
      if(args.type==="total")
        return `Math.round(data.bills.filter(function(b){return b.active!==false;}).reduce(function(s,b){return s+b.amount;},0)*100)/100`;
      return `data.bills.filter(function(b){return b.active!==false;}).map(function(b){return {name:b.name,value:b.amount};}).sort(function(a,b){return b.value-a.value;})`;
    },
    // portfolio(type?) — "total"=value, default=holdings [{name,value}]
    portfolio:(args={})=>{
      if(args.type==="total")
        return `(function(){if(!data.holdings||!data.holdings.length)return 0;return Math.round(data.holdings.reduce(function(s,h){return s+(h.shares||0)*(h.price||h.currentPrice||0);},0)*100)/100;})()`;
      return `(function(){if(!data.holdings||!data.holdings.length)return [];return data.holdings.map(function(h){return {name:h.ticker||h.symbol||'?',value:Math.round((h.shares||0)*(h.price||h.currentPrice||0)*100)/100};}).sort(function(a,b){return b.value-a.value;});})()`;
    },
    // merchants(month?|from?,to?, limit?) — top merchants by spend
    merchants:(args={})=>{
      const df=_df(args);
      const n=args.limit||10;
      return `(function(){var a={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var k=t.merchant||t.description||'Other';a[k]=(a[k]||0)+t.amount;});return Object.entries(a).sort(function(x,y){return y[1]-x[1];}).slice(0,${n}).map(function(e){return {name:e[0],value:Math.round(e[1]*100)/100};});})()`;
    },
    // transactions(month?|from?,to?, limit?) — recent transactions
    transactions:(args={})=>{
      const df=_df(args);
      const n=args.limit||10;
      return `data.txns.filter(function(t){return ${df};}).slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,${n}).map(function(t){return {name:(t.merchant||t.description||'?')+' ('+t.date+')',value:t.amount};})`;
    },

    // ── Expected Income ────────────────────────────────────────────────────────
    // pending_income(month?|from?,to?) — unconfirmed expected income
    pending_income:(args={})=>{
      const df=_df(args,'e.expectedDate');
      return `(function(){var items=(data.expected||[]).filter(function(e){return !e.confirmed&&${df};});var total=items.reduce(function(s,e){return s+e.amount;},0);return {total:Math.round(total*100)/100,items:items.map(function(e){return {name:e.source,value:e.amount,date:e.expectedDate};})};})()`;
    },
    // confirmed_income(month?|from?,to?) — confirmed expected income
    confirmed_income:(args={})=>{
      const df=_df(args,'e.expectedDate');
      return `(function(){var items=(data.expected||[]).filter(function(e){return e.confirmed&&${df};});var total=items.reduce(function(s,e){return s+e.amount;},0);return {total:Math.round(total*100)/100,items:items.map(function(e){return {name:e.source,value:e.amount,date:e.confirmedDate||e.expectedDate};})};})()`;
    },
    // all_expected_income(month?|from?,to?) — all expected income with status
    all_expected_income:(args={})=>{
      const df=_df(args,'e.expectedDate');
      return `(function(){var items=(data.expected||[]).filter(function(e){return ${df};});var total=items.reduce(function(s,e){return s+e.amount;},0);var pending=items.filter(function(e){return !e.confirmed;}).reduce(function(s,e){return s+e.amount;},0);var confirmed=items.filter(function(e){return e.confirmed;}).reduce(function(s,e){return s+e.amount;},0);return {total:Math.round(total*100)/100,pending:Math.round(pending*100)/100,confirmed:Math.round(confirmed*100)/100,items:items.map(function(e){return {name:e.source+(e.confirmed?' ✓':' ?'),value:e.amount,date:e.expectedDate};})};})()`;
    },

    // ── Budgets ────────────────────────────────────────────────────────────────
    // budgets() — all category budgets
    budgets:()=>`Object.entries(data.catBudgets||{}).map(function(e){return {name:e[0],value:e[1]};}).sort(function(a,b){return b.value-a.value;})`,
    // budget_vs_actual(month?|from?,to?) — category budget vs actual spend
    budget_vs_actual:(args={})=>{
      const df=_df(args);
      return `(function(){var spent={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';spent[c]=(spent[c]||0)+t.amount;});var budgets=data.catBudgets||{};var cats=Array.from(new Set(Object.keys(budgets).concat(Object.keys(spent))));return cats.map(function(c){var b=budgets[c]||0;var s=Math.round((spent[c]||0)*100)/100;var rem=Math.round((b-s)*100)/100;var pct=b>0?Math.round((s/b)*1000)/10:null;return {name:c,budget:b,spent:s,remaining:rem,percentUsed:pct};}).sort(function(a,b){return (b.percentUsed||0)-(a.percentUsed||0);});})()`;
    },
    // budget_remaining(category, month?|from?,to?) — remaining budget for one category
    budget_remaining:(args={})=>{
      const cat=(args.category||"").replace(/'/g,"\\'");
      const df=_df(args);
      return `(function(){var cat='${cat}';var budget=(data.catBudgets||{})[cat]||0;var spent=data.txns.filter(function(t){return t.type==='expense'&&(t.category||'Other')===cat&&${df};}).reduce(function(s,t){return s+t.amount;},0);var remaining=budget-spent;var pct=budget>0?Math.round((spent/budget)*1000)/10:null;return {category:cat,budget:Math.round(budget*100)/100,spent:Math.round(spent*100)/100,remaining:Math.round(remaining*100)/100,percentUsed:pct};})()`;
    },
    // over_budget(month?|from?,to?) — categories exceeding their budget
    over_budget:(args={})=>{
      const df=_df(args);
      return `(function(){var spent={};data.txns.filter(function(t){return t.type==='expense'&&${df};}).forEach(function(t){var c=t.category||'Other';spent[c]=(spent[c]||0)+t.amount;});var budgets=data.catBudgets||{};return Object.keys(budgets).filter(function(c){return (spent[c]||0)>budgets[c];}).map(function(c){return {name:c,budget:Math.round(budgets[c]*100)/100,spent:Math.round(spent[c]*100)/100,over:Math.round((spent[c]-budgets[c])*100)/100};}).sort(function(a,b){return b.over-a.over;});})()`;
    },

    // ── Bills ─────────────────────────────────────────────────────────────────
    // bills_due(month?|from?,to?) — unpaid bills; range returns unpaid across all months in window
    bills_due:(args={})=>{
      const m=args.month||new Date().toISOString().slice(0,7);
      return `(function(){var m='${m}';var paid=new Set((data.billPayments||[]).filter(function(p){return p.month===m;}).map(function(p){return p.billId;}));return (data.bills||[]).filter(function(b){return b.active!==false&&!paid.has(b.id);}).map(function(b){return {name:b.name,value:b.amount,dueDay:b.dueDay,category:b.category};}).sort(function(a,b){return a.dueDay-b.dueDay;});})()`;
    },
    // bills_paid(month?) — paid bills this month
    bills_paid:(args={})=>{
      const m=args.month||new Date().toISOString().slice(0,7);
      return `(function(){var m='${m}';var paid=new Set((data.billPayments||[]).filter(function(p){return p.month===m;}).map(function(p){return p.billId;}));return (data.bills||[]).filter(function(b){return paid.has(b.id);}).map(function(b){return {name:b.name,value:b.amount,dueDay:b.dueDay};});})()`;
    },

    // ── Holdings / Portfolio ───────────────────────────────────────────────────
    // holdings_detail() — each holding with cost basis, market value, gain/loss
    holdings_detail:()=>`(function(){return (data.holdings||[]).map(function(h){var price=h.price||h.currentPrice||0;var mktVal=Math.round((h.shares||0)*price*100)/100;var cost=Math.round((h.shares||0)*(h.costBasis||0)*100)/100;var gain=Math.round((mktVal-cost)*100)/100;var gainPct=cost>0?Math.round((gain/cost)*1000)/10:null;return {name:h.ticker||h.symbol||'?',shares:h.shares,costBasis:h.costBasis,marketValue:mktVal,cost:cost,gain:gain,gainPercent:gainPct};}).sort(function(a,b){return b.marketValue-a.marketValue;});})()`,
    // portfolio_gain() — total unrealised gain/loss
    portfolio_gain:()=>`(function(){var total=0,cost=0;(data.holdings||[]).forEach(function(h){var price=h.price||h.currentPrice||0;total+=(h.shares||0)*price;cost+=(h.shares||0)*(h.costBasis||0);});var gain=total-cost;var pct=cost>0?Math.round((gain/cost)*1000)/10:null;return {marketValue:Math.round(total*100)/100,totalCost:Math.round(cost*100)/100,gain:Math.round(gain*100)/100,gainPercent:pct};})()`,
    // holding(ticker) — detail for one ticker
    holding:(args={})=>{
      const t=(args.ticker||"").replace(/'/g,"\\'");
      return `(function(){var t='${t}';var h=(data.holdings||[]).find(function(h){return (h.ticker||h.symbol||'').toUpperCase()===t.toUpperCase();});if(!h)return null;var price=h.price||h.currentPrice||0;var mktVal=Math.round((h.shares||0)*price*100)/100;var cost=Math.round((h.shares||0)*(h.costBasis||0)*100)/100;var gain=Math.round((mktVal-cost)*100)/100;var pct=cost>0?Math.round((gain/cost)*1000)/10:null;return {ticker:h.ticker||h.symbol,shares:h.shares,costBasis:h.costBasis,marketValue:mktVal,cost:cost,gain:gain,gainPercent:pct};})()`;
    },

    // ── Vacations ─────────────────────────────────────────────────────────────
    // vacations() — all vacations: [{name, startDate, endDate, budget}]
    vacations:()=>`(data.vacations||[]).map(function(v){return {name:v.name,startDate:v.startDate,endDate:v.endDate,budget:v.budget};})`,
    // vacation_spending(name) — actual spend vs budget for a named vacation
    vacation_spending:(args={})=>{
      const name=(args.name||"").replace(/'/g,"\\'");
      return `(function(){var name='${name}';var v=(data.vacations||[]).find(function(v){return v.name.toLowerCase().includes(name.toLowerCase());});if(!v)return null;var txns=data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date>=v.startDate&&t.date<=v.endDate;});var total=txns.reduce(function(s,t){return s+t.amount;},0);var rem=v.budget-total;return {vacation:v.name,startDate:v.startDate,endDate:v.endDate,budget:v.budget,spent:Math.round(total*100)/100,remaining:Math.round(rem*100)/100,transactions:txns.map(function(t){return {name:t.merchant||t.description||'?',value:t.amount,date:t.date,category:t.category};})};})()`;
    },

    // ── Account History ────────────────────────────────────────────────────────
    // account_balance() — most recent balance snapshot
    account_balance:()=>`(function(){var h=(data.accountHistory||[]).slice().sort(function(a,b){return b.date.localeCompare(a.date);});return h.length?{balance:h[0].balance,date:h[0].date}:null;})()`,
    // balance_history(from?,to?) — balance snapshots over time
    balance_history:(args={})=>{
      const df=_df(args,'h.date');
      return `(data.accountHistory||[]).filter(function(h){return ${df};}).slice().sort(function(a,b){return a.date.localeCompare(b.date);}).map(function(h){return {name:h.date,value:h.balance};})`;
    },

    // ── Transactions (extended) ────────────────────────────────────────────────
    // txns_by_category(category, month?|from?,to?) — all transactions in a category
    txns_by_category:(args={})=>{
      const cat=(args.category||"").replace(/'/g,"\\'");
      const df=_df(args);
      return `(function(){var cat='${cat}';return data.txns.filter(function(t){return t.type==='expense'&&(t.category||'Other')===cat&&${df};}).sort(function(a,b){return b.date.localeCompare(a.date);}).map(function(t){return {name:(t.merchant||'?')+' ('+t.date+')',value:t.amount,category:t.category};});})()`;
    },
    // txns_by_merchant(merchant, month?|from?,to?) — all transactions from a merchant
    txns_by_merchant:(args={})=>{
      const merch=(args.merchant||"").replace(/'/g,"\\'");
      const df=_df(args);
      return `(function(){var m='${merch}';return data.txns.filter(function(t){return (t.merchant||t.description||'').toLowerCase().includes(m.toLowerCase())&&${df};}).sort(function(a,b){return b.date.localeCompare(a.date);}).map(function(t){return {name:(t.merchant||'?')+' ('+t.date+')',value:t.amount,type:t.type};});})()`;
    },
    // largest_expenses(month?|from?,to?, limit?) — top N expenses by amount
    largest_expenses:(args={})=>{
      const df=_df(args);
      const n=args.limit||10;
      return `data.txns.filter(function(t){return t.type==='expense'&&${df};}).slice().sort(function(a,b){return b.amount-a.amount;}).slice(0,${n}).map(function(t){return {name:(t.merchant||'?')+' ('+t.date+')',value:t.amount,category:t.category};})`;
    },

    // ── Math tools — all arithmetic happens here, never in LLM text ──────────

    // compare_expenses(month1, month2) — {month1,value1,month2,value2,change,changePercent}
    compare_expenses:(args={})=>{
      const m1=args.month1||new Date().toISOString().slice(0,7);
      const m2=args.month2||new Date().toISOString().slice(0,7);
      return `(function(){
        function total(m){return data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);}
        var v1=total('${m1}'),v2=total('${m2}');
        var change=v2-v1;
        var pct=v1!==0?Math.round((change/v1)*1000)/10:null;
        return {month1:'${m1}',value1:Math.round(v1*100)/100,month2:'${m2}',value2:Math.round(v2*100)/100,change:Math.round(change*100)/100,changePercent:pct};
      })()`.replace(/\n\s*/g," ");
    },
    // compare_income(month1, month2) — same shape for income
    compare_income:(args={})=>{
      const m1=args.month1||new Date().toISOString().slice(0,7);
      const m2=args.month2||new Date().toISOString().slice(0,7);
      return `(function(){
        function total(m){return data.txns.filter(function(t){return t.type==='income'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);}
        var v1=total('${m1}'),v2=total('${m2}');
        var change=v2-v1;
        var pct=v1!==0?Math.round((change/v1)*1000)/10:null;
        return {month1:'${m1}',value1:Math.round(v1*100)/100,month2:'${m2}',value2:Math.round(v2*100)/100,change:Math.round(change*100)/100,changePercent:pct};
      })()`.replace(/\n\s*/g," ");
    },
    // compare_net(month1, month2) — net position comparison
    compare_net:(args={})=>{
      const m1=args.month1||new Date().toISOString().slice(0,7);
      const m2=args.month2||new Date().toISOString().slice(0,7);
      return `(function(){
        function net(m){var i=data.txns.filter(function(t){return t.type==='income'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);var e=data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);return i-e;}
        var v1=net('${m1}'),v2=net('${m2}');
        var change=v2-v1;
        var pct=v1!==0?Math.round((change/Math.abs(v1))*1000)/10:null;
        return {month1:'${m1}',value1:Math.round(v1*100)/100,month2:'${m2}',value2:Math.round(v2*100)/100,change:Math.round(change*100)/100,changePercent:pct};
      })()`.replace(/\n\s*/g," ");
    },
    // savings_rate(month?|from?,to?) — {income, expenses, saved, rate%}
    savings_rate:(args={})=>{
      const df=_df(args);
      const label=_label(args);
      return `(function(){var inc=data.txns.filter(function(t){return t.type==='income'&&${df};}).reduce(function(s,t){return s+t.amount;},0);var exp=data.txns.filter(function(t){return t.type==='expense'&&${df};}).reduce(function(s,t){return s+t.amount;},0);var saved=inc-exp;var rate=inc>0?Math.round((saved/inc)*1000)/10:null;return {period:'${label}',income:Math.round(inc*100)/100,expenses:Math.round(exp*100)/100,saved:Math.round(saved*100)/100,rate:rate};})()`;
    },
    // expense_share(category, month?|from?,to?) — what % of spending is one category
    expense_share:(args={})=>{
      const cat=(args.category||"").replace(/'/g,"\\'");
      const df=_df(args);
      return `(function(){var cat='${cat}';var txns=data.txns.filter(function(t){return t.type==='expense'&&${df};});var total=txns.reduce(function(s,t){return s+t.amount;},0);var catTotal=txns.filter(function(t){return (t.category||'Other')===cat;}).reduce(function(s,t){return s+t.amount;},0);var pct=total>0?Math.round((catTotal/total)*1000)/10:null;return {category:cat,amount:Math.round(catTotal*100)/100,total:Math.round(total*100)/100,percent:pct};})()`;
    },
  };

  // Build compact system prompt — just tool names, no raw JS examples
  const buildSystemPrompt=()=>{
    const curMonth=new Date().toISOString().slice(0,7);
    return `You are SpendTracker Assistant. Answer finance questions by calling the tools below. NEVER invent or estimate numbers — only state values returned by tools.

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

Current month: ${curMonth}`;
  };

  const executeTool=async(tool)=>{
    const{name,args}=tool;
    if(name==="navigate"){
      onNavigate(args.tab);
      return{success:true,navigatedTo:args.tab};
    }
    // Named library tool — look up the JS generator and run it
    if(TOOL_LIBRARY[name]){
      try{
        const js=TOOL_LIBRARY[name](args||{});
        const r=await fetch("/api/llm/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:js})});
        const d=await r.json();
        return{id:name,result:d.result,error:d.error};
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
            const r=await fetch("/api/llm/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q.js()})});
            const d=await r.json();
            if(d.result!==undefined&&!d.error){
              const w=q.buildWidget?q.buildWidget(d.result):autoWidget(uid(),q.label,d.result,q.chartType);
              if(w) widgets.push(w);
            }
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

// ── Sidebar nav data ─────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { k:"dashboard", l:"Home",           icon:"⊞", desc:"Overview of your finances — spending, income, budgets and upcoming bills at a glance.", alwaysShow:true },
  { k:"insights",  l:"Insights",       icon:"◈", desc:"Ask questions about your data and get charts and answers powered by a local AI model.", alwaysShow:true },
  { k:"bills",     l:"Bills",          icon:"◷", desc:"Track recurring bills, mark them paid each month, and see what's still outstanding." },
  { k:"goals",     l:"Goals",          icon:"◎", desc:"Set savings goals with a target amount and date, and track your progress over time." },
  { k:"networth",  l:"Net Worth",      icon:"◈", desc:"Track accounts, assets and liabilities to see your overall financial position." },
  { k:"stocks",    l:"Stocks",         icon:"◉", desc:"Monitor your stock and ETF holdings with live prices in CAD and USD." },
  { k:"expected",  l:"Expected Income",icon:"◑", desc:"Schedule future income payments and mark them received when they land." },
  { k:"history",   l:"History",        icon:"≡",  desc:"Browse, search and bulk-edit all your past transactions." },
  { k:"vacations", l:"Vacations",      icon:"◷", desc:"Budget and track spending for trips separately from your main expenses." },
  { k:"categories",l:"Categories",     icon:"▦", desc:"Define spending categories and set monthly budget caps with progress alerts." },
  { k:"manual",    l:"Add Expense",    icon:"+", desc:"Log a one-off or recurring expense directly into your transaction history." },
  { k:"income",    l:"Add Income",     icon:"+", desc:"Record a one-off or recurring income entry." },
  { k:"folder",    l:"Folder Sync",    icon:"▤", desc:"Point the app at a local folder of receipts and import them all at once." },
  { k:"upload",    l:"Upload Receipts",icon:"↑", desc:"Upload individual receipt photos or PDFs and extract the details automatically." },
  { k:"settings",  l:"Settings",       icon:"⚙", desc:"Configure your name, Ollama model, and developer options.", isBottom:true },
];

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
        <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,#0284C7,#0369a1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <span style={{ color:"#fff", fontWeight:900, fontSize:13 }}>S</span>
        </div>
        <span style={{ fontWeight:800, fontSize:14, color:"#0f172a", letterSpacing:"-0.3px" }}>SpendTracker</span>
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

// ─── In-Depth Mode selectable wrapper ──────────────────────────────────────
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

// ─── Global Chat FAB + slide-up panel ───────────────────────────────────────
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
    const js=fn(args);
    const r=await fetch("/api/llm/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:js})});
    const d=await r.json();
    return d.result??d.error??null;
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

  // Build a reply text directly from tool result data — no LLM, no hallucination
  const buildToolSummary=(name,args,result)=>{
    const fmt=v=>typeof v==='number'?'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):String(v??'');
    const period=args.month?` for ${args.month}`:args.from?` from ${args.from} to ${args.to||'now'}`:'';
    if(result===null||result===undefined) return 'No data found.';
    // Scalar
    if(typeof result==='number') return `${name==='expenses'?'Total spending':name==='income'?'Total income':name==='net'?'Net position':name==='bills'?'Bills total':'Result'}${period}: ${fmt(result)}.`;
    // Known shapes
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
    // Arrays
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

  // Parse tool calls from LLM output — handles multiple formats:
  // 1. <tool>{...}</tool>  (our intended format)
  // 2. ```json / ```plaintext code blocks
  // 3. phi3 {"tool":{"name":"..."}} structure
  // 4. Raw {"name":"..."} JSON inline
  const parseToolCall=(text)=>{
    // Format 1: <tool>...</tool>
    const xmlM=text.match(/<tool>([\s\S]*?)<\/tool>/);
    if(xmlM){try{const d=JSON.parse(xmlM[1]);if(d?.name)return d;}catch{}}
    // Format 2: any code block containing a JSON object with "name" or nested "tool"
    const blockMs=[...text.matchAll(/```[a-z]*\s*(\{[\s\S]*?\})\s*```/g)];
    for(const bm of blockMs){
      try{
        const d=JSON.parse(bm[1]);
        if(d?.name) return {name:d.name,args:d.args||d.arguments||d.parameters||{}};
        if(d?.tool?.name) return {name:d.tool.name,args:d.tool.args||d.tool.arguments||d.tool.parameters||{}};
      }catch{}
    }
    // Format 3: raw JSON object anywhere in text with "name" key
    const allJson=[...text.matchAll(/(\{[^{}]*"name"\s*:[^{}]*\})/g)];
    for(const jm of allJson){
      try{const d=JSON.parse(jm[1]);if(d?.name&&TOOL_LIBRARY[d.name])return{name:d.name,args:d.args||d.arguments||{}};}catch{}
    }
    // Format 4: phi3 nested {"tool":...} possibly with surrounding text
    const nestedM=text.match(/"tool"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
    if(nestedM){const name=nestedM[1];if(TOOL_LIBRARY[name])return{name,args:{}};}
    return null;
  };

  const curMonth=new Date().toISOString().slice(0,7);

  // Fast-path: common patterns that skip LLM entirely
  // Note: more specific patterns must come before broader ones
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

  // Navigate fast-path
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

  // voiceMode: true when triggered by mic — Jarvis will speak then auto-listen again
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
      // Navigate fast-path
      const navMatch=text.match(/\bnavigate\s+to\s+([a-z\s]+)/i)||text.match(/\bgo\s+to\s+([a-z\s]+)/i)||text.match(/\bopen\s+([a-z\s]+)/i);
      if(navMatch){
        const dest=navMatch[1].trim().toLowerCase();
        const tab=NAV_TABS[dest]||Object.entries(NAV_TABS).find(([k])=>dest.includes(k))?.[1];
        if(tab){onNavigate(tab);const navTxt=`Navigating to ${dest}.`;setMessages(p=>[...p,{role:"assistant",text:navTxt}]);reply_(navTxt);setLoading(false);return;}
      }

      // Quick data fast-path
      const quick=QUICK.find(q=>q.test.test(text)&&selectedItems.length===0);
      if(quick){
        const result=await execTool(quick.name,quick.args(text));
        const widget=autoWidget(uid(),quick.name,result,null);
        const quickTxt=quick.reply(result);
        setMessages(p=>[...p,{role:"assistant",text:quickTxt,widget}]);
        reply_(quickTxt);
        setLoading(false);setTimeout(()=>inputRef.current?.focus(),50);return;
      }

      // LLM path
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
    // If Jarvis is speaking, tapping mic cancels speech and stops the loop
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
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const [schema,setSchema]=useState(DEFAULT_SCHEMA);
  const [insightWidgets,setInsightWidgets]=useState([]);
  const [insightMessages,setInsightMessages]=useState([]);
  const [favourites,setFavourites]=useState(["bills","history","stocks"]);
  const toggleFavourite=k=>setFavourites(prev=>{const next=prev.includes(k)?prev.filter(x=>x!==k):[...prev,k];saveServerData({favourites:next});return next;});
  const [ready,setReady]=useState(false);
  const [month,setMonth]=useState(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const [historyMonth,setHistoryMonth]=useState(today().slice(0,7));
  const [showWhatsNew,setShowWhatsNew]=useState(false);
  const [toast,setToast]=useState(null);
  const [inDepthMode,setInDepthMode]=useState(false);
  const [selectedItems,setSelectedItems]=useState([]);
  const [globalChatOpen,setGlobalChatOpen]=useState(false);
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
      if(d.settings) setSettings({...DEFAULT_SETTINGS,...d.settings});
      if(d.schema) setSchema(d.schema);
      if(d.insightMessages) setInsightMessages(d.insightMessages);
      if(d.insightWidgets) setInsightWidgets(d.insightWidgets);
      if(d.favourites) setFavourites(d.favourites);
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

  const pendingCount=expected.filter(e=>!e.confirmed).length;
  const unpaidBillCount=bills.filter(b=>b.active!==false&&!billPayments.some(p=>p.billId===b.id&&p.month===month)).length;

  return (
    <div style={{display:"flex",height:"100vh",overflow:"hidden",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",color:"#1E293B",background:"#f0f9ff"}}>
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
        {view==="dashboard"&&<Dashboard txns={visibleTxns} expected={expected} cats={cats} catBudgets={catBudgets} month={month} setMonth={setMonth} onConfirm={confirmPayment} onRevert={revertPayment} vacations={vacations} vacationTxns={vacationTxns} bills={bills} billPayments={billPayments} onToggleBill={toggleBill} goals={goals} accounts={accounts} holdings={holdings} stockPrices={stockPrices} fxRate={fxRate} inDepthMode={inDepthMode} onSelectItem={item=>setSelectedItems(p=>[...p.filter(x=>x.id!==item.id),item])}/>}
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
        {view==="settings"&&<Settings settings={settings} onSave={saveSettings}/>}
        {view==="datamodel"&&settings.devMode&&<DataModel schema={schema} onSave={saveSchema}/>}
        {view==="insights"&&<Insights schema={schema} settings={settings} onNavigate={setView} widgets={insightWidgets} onSetWidgets={setInsightWidgets} messages={insightMessages} onSetMessages={setInsightMessages}/>}
      </div>
      <GlobalChat
        view={view}
        onNavigate={setView}
        settings={settings}
        inDepthMode={inDepthMode}
        onSetInDepthMode={setInDepthMode}
        selectedItems={selectedItems}
        onSetSelectedItems={setSelectedItems}
        open={globalChatOpen}
        onSetOpen={setGlobalChatOpen}
      />
    </div>
  );
}

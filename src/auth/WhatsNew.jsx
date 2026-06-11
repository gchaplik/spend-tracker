import React, { useState, useEffect } from "react";
import { T, CA, Btn } from "../theme/tokens.jsx";

const WHATS_NEW = [
  { icon: "—", title: "Account Security", desc: "Protect your financial data with a PIN, biometric unlock (Touch ID / Windows Hello), and optional two-factor authentication. Set up on first launch or in Settings." },
  { icon: "—", title: "Household Members", desc: "Add people to your household, split shared transactions equally or by income, and track balances with a built-in settlement log. Try Household." },
  { icon: "—", title: "USD Income & Expenses", desc: "Record income or expenses in USD and CashHeap automatically converts to CAD using the real FX rate for that day. Works in Add Expense, Add Income, and Expected Income." },
  { icon: "—", title: "Mark Vacation Complete", desc: "Once a trip is done, mark it complete — it gets a green badge and moves to the bottom of the list so active trips stay front and centre." },
  { icon: "—", title: "Edit Bills Inline", desc: "Click Edit on any bill row in the Bills tab to update the name, amount, due date, or category without leaving the page." },
  { icon: "—", title: "AI Receipt Scanning", desc: "Upload photos or PDFs of receipts — AI extracts merchant, date, amount, and category automatically. Try Upload Receipts." },
  { icon: "—", title: "Folder Sync", desc: "Point the app at a local folder of receipts and scan them all at once. Already-imported files are skipped automatically. Try Folder Sync." },
  { icon: "—", title: "Recurring Transactions", desc: "Log expenses or income on weekly, bi-weekly, monthly, quarterly, and more cadences — all entries created in one shot. Try Add Expense or Add Income." },
  { icon: "—", title: "Expected Income", desc: "Schedule future income and mark it received when it lands. Overdue items are flagged and pending totals show on the Dashboard. Try Expected Income." },
  { icon: "—", title: "Vacation Budgets", desc: "Track trip expenses in a separate budget so they don't distort your monthly spending. Spending also rolls up to the Dashboard. Try Vacations." },
  { icon: "—", title: "Category Budgets", desc: "Set a monthly cap per category. Progress bars and over-budget alerts appear on the Dashboard and in History. Try Categories." },
  { icon: "—", title: "Bulk Select & Edit", desc: "In History and Expected Income, tap Select to check multiple rows and delete or confirm them all at once." },
  { icon: "—", title: "6-Month Cashflow Chart", desc: "The Dashboard charts income, expenses, and pending expected income across the last 6 months so you can spot trends at a glance." },
];


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
      {status==='available' ? `Downloading update v${version}...` : `Update v${version} ready — `}
      {status==='ready' && <button onClick={()=>window.electronUpdater.restartAndInstall()} style={{background:'#fff',color:'#0284C7',border:'none',borderRadius:6,padding:'3px 12px',fontWeight:700,cursor:'pointer',fontSize:12}}>Restart now</button>}
    </div>
  );
}

class ErrorBoundary extends React.Component{
  constructor(p){super(p);this.state={err:null};}
  static getDerivedStateFromError(e){return{err:e};}
  render(){
    if(this.state.err) return(
      <div style={{padding:40,fontFamily:"monospace",color:"#dc2626",background:"#fff",height:"100vh",overflow:"auto"}}>
        <div style={{fontSize:18,fontWeight:700,marginBottom:16}}>⚠ App crashed — {this.state.err.message}</div>
        <pre style={{fontSize:12,whiteSpace:"pre-wrap",color:"#555"}}>{this.state.err.stack}</pre>
        <button onClick={()=>this.setState({err:null})} style={{marginTop:20,padding:"8px 16px",background:"#111",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}


export { WHATS_NEW, WhatsNewModal, UpdateBanner };

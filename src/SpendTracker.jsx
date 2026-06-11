import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from "react";
import { DEFAULT_CATS, COLORS, DEFAULT_SETTINGS } from "./constants/index.js";
import { fmt, today, uid } from "./utils/formatters.js";
import { fetchData as loadServerData, patchData as saveServerData } from "./api/client.js";
import { T, IS } from "./theme/tokens.jsx";
import { _b64ud, hashPin } from "./utils/crypto.js";
import { nfmt, useNfmt, DiscreteModeCtx } from "./utils/discrete.jsx";
import { DepthCtx } from "./components/SelectableWrapper.jsx";
import { useAlerts, AlertsBell } from "./components/Alerts.jsx";
import { DEFAULT_SCHEMA } from "./views/jarvis/schema.js";
import { Sidebar } from "./components/Sidebar.jsx";
import { Toast } from "./components/Toast.jsx";
import { Dashboard } from "./views/Dashboard.jsx";
import { HealthScore, SpendingAnomalies } from "./views/HealthScore.jsx";
import { AccountSetup } from "./auth/AccountSetup.jsx";
import { LockScreen } from "./auth/LockScreen.jsx";
import { TermsOfServiceModal } from "./auth/TermsOfService.jsx";
import { WhatsNewModal, UpdateBanner } from "./auth/WhatsNew.jsx";
import { MountainLogo } from "./auth/MountainLogo.jsx";
import { GlobalChat } from "./views/jarvis/GlobalChat.jsx";
import { CommandPalette } from "./components/CommandPalette.jsx";
import { QuickAdd } from "./components/QuickAdd.jsx";
import { TabBar } from "./components/TabBar.jsx";
import { matchesCombo } from "./utils/shortcuts.js";
import { buildDates } from "./utils/dateUtils.js";

// Heavy views — lazy loaded to keep initial bundle small
const ExpectedIncome       = lazy(() => import("./views/ExpectedIncome.jsx").then(m => ({ default: m.ExpectedIncome })));
const LocalFolderSync      = lazy(() => import("./views/Receipts.jsx").then(m => ({ default: m.LocalFolderSync })));
const UploadReceipts       = lazy(() => import("./views/Receipts.jsx").then(m => ({ default: m.UploadReceipts })));
const RecurringForm        = lazy(() => import("./views/Receipts.jsx").then(m => ({ default: m.RecurringForm })));
const History              = lazy(() => import("./views/History.jsx").then(m => ({ default: m.History })));
const Bills                = lazy(() => import("./views/Bills.jsx").then(m => ({ default: m.Bills })));
const Goals                = lazy(() => import("./views/Goals.jsx").then(m => ({ default: m.Goals })));
const NetWorth             = lazy(() => import("./views/NetWorth.jsx").then(m => ({ default: m.NetWorth })));
const Stocks               = lazy(() => import("./views/Stocks.jsx").then(m => ({ default: m.Stocks })));
const Vacations            = lazy(() => import("./views/Vacations.jsx").then(m => ({ default: m.Vacations })));
const Categories           = lazy(() => import("./views/Categories.jsx").then(m => ({ default: m.Categories })));
const CSVImport            = lazy(() => import("./views/CSVImport.jsx").then(m => ({ default: m.CSVImport })));
const Reports              = lazy(() => import("./views/Reports.jsx").then(m => ({ default: m.Reports })));
const CashFlowForecast     = lazy(() => import("./views/CashFlow.jsx").then(m => ({ default: m.CashFlowForecast })));
const DebtTracker          = lazy(() => import("./views/DebtTracker.jsx").then(m => ({ default: m.DebtTracker })));
const SubscriptionManager  = lazy(() => import("./views/SubscriptionManager.jsx").then(m => ({ default: m.SubscriptionManager })));
const TaxTracker           = lazy(() => import("./views/TaxTracker.jsx").then(m => ({ default: m.TaxTracker })));
const RetirementPlanner    = lazy(() => import("./views/RetirementPlanner.jsx").then(m => ({ default: m.RetirementPlanner })));
const FinancialCalendar    = lazy(() => import("./views/FinancialCalendar.jsx").then(m => ({ default: m.FinancialCalendar })));
const WishlistPage         = lazy(() => import("./views/Wishlist.jsx").then(m => ({ default: m.WishlistPage })));
const MortgageCalculator   = lazy(() => import("./views/MortgageCalculator.jsx").then(m => ({ default: m.MortgageCalculator })));
const Household            = lazy(() => import("./views/Household.jsx").then(m => ({ default: m.Household })));
const Settings             = lazy(() => import("./views/Settings.jsx").then(m => ({ default: m.Settings })));
const DataModel            = lazy(() => import("./views/jarvis/DataModel.jsx").then(m => ({ default: m.DataModel })));
const ToolCoveragePanel    = lazy(() => import("./views/jarvis/ToolCoverage.jsx").then(m => ({ default: m.ToolCoveragePanel })));
const Insights             = lazy(() => import("./views/jarvis/Insights.jsx").then(m => ({ default: m.Insights })));
const TutorialModal        = lazy(() => import("./auth/Tutorial.jsx").then(m => ({ default: m.TutorialModal })));

const ViewLoader = <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:T.tx3,fontSize:13}}>Loading…</div>;

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

export default function App(){
  const [view,setView]=useState("dashboard");
  const [txns,setTxns]=useState([]);
  const [cats,setCats]=useState(DEFAULT_CATS);
  const [expected,setExpected]=useState([]);
  const [catBudgets,setCatBudgets]=useState({});
  const [catIcons,setCatIcons]=useState({});
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
  const [favourites,setFavourites]=useState(["bills","expected","history","stocks"]);
  const toggleFavourite=k=>setFavourites(prev=>{const next=prev.includes(k)?prev.filter(x=>x!==k):[...prev,k];saveServerData({favourites:next});return next;});
  const [inDepthMode,setInDepthMode]=useState(false);
  const [selectedItems,setSelectedItems]=useState([]);
  const [globalChatOpen,setGlobalChatOpen]=useState(false);
  const [cmdPaletteOpen,setCmdPaletteOpen]=useState(false);
  const [quickAddOpen,setQuickAddOpen]=useState(false);
  const [tabs,setTabs]=useState(()=>{
    try{
      const s=JSON.parse(localStorage.getItem("ch_tabs")||"null");
      if(Array.isArray(s)&&s.length>0){
        const clean=s.filter(k=>typeof k==="string");
        return clean[0]==="dashboard"?clean:["dashboard",...clean.filter(k=>k!=="dashboard")];
      }
    }catch{}
    return["dashboard"];
  });
  const [pinnedTabs,setPinnedTabs]=useState(()=>{
    try{
      const s=JSON.parse(localStorage.getItem("ch_pinned")||"null");
      return new Set(Array.isArray(s)?s:[]);
    }catch{}
    return new Set();
  });
  const [closedTabHistory,setClosedTabHistory]=useState([]);
  const [discreteMode,setDiscreteMode]=useState(false);
  const [discreteAuth,setDiscreteAuth]=useState({open:false,next:false,pin:"",error:"",busy:false});
  const [ready,setReady]=useState(false);
  const [month,setMonth]=useState(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
  const [historyMonth,setHistoryMonth]=useState(today().slice(0,7));
  const [showWhatsNew,setShowWhatsNew]=useState(false);
  const [dismissedAlerts,setDismissedAlerts]=useState(new Set());
  const [tosAccepted,setTosAccepted]=useState(false);
  const [tutorialSeen,setTutorialSeen]=useState(false);
  const [showTutorial,setShowTutorial]=useState(false);
  const [authConfig,setAuthConfig]=useState({});
  const [isUnlocked,setIsUnlocked]=useState(true);
  const [idleBlur,setIdleBlur]=useState(false);
  const lastActivityRef=useRef(Date.now());
  const lockTimerRef=useRef(null);
  const [toast,setToast]=useState(null);
  const toastTimer=useRef(null);
  const showToast=(msg,undoFn)=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast({msg,undoFn});toastTimer.current=setTimeout(()=>setToast(null),5000);};
  const dismissToast=()=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast(null);};

  useEffect(()=>{
    if(!authConfig.pinHash) return;
    const idleMs=(authConfig.autoLockMinutes||5)*60*1000;
    const blurMs=idleMs*0.8;
    const onActivity=()=>{lastActivityRef.current=Date.now();if(idleBlur){setIdleBlur(false);}};
    document.addEventListener("mousemove",onActivity,{passive:true});
    document.addEventListener("keydown",onActivity,{passive:true});
    document.addEventListener("click",onActivity,{passive:true});
    lockTimerRef.current=setInterval(()=>{
      if(!isUnlocked) return;
      const idle=Date.now()-lastActivityRef.current;
      if(idle>idleMs){setIdleBlur(false);setIsUnlocked(false);}
      else if(idle>blurMs){setIdleBlur(true);}
    },10000);
    return()=>{
      document.removeEventListener("mousemove",onActivity);
      document.removeEventListener("keydown",onActivity);
      document.removeEventListener("click",onActivity);
      clearInterval(lockTimerRef.current);
    };
  },[authConfig.pinHash,authConfig.autoLockMinutes,isUnlocked,idleBlur]);

  useEffect(()=>{
    loadServerData().then(d => {
      if(d.txns) setTxns(d.txns);
      if(d.cats) setCats(d.cats);
      if(d.expected) setExpected(d.expected);
      if(d.catBudgets) setCatBudgets(d.catBudgets);
      if(d.catIcons) setCatIcons(d.catIcons);
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
      if(d.tutorialSeen){ setTutorialSeen(true); } else { setShowTutorial(true); }
      if(d.authConfig&&typeof d.authConfig==="object"){
        setAuthConfig(d.authConfig);
        if(d.authConfig.enabled) setIsUnlocked(false);
      }
      setReady(true);
    }).catch(()=>setReady(true));
  },[]);

  useEffect(()=>{
    if(typeof settings.discreteMode!=="boolean") return;
    setDiscreteMode(settings.discreteMode);
    window.__discreteMode=settings.discreteMode;
  },[settings.discreteMode]);

  // Persist tab state to localStorage
  useEffect(()=>{ localStorage.setItem("ch_tabs",JSON.stringify(tabs)); },[tabs]);
  useEffect(()=>{ localStorage.setItem("ch_pinned",JSON.stringify([...pinnedTabs])); },[pinnedTabs]);

  // Sync tabs whenever view changes (from sidebar, palette, internal nav, etc.)
  useEffect(()=>{
    setTabs(prev=>prev.includes(view)?prev:[...prev,view]);
  },[view]);

  const closeTab=useCallback((k)=>{
    if(k==="dashboard"||pinnedTabs.has(k)) return;
    setClosedTabHistory(p=>[k,...p].slice(0,20));
    setTabs(prev=>{
      const next=prev.filter(t=>t!==k);
      if(view===k) setView(next[Math.max(0,prev.indexOf(k)-1)]||"dashboard");
      return next;
    });
  },[view,pinnedTabs]);

  const closeOtherTabs=useCallback((k)=>{
    setTabs(prev=>{
      const toClose=prev.filter(t=>t!==k&&t!=="dashboard"&&!pinnedTabs.has(t));
      setClosedTabHistory(p=>[...toClose,...p].slice(0,20));
      return prev.filter(t=>t===k||t==="dashboard"||pinnedTabs.has(t));
    });
    setView(k);
  },[pinnedTabs]);

  const closeAllTabs=useCallback(()=>{
    setTabs(prev=>{
      const toClose=prev.filter(t=>t!=="dashboard"&&!pinnedTabs.has(t));
      setClosedTabHistory(p=>[...toClose,...p].slice(0,20));
      return prev.filter(t=>t==="dashboard"||pinnedTabs.has(t));
    });
    setView("dashboard");
  },[pinnedTabs]);

  const pinTab=useCallback((k)=>{ if(k!=="dashboard") setPinnedTabs(p=>new Set([...p,k])); },[]);
  const unpinTab=useCallback((k)=>{ setPinnedTabs(p=>{ const n=new Set(p); n.delete(k); return n; }); },[]);

  const reorderTabs=useCallback((fromIdx,toIdx)=>{
    if(fromIdx===0||toIdx===0) return;
    setTabs(prev=>{ const n=[...prev]; const[m]=n.splice(fromIdx,1); n.splice(toIdx,0,m); return n; });
  },[]);

  const reopenLastClosedTab=useCallback(()=>{
    setClosedTabHistory(prev=>{
      if(!prev.length) return prev;
      const[k,...rest]=prev;
      setTabs(p=>p.includes(k)?p:[...p,k]);
      setView(k);
      return rest;
    });
  },[]);

  useEffect(()=>{
    const sc=settings.viewShortcuts||{};
    const inInput=()=>{const t=document.activeElement?.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||document.activeElement?.isContentEditable;};
    const onKey=(e)=>{
      if((e.metaKey||e.ctrlKey)&&e.key==="k"){e.preventDefault();setCmdPaletteOpen(o=>!o);return;}
      if((e.metaKey||e.ctrlKey)&&e.key==="n"&&!e.shiftKey){e.preventDefault();setQuickAddOpen(true);return;}
      if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key==="w"){e.preventDefault();closeTab(view);return;}
      if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key==="T"){e.preventDefault();reopenLastClosedTab();return;}
      if(e.key==="Tab"&&e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!inInput()){
        e.preventDefault();
        const idx=tabs.indexOf(view);
        setView(tabs[(idx+1)%tabs.length]);
        return;
      }
      for(const[vk,combo] of Object.entries(sc)){if(matchesCombo(e,combo)){e.preventDefault();setView(vk);return;}}
      if((e.metaKey||e.ctrlKey)&&!e.altKey&&/^[1-9]$/.test(e.key)){
        const idx=parseInt(e.key)-1;
        if(idx<tabs.length){e.preventDefault();setView(tabs[idx]);return;}
      }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[settings.viewShortcuts,view,tabs,closeTab,reopenLastClosedTab]);

  useEffect(()=>{
    if(!settings.devMode && view==="toolcoverage") setView("dashboard");
  },[settings.devMode,view]);

  const saveTxns=t=>{
    const threshold=settings.largeTransactionAlert||500;
    if(Notification.permission==="granted"){
      const newTxns=t.filter(x=>!txns.find(y=>y.id===x.id));
      newTxns.filter(x=>x.type==="expense"&&x.amount>=threshold).forEach(x=>{
        new Notification("Large Transaction",{body:`${x.merchant||x.source}: ${fmt(x.amount)}`});
      });
    }
    setTxns(t);saveServerData({txns:t});
  };
  const saveCats=c=>{setCats(c);saveServerData({cats:c});};
  const saveExpected=e=>{setExpected(e);saveServerData({expected:e});};
  const saveCatBudgets=b=>{setCatBudgets(b);saveServerData({catBudgets:b})};
  const saveCatIcons=ic=>{setCatIcons(ic);saveServerData({catIcons:ic})};
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
  const setDiscreteModeAndPersist=next=>{
    setDiscreteMode(next);
    window.__discreteMode=next;
    saveSettings({...settings,discreteMode:next});
  };
  const closeDiscreteAuth=()=>setDiscreteAuth({open:false,next:false,pin:"",error:"",busy:false});
  const useBiometricForDiscreteMode=async()=>{
    if(!authConfig.webauthnCredId) return false;
    try{
      if(authConfig.bioMethod==="touchid"&&window.electronBiometrics){
        await window.electronBiometrics.prompt("verify your identity to change discrete mode");
        return true;
      }
      if(window.PublicKeyCredential&&navigator.credentials?.get){
        const credId=_b64ud(authConfig.webauthnCredId);
        await navigator.credentials.get({publicKey:{
          challenge:crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials:[{type:"public-key",id:credId}],
          userVerification:"required",
          timeout:60000,
          rpId:window.location.hostname||"localhost",
        }});
        return true;
      }
    }catch(_e){return false;}
    return false;
  };
  const requestDiscreteModeChange=async(next)=>{
    if(next===discreteMode) return;
    if(!authConfig?.pinHash){setDiscreteModeAndPersist(next);return;}
    if(await useBiometricForDiscreteMode()){setDiscreteModeAndPersist(next);return;}
    setDiscreteAuth({open:true,next,pin:"",error:"",busy:false});
  };
  const submitDiscreteAuth=async()=>{
    if(discreteAuth.busy) return;
    if((discreteAuth.pin||"").length<4){setDiscreteAuth(p=>({...p,error:"Enter your current PIN to continue"}));return;}
    setDiscreteAuth(p=>({...p,busy:true,error:""}));
    try{
      const candidateHash=await hashPin(discreteAuth.pin,authConfig.pinSalt);
      if(candidateHash===authConfig.pinHash){setDiscreteModeAndPersist(discreteAuth.next);closeDiscreteAuth();}
      else{setDiscreteAuth(p=>({...p,busy:false,error:"Incorrect PIN"}));}
    }catch(e){setDiscreteAuth(p=>({...p,busy:false,error:e.message||"Could not verify PIN"}));}
  };
  const saveSchema=s=>{setSchema(s);saveServerData({schema:s})};

  // Net worth milestones — toast when net worth crosses a round number
  const MILESTONES=[10000,25000,50000,100000,250000,500000,1000000];
  const prevNetWorthRef=useRef(null);
  useEffect(()=>{
    if(!ready||accounts.length===0) return;
    const ASSET_TYPES=["chequing","savings","investment","other"];
    const assets=accounts.filter(a=>ASSET_TYPES.includes(a.type)).reduce((s,a)=>s+a.balance,0);
    const liab=accounts.filter(a=>!ASSET_TYPES.includes(a.type)).reduce((s,a)=>s+a.balance,0);
    const nw=assets-liab;
    const prev=prevNetWorthRef.current;
    if(prev!==null&&prev!==nw){
      const crossed=MILESTONES.filter(m=>(prev<m&&nw>=m)||(prev>=-m&&nw<=-m));
      if(crossed.length>0){
        const m=crossed[0];
        const sign=nw>=0?"+":"-";
        showToast(`${sign} Net worth crossed ${fmt(Math.abs(m))}!`);
        if(Notification.permission==="granted") new Notification("CashHeap",{body:`Net worth reached ${sign}${fmt(Math.abs(m))}`});
      }
    }
    prevNetWorthRef.current=nw;
  },[accounts,ready]);

  // OS notifications on app launch
  const notifFiredRef=useRef(false);
  useEffect(()=>{
    if(!ready||notifFiredRef.current) return;
    notifFiredRef.current=true;
    if(typeof Notification==="undefined") return;
    const requestAndFire=()=>{
      const curMonth=today().slice(0,7);
      const msgs=[];
      // Bills due ≤3 days
      const todayMs=new Date().setHours(0,0,0,0);
      const threeMs=3*86400000;
      bills.filter(b=>b.active!==false&&!billPayments.some(p=>p.billId===b.id&&p.month===curMonth)).forEach(b=>{
        if(!b.dueDay) return;
        const due=new Date(new Date().getFullYear(),new Date().getMonth(),b.dueDay).setHours(0,0,0,0);
        const diff=due-todayMs;
        if(diff>=0&&diff<=threeMs) msgs.push({title:"Bill Due Soon",body:`${b.name} — ${fmt(b.amount)} due in ${Math.round(diff/86400000)} day${diff===0?"":"s"}`});
      });
      // Budget overage (80% and 100%)
      const mt=txns.filter(t=>t.type==="expense"&&t.date?.startsWith(curMonth));
      Object.entries(catBudgets).forEach(([cat,budget])=>{
        if(!budget) return;
        const spent=mt.filter(t=>t.category===cat).reduce((s,t)=>s+t.amount,0);
        const pct=spent/budget;
        if(pct>=1) msgs.push({title:"Budget Exceeded",body:`${cat}: ${fmt(spent)} of ${fmt(budget)} budget`});
        else if(pct>=0.8) msgs.push({title:"Budget Warning",body:`${cat} is at ${Math.round(pct*100)}% of budget`});
      });
      // Weekly digest (Sundays)
      if(new Date().getDay()===0){
        const weekAgo=new Date();weekAgo.setDate(weekAgo.getDate()-7);
        const weekStr=weekAgo.toISOString().split("T")[0];
        const weekTxns=txns.filter(t=>t.type==="expense"&&t.date>=weekStr&&t.date<=today());
        const weekTotal=weekTxns.reduce((s,t)=>s+t.amount,0);
        if(weekTotal>0){
          const topCat=Object.entries(weekTxns.reduce((m,t)=>{m[t.category||"Other"]=(m[t.category||"Other"]||0)+t.amount;return m;},{})).sort((a,b)=>b[1]-a[1])[0];
          msgs.push({title:"Weekly Digest",body:`This week: ${fmt(weekTotal)} spent${topCat?` · Top: ${topCat[0]} (${fmt(topCat[1])})`:""}` });
        }
      }
      msgs.forEach(({title,body})=>new Notification(title,{body}));
    };
    if(Notification.permission==="granted") requestAndFire();
    else if(Notification.permission!=="denied") Notification.requestPermission().then(p=>{if(p==="granted")requestAndFire();});
  },[ready]);

  const enableAlerts=()=>saveSettings({...settings,alertsEnabled:true});
  const disableAlerts=()=>{saveSettings({...settings,alertsEnabled:false});setDismissedAlerts(new Set());};
  const dismissAlert=id=>setDismissedAlerts(p=>new Set([...p,id]));
  const dismissAllAlerts=()=>setDismissedAlerts(new Set(appAlerts.map(a=>a.id)));
  const insightMsgsReady=useRef(false);
  useEffect(()=>{if(!insightMsgsReady.current){insightMsgsReady.current=true;return;}saveServerData({insightMessages});},[insightMessages]);
  const insightWgtsReady=useRef(false);
  useEffect(()=>{if(!insightWgtsReady.current){insightWgtsReady.current=true;return;}saveServerData({insightWidgets});},[insightWidgets]);
  const toggleBill=(id,forMonth=month)=>{
    const payment=billPayments.find(p=>p.billId===id&&p.month===forMonth);
    if(payment){
      if(payment.txnId) saveTxns(txns.filter(t=>t.id!==payment.txnId));
      saveBillPayments(billPayments.filter(p=>!(p.billId===id&&p.month===forMonth)));
    } else {
      const b=bills.find(x=>x.id===id);
      if(b){
        const txnId=uid();
        saveTxns([...txns,{id:txnId,type:"expense",merchant:b.name,category:b.category||"Bills",amount:b.amount,date:today(),note:b.note||""}]);
        saveBillPayments([...billPayments,{id:uid(),billId:id,month:forMonth,paidDate:today(),amount:b.amount,txnId}]);
      }
    }
  };
  const confirmPayment=id=>{
    const item=expected.find(e=>e.id===id);if(!item)return;
    const txnId=uid();
    saveTxns([...txns,{id:txnId,type:"income",merchant:item.source,source:item.source,amount:item.amount,date:today(),note:item.note||""}]);
    let nextExpected=expected.map(e=>e.id===id?{...e,confirmed:true,confirmedDate:today(),confirmedTxnId:txnId}:e);
    if(item.cadence&&item.cadence!=="once"&&item.expectedDate){
      const nextDate=buildDates(item.expectedDate,item.cadence,2)[1];
      if(nextDate){
        const alreadyExists=expected.some(e=>e.source===item.source&&e.expectedDate===nextDate&&!e.confirmed);
        if(!alreadyExists) nextExpected=[...nextExpected,{...item,id:uid(),confirmed:false,confirmedDate:null,confirmedTxnId:null,expectedDate:nextDate}];
      }
    }
    saveExpected(nextExpected);
  };

  const autoMatchBills=(newTxns,allTxns)=>{
    const curMonth=today().slice(0,7);
    const unpaid=bills.filter(b=>b.active!==false&&!billPayments.some(p=>p.billId===b.id&&p.month===curMonth));
    if(!unpaid.length) return;
    const newPayments=[...billPayments];
    unpaid.forEach(bill=>{
      const bName=(bill.name||"").toLowerCase();
      const match=newTxns.find(t=>{
        if(t.type!=="expense") return false;
        const tName=(t.merchant||"").toLowerCase();
        const nameMatch=tName.includes(bName)||bName.includes(tName);
        const amtMatch=Math.abs(t.amount-bill.amount)/Math.max(bill.amount,0.01)<=0.1;
        const monthMatch=t.date?.startsWith(curMonth);
        return nameMatch&&amtMatch&&monthMatch;
      });
      if(match) newPayments.push({id:uid(),billId:bill.id,month:curMonth,paidDate:today(),amount:bill.amount,txnId:match.id,autoMatched:true});
    });
    if(newPayments.length>billPayments.length) saveBillPayments(newPayments);
  };
  const revertPayment=id=>{
    const item=expected.find(e=>e.id===id);if(!item)return;
    if(item.confirmedTxnId) saveTxns(txns.filter(t=>t.id!==item.confirmedTxnId));
    saveExpected(expected.map(e=>e.id===id?{...e,confirmed:false,confirmedDate:null,confirmedTxnId:null}:e));
  };

  const appAlerts=useAlerts({txns,bills,billPayments,catBudgets,goals,month,settings});
  const pendingCount=expected.filter(e=>!e.confirmed).length;
  const unpaidBillCount=bills.filter(b=>b.active!==false&&!billPayments.some(p=>p.billId===b.id&&p.month===month)).length;

  if(!ready) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",color:"#9ca3af",fontSize:13}}>Loading...</div>;
  if(!authConfig.pinHash) return <AccountSetup onComplete={cfg=>{saveAuthConfig(cfg);setIsUnlocked(true);}}/>;
  if(!isUnlocked) return <LockScreen authConfig={authConfig} onUnlock={()=>{setIsUnlocked(true);setIdleBlur(false);lastActivityRef.current=Date.now();}}/>;

  const cbFilters={none:"",deuteranopia:"url(#cb-deuteranopia)",protanopia:"url(#cb-protanopia)",tritanopia:"url(#cb-tritanopia)",achromatopsia:"url(#cb-achromatopsia)"};
  const rootFilter=[settings.darkMode?"invert(1) hue-rotate(180deg)":"",cbFilters[settings.colorBlindMode]||""].filter(Boolean).join(" ")||undefined;

  return (
    <DiscreteModeCtx.Provider value={discreteMode}>
    <ErrorBoundary>
    <>
    {discreteMode&&<style>{`.recharts-tooltip-wrapper{display:none!important}.recharts-cartesian-axis-tick-value{opacity:0!important}`}</style>}
    <svg style={{position:"absolute",width:0,height:0,overflow:"hidden"}} aria-hidden="true">
      <defs>
        <filter id="cb-deuteranopia"><feColorMatrix type="matrix" values="0.367 0.861 -0.228 0 0  0.280 0.673  0.047 0 0  -0.012 0.043  0.969 0 0  0 0 0 1 0"/></filter>
        <filter id="cb-protanopia">  <feColorMatrix type="matrix" values="0.152 1.053 -0.205 0 0  0.115 0.786  0.099 0 0  -0.004 -0.048 1.052 0 0  0 0 0 1 0"/></filter>
        <filter id="cb-tritanopia">  <feColorMatrix type="matrix" values="1.256 -0.077 -0.180 0 0  -0.078 0.931  0.148 0 0  0.005  0.691  0.304 0 0  0 0 0 1 0"/></filter>
        <filter id="cb-achromatopsia"><feColorMatrix type="saturate" values="0"/></filter>
      </defs>
    </svg>
    <UpdateBanner/>
    {idleBlur&&isUnlocked&&(
      <div onClick={()=>{lastActivityRef.current=Date.now();setIdleBlur(false);}}
        style={{position:"fixed",inset:0,zIndex:9000,backdropFilter:"blur(24px) brightness(0.6)",WebkitBackdropFilter:"blur(24px) brightness(0.6)",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
        <MountainLogo size={48}/>
        <div style={{color:"rgba(255,255,255,0.9)",fontSize:14,fontWeight:600,fontFamily:"system-ui,sans-serif"}}>CashHeap is idle</div>
        <div style={{color:"rgba(255,255,255,0.5)",fontSize:12,fontFamily:"system-ui,sans-serif"}}>Click anywhere to continue</div>
      </div>
    )}
    {!tosAccepted&&<TermsOfServiceModal onAccept={()=>{setTosAccepted(true);saveServerData({tosAccepted:true});}} onDecline={()=>{if(window.electronApp?.quit)window.electronApp.quit();else window.close();}}/>}
    <DepthCtx.Provider value={{inDepthMode,onSelectItem:item=>setSelectedItems(p=>{const already=p.some(x=>x.label===item.label);return already?p:[...p,item];})}}>
    <div style={{display:"flex",height:"100vh",overflow:"hidden",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",color:T.tx1,background:T.bg,filter:rootFilter}}>
      {showWhatsNew&&<WhatsNewModal onClose={()=>setShowWhatsNew(false)}/>}
      {showTutorial&&<Suspense fallback={null}><TutorialModal onClose={()=>{setShowTutorial(false);if(!tutorialSeen){setTutorialSeen(true);saveServerData({tutorialSeen:true});}}} onNavigate={v=>{setView(v);}}/></Suspense>}
      {toast&&<Toast msg={toast.msg} undoFn={toast.undoFn} onClose={dismissToast}/>}
      <CommandPalette open={cmdPaletteOpen} onClose={()=>setCmdPaletteOpen(false)} onNavigate={v=>{setView(v);}} devMode={settings.devMode}/>
      {quickAddOpen&&<QuickAdd cats={cats} onSave={t=>{saveTxns([...txns,t]);setQuickAddOpen(false);showToast("Transaction added");}} onClose={()=>setQuickAddOpen(false)}/>}

      <Sidebar view={view} onNavigate={setView} favourites={favourites} onToggleFavourite={toggleFavourite} onReorderFavourites={next=>{setFavourites(next);saveServerData({favourites:next});}} pendingCount={pendingCount} unpaidBillCount={unpaidBillCount} devMode={settings.devMode} onShowWhatsNew={()=>setShowWhatsNew(v=>!v)} onSignOut={authConfig.pinHash?()=>{setIsUnlocked(false);setIdleBlur(false);}:undefined} shortcuts={settings.viewShortcuts||{}}/>

      <div data-tutorial="main-content" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <TabBar
          tabs={tabs} activeTab={view} pinnedTabs={pinnedTabs}
          onNavigate={setView} onClose={closeTab}
          onCloseOthers={closeOtherTabs} onCloseAll={closeAllTabs}
          onPin={pinTab} onUnpin={unpinTab} onReorder={reorderTabs}
          onOpenPalette={()=>setCmdPaletteOpen(true)}
          shortcuts={settings.viewShortcuts||{}}
          badges={{expected:pendingCount,bills:unpaidBillCount}}
        />
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",padding:"16px 36px 0",gap:8,flexShrink:0}}>
          <button onClick={()=>setCmdPaletteOpen(true)} title="Command palette (⌘K)" style={{display:"flex",alignItems:"center",gap:6,padding:"5px 11px",borderRadius:20,border:"1.5px solid "+T.border,background:"transparent",color:T.tx3,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}><span style={{fontSize:12}}>⌘K</span></button>
          <button onClick={()=>requestDiscreteModeChange(!discreteMode)} title={discreteMode?"Discrete Mode ON — click to show real numbers":"Discrete Mode — hide all numbers for demos"} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 11px",borderRadius:20,border:"1.5px solid",borderColor:discreteMode?T.accent:T.border,background:discreteMode?T.accent:"transparent",color:discreteMode?"#fff":T.tx3,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}><span style={{fontSize:14}}>◫</span><span>{discreteMode?"Discrete ON":"Discrete"}</span></button>
          {settings.alertsEnabled===true&&(<AlertsBell alerts={appAlerts} dismissed={dismissedAlerts} onDismiss={dismissAlert} onDismissAll={dismissAllAlerts} settings={settings} onUpdateSettings={saveSettings} onEnable={enableAlerts} onDisable={disableAlerts}/>)}
        </div>
        {settings.alertsEnabled===null&&(
          <div style={{margin:"12px 36px 0",background:T.surface,border:"1px solid "+T.border,borderRadius:T.rCard,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,boxShadow:T.shadow}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:T.overlay,border:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={T.tx2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg></div>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:T.tx1}}>Would you like budget &amp; bill alerts?</div><div style={{fontSize:12,color:T.tx3,marginTop:2}}>Get notified when bills are due, budgets are close, or large transactions occur.</div></div>
            <div style={{display:"flex",gap:8,flexShrink:0}}>
              <button onClick={enableAlerts} style={{padding:"7px 16px",borderRadius:T.r,border:"none",background:T.accent,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Enable</button>
              <button onClick={()=>saveSettings({...settings,alertsEnabled:false})} style={{padding:"7px 12px",borderRadius:T.r,border:"1px solid "+T.border,background:"transparent",color:T.tx2,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>No thanks</button>
            </div>
          </div>
        )}
        <div style={{flex:1,padding:"20px 36px 28px"}}>
        <Suspense fallback={ViewLoader}>
        {(()=>{const visibleTxns=txns.filter(t=>t.date&&t.date<=today());return(<>
        {view==="dashboard"&&<><Dashboard txns={visibleTxns} expected={expected} cats={cats} catBudgets={catBudgets} catIcons={catIcons} month={month} setMonth={setMonth} onConfirm={confirmPayment} onRevert={revertPayment} vacations={vacations} vacationTxns={vacationTxns} bills={bills} billPayments={billPayments} onToggleBill={toggleBill} goals={goals} accounts={accounts} holdings={holdings} stockPrices={stockPrices} fxRate={fxRate} settings={settings}/><div style={{marginTop:24}}><HealthScore txns={visibleTxns} accounts={accounts} holdings={holdings} catBudgets={catBudgets} goals={goals} bills={bills} billPayments={billPayments} month={month} fxRate={fxRate} stockPrices={stockPrices}/></div><div style={{marginTop:8}}><SpendingAnomalies txns={visibleTxns} cats={cats} month={month}/></div></>}
        {view==="expected"&&<ExpectedIncome expected={expected} onUpdate={saveExpected} onConfirm={confirmPayment}/>}
        {view==="folder"&&<LocalFolderSync cats={cats} receiptFPs={receiptFPs} onSaveFPs={saveReceiptFPs} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}} discreteMode={discreteMode}/>}
        {view==="upload"&&<UploadReceipts cats={cats} receiptFPs={receiptFPs} onSaveFPs={saveReceiptFPs} onSave={t=>{saveTxns([...txns,...t]);setHistoryMonth(t[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}} discreteMode={discreteMode}/>}
        {view==="manual"&&<RecurringForm title="Add Expense" type="expense" cats={cats} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="income"&&<RecurringForm title="Add Income" type="income" cats={cats} onSaveMultiple={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));setView("history");}}/>}
        {view==="history"&&<History txns={visibleTxns} cats={cats} onUpdate={saveTxns} fMonth={historyMonth} setFMonth={setHistoryMonth} onToast={showToast} subscriptions={subscriptions} merchantNorms={settings.merchantNorms||[]}/>}
        {view==="bills"&&<Bills bills={bills} billPayments={billPayments} onSaveBills={saveBills} onSaveBillPayments={saveBillPayments} onTogglePaid={toggleBill} cats={cats}/>}
        {view==="goals"&&<Goals goals={goals} onSaveGoals={saveGoals}/>}
        {view==="networth"&&<NetWorth accounts={accounts} accountHistory={accountHistory} onSaveAccounts={saveAccounts} onSaveAccountHistory={saveAccountHistory} holdings={holdings} stockPrices={stockPrices} fxRate={fxRate}/>}
        {view==="stocks"&&<Stocks holdings={holdings} onSaveHoldings={saveHoldings} onPricesUpdate={prices=>{setStockPrices(prices);const flat=Object.fromEntries(Object.entries(prices).map(([t,v])=>[t,v.price??v]));fetch("/api/holdings/prices",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({prices:flat})}).catch(()=>{});}} onFxRateUpdate={setFxRate}/>}
        </>);})()}
        {view==="vacations"&&<Vacations vacations={vacations} vacationTxns={vacationTxns} onSaveVacations={saveVacations} onSaveTxns={saveVacationTxns}/>}
        {view==="categories"&&<Categories cats={cats} onUpdate={saveCats} catBudgets={catBudgets} onUpdateBudgets={saveCatBudgets} catIcons={catIcons} onUpdateCatIcons={saveCatIcons} catRules={settings.catRules||[]} onUpdateCatRules={r=>saveSettings({...settings,catRules:r})} catRollover={settings.catRollover||{}} onUpdateCatRollover={r=>saveSettings({...settings,catRollover:r})} merchantNorms={settings.merchantNorms||[]} onUpdateMerchantNorms={r=>saveSettings({...settings,merchantNorms:r})} txns={txns} expectedMonthlyIncome={expected.filter(e=>e.confirmed&&e.expectedDate&&e.expectedDate.startsWith(today().slice(0,7))).reduce((s,e)=>s+e.amount,0)} settings={settings}/>}
        {view==="import"&&<CSVImport txns={txns} cats={cats} catRules={settings.catRules||[]} onImport={arr=>{saveTxns([...txns,...arr]);setHistoryMonth(arr[0]?.date?.slice(0,7)||today().slice(0,7));autoMatchBills(arr,[...txns,...arr]);}}/>}
        {view==="reports"&&<Reports txns={txns} bills={bills} billPayments={billPayments} cats={cats} catBudgets={catBudgets} goals={goals} vacations={vacations} vacationTxns={vacationTxns} settings={settings}/>}
        {view==="cashflow"&&<CashFlowForecast txns={txns} bills={bills} billPayments={billPayments} expected={expected} accounts={accounts} settings={settings} catBudgets={catBudgets} cats={cats}/>}
        {view==="debt"&&<DebtTracker debts={debts} onSaveDebts={saveDebts}/>}
        {view==="subscriptions"&&<SubscriptionManager subscriptions={subscriptions} onSave={saveSubscriptions} txns={txns}/>}
        {view==="tax"&&<TaxTracker txns={txns} taxItems={taxItems} onSaveTaxItems={saveTaxItems} settings={settings}/>}
        {view==="retirement"&&<RetirementPlanner txns={txns} accounts={accounts} settings={settings}/>}
        {view==="calendar"&&<FinancialCalendar bills={bills} billPayments={billPayments} expected={expected} goals={goals} vacations={vacations} txns={txns}/>}
        {view==="wishlist"&&<WishlistPage wishlist={wishlist} onSave={saveWishlist} txns={txns} goals={goals} onSaveGoals={saveGoals}/>}
        {view==="mortgage"&&<MortgageCalculator accounts={accounts} onSaveAccounts={saveAccounts}/>}
        {view==="household"&&<Household members={members} onSaveMembers={saveMembers} txns={txns} onSaveTxns={saveTxns} splits={splits} onSaveSplits={saveSplits} settlements={settlements} onSaveSettlements={saveSettlements}/>}
        {view==="settings"&&<Settings settings={settings} onSave={saveSettings} authConfig={authConfig} onSaveAuthConfig={saveAuthConfig} onStartTutorial={()=>{setView("dashboard");setShowTutorial(true);}}/>}
        {view==="datamodel"&&settings.devMode&&<DataModel schema={schema} onSave={saveSchema}/>}
        {view==="toolcoverage"&&settings.devMode&&<ToolCoveragePanel/>}
        {view==="insights"&&<Insights schema={schema} settings={settings} onNavigate={setView} widgets={insightWidgets} onSetWidgets={setInsightWidgets} messages={insightMessages} onSetMessages={setInsightMessages} discreteMode={discreteMode}/>}
        </Suspense>
        </div>
        </div>
      </div>
      <GlobalChat view={view} onNavigate={setView} settings={settings} schema={schema} inDepthMode={inDepthMode} onSetInDepthMode={setInDepthMode} selectedItems={selectedItems} onSetSelectedItems={setSelectedItems} open={globalChatOpen} onSetOpen={setGlobalChatOpen} discreteMode={discreteMode} alerts={appAlerts} onSaveSettings={saveSettings}/>
      {discreteAuth.open&&(
        <div style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(15,23,42,0.45)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
          <div style={{width:"100%",maxWidth:420,background:T.surface,borderRadius:18,boxShadow:T.shadowMd,border:"1px solid "+T.border,padding:"22px 22px 18px"}}>
            <div style={{fontSize:16,fontWeight:800,color:T.tx1,marginBottom:8}}>Confirm discrete mode change</div>
            <div style={{fontSize:13,color:T.tx3,lineHeight:1.6,marginBottom:14}}>Use Touch ID / fingerprint if available, or enter your current PIN.</div>
            <input type="password" inputMode="numeric" value={discreteAuth.pin} onChange={e=>setDiscreteAuth(p=>({...p,pin:e.target.value.replace(/\D/g,"").slice(0,6),error:""}))} placeholder="Current PIN" style={{...IS,marginBottom:8,textAlign:"center",letterSpacing:6,fontFamily:"monospace"}} onKeyDown={e=>{if(e.key==="Enter") submitDiscreteAuth(); if(e.key==="Escape") closeDiscreteAuth();}} autoFocus/>
            {discreteAuth.error&&<div style={{fontSize:12,color:T.red,background:T.redBg,border:"1px solid #fecaca",borderRadius:8,padding:"8px 10px",marginBottom:10}}>{discreteAuth.error}</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={submitDiscreteAuth} disabled={discreteAuth.busy} style={{flex:1,padding:"9px 12px",borderRadius:10,border:"none",background:T.accent,color:"#fff",fontSize:13,fontWeight:700,cursor:discreteAuth.busy?"not-allowed":"pointer",fontFamily:"inherit",opacity:discreteAuth.busy?0.7:1}}>{discreteAuth.busy?"Verifying...":"Continue"}</button>
              <button onClick={closeDiscreteAuth} style={{padding:"9px 14px",borderRadius:10,border:"1px solid "+T.border,background:"transparent",color:T.tx2,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </DepthCtx.Provider>
    </>
    </ErrorBoundary>
    </DiscreteModeCtx.Provider>
  );
}

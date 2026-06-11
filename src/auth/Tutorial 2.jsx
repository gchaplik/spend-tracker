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

const TUTORIAL_STEPS=[
  {
    id:"welcome",
    icon:"◈",
    title:"Welcome to CashHeap",
    body:"CashHeap is your private, local-first finance app. Everything lives on your device — no cloud, no subscriptions, no accounts required.\n\nThis quick tour covers the most important features. You can skip it at any time or replay it from Settings.",
    narration:"Hi, I'm Jarvis — your personal finance assistant. I live right here in CashHeap and I'm here to help you understand your money. Everything stays on your device, completely private. Let me walk you through what I can help you with.",
    tip:null,
    target:null,
    nav:"dashboard",
  },
  {
    id:"dashboard",
    narration:"This is your Dashboard — the nerve centre of your finances. At a glance you can see how much you've spent and earned this month, which budgets are running hot, upcoming bills, and your progress toward your savings goals.",
    icon:"⊞",
    title:"Dashboard",
    body:"The Dashboard gives you a live snapshot of your finances: total spending vs income this month, budget progress per category, upcoming bills, and your savings goals.\n\nThe health score at the bottom summarises how well you're tracking across all areas.",
    tip:"Change the month with the ← → arrows in the top-right of the Dashboard.",
    target:"main-content",
    nav:"dashboard",
  },
  {
    id:"transactions",
    narration:"Here's where you log what you spend and earn. Tap Add Expense or Add Income, fill in the date and amount, pick a category, and you're done. Your full transaction history lives in the History tab where you can search, filter, and bulk edit.",
    icon:"≡",
    title:"Adding Transactions",
    body:"Use Add Expense or Add Income in the sidebar to log a transaction manually. Every entry needs a date, amount, and category — everything else is optional.\n\nThe History tab shows all past transactions with search, filters, and bulk editing.",
    tip:"You can also import transactions in bulk using CSV Import.",
    target:"manual",
    nav:"manual",
  },
  {
    id:"bills",
    narration:"Bills are your recurring expenses — rent, subscriptions, utilities. Add them once and every month CashHeap will remind you what's due. Tick them off as you pay them and I'll make sure nothing slips through the cracks.",
    icon:"◷",
    title:"Bills & Recurring Expenses",
    body:"Add your regular bills under Bills. Each month CashHeap shows which are paid and which are still outstanding. Tick them off as you pay them.\n\nUnpaid bills show a badge on the sidebar icon so you never miss one.",
    tip:"Bills feed directly into the Cash Flow forecast so you can see future balance projections.",
    target:"bills",
    nav:"bills",
  },
  {
    id:"budgets",
    narration:"Categories let you slice your spending into buckets — groceries, dining, transport, whatever makes sense for you. Set a monthly cap on any category and I'll alert you on the Dashboard before you go over.",
    icon:"▦",
    title:"Categories & Budgets",
    body:"Under Categories you can create custom spending categories and set a monthly budget cap for each one. Colour-coded progress bars show how close you are to your limit.\n\nAlerts fire on the Dashboard when you're approaching or over budget.",
    tip:"Categories you create here are available when logging any transaction.",
    target:"categories",
    nav:"categories",
  },
  {
    id:"goals",
    narration:"What are you saving towards? A holiday, an emergency fund, a new laptop? Set a target amount and a deadline and I'll calculate exactly how much you need to set aside each month to get there.",
    icon:"◎",
    title:"Savings Goals",
    body:"Goals lets you set a target amount and deadline — a holiday, emergency fund, new laptop, whatever you're saving towards. CashHeap calculates the required monthly saving and tracks your progress over time.",
    tip:"Goals also appear in the Cash Flow forecast so you can see the impact on your projected balance.",
    target:"goals",
    nav:"goals",
  },
  {
    id:"networth",
    narration:"Net Worth is the big picture. Add your bank accounts, investments, and any debts, and CashHeap will calculate where you really stand. Watch the number grow over time — that's the whole point.",
    icon:"◈",
    title:"Net Worth",
    body:"Add your bank accounts, investments, and any debts under Net Worth. CashHeap calculates your overall position and charts it over time so you can watch it grow.\n\nStocks lets you track a share portfolio with live CAD/USD prices.",
    tip:"Account balances feed into the Cash Flow 90-day forecast.",
    target:"networth",
    nav:"networth",
  },
  {
    id:"jarvis",
    narration:"That button in the corner — that's me. Tap it any time and ask me anything about your finances. How much did you spend on dining last month? Which budget is closest to its limit? I'll pull the answer straight from your data. I'm powered by Kimi K2 through OpenRouter — a fast, intelligent model that works for everyone right out of the box.",
    icon:"✦",
    title:"Jarvis AI Assistant",
    body:'Tap the floating button in the bottom-right corner to open Jarvis — your personal finance AI. Ask anything in plain English:\n\n• "How much did I spend on dining last month?"\n• "Which category is closest to its budget?"\n• "Show me my biggest expenses this year"\n\nJarvis runs on Kimi K2 via OpenRouter by default — no local GPU required. You can also switch to a local Ollama model for fully private, offline inference.',
    tip:"Jarvis never invents numbers — every figure comes directly from your data.",
    target:"jarvis",
    nav:"dashboard",
  },
  {
    id:"jarvis-setup",
    narration:"Getting me set up takes about thirty seconds. Head to Settings, find the AI section, and you'll see the OpenRouter panel. Grab a free API key from openrouter.ai, paste it in, and you're talking to Kimi K2. If you'd rather keep everything offline, the Ollama option runs entirely on your machine — no internet needed.",
    icon:"⚙",
    title:"Connect Jarvis in 30 seconds",
    body:'To activate Jarvis:\n\n1. Go to Settings → AI\n2. Select OpenRouter (default)\n3. Paste your API key from openrouter.ai/keys\n4. The model is already set to moonshotai/kimi-k2\n\nFree-tier keys from OpenRouter are enough for daily use. If you prefer local, private inference, switch to the Ollama option and run any model on your own machine.',
    tip:"openrouter.ai offers a free tier — no credit card needed to get started.",
    target:"settings",
    nav:"settings",
  },
  {
    id:"receipts",
    narration:"Got a receipt? Just take a photo or drop the PDF here and I'll read the merchant, date, amount, and items for you. No more manual typing. You can also point me at a whole folder of receipts and I'll import them all at once.",
    icon:"↑",
    title:"Receipt Scanning",
    body:"Photograph a receipt or drag a PDF onto Upload Receipts. Jarvis reads the merchant, date, amount, and items automatically and creates a transaction draft for you to review.\n\nUse Folder Sync to bulk-import a whole folder of receipts at once.",
    tip:"Receipt scanning requires a Gemini API key (free at aistudio.google.com/apikey).",
    target:"upload",
    nav:"upload",
  },
  {
    id:"security",
    narration:"Settings is where you lock things down. You can set a PIN, enable Touch ID or Windows Hello, and configure how long before the app locks itself. You can also connect your AI model here and customise the look of the app.",
    icon:"⚙",
    title:"Security & Settings",
    body:"Head to Settings to:\n\n• Set a PIN to protect the app at launch\n• Enable Touch ID or Windows Hello for one-touch unlock\n• Set up two-factor authentication\n• Configure auto-lock after idle\n• Choose dark mode or a colour-blind filter\n• Connect your AI model",
    tip:"You can replay this tutorial any time from Settings → App → Start Tutorial.",
    target:"settings",
    nav:"settings",
  },
  {
    id:"done",
    narration:"And that's the tour. You're all set. Remember, I'm always here in the corner if you need me. Just tap that button and ask away. Welcome to CashHeap.",
    icon:"◉",
    title:"You're all set",
    body:"That's the core of CashHeap. Explore at your own pace — every section has inline help and sensible defaults to get you started.\n\nIf you ever want to revisit this tour, find it in Settings → App.",
    tip:null,
    target:null,
    nav:null,
  },
];

function TutorialModal({onClose,onNavigate}){
  const [step,setStep]=useState(0);
  const [minimized,setMinimized]=useState(false);
  const [spotRect,setSpotRect]=useState(null);
  const [voiceOn,setVoiceOn]=useState(true);
  const [speaking,setSpeaking]=useState(false);
  const total=TUTORIAL_STEPS.length;
  const s=TUTORIAL_STEPS[step];
  const isLast=step===total-1;
  const hasSpot=!!spotRect;

  // Speak narration via Web Speech API
  const speak=(text)=>{
    if(!window.speechSynthesis||!text) return;
    window.speechSynthesis.cancel();
    const utt=new SpeechSynthesisUtterance(text);
    utt.rate=0.95; utt.pitch=1.0; utt.volume=1;
    // Prefer a natural-sounding voice
    const voices=window.speechSynthesis.getVoices();
    const preferred=voices.find(v=>/samantha|karen|daniel|alex|google us|google uk/i.test(v.name))
      ||voices.find(v=>v.lang==="en-US"&&v.localService)
      ||voices.find(v=>v.lang.startsWith("en"));
    if(preferred) utt.voice=preferred;
    utt.onstart=()=>setSpeaking(true);
    utt.onend=()=>setSpeaking(false);
    utt.onerror=()=>setSpeaking(false);
    window.speechSynthesis.speak(utt);
  };

  const stopSpeech=()=>{ window.speechSynthesis&&window.speechSynthesis.cancel(); setSpeaking(false); };

  // Auto-navigate + speak whenever step changes
  useEffect(()=>{
    if(s.nav&&onNavigate) onNavigate(s.nav);
    if(voiceOn&&s.narration) speak(s.narration);
    else stopSpeech();
  },[step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle voice on/off
  const toggleVoice=()=>{
    setVoiceOn(v=>{
      if(v){ stopSpeech(); return false; }
      else { if(s.narration) speak(s.narration); return true; }
    });
  };

  // Stop speech on unmount
  useEffect(()=>()=>stopSpeech(),[]);

  // Measure the target element after navigation settles
  useEffect(()=>{
    if(!s.target){ setSpotRect(null); return; }
    let tries=0;
    const measure=()=>{
      const el=document.querySelector(`[data-tutorial="${s.target}"]`);
      if(el){
        const r=el.getBoundingClientRect();
        if(r.width>0) { setSpotRect({top:r.top,left:r.left,width:r.width,height:r.height}); return; }
      }
      if(++tries<15) setTimeout(measure,80);
    };
    setTimeout(measure,120);
    return()=>{ tries=99; };
  },[step,s.target]);

  const goToStep=(i)=>{stopSpeech();setStep(i);setSpotRect(null);};
  const next=()=>{ stopSpeech(); if(isLast){onClose();}else{setSpotRect(null);setStep(p=>p+1);} };
  const prev=()=>{ stopSpeech(); setSpotRect(null);setStep(p=>Math.max(0,p-1)); };

  // Card layout: centred when no spotlight, bottom-anchored when spotlighting
  const cardStyle=hasSpot
    ? {position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:10002,width:420,maxWidth:"calc(100vw - 48px)"}
    : {position:"relative",zIndex:10002,width:480,maxWidth:"calc(100vw - 40px)"};

  const PAD=8; // spotlight padding around target

  // Minimized pill
  if(minimized) return(
    <button onClick={()=>{setMinimized(false);if(voiceOn&&s.narration)speak(s.narration);}}
      style={{position:"fixed",top:16,right:16,zIndex:10000,background:T.tx1,color:"#fff",border:"none",borderRadius:99,padding:"8px 14px",display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",fontSize:12,fontWeight:500,boxShadow:"0 4px 16px rgba(0,0,0,0.18)",transition:"opacity .15s"}}
      onMouseEnter={e=>e.currentTarget.style.opacity="0.85"}
      onMouseLeave={e=>e.currentTarget.style.opacity="1"}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" style={{flexShrink:0}}>
        <circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"/>
        <circle cx="9" cy="9" r="7" fill="none" stroke="#fff" strokeWidth="2"
          strokeDasharray={`${2*Math.PI*7}`}
          strokeDashoffset={`${2*Math.PI*7*(1-(step+1)/total)}`}
          strokeLinecap="round" transform="rotate(-90 9 9)"/>
      </svg>
      Tutorial · Step {step+1}/{total}
    </button>
  );

  return(
    <div style={{position:"fixed",inset:0,zIndex:10000,fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      ...(hasSpot?{}:{background:"rgba(0,0,0,0.45)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center"})
    }}>

      {/* Spotlight overlay — four dark panels around the target */}
      {hasSpot&&<>
        {/* top */}
        <div style={{position:"fixed",top:0,left:0,right:0,height:spotRect.top-PAD,background:"rgba(0,0,0,0.55)",zIndex:10001,pointerEvents:"none"}}/>
        {/* bottom */}
        <div style={{position:"fixed",top:spotRect.top+spotRect.height+PAD,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:10001,pointerEvents:"none"}}/>
        {/* left */}
        <div style={{position:"fixed",top:spotRect.top-PAD,left:0,width:spotRect.left-PAD,height:spotRect.height+PAD*2,background:"rgba(0,0,0,0.55)",zIndex:10001,pointerEvents:"none"}}/>
        {/* right */}
        <div style={{position:"fixed",top:spotRect.top-PAD,left:spotRect.left+spotRect.width+PAD,right:0,height:spotRect.height+PAD*2,background:"rgba(0,0,0,0.55)",zIndex:10001,pointerEvents:"none"}}/>
        {/* highlight border ring */}
        <div style={{position:"fixed",top:spotRect.top-PAD,left:spotRect.left-PAD,width:spotRect.width+PAD*2,height:spotRect.height+PAD*2,borderRadius:T.rCard+4,border:"2px solid rgba(255,255,255,0.6)",zIndex:10001,pointerEvents:"none",boxShadow:"0 0 0 1px rgba(255,255,255,0.15)"}}/>
      </>}

      {/* Tutorial card */}
      <div style={cardStyle}>
        <div style={{background:T.surface,borderRadius:20,boxShadow:"0 32px 80px rgba(0,0,0,0.28)",overflow:"hidden",display:"flex",flexDirection:"column"}}>

          {/* Progress bar */}
          <div style={{height:3,background:T.border}}>
            <div style={{height:3,background:T.tx1,width:`${((step+1)/total)*100}%`,transition:"width 0.3s ease",borderRadius:2}}/>
          </div>

          {/* Header */}
          <div style={{padding:"22px 24px 0"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <div style={{display:"flex",gap:5}}>
                {TUTORIAL_STEPS.map((_,i)=>(
                  <button key={i} onClick={()=>goToStep(i)}
                    style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?T.tx1:i<step?T.tx2:T.border,border:"none",cursor:"pointer",padding:0,transition:"all 0.2s"}}
                  />
                ))}
              </div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                {/* Voice toggle */}
                <button onClick={toggleVoice} title={voiceOn?"Mute Jarvis":"Unmute Jarvis"}
                  style={{background:voiceOn?T.tx1:T.overlay,border:"1px solid "+T.border,borderRadius:99,cursor:"pointer",color:voiceOn?"#fff":T.tx3,fontSize:11,fontWeight:500,padding:"3px 9px",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5,transition:"background .15s"}}>
                  {/* Speaker icon */}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    {voiceOn
                      ?<><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12z" opacity=".7"/><path d="M14 3.23v2.06A7 7 0 0114 20.77v2.06A9 9 0 0014 3.23z" opacity=".4"/></>
                      :<><path d="M16.5 12A4.5 4.5 0 0014 7.97v2.14l2.45 2.45c.03-.18.05-.37.05-.56zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0017.22 19l2 2L20.73 20l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></>
                    }
                  </svg>
                  {voiceOn
                    ? speaking
                      ? <span style={{display:"flex",gap:2,alignItems:"flex-end",height:10}}>
                          {[0,1,2].map(i=><span key={i} style={{width:2,background:"#fff",borderRadius:1,animation:`tbar 0.7s ${i*0.15}s ease-in-out infinite alternate`,display:"inline-block",height:i===1?10:6}}/>)}
                          <style>{`@keyframes tbar{from{height:3px}to{height:10px}}`}</style>
                        </span>
                      : "Jarvis"
                    : "Jarvis"
                  }
                </button>
                <button onClick={()=>{stopSpeech();setMinimized(true);}} title="Minimise"
                  style={{background:"none",border:"none",cursor:"pointer",color:T.tx3,fontSize:16,lineHeight:1,padding:"0 6px",fontFamily:"inherit"}}>—</button>
                <button onClick={()=>{stopSpeech();onClose();}} title="End tutorial"
                  style={{background:"none",border:"none",cursor:"pointer",color:T.tx3,fontSize:18,lineHeight:1,padding:"0 0 0 4px",fontFamily:"inherit"}}>×</button>
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:10,background:T.overlay,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,color:T.tx1}}>
                {s.icon}
              </div>
              <div style={{fontSize:16,fontWeight:600,color:T.tx1,lineHeight:1.2}}>{s.title}</div>
            </div>
          </div>

          {/* Body */}
          <div style={{padding:"0 24px 16px"}}>
            <div style={{fontSize:13,color:T.tx2,lineHeight:1.65,whiteSpace:"pre-line"}}>{s.body}</div>
            {s.tip&&(
              <div style={{marginTop:12,padding:"9px 12px",background:T.overlay,borderRadius:T.r,borderLeft:"3px solid "+T.tx1,display:"flex",gap:8,alignItems:"flex-start"}}>
                <span style={{fontSize:10,fontWeight:700,color:T.tx1,flexShrink:0,marginTop:2,letterSpacing:"0.05em"}}>TIP</span>
                <span style={{fontSize:12,color:T.tx2,lineHeight:1.55}}>{s.tip}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{padding:"12px 24px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",borderTop:"1px solid "+T.border}}>
            <button onClick={prev} disabled={step===0}
              style={{background:"none",border:"none",cursor:step===0?"default":"pointer",color:T.tx1,fontSize:13,fontWeight:500,fontFamily:"inherit",opacity:step===0?0:1,transition:"opacity .15s",padding:0}}
            >← Back</button>
            <button onClick={next}
              style={{padding:"8px 20px",borderRadius:T.r,border:"none",background:T.tx1,color:"#fff",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",transition:"opacity .15s"}}
              onMouseEnter={e=>e.currentTarget.style.opacity="0.85"}
              onMouseLeave={e=>e.currentTarget.style.opacity="1"}
            >{isLast?"Done":"Next →"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}


export { TutorialModal, TUTORIAL_STEPS };

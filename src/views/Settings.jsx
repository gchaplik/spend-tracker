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
import { _b64e, _b64d, _b64ue, _b64ud, hashPin, genSalt, _b32d, calcTOTP, genTOTPSecret } from "../utils/crypto.js";
import { eventToCombo, displayCombo } from "../utils/shortcuts.js";

function DeepSeekSettings({f,set,onSave,CodeBlock,copied,setCopied}){
  const [status,setStatus]=useState(null); // null | "ok" | "notpulled" | "error" | "testing"

  const testConnection=async()=>{
    setStatus("testing");
    try{
      const r=await fetch("/api/llm/models");
      if(r.ok){
        const d=await r.json();
        const models=(d.models||[]).map(m=>(m.name||m).toLowerCase());
        const dsModel=(f.deepseekModel||"deepseek-r1:8b").toLowerCase();
        const hasModel=models.some(m=>m.startsWith(dsModel.split(":")[0]));
        setStatus(hasModel?"ok":"notpulled");
      } else { setStatus("error"); }
    }catch{ setStatus("error"); }
  };

  const modelName=f.deepseekModel||"deepseek-r1:8b";

  return(
    <div style={{padding:"4px 0 14px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontSize:12,color:T.tx2}}>
        Runs <strong>DeepSeek R1</strong> locally via <a href="https://ollama.ai" target="_blank" rel="noreferrer" style={{color:T.accent}}>Ollama</a> — no API key or internet required after setup.
      </div>

      {/* Model selector */}
      <div>
        <div style={{fontSize:11,fontWeight:600,color:T.tx3,marginBottom:4}}>Model</div>
        <div style={{display:"flex",background:T.overlay,borderRadius:T.r,padding:3,gap:2}}>
          {[{k:"deepseek-r1:8b",l:"R1 8B"},{k:"deepseek-r1:14b",l:"R1 14B"},{k:"deepseek-r1:32b",l:"R1 32B"}].map(opt=>{
            const active=(f.deepseekModel||"deepseek-r1:8b")===opt.k;
            return(
              <button key={opt.k} onClick={()=>{set("deepseekModel",opt.k);onSave({...f,deepseekModel:opt.k});}}
                style={{flex:1,padding:"5px 8px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:active?600:400,
                  background:active?T.surface:"transparent",color:active?T.tx1:T.tx3,
                  boxShadow:active?T.shadow:"none",transition:"all .15s",fontFamily:"inherit"}}>
                {opt.l}
              </button>
            );
          })}
        </div>
        <div style={{fontSize:11,color:T.tx3,marginTop:4}}>8B · 8 GB RAM &nbsp;|&nbsp; 14B · 16 GB &nbsp;|&nbsp; 32B · 32 GB</div>
      </div>

      {/* Install steps */}
      <div style={{background:T.overlay,borderRadius:T.rCard,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontSize:11,fontWeight:600,color:T.tx2}}>Setup (one-time)</div>
        <div>
          <div style={{fontSize:11,color:T.tx3,marginBottom:2}}>1. Install Ollama</div>
          <CodeBlock cmd="curl -fsSL https://ollama.ai/install.sh | sh"/>
          <div style={{fontSize:11,color:T.tx3,marginTop:5}}>Windows: <a href="https://ollama.ai/download" target="_blank" rel="noreferrer" style={{color:T.accent}}>ollama.ai/download</a></div>
        </div>
        <div>
          <div style={{fontSize:11,color:T.tx3,marginBottom:2}}>2. Pull the model</div>
          <CodeBlock cmd={`ollama pull ${modelName}`}/>
        </div>
      </div>

      {/* Test button */}
      <div style={{display:"flex",gap:8}}>
        <button onClick={testConnection} disabled={status==="testing"}
          style={{flex:1,padding:"8px",borderRadius:T.r,border:"1px solid #bae6fd",background:"#f0f9ff",color:"#0284C7",cursor:status==="testing"?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:status==="testing"?0.6:1}}>
          {status==="testing"?"Testing...":"Test Connection"}
        </button>
      </div>
      {status==="ok"&&<div style={{fontSize:12,color:"#059669",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:T.r,padding:"8px 12px"}}>✓ DeepSeek is ready</div>}
      {status==="notpulled"&&<div style={{fontSize:12,color:"#d97706",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:T.r,padding:"8px 12px"}}>Ollama is running but {modelName} is not pulled yet — run the pull command above</div>}
      {status==="error"&&<div style={{fontSize:12,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:T.r,padding:"8px 12px"}}>Could not reach Ollama — make sure it is running (<code style={{background:"rgba(0,0,0,0.06)",padding:"1px 4px",borderRadius:3}}>ollama serve</code>)</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function Settings({settings,onSave,authConfig,onSaveAuthConfig,onStartTutorial}){
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
  const [deepseekExpanded,setDeepseekExpanded]=useState(()=>settings.deepseekExpanded!==false);
  const [openrouterExpanded,setOpenRouterExpanded]=useState(()=>settings.openrouterExpanded!==false);

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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const [recordingFor,setRecordingFor]=useState(null); // view key being recorded, or null
  const [shortcuts,setShortcuts]=useState(()=>({...(settings.viewShortcuts||{})}));
  const shortcutInputRef=useRef(null);

  const startRecording=(k)=>{setRecordingFor(k);setTimeout(()=>shortcutInputRef.current?.focus(),10);};
  const clearShortcut=(k)=>{const next={...shortcuts};delete next[k];setShortcuts(next);onSave({...f,viewShortcuts:next});};
  const saveShortcuts=(next)=>{setShortcuts(next);onSave({...f,viewShortcuts:next});};

  useEffect(()=>{
    if(!recordingFor) return;
    const onKey=(e)=>{
      e.preventDefault();e.stopPropagation();
      if(e.key==="Escape"){setRecordingFor(null);return;}
      const combo=eventToCombo(e);
      if(!combo) return;
      const next={...shortcuts,[recordingFor]:combo};
      setShortcuts(next);
      onSave({...f,viewShortcuts:next});
      setRecordingFor(null);
    };
    window.addEventListener("keydown",onKey,{capture:true});
    return()=>window.removeEventListener("keydown",onKey,{capture:true});
  },[recordingFor,shortcuts,f,onSave]);

  // ── Keyword search ────────────────────────────────────────────────────────
  const [searchQ,setSearchQ]=useState('');
  const q=searchQ.toLowerCase().trim();
  const show=(...kws)=>!q||kws.some(k=>k.toLowerCase().includes(q));

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

  // shared sub-styles
  const S={background:T.surface,border:"1px solid "+T.border,borderRadius:T.rCard,padding:"0 18px",marginBottom:10};
  const SH={fontSize:10,fontWeight:600,color:T.tx3,textTransform:"uppercase",letterSpacing:"0.08em",padding:"12px 0 8px",borderBottom:"1px solid "+T.border,marginBottom:0};
  const SR={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid "+T.bg};
  const SRL={fontSize:13,fontWeight:500,color:T.tx1};
  const SRS={fontSize:11,color:T.tx3,marginTop:1};
  const Toggle=({on,onToggle})=>(
    <button onClick={onToggle} style={{width:38,height:21,borderRadius:11,border:"none",cursor:"pointer",background:on?T.tx1:T.border,position:"relative",transition:"background .2s",flexShrink:0}}>
      <span style={{position:"absolute",top:2,left:on?18:2,width:17,height:17,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,0.15)"}}/>
    </button>
  );
  const SmBtn=({onClick,label,red,disabled})=>(
    <button onClick={onClick} disabled={disabled} style={{padding:"5px 12px",background:red?T.redBg:T.overlay,color:red?T.red:T.tx1,border:`1px solid ${red?"#fecaca":T.border}`,borderRadius:T.r,fontSize:12,fontWeight:500,cursor:disabled?"default":"pointer",fontFamily:"inherit",flexShrink:0,opacity:disabled?0.5:1}}>{label}</button>
  );

  return(
    <div style={{width:"100%"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
        <h2 style={{margin:0,fontSize:18,fontWeight:600,color:T.tx1}}>Settings</h2>
        <div style={{flex:1,maxWidth:280,display:"flex",alignItems:"center",background:T.overlay,border:"1px solid "+T.border,borderRadius:99,padding:"5px 12px",gap:7}}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={T.tx3} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx={11} cy={11} r={8}/><path d="m21 21-4.35-4.35"/></svg>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search settings…" style={{border:"none",background:"transparent",outline:"none",fontSize:12,color:T.tx1,fontFamily:"inherit",flex:1}}/>
          {searchQ&&<button onClick={()=>setSearchQ('')} style={{border:"none",background:"none",cursor:"pointer",color:T.tx3,fontSize:14,padding:0,lineHeight:1}}>×</button>}
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Account ─────────────────────────────────────────────────────── */}
      {show('account','name','email','profile')&&<div style={S}>
        <div style={SH}>Account</div>
        <div style={{...SR,borderBottom:"none"}}>
          <div style={SRL}>Name</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input style={{...IS,width:200,padding:"6px 10px",margin:0}} value={f.name} onChange={e=>set("name",e.target.value)} placeholder="Your name"/>
            <SmBtn onClick={save} label="Save"/>
          </div>
        </div>
        {authConfig?.email&&(
          <div style={{...SR,borderBottom:"none"}}>
            <div><div style={SRL}>Email</div><div style={SRS}>{authConfig.email}</div></div>
          </div>
        )}
      </div>}

      {/* ── Security ────────────────────────────────────────────────────── */}
      {show('security','pin','password','lock','auth','biometric','touchid','fingerprint','2fa','totp')&&authConfig!==undefined&&<SecuritySettingsSection authConfig={authConfig} onSave={onSaveAuthConfig} compact/>}

      {/* ── Appearance ──────────────────────────────────────────────────── */}
      {show('appearance','dark','colour','color','blind','theme')&&<div style={S}>
        <div style={SH}>Appearance</div>
        <div style={SR}>
          <div><div style={SRL}>Dark Mode</div><div style={SRS}>Inverts colours across the app</div></div>
          <Toggle on={f.darkMode} onToggle={()=>{const v=!f.darkMode;set("darkMode",v);setTimeout(()=>onSave({...f,darkMode:v}),50);}}/>
        </div>
        <div style={{...SR,borderBottom:"none"}}>
          <div style={SRL}>Colour Blind Mode</div>
          <select value={f.colorBlindMode} onChange={e=>{set("colorBlindMode",e.target.value);setTimeout(()=>onSave({...f,colorBlindMode:e.target.value}),50);}} style={{padding:"6px 10px",borderRadius:T.r,border:"1px solid "+T.border,fontSize:12,fontFamily:"inherit",outline:"none",background:T.surface,color:T.tx1}}>
            <option value="none">None</option>
            <option value="deuteranopia">Deuteranopia</option>
            <option value="protanopia">Protanopia</option>
            <option value="tritanopia">Tritanopia</option>
            <option value="achromatopsia">Greyscale</option>
          </select>
        </div>
      </div>}

      {/* ── AI ──────────────────────────────────────────────────────────── */}
      {show('ai','jarvis','model','gemini','openrouter','deepseek','ollama','api key','claude','gpt')&&<div style={S}>
        <div style={SH}>AI</div>

        {/* Active model selector */}
        <div style={{...SR,borderBottom:"1px solid "+T.border}}>
          <div><div style={SRL}>Jarvis Model</div><div style={SRS}>Which AI powers the chat assistant</div></div>
          <div style={{display:"flex",background:T.overlay,borderRadius:T.r,padding:3,gap:2}}>
            {[
              {k:"gemini",      l:"Gemini"},
              {k:"deepseek",    l:"DeepSeek"},
              {k:"ollama",      l:"Ollama"},
              {k:"openrouter",  l:"OpenRouter"},
            ].map(opt=>{
              const active=(f.globalChatModel||"deepseek")===opt.k;
              return(
                <button key={opt.k} onClick={()=>{set("globalChatModel",opt.k);setTimeout(()=>onSave({...f,globalChatModel:opt.k}),50);}}
                  style={{padding:"5px 13px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:500,fontFamily:"inherit",
                    background:active?T.surface:"transparent",color:active?T.tx1:T.tx3,
                    boxShadow:active?T.shadow:"none",transition:"all 0.15s"}}>
                  {opt.l}
                </button>
              );
            })}
          </div>
        </div>

        {/* DeepSeek — shown when DeepSeek selected */}
        {(f.globalChatModel==="deepseek")&&(
          <div style={{borderBottom:"1px solid "+T.border}}>
            <div onClick={()=>setDeepseekExpanded(p=>{onSave({...f,deepseekExpanded:!p});return !p;})} style={{...SR,borderBottom:"none",cursor:"pointer"}}>
              <div><div style={SRL}>DeepSeek (local)</div><div style={SRS}>Runs privately via Ollama on your machine</div></div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:"#94a3b8",display:"inline-block",transform:deepseekExpanded?"rotate(0deg)":"rotate(-90deg)",transition:"transform .2s"}}>▾</span>
              </div>
            </div>
            {deepseekExpanded&&<DeepSeekSettings f={f} set={set} onSave={onSave} CodeBlock={CodeBlock} copied={copied} setCopied={setCopied}/>}
          </div>
        )}

        {/* Gemini */}
        <div style={{borderBottom:"1px solid #f1f5f9"}}>
          <div onClick={()=>setGeminiExpanded(p=>{onSave({...f,geminiExpanded:!p});return !p;})} style={{...SR,borderBottom:"none",cursor:"pointer"}}>
            <div><div style={SRL}>Gemini API Key</div><div style={SRS}>Receipt scanning and Jarvis AI</div></div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {geminiKeySet===null?<span style={{fontSize:11,color:"#94a3b8"}}>checking...</span>
               :geminiKeySet?<span style={{fontSize:11,color:"#059669",fontWeight:600}}>Active{geminiKeySource==="env"?" (env)":""}</span>
               :<span style={{fontSize:11,color:"#f59e0b",fontWeight:600}}>Not set</span>}
              <span style={{fontSize:12,color:"#94a3b8",display:"inline-block",transform:geminiExpanded?"rotate(0deg)":"rotate(-90deg)",transition:"transform .2s"}}>▾</span>
            </div>
          </div>
          {geminiExpanded&&(
            <div style={{padding:"4px 0 14px"}}>
              {!geminiKeySet?(
                <>
                  <input type="password" style={{...IS,letterSpacing:geminiKeyInput?"0.15em":"normal",fontFamily:geminiKeyInput?"monospace":"inherit",marginBottom:8}} value={geminiKeyInput} onChange={e=>setGeminiKeyInput(e.target.value)} placeholder="AIza..." autoComplete="off" spellCheck={false}/>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={saveGeminiKey} disabled={geminiSaving||!geminiKeyInput.trim()} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid #bbf7d0",background:"#f0fdf4",color:"#059669",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:geminiSaving||!geminiKeyInput.trim()?0.5:1}}>{geminiSaving?"Saving...":"Save Key"}</button>
                  </div>
                </>
              ):(
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{flex:1,fontSize:12,color:"#94a3b8",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"7px 12px",letterSpacing:"0.2em",fontFamily:"monospace"}}>{"•".repeat(24)}</div>
                  <SmBtn onClick={resetGeminiKey} label="Remove" red disabled={geminiSaving||geminiKeySource==="env"}/>
                </div>
              )}
              {geminiMsg&&<div style={{marginTop:8,fontSize:12,color:geminiMsg.type==="ok"?"#059669":"#dc2626",background:geminiMsg.type==="ok"?"#f0fdf4":"#fef2f2",border:`1px solid ${geminiMsg.type==="ok"?"#bbf7d0":"#fecaca"}`,borderRadius:8,padding:"7px 12px"}}>{geminiMsg.text}</div>}
              <div style={{marginTop:8,fontSize:11,color:"#94a3b8"}}>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{color:"#0284C7"}}>aistudio.google.com/apikey</a></div>
            </div>
          )}
        </div>

        {/* OpenRouter */}
        <div style={{borderBottom:"1px solid "+T.border}}>
          <div onClick={()=>setOpenRouterExpanded(p=>{onSave({...f,openrouterExpanded:!p});return !p;})} style={{...SR,borderBottom:"none",cursor:"pointer"}}>
            <div>
              <div style={SRL}>OpenRouter</div>
              <div style={SRS}>Cloud inference — Kimi, Claude, GPT-4, and 200+ models</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {f.openrouterKey&&<span style={{fontSize:11,color:"#059669",fontWeight:600}}>Key saved</span>}
              <span style={{fontSize:12,color:"#94a3b8",display:"inline-block",transform:openrouterExpanded?"rotate(0deg)":"rotate(-90deg)",transition:"transform .2s"}}>▾</span>
            </div>
          </div>
          {openrouterExpanded&&(
            <div style={{padding:"4px 0 14px",display:"flex",flexDirection:"column",gap:10}}>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:T.tx2,marginBottom:4}}>API Key</div>
                <input
                  type="password"
                  style={IS}
                  value={f.openrouterKey||""}
                  onChange={e=>set("openrouterKey",e.target.value)}
                  placeholder="sk-or-v1-…"
                />
                <div style={{fontSize:11,color:T.tx3,marginTop:4}}>
                  Get a free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" style={{color:T.accent}}>openrouter.ai/keys</a>
                </div>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:T.tx2,marginBottom:4}}>Model</div>
                <input
                  style={IS}
                  value={f.openrouterModel||"moonshotai/kimi-k2"}
                  onChange={e=>set("openrouterModel",e.target.value)}
                  placeholder="moonshotai/kimi-k2"
                />
                <div style={{fontSize:11,color:T.tx3,marginTop:4}}>
                  Suggestions: <code style={{background:T.overlay,padding:"1px 4px",borderRadius:3}}>moonshotai/kimi-k2</code> · <code style={{background:T.overlay,padding:"1px 4px",borderRadius:3}}>anthropic/claude-3.5-haiku</code> · <code style={{background:T.overlay,padding:"1px 4px",borderRadius:3}}>openai/gpt-4o-mini</code>
                </div>
              </div>
              <SmBtn onClick={()=>onSave({...f})} label="Save"/>
              {f.globalChatModel!=="openrouter"&&(
                <button onClick={()=>{set("globalChatModel","openrouter");setTimeout(()=>onSave({...f,globalChatModel:"openrouter"}),50);}}
                  style={{padding:"8px",borderRadius:T.r,border:"1px solid "+T.border,background:T.accentBg,color:T.accent,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
                  Set as active model
                </button>
              )}
            </div>
          )}
        </div>

        {/* Ollama */}
        <div>
          <div onClick={()=>setOllamaExpanded(p=>{onSave({...f,ollamaExpanded:!p});return !p;})} style={{...SR,borderBottom:"none",cursor:"pointer"}}>
            <div><div style={SRL}>Local AI (Ollama)</div><div style={SRS}>Runs entirely on your machine</div></div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {ollamaStatus==="ok"&&<span style={{fontSize:11,color:"#059669",fontWeight:600}}>Connected</span>}
              {ollamaStatus==="error"&&<span style={{fontSize:11,color:"#dc2626",fontWeight:600}}>Unreachable</span>}
              <span style={{fontSize:12,color:"#94a3b8",display:"inline-block",transform:ollamaExpanded?"rotate(0deg)":"rotate(-90deg)",transition:"transform .2s"}}>▾</span>
            </div>
          </div>
          {ollamaExpanded&&(
            <div style={{padding:"4px 0 14px",display:"flex",flexDirection:"column",gap:10}}>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4}}>Server URL</div>
                <input style={IS} value={f.ollamaUrl} onChange={e=>set("ollamaUrl",e.target.value)} placeholder="http://localhost:11434"/>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4}}>Model</div>
                <input style={IS} value={f.ollamaModel} onChange={e=>set("ollamaModel",e.target.value)} placeholder="phi3:mini"/>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>Recommended: <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>phi3:mini</code> · <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>llama3.2:3b</code> · <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>mistral:7b</code></div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={testOllama} disabled={testing} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid #bae6fd",background:"#f0f9ff",color:"#0284C7",cursor:testing?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:testing?0.6:1}}>{testing?"Testing...":"Test Connection"}</button>
                <SmBtn onClick={save} label="Save"/>
              </div>
              {ollamaStatus==="ok"&&<div style={{fontSize:12,color:"#059669",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"8px 12px"}}>✓ Ollama is running and reachable</div>}
              {ollamaStatus==="error"&&(
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{fontSize:12,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px"}}>Could not reach Ollama — install it first</div>
                  <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4}}>macOS / Linux</div>
                      <CodeBlock cmd="curl -fsSL https://ollama.ai/install.sh | sh"/>
                    </div>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4}}>Windows — <a href="https://ollama.ai/download" target="_blank" rel="noreferrer" style={{color:"#0284C7"}}>ollama.ai/download</a></div>
                    </div>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4}}>Pull a model</div>
                      <CodeBlock cmd="ollama pull phi3:mini"/>
                    </div>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4}}>Start server</div>
                      <CodeBlock cmd="ollama serve"/>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>}

      {/* ── App ─────────────────────────────────────────────────────────── */}
      {show('app','tutorial','developer','dev','update','version','build')&&<div style={{...S,marginBottom:0}}>
        <div style={SH}>App</div>
        <div style={SR}>
          <div><div style={SRL}>Tutorial</div><div style={SRS}>Walk through CashHeap's key features</div></div>
          <SmBtn onClick={onStartTutorial} label="Start Tutorial"/>
        </div>
        <div style={SR}>
          <div><div style={SRL}>Developer Mode</div><div style={SRS}>Unlocks the Data Model editor</div></div>
          <Toggle on={f.devMode} onToggle={()=>{set("devMode",!f.devMode);setTimeout(()=>onSave({...f,devMode:!f.devMode}),50);}}/>
        </div>
        {isElectron&&<>
          <div style={SR}>
            <div><div style={SRL}>Update from Source</div><div style={SRS}>Rebuild and reinstall from local code</div></div>
            <button onClick={triggerLocalUpdate} disabled={localStatus==='building'} style={{padding:"5px 13px",background:localStatus==='building'?"#f1f5f9":localStatus==='error'?"#fef2f2":"#f1f5f9",color:localStatus==='error'?"#dc2626":"#374151",border:`1px solid ${localStatus==='error'?"#fecaca":"#e2e8f0"}`,borderRadius:7,fontSize:12,fontWeight:600,cursor:localStatus==='building'?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
              {localStatus==='building'?<><span style={{width:10,height:10,border:"2px solid rgba(0,0,0,0.15)",borderTopColor:"#374151",borderRadius:"50%",display:"inline-block",animation:"spin 0.8s linear infinite"}}/>Building...</>:localStatus==='error'?'Retry':'Build & Install'}
            </button>
          </div>
          {localLog.length>0&&(
            <div style={{background:"#0f172a",borderRadius:8,padding:"8px 12px",maxHeight:100,overflowY:"auto",fontFamily:"monospace",fontSize:10,lineHeight:1.6,marginBottom:8}}>
              {localLog.map((l,i)=><div key={i} style={{color:l.startsWith('Error')?'#f87171':l.includes('✓')||l.includes('built')?"#4ade80":"#94a3b8"}}>{l}</div>)}
            </div>
          )}
          <div style={{...SR,borderBottom:"none"}}>
            <div><div style={SRL}>Check for Updates</div><div style={SRS}>Download from GitHub Releases</div></div>
            <button onClick={ghStatus==='ready'?()=>window.electronUpdater.restartAndInstall():checkGithub} disabled={ghStatus==='checking'||ghStatus==='downloading'} style={{padding:"5px 13px",background:ghStatus==='ready'?"#f0fdf4":ghStatus==='error'?"#fef2f2":"#f1f5f9",color:ghStatus==='ready'?"#059669":ghStatus==='error'?"#dc2626":"#374151",border:`1px solid ${ghStatus==='ready'?"#bbf7d0":ghStatus==='error'?"#fecaca":"#e2e8f0"}`,borderRadius:7,fontSize:12,fontWeight:600,cursor:(ghStatus==='checking'||ghStatus==='downloading')?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
              {ghStatus==='checking'||ghStatus==='downloading'?<><span style={{width:10,height:10,border:"2px solid rgba(0,0,0,0.15)",borderTopColor:"#374151",borderRadius:"50%",display:"inline-block",animation:"spin 0.8s linear infinite"}}/>{ghStatus==='downloading'?`Downloading v${ghVersion}...`:"Checking..."}</>:ghStatus==='ready'?`Restart to install v${ghVersion}`:ghStatus==='up-to-date'?"Up to date":ghStatus==='error'?'Retry':'Check for Updates'}
            </button>
          </div>
          {ghStatus==='error'&&<div style={{fontSize:11,color:"#dc2626",marginBottom:10,paddingLeft:2}}>{ghError||"Update check failed."}</div>}
        </>}
      </div>}

      {/* Shortcuts section */}
      {show('shortcuts','keyboard','hotkey','key','navigate','command')&&(
        <div style={{...S,marginBottom:0}}>
          <div style={SH}>Keyboard Shortcuts</div>
          <div style={{fontSize:12,color:T.tx3,padding:"10px 0 4px"}}>
            Click a field and press a key combo (must include ⌘/Ctrl/Alt) to assign. Press <kbd style={{background:T.overlay,border:"1px solid "+T.border,borderRadius:3,padding:"1px 5px",fontSize:11}}>Esc</kbd> to cancel. Click ✕ to clear.
          </div>
          {/* Shortcut recording trap — hidden focusable element */}
          <input ref={shortcutInputRef} readOnly style={{position:"absolute",opacity:0,pointerEvents:"none",width:1,height:1}} onBlur={()=>setRecordingFor(null)}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
            {NAV_ITEMS.filter(n=>!n.devOnly).map(item=>{
              const sc=shortcuts[item.k];
              const isRecording=recordingFor===item.k;
              return(
                <div key={item.k} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid "+T.bg}}>
                  <span style={{fontSize:13,color:T.tx3,width:18,textAlign:"center",flexShrink:0}}>{item.icon}</span>
                  <span style={{flex:1,fontSize:12,color:T.tx2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.l}</span>
                  <button
                    onClick={()=>isRecording?setRecordingFor(null):startRecording(item.k)}
                    style={{
                      padding:"3px 9px",borderRadius:6,border:"1px solid "+(isRecording?T.accent:T.border),
                      background:isRecording?T.accentBg:"transparent",
                      color:isRecording?T.accent:(sc?T.tx1:T.tx3),
                      fontSize:11,fontWeight:sc||isRecording?600:400,cursor:"pointer",fontFamily:"inherit",
                      minWidth:60,textAlign:"center",transition:"all .15s",
                    }}
                  >
                    {isRecording?"Press keys…":(sc?displayCombo(sc):"+ Add")}
                  </button>
                  {sc&&!isRecording&&(
                    <button onClick={()=>clearShortcut(item.k)} style={{background:"transparent",border:"none",color:T.tx3,cursor:"pointer",fontSize:14,padding:"0 2px",lineHeight:1}}>✕</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {q&&![show('account','name','email','profile'),show('security','pin','password','lock','auth','biometric'),show('appearance','dark','colour','color','blind'),show('ai','jarvis','model','gemini','openrouter','deepseek','ollama'),show('app','tutorial','developer','dev','update'),show('shortcuts','keyboard','hotkey','key','navigate','command')].some(Boolean)&&(
        <div style={{padding:"40px 0",textAlign:"center",color:T.tx3,fontSize:13}}>No settings match "{searchQ}"</div>
      )}
    </div>
  );
}

// ── Security Settings Section (manage existing account) ───────────────────────
function SecuritySettingsSection({authConfig,onSave,compact}){
  const AC=(authConfig&&typeof authConfig==="object"&&authConfig.pinHash)?authConfig:null;
  const [phase,setPhase]=useState("idle"); // idle | changePIN | totpSetup | changeEmail
  const [pinA,setPinA]=useState("");
  const [pinB,setPinB]=useState("");
  const [pinErr,setPinErr]=useState("");
  const [pinBusy,setPinBusy]=useState(false);
  const [bioStatus,setBioStatus]=useState(AC?.webauthnCredId?"enrolled":"idle"); // idle|enrolling|enrolled|error
  const [bioErr,setBioErr]=useState("");
  const [totpSecret]=useState(()=>genTOTPSecret());
  const [totpInput,setTotpInput]=useState("");
  const [totpErr,setTotpErr]=useState("");
  const [autoLock,setAutoLock]=useState(AC?.autoLockMinutes||0);
  const [emailInput,setEmailInput]=useState(AC?.email||"");

  const cfg=patch=>{const n={...AC,...patch};onSave(n);return n;};

  const savePIN=async()=>{
    if(pinA.length<4){setPinErr("At least 4 digits");return;}
    if(pinA!==pinB){setPinErr("PINs don't match");return;}
    setPinBusy(true);setPinErr("");
    const salt=genSalt();
    cfg({pinHash:await hashPin(pinA,salt),pinSalt:salt});
    setPinA("");setPinB("");setPhase("idle");setPinBusy(false);
  };

  const enrollBio=async()=>{
    setBioStatus("enrolling");setBioErr("");
    try{
      // macOS: use native Touch ID via Electron IPC (most reliable)
      if(window.electronBiometrics){
        const ok=await window.electronBiometrics.available();
        if(ok){
          await window.electronBiometrics.prompt("verify your identity to enable Touch ID for CashHeap");
          cfg({webauthnCredId:"native-touchid",webauthnEnabled:true,bioMethod:"touchid"});
          setBioStatus("enrolled");return;
        }
      }
      // Fallback: WebAuthn (Windows Hello, FIDO2 keys, etc.)
      const cred=await navigator.credentials.create({publicKey:{
        challenge:crypto.getRandomValues(new Uint8Array(32)),
        rp:{name:"CashHeap",id:window.location.hostname||"localhost"},
        user:{id:new TextEncoder().encode("cashheap-user"),name:"cashheap",displayName:"CashHeap"},
        pubKeyCredParams:[{alg:-7,type:"public-key"},{alg:-257,type:"public-key"}],
        authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required",residentKey:"preferred"},
        timeout:60000,
      }});
      cfg({webauthnCredId:_b64ue(cred.rawId),webauthnEnabled:true,bioMethod:"webauthn"});
      setBioStatus("enrolled");
    }catch(e){
      setBioErr(e.name==="NotAllowedError"?"Cancelled — try again.":`${e.message}`);
      setBioStatus(AC?.webauthnCredId?"enrolled":"idle");
    }
  };

  const verifyAndSaveTOTP=async()=>{
    const now=await calcTOTP(totpSecret);
    const prev=await calcTOTP(totpSecret,Date.now()-30000);
    if(totpInput===now||totpInput===prev){cfg({totpSecret,totpEnabled:true});setPhase("idle");}
    else{setTotpErr("Incorrect code — try again");}
  };

  const IS2={width:"100%",padding:"9px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"};
  const Row=({icon,label,sub,subColor,action})=>(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",background:"#f8fafc",borderRadius:9,marginBottom:8}}>
      <div>
        <div style={{fontSize:12,fontWeight:600,color:"#1e293b"}}>{icon?`${icon} `:""}{label}</div>
        {sub&&<div style={{fontSize:11,marginTop:1,color:subColor||"#64748b"}}>{sub}</div>}
      </div>
      {action}
    </div>
  );
  const Btn=({onClick,label,color="#0284C7",textColor="#fff",disabled})=>(
    <button onClick={onClick} disabled={disabled} style={{padding:"6px 14px",background:disabled?"#94a3b8":color,color:textColor,border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:disabled?"default":"pointer",fontFamily:"inherit",flexShrink:0}}>{label}</button>
  );

  const SH2={fontSize:11,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",padding:"16px 0 10px",borderBottom:"1px solid #f1f5f9",marginBottom:0};
  const SR2={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 0",borderBottom:"1px solid #f8fafc"};
  const SRL2={fontSize:13,fontWeight:500,color:"#1e293b"};
  const SRS2={fontSize:11,color:"#94a3b8",marginTop:1};
  const SmBtn2=({onClick,label,red,disabled})=>(
    <button onClick={onClick} disabled={disabled} style={{padding:"5px 13px",background:red?"#fef2f2":"#f1f5f9",color:red?"#dc2626":"#374151",border:`1px solid ${red?"#fecaca":"#e2e8f0"}`,borderRadius:7,fontSize:12,fontWeight:600,cursor:disabled?"default":"pointer",fontFamily:"inherit",flexShrink:0,opacity:disabled?0.5:1}}>{label}</button>
  );

  if(!AC) return(
    <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:"0 20px",marginBottom:16}}>
      <div style={SH2}>Security</div>
      <div style={{...SR2,borderBottom:"none"}}><div style={SRL2}>No account configured — you'll be prompted on next launch.</div></div>
    </div>
  );

  return(
    <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:T.rCard,padding:"0 18px",marginBottom:0}}>
      <div style={SH2}>Security</div>

      {/* Email */}
      {phase!=="changePIN"&&phase!=="totpSetup"&&(
        <div style={SR2}>
          <div>
            <div style={SRL2}>Email</div>
            <div style={SRS2}>{AC.email||"No email set"}</div>
          </div>
          {phase==="changeEmail"?(
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input type="email" placeholder="you@example.com" value={emailInput} onChange={e=>setEmailInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&emailInput.includes("@")&&(cfg({email:emailInput.trim()}),setPhase("idle"))} style={{padding:"6px 10px",borderRadius:7,border:"1px solid #e2e8f0",fontSize:12,fontFamily:"inherit",outline:"none",width:180}}/>
              <SmBtn2 onClick={()=>{if(emailInput.includes("@")){cfg({email:emailInput.trim()});setPhase("idle");}}} label="Save"/>
              <SmBtn2 onClick={()=>setPhase("idle")} label="Cancel"/>
            </div>
          ):(
            <SmBtn2 onClick={()=>{setEmailInput(AC.email||"");setPhase("changeEmail");}} label={AC.email?"Change":"Add"}/>
          )}
        </div>
      )}

      {/* PIN */}
      {phase==="changePIN"?(
        <div style={{padding:"12px 0",borderBottom:"1px solid #f8fafc"}}>
          <div style={{fontSize:12,fontWeight:600,color:"#1e293b",marginBottom:8}}>Change PIN</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:320}}>
            <input type="password" inputMode="numeric" placeholder="New PIN (4-6 digits)" maxLength={6} value={pinA} onChange={e=>setPinA(e.target.value.replace(/\D/g,""))} style={IS2}/>
            <input type="password" inputMode="numeric" placeholder="Confirm new PIN" maxLength={6} value={pinB} onChange={e=>setPinB(e.target.value.replace(/\D/g,""))} style={IS2} onKeyDown={e=>e.key==="Enter"&&savePIN()}/>
            {pinErr&&<div style={{color:"#dc2626",fontSize:11}}>{pinErr}</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={savePIN} disabled={pinBusy} style={{flex:1,padding:"7px 0",background:"#0284C7",color:"#fff",border:"none",borderRadius:7,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{pinBusy?"Saving...":"Update PIN"}</button>
              <button onClick={()=>{setPhase("idle");setPinA("");setPinB("");setPinErr("");}} style={{flex:1,padding:"7px 0",background:"#f1f5f9",color:"#374151",border:"none",borderRadius:7,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            </div>
          </div>
        </div>
      ):(
        <div style={SR2}>
          <div><div style={SRL2}>PIN</div><div style={SRS2}>PBKDF2 secured unlock PIN</div></div>
          <SmBtn2 onClick={()=>setPhase("changePIN")} label="Change"/>
        </div>
      )}

      {/* Biometrics */}
      {phase!=="changePIN"&&(
        <>
          <div style={SR2}>
            <div>
              <div style={SRL2}>Biometrics</div>
              <div style={{...SRS2,color:bioStatus==="enrolled"?"#16a34a":undefined}}>{bioStatus==="enrolled"?"Touch ID / Windows Hello active":"Not enrolled"}</div>
            </div>
            {bioStatus==="enrolled"
              ?<SmBtn2 onClick={()=>{cfg({webauthnCredId:null,webauthnEnabled:false});setBioStatus("idle");}} label="Remove" red/>
              :<SmBtn2 onClick={enrollBio} label={bioStatus==="enrolling"?"...":"Enroll"} disabled={bioStatus==="enrolling"}/>
            }
          </div>
          {bioErr&&<div style={{fontSize:11,color:"#dc2626",paddingBottom:8,marginTop:-6}}>{bioErr}</div>}
        </>
      )}

      {/* TOTP */}
      {phase==="totpSetup"?(
        <div style={{padding:"12px 0",borderBottom:"1px solid #f8fafc"}}>
          <div style={{fontSize:12,fontWeight:600,color:"#1e293b",marginBottom:8}}>Set Up 2-Factor Authentication</div>
          <div style={{textAlign:"center",marginBottom:10}}>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(`otpauth://totp/CashHeap?secret=${totpSecret}&issuer=CashHeap`)}`} alt="QR" style={{borderRadius:8,border:"2px solid #e2e8f0"}}/>
            <div style={{marginTop:6,background:"#0f172a",borderRadius:6,padding:"6px 10px",fontFamily:"monospace",fontSize:11,color:"#a5f3fc",wordBreak:"break-all"}}>{totpSecret}</div>
          </div>
          <input placeholder="Enter 6-digit code to verify" maxLength={6} value={totpInput} onChange={e=>setTotpInput(e.target.value.replace(/\D/g,"").slice(0,6))} style={{...IS2,textAlign:"center",fontSize:18,letterSpacing:6,fontFamily:"monospace",marginBottom:8}} onKeyDown={e=>e.key==="Enter"&&totpInput.length===6&&verifyAndSaveTOTP()}/>
          {totpErr&&<div style={{color:"#dc2626",fontSize:11,marginBottom:6}}>{totpErr}</div>}
          <div style={{display:"flex",gap:8,maxWidth:320}}>
            <button onClick={verifyAndSaveTOTP} disabled={totpInput.length!==6} style={{flex:1,padding:"7px 0",background:totpInput.length===6?"#0284C7":"#94a3b8",color:"#fff",border:"none",borderRadius:7,fontWeight:600,fontSize:12,cursor:totpInput.length===6?"pointer":"default",fontFamily:"inherit"}}>Verify &amp; Enable</button>
            <button onClick={()=>{setPhase("idle");setTotpInput("");setTotpErr("");}} style={{flex:1,padding:"7px 0",background:"#f1f5f9",color:"#374151",border:"none",borderRadius:7,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          </div>
        </div>
      ):(
        phase!=="changePIN"&&(
          <div style={SR2}>
            <div>
              <div style={SRL2}>Two-Factor Auth</div>
              <div style={{...SRS2,color:AC.totpEnabled?"#16a34a":undefined}}>{AC.totpEnabled?"Authenticator app active":"Not enabled"}</div>
            </div>
            {AC.totpEnabled
              ?<SmBtn2 onClick={()=>cfg({totpSecret:null,totpEnabled:false})} label="Disable" red/>
              :<SmBtn2 onClick={()=>{setTotpInput("");setTotpErr("");setPhase("totpSetup");}} label="Set Up"/>
            }
          </div>
        )
      )}

      {/* Auto-lock */}
      {phase==="idle"&&(
        <div style={{...SR2,borderBottom:"none"}}>
          <div><div style={SRL2}>Auto-lock</div><div style={SRS2}>Lock after idle period</div></div>
          <select value={autoLock} onChange={e=>{const v=Number(e.target.value);setAutoLock(v);cfg({autoLockMinutes:v});}} style={{padding:"6px 10px",borderRadius:7,border:"1px solid #e2e8f0",fontSize:12,fontFamily:"inherit",outline:"none",background:"#fff",color:"#1e293b"}}>
            <option value={0}>On launch only</option>
            <option value={1}>After 1 minute</option>
            <option value={5}>After 5 minutes</option>
            <option value={15}>After 15 minutes</option>
            <option value={30}>After 30 minutes</option>
          </select>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL COVERAGE PANEL  (dev mode only)
// Registry: every data point in the app + which Jarvis tool covers it
// ─────────────────────────────────────────────────────────────────────────────

// DATA_POINTS registry — update this whenever a new data entity or field is added.
// Each entry: { entity, field, description, tools: [toolName,...] }
// tools:[] means no tool coverage yet → shows as a gap

export { DeepSeekSettings, Settings, SecuritySettingsSection };

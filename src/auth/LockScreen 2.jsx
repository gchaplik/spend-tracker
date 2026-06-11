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
import { MountainLogo } from "./MountainLogo.jsx";

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

  useEffect(()=>{
    if(phase!=="pin") return;
    const onKey=e=>{
      if(e.key>="0"&&e.key<="9") pressKey(e.key);
      else if(e.key==="Backspace"||e.key==="Delete") pressKey("del");
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[phase,pin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger biometrics at most once per lock-screen mount, and then once more
  // each time the user brings the window back into focus. Guard against the
  // Electron pattern where both "focus" and "visibilitychange" fire within
  // a few hundred ms of each other on the same app-activation event.
  const bioDebounceRef = useRef(null);
  const bioFiredRef = useRef(false);
  useEffect(()=>{
    if(!authConfig.webauthnCredId) return;
    bioFiredRef.current=false;
    const fire=()=>{
      if(bioFiredRef.current) return;
      bioFiredRef.current=true;
      tryBiometric();
    };
    const trigger=()=>{
      if(document.visibilityState!=="visible") return;
      if(bioDebounceRef.current) clearTimeout(bioDebounceRef.current);
      bioDebounceRef.current=setTimeout(()=>{
        bioDebounceRef.current=null;
        fire();
      },400); // wide enough to swallow Electron's focus+visibilitychange burst
    };
    const onVisibility=()=>{
      if(document.visibilityState==="hidden") bioFiredRef.current=false; // reset so next focus triggers again
      else trigger();
    };
    // Auto-trigger once on mount after a short delay (app just opened / lock just shown)
    const mountTimer=setTimeout(()=>{
      if(document.visibilityState==="visible") fire();
    },300);
    document.addEventListener("visibilitychange",onVisibility);
    window.addEventListener("focus",trigger);
    return()=>{
      clearTimeout(mountTimer);
      document.removeEventListener("visibilitychange",onVisibility);
      window.removeEventListener("focus",trigger);
      if(bioDebounceRef.current) clearTimeout(bioDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[authConfig.webauthnCredId]);

  const pressKey=async(k)=>{
    if(phase==="totp") return;
    setErr("");
    if(k==="del"){setPin(p=>p.slice(0,-1));return;}
    const next=pin+k;
    setPin(next);
    if(next.length===MAX) await verifyPin(next);
  };

  const tryBiometric=async()=>{
    if(!authConfig.webauthnCredId||bioBusy){return;}
    setBioBusy(true);setErr("");
    try{
      // macOS: native Touch ID via Electron IPC
      if(authConfig.bioMethod==="touchid"&&window.electronBiometrics){
        await window.electronBiometrics.prompt("unlock CashHeap");
      } else {
        // WebAuthn fallback (Windows Hello, FIDO2, etc.)
        const credId=_b64ud(authConfig.webauthnCredId);
        const challenge=crypto.getRandomValues(new Uint8Array(32));
        await navigator.credentials.get({publicKey:{
          challenge,
          allowCredentials:[{type:"public-key",id:credId}],
          userVerification:"required",
          timeout:60000,
          rpId:window.location.hostname||"localhost",
        }});
      }
      if(authConfig.totpEnabled&&authConfig.totpSecret){setPhase("totp");}
      else onUnlock();
    }catch(e){
      if(e.name!=="NotAllowedError") setErr("Biometric failed — use your PIN.");
    }
    setBioBusy(false);
  };

  const keys=["1","2","3","4","5","6","7","8","9","","0","del"];

  // numpad is 3×72 + 2×8 = 232px; everything is pinned to that width
  const NW=232; // numpad + bio button width

  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,background:T.bg,fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {/* Single centred column — margin auto + absolute centering is the most reliable cross-browser approach */}
      <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:NW,display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{marginBottom:14}}><MountainLogo size={48}/></div>
        <div style={{color:T.tx1,fontSize:18,fontWeight:600,marginBottom:3,textAlign:"center"}}>CashHeap</div>
        <div style={{color:T.tx3,fontSize:13,marginBottom:32,textAlign:"center"}}>
          {phase==="totp"?"Enter your authenticator code":"Enter your PIN to continue"}
        </div>

        {phase==="pin"&&(
          <>
            <div style={{display:"flex",gap:14,marginBottom:32,animation:shaking?"shake 0.4s ease":"none",justifyContent:"center",width:NW}}>
              {Array.from({length:MAX}).map((_,i)=>(
                <div key={i} style={{width:14,height:14,borderRadius:"50%",background:i<pin.length?T.tx1:T.border,transition:"background .15s",flexShrink:0}}/>
              ))}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(3,72px)",gap:8,marginBottom:16,width:NW}}>
              {keys.map((k,i)=>(
                <button key={i} onClick={()=>k&&pressKey(k)}
                  style={{height:72,borderRadius:"50%",border:"none",cursor:k?"pointer":"default",
                    background:k?T.overlay:"transparent",
                    color:T.tx1,fontSize:k==="del"?16:22,fontWeight:500,fontFamily:"inherit",
                    transition:"background .1s",opacity:k?1:0
                  }}
                  onMouseDown={e=>{if(k)e.currentTarget.style.background=T.border;}}
                  onMouseUp={e=>{if(k)e.currentTarget.style.background=T.overlay;}}
                  onMouseLeave={e=>{if(k)e.currentTarget.style.background=T.overlay;}}
                >{k==="del"?"⌫":k}</button>
              ))}
            </div>

            {authConfig.webauthnCredId&&(
              <button onClick={tryBiometric} disabled={bioBusy}
                style={{width:NW,boxSizing:"border-box",height:44,borderRadius:T.r,border:bioBusy?"none":"1px solid "+T.border,background:bioBusy?"transparent":T.surface,color:bioBusy?T.tx3:T.tx1,fontSize:13,cursor:bioBusy?"default":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:bioBusy?"center":"flex-start",paddingLeft:bioBusy?0:16,marginBottom:12,transition:"color .2s, background .15s"}}
                onMouseEnter={e=>{if(!bioBusy)e.currentTarget.style.background=T.overlay;}}
                onMouseLeave={e=>{if(!bioBusy)e.currentTarget.style.background=T.surface;}}
              >
                {bioBusy&&<span style={{width:12,height:12,border:"1.5px solid "+T.border,borderTopColor:T.tx2,borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite",willChange:"transform",marginRight:7,flexShrink:0}}/>}
                {bioBusy?"Verifying...":"Biometrics"}
              </button>
            )}
          </>
        )}

        {phase==="totp"&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,width:NW}}>
            <div style={{animation:shaking?"shake 0.4s ease":"none",width:"100%",display:"flex",justifyContent:"center"}}>
              <input autoFocus value={totpCode}
                onChange={e=>setTotpCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                placeholder="000000"
                style={{width:160,textAlign:"center",fontSize:26,fontWeight:500,letterSpacing:8,padding:"12px 0",background:T.surface,border:"1px solid "+T.border,borderRadius:T.rCard,color:T.tx1,fontFamily:"monospace",outline:"none"}}
                onKeyDown={e=>e.key==="Enter"&&totpCode.length===6&&verifyTotp()}
              />
            </div>
            <button onClick={verifyTotp} disabled={totpCode.length!==6}
              style={{background:totpCode.length===6?T.accent:T.overlay,color:totpCode.length===6?"#fff":T.tx3,border:"none",borderRadius:T.r,padding:"10px 32px",fontSize:13,fontWeight:500,cursor:totpCode.length===6?"pointer":"default",fontFamily:"inherit",transition:"background .2s"}}
            >Verify</button>
            <button onClick={()=>{setPhase("pin");setTotpCode("");setErr("");}} style={{background:"none",border:"none",color:T.tx3,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>← Back to PIN</button>
          </div>
        )}

        {err&&<div style={{marginTop:8,color:T.red,fontSize:12,textAlign:"center"}}>{err}</div>}
      </div>
    </div>
  );
}

// ── Terms of Service Modal ────────────────────────────────────────────────────

export { LockScreen };

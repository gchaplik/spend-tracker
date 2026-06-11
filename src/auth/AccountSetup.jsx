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

// ── Account Setup Wizard (first launch) ──────────────────────────────────────
function AccountSetup({onComplete}){
  const [step,setStep]=useState(1); // 1=PIN, 2=Biometric, 3=TOTP
  const [pinA,setPinA]=useState("");
  const [pinB,setPinB]=useState("");
  const [pinErr,setPinErr]=useState("");
  const [bioStatus,setBioStatus]=useState("idle"); // idle|enrolling|done|skipped|error
  const [bioErr,setBioErr]=useState("");
  const [totpSecret]=useState(()=>genTOTPSecret());
  const [totpInput,setTotpInput]=useState("");
  const [totpErr,setTotpErr]=useState("");
  const [savedHash,setSavedHash]=useState(null);
  const [savedSalt,setSavedSalt]=useState(null);
  const [credId,setCredId]=useState(null);
  const [bioMethod,setBioMethod]=useState("webauthn"); // "touchid"|"webauthn"

  const IS={width:"100%",padding:"12px 14px",borderRadius:10,border:"2px solid #e2e8f0",fontSize:15,fontFamily:"inherit",outline:"none",boxSizing:"border-box",textAlign:"center",letterSpacing:6,transition:"border-color .2s"};

  // Step 1: create PIN
  const submitPin=async()=>{
    if(pinA.length<4){setPinErr("PIN must be at least 4 digits");return;}
    if(pinA!==pinB){setPinErr("PINs don't match — try again");return;}
    const salt=genSalt();
    const hash=await hashPin(pinA,salt);
    setSavedHash(hash);setSavedSalt(salt);
    setPinA("");setPinB("");setPinErr("");
    setStep(2);
  };

  // Step 2: biometric
  const enrollBio=async()=>{
    setBioStatus("enrolling");setBioErr("");
    try{
      // macOS: native Touch ID via Electron IPC
      if(window.electronBiometrics){
        const avail=await window.electronBiometrics.available();
        if(avail){
          await window.electronBiometrics.prompt("verify your identity to enable Touch ID for CashHeap");
          setCredId("native-touchid");
          setBioMethod("touchid");
          setBioStatus("done");return;
        }
      }
      // Fallback: WebAuthn (Windows Hello / FIDO2)
      const cred=await navigator.credentials.create({publicKey:{
        challenge:crypto.getRandomValues(new Uint8Array(32)),
        rp:{name:"CashHeap",id:window.location.hostname||"localhost"},
        user:{id:new TextEncoder().encode("cashheap-user"),name:"cashheap",displayName:"CashHeap"},
        pubKeyCredParams:[{alg:-7,type:"public-key"},{alg:-257,type:"public-key"}],
        authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required",residentKey:"preferred"},
        timeout:60000,
      }});
      setCredId(_b64ue(cred.rawId));
      setBioMethod("webauthn");
      setBioStatus("done");
    }catch(e){
      setBioErr(e.name==="NotAllowedError"?"Cancelled — you can set this up later in Settings.":`Could not enroll: ${e.message}`);
      setBioStatus("error");
    }
  };
  const skipBio=()=>{setBioStatus("skipped");setStep(3);};
  const nextAfterBio=()=>setStep(3);

  // Step 3: TOTP
  const verifyTOTP=async()=>{
    const now=await calcTOTP(totpSecret);
    const prev=await calcTOTP(totpSecret,Date.now()-30000);
    if(totpInput===now||totpInput===prev){
      finish(true);
    }else{setTotpErr("Incorrect code — try again");}
  };
  const skipTOTP=()=>finish(false);

  const finish=(totpEnabled)=>{
    const cfg={
      enabled:true,
      pinHash:savedHash,
      pinSalt:savedSalt,
      webauthnCredId:credId||null,
      webauthnEnabled:!!credId,
      bioMethod:credId?bioMethod:"webauthn",
      totpEnabled,
      totpSecret:totpEnabled?totpSecret:null,
      autoLockMinutes:5,
    };
    onComplete(cfg);
  };

  const steps=[{n:1,l:"Create PIN"},{n:2,l:"Biometrics"},{n:3,l:"2-Factor"}];

  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",padding:24}}>
      <div style={{marginBottom:12}}><MountainLogo size={48}/></div>
      <div style={{color:T.tx1,fontSize:18,fontWeight:600,marginBottom:4}}>Welcome to CashHeap</div>
      <div style={{color:T.tx3,fontSize:13,marginBottom:28,textAlign:"center"}}>Set up your account to keep your financial data secure.</div>

      {/* Step progress */}
      <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:28}}>
        {steps.map((s,i)=>(
          <div key={s.n} style={{display:"flex",alignItems:"center"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div style={{width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,
                background:step>=s.n?T.accent:T.overlay,
                color:step>=s.n?"#fff":T.tx3,
                transition:"all .3s"
              }}>{step>s.n?"✓":s.n}</div>
              <div style={{fontSize:10,color:step>=s.n?T.accent:T.tx3,whiteSpace:"nowrap"}}>{s.l}</div>
            </div>
            {i<steps.length-1&&<div style={{width:44,height:1,background:step>s.n?T.accent:T.border,margin:"0 6px",marginBottom:20,transition:"background .3s"}}/>}
          </div>
        ))}
      </div>

      {/* Card */}
      <div style={{background:T.surface,borderRadius:T.rCard,boxShadow:T.shadowMd,padding:"24px 28px",width:"100%",maxWidth:380}}>

        {/* Step 1 — PIN */}
        {step===1&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{color:T.tx1,fontSize:15,fontWeight:600,marginBottom:2}}>Create your PIN</div>
            <div style={{color:T.tx3,fontSize:12,marginBottom:6,lineHeight:1.5}}>Your PIN unlocks CashHeap. Stored with PBKDF2 — never visible to us.</div>
            <input type="password" inputMode="numeric" placeholder="Enter PIN (4–6 digits)" maxLength={6}
              value={pinA} onChange={e=>setPinA(e.target.value.replace(/\D/g,""))}
              style={IS}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}
            />
            <input type="password" inputMode="numeric" placeholder="Confirm PIN" maxLength={6}
              value={pinB} onChange={e=>setPinB(e.target.value.replace(/\D/g,""))}
              style={IS}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}
              onKeyDown={e=>e.key==="Enter"&&pinA.length>=4&&pinA===pinB&&submitPin()}
            />
            {pinErr&&<div style={{color:T.red,fontSize:12}}>{pinErr}</div>}
            <button onClick={submitPin} disabled={pinA.length<4||pinB.length<4}
              style={{marginTop:4,padding:"10px 0",borderRadius:T.r,border:"none",background:pinA.length>=4&&pinB.length>=4?T.accent:T.overlay,color:pinA.length>=4&&pinB.length>=4?"#fff":T.tx3,fontSize:13,fontWeight:500,cursor:pinA.length>=4&&pinB.length>=4?"pointer":"default",fontFamily:"inherit",transition:"background .2s"}}
            >Continue →</button>
          </div>
        )}

        {/* Step 2 — Biometric */}
        {step===2&&(
          <div style={{display:"flex",flexDirection:"column",gap:12,alignItems:"center",textAlign:"center"}}>
            <div style={{color:T.tx1,fontSize:15,fontWeight:600}}>Enable Biometrics</div>
            <div style={{color:T.tx3,fontSize:12,lineHeight:1.6,marginBottom:4}}>
              Use Touch ID, Face ID, Windows Hello, or your device's fingerprint sensor to unlock instantly.
            </div>
            {bioStatus==="idle"&&(
              <button onClick={enrollBio} style={{width:"100%",padding:"10px 0",borderRadius:T.r,border:"none",background:T.accent,color:"#fff",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>
                Set Up Biometrics
              </button>
            )}
            {bioStatus==="enrolling"&&(
              <div style={{color:T.accent,fontSize:13,display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:14,height:14,border:"2px solid "+T.accentBg,borderTopColor:T.accent,borderRadius:"50%",display:"inline-block",animation:"spin 0.8s linear infinite"}}/>
                Follow the prompt on your device…
              </div>
            )}
            {bioStatus==="done"&&(
              <>
                <div style={{color:T.green,fontSize:13}}>Biometrics enrolled successfully!</div>
                <button onClick={nextAfterBio} style={{width:"100%",padding:"10px 0",borderRadius:T.r,border:"none",background:T.accent,color:"#fff",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",marginTop:4}}>Continue →</button>
              </>
            )}
            {(bioStatus==="error"||bioStatus==="idle")&&bioErr&&<div style={{color:T.red,fontSize:12}}>{bioErr}</div>}
            {bioStatus!=="done"&&bioStatus!=="enrolling"&&(
              <button onClick={skipBio} style={{background:"none",border:"none",color:T.tx3,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline",marginTop:2}}>
                Skip for now
              </button>
            )}
          </div>
        )}

        {/* Step 3 — TOTP */}
        {step===3&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{color:T.tx1,fontSize:15,fontWeight:600,textAlign:"center",marginBottom:2}}>Two-Factor Authentication</div>
            <div style={{color:T.tx3,fontSize:12,lineHeight:1.5,textAlign:"center",marginBottom:4}}>
              Scan with Google Authenticator, Authy, or any TOTP app. Optional but recommended.
            </div>
            <div style={{textAlign:"center",margin:"4px 0 8px"}}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(`otpauth://totp/CashHeap?secret=${totpSecret}&issuer=CashHeap`)}`} alt="QR" style={{borderRadius:T.r,border:"1px solid "+T.border}}/>
              <div style={{marginTop:6,fontSize:10,color:T.tx3}}>Manual key:</div>
              <div style={{fontFamily:"monospace",fontSize:11,color:T.accent,letterSpacing:1,wordBreak:"break-all",marginTop:2}}>{totpSecret}</div>
            </div>
            <input placeholder="6-digit code" maxLength={6}
              value={totpInput} onChange={e=>setTotpInput(e.target.value.replace(/\D/g,"").slice(0,6))}
              onKeyDown={e=>e.key==="Enter"&&totpInput.length===6&&verifyTOTP()}
              style={{...IS,fontSize:20,letterSpacing:10,fontFamily:"monospace",textAlign:"center"}}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}
            />
            {totpErr&&<div style={{color:T.red,fontSize:12}}>{totpErr}</div>}
            <button onClick={verifyTOTP} disabled={totpInput.length!==6}
              style={{padding:"10px 0",borderRadius:T.r,border:"none",background:totpInput.length===6?T.accent:T.overlay,color:totpInput.length===6?"#fff":T.tx3,fontSize:13,fontWeight:500,cursor:totpInput.length===6?"pointer":"default",fontFamily:"inherit",transition:"background .2s"}}
            >Enable 2FA &amp; Finish</button>
            <button onClick={skipTOTP} style={{background:"none",border:"none",color:T.tx3,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline",textAlign:"center"}}>
              Skip — finish without 2FA
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Lock Screen ───────────────────────────────────────────────────────────────

export { AccountSetup };

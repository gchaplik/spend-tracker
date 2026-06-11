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
import { idbPut, idbGet, idbDel } from "../utils/idb.js";
import { extractReceipt } from "../utils/receiptOCR.js";

function LocalFolderSync({cats, receiptFPs=new Set(), onSaveFPs, onSaveMultiple, discreteMode}) {
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
        setStatus({ t: "info", m: `Click "Restore Access" to reconnect to ${handle.name}.` });
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (discreteMode) {
    return <DiscreteModeBlockedCard />;
  }

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
    <div style={{width:"100%"}}>
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
            ? <Btn onClick={restoreAccess} disabled={syncing} full v="secondary">Restore Access to Folder: {dirName}</Btn>
            : <Btn onClick={pickFolder} disabled={syncing} full v="secondary">{dirName ? dirName : "Pick Folder"}</Btn>}
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

function UploadReceipts({cats,receiptFPs=new Set(),onSaveFPs,onSave, discreteMode}){
  const [items,setItems]=useState([]);
  const [stage,setStage]=useState("select");
  const [busy,setBusy]=useState(false);
  const ref=useRef();

  if (discreteMode) {
    return <DiscreteModeBlockedCard />;
  }

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
    <div style={{width:"100%"}}>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>{title}</h2>
      <div style={CA}>
        <Fld label={type==="income"?"Source":"Merchant / Description"}><input style={IS} value={f.merchant} onChange={e=>set("merchant",e.target.value)} placeholder={type==="income"?"e.g. Salary, Freelance":"e.g. Walmart, Netflix, Rent"}/></Fld>
        {/* Currency selector */}
        <Fld label="Currency">
          <div style={{display:"flex",gap:8}}>
            {["CAD","USD"].map(cur=>(
              <button key={cur} onClick={()=>set("currency",cur)} style={{flex:1,padding:"8px 0",borderRadius:8,border:`2px solid ${f.currency===cur?"#0284C7":"#e2e8f0"}`,background:f.currency===cur?"#f0f9ff":"#fff",color:f.currency===cur?"#0284C7":"#64748b",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
                {cur==="CAD"?"CAD":"USD"}
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
              {fxLoading&&<span style={{fontSize:11,color:"#0284C7"}}>Fetching rate...</span>}
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
                {nfmt(cadAmt)} CAD
              </span>
            </div>
            {recurring&&<div style={{fontSize:12,color:"#0369a1",marginTop:6,fontWeight:500}}>
              {count} payments of <strong>${amtNum.toFixed(2)} USD</strong> = <strong>{nfmt(cadAmt*count)} CAD</strong> total
            </div>}
          </div>
        )}
        {recurring&&amtNum>0&&!isUSD&&<div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:12,padding:"11px 14px",marginBottom:16,fontSize:13,color:"#0369a1",fontWeight:500}}>{count} payments of <strong>{nfmt(amtNum)} CAD</strong> = <strong style={{fontWeight:800}}>{nfmt(amtNum*count)} CAD</strong> — {lbl.toLowerCase()}, starting {f.date}</div>}
        {recurring&&amtNum>0&&isUSD&&cadAmt>0&&<div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #7dd3fc",borderRadius:12,padding:"11px 14px",marginBottom:16,fontSize:13,color:"#0369a1",fontWeight:500}}>{count} payments of <strong>${amtNum.toFixed(2)} USD</strong> ({nfmt(cadAmt)} CAD each) = <strong style={{fontWeight:800}}>{nfmt(cadAmt*count)} CAD</strong> — {lbl.toLowerCase()}, starting {f.date}</div>}
        <Btn onClick={submit} disabled={!f.merchant.trim()||!f.amount||(isUSD&&!effectiveRate)} full>{recurring?"Log "+count+" Entries":"Add "+title}</Btn>
      </div>
    </div>
  );
}


export { LocalFolderSync, FileThumbnail, UploadReceipts, RecurringForm };

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
import { getLearnedCategory } from "../utils/catLearn.js";

// ── CSV Import ────────────────────────────────────────────────────────────────
const CSV_MAPPINGS_KEY="ch_csv_mappings";
function loadSavedMappings(){try{return JSON.parse(localStorage.getItem(CSV_MAPPINGS_KEY)||"{}");}catch{return {};}}
function saveMappingForProfile(profile,mapping,skipRows){
  const all={...loadSavedMappings(),[profile]:{mapping,skipRows}};
  localStorage.setItem(CSV_MAPPINGS_KEY,JSON.stringify(all));
  return all;
}

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
function applyAutoCategory(merchant,type,cats,catRules){
  if(type==="income") return cats[0]||"Other";
  const mLower=merchant.toLowerCase();
  for(const rule of (catRules||[])){
    if(mLower.includes(rule.pattern.toLowerCase())&&cats.includes(rule.category)) return rule.category;
  }
  const learned=getLearnedCategory(merchant);
  if(learned&&cats.includes(learned)) return learned;
  return cats[0]||"Other";
}

function CSVImport({txns,cats,catRules=[],onImport}){
  const [profile,setProfile]=useState("td");
  const [step,setStep]=useState("upload"); // upload | map | review
  const [rawRows,setRawRows]=useState([]);
  const [headers,setHeaders]=useState([]);
  const [mapping,setMapping]=useState({date:"",desc:"",debit:"",credit:"",amount:""});
  const [skipRows,setSkipRows]=useState(1);
  const [preview,setPreview]=useState([]); // parsed+deduped rows for review
  const [checked,setChecked]=useState({});
  const [imported,setImported]=useState(null);
  const [savedMappings,setSavedMappings]=useState(loadSavedMappings);
  const [mappingFromSave,setMappingFromSave]=useState(false);
  const [pdfBusy,setPdfBusy]=useState(false);
  const [pdfError,setPdfError]=useState(null);
  const fileRef=useRef();
  const pdfRef=useRef();

  const applyProfile=(prof,savedAll)=>{
    const saved=(savedAll||savedMappings)[prof];
    if(saved){setMapping(saved.mapping);setSkipRows(saved.skipRows??1);return true;}
    const p=BANK_PROFILES[prof];
    const autoMap={};
    if(p.cols.date!==undefined) autoMap.date=String(p.cols.date);
    if(p.cols.desc!==undefined) autoMap.desc=String(p.cols.desc);
    if(p.cols.debit!==undefined) autoMap.debit=String(p.cols.debit);
    if(p.cols.credit!==undefined) autoMap.credit=String(p.cols.credit);
    if(p.cols.amount!==undefined) autoMap.amount=String(p.cols.amount);
    setMapping(autoMap);
    setSkipRows(p.skipRows||1);
    return false;
  };

  const onFile=e=>{
    const f=e.target.files[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const rows=parseCSV(ev.target.result);
      setRawRows(rows);
      setHeaders(rows[0]||[]);
      const hasSaved=applyProfile(profile);
      setMappingFromSave(hasSaved);
      setStep("map");
    };
    reader.readAsText(f);
  };

  const onPdfFile=async(e)=>{
    const f=e.target.files[0]; if(!f) return;
    setPdfBusy(true);setPdfError(null);
    try{
      const fd=new FormData();
      fd.append("file",f);
      fd.append("bank",profile!=="custom"?profile:"");
      const res=await fetch("/api/pdf-parse",{method:"POST",body:fd});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||"PDF parse failed");
      const parsed=data.transactions;
      if(!parsed.length) throw new Error("No transactions found in PDF. Try a different bank or use CSV export.");
      // build preview directly from parsed results
      const rows=parsed.map((r,i)=>{
        const cat=applyAutoCategory(r.merchant,r.type,cats,catRules);
        const dateMs=r.date?new Date(r.date).getTime():0;
        const isDupe=txns.some(t=>{
          if(Math.abs(t.amount-r.amount)>=0.01) return false;
          if((t.merchant||t.source||"").toLowerCase()!==r.merchant.toLowerCase()) return false;
          const tMs=t.date?new Date(t.date).getTime():null;
          return tMs!=null&&Math.abs(tMs-dateMs)<=86400000;
        });
        return {_id:i,date:r.date,merchant:r.merchant,amount:r.amount,type:r.type,category:cat,isDupe,_raw:[]};
      });
      setPreview(rows);
      const sel={};rows.forEach(r=>{if(!r.isDupe)sel[r._id]=true;});
      setChecked(sel);
      setStep("review");
    }catch(err){
      setPdfError(err.message);
    }
    setPdfBusy(false);
    if(pdfRef.current) pdfRef.current.value="";
  };

  const buildPreview=()=>{
    const updated=saveMappingForProfile(profile,mapping,skipRows);
    setSavedMappings(updated);
    setMappingFromSave(true);
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
      const cat=applyAutoCategory(merchant,type,cats,catRules);
      // duplicate detection: amount within $0.01 + merchant fuzzy match + date within ±1 day
      const dateMs=date?new Date(date).getTime():0;
      const isDupe=txns.some(t=>{
        if(Math.abs(t.amount-amount)>=0.01) return false;
        if((t.merchant||t.source||"").toLowerCase()!==merchant.toLowerCase()) return false;
        const tMs=t.date?new Date(t.date).getTime():null;
        return tMs!=null&&Math.abs(tMs-dateMs)<=86400000;
      });
      return {_id:i,date,merchant,amount,type,category:cat,isDupe,_raw:row};
    }).filter(r=>r.amount>0&&r.date);
    setPreview(parsed);
    const sel={};parsed.forEach(r=>{if(!r.isDupe)sel[r._id]=true;});
    setChecked(sel);
    setStep("review");
  };

  const [aiCatBusy,setAiCatBusy]=useState(false);

  const doImport=()=>{
    const toImport=preview.filter(r=>checked[r._id]).map(r=>({
      id:uid(),type:r.type,merchant:r.merchant,source:r.type==="income"?r.merchant:undefined,
      amount:r.amount,date:r.date,category:r.type==="expense"?r.category:undefined,note:"CSV import",hasReceipt:false
    }));
    onImport(toImport);
    setImported(toImport.length);
    setStep("done");
  };

  const aiCategorize=async()=>{
    const expenses=preview.filter(r=>r.type==="expense"&&checked[r._id]);
    if(!expenses.length) return;
    const unique=[...new Set(expenses.map(r=>r.merchant))];
    setAiCatBusy(true);
    try{
      const prompt=`Categorize each merchant into exactly one of these categories: ${cats.join(", ")}.\nRespond with ONLY a JSON object mapping merchant name to category, nothing else.\nMerchants: ${JSON.stringify(unique)}`;
      const res=await fetch("/api/llm/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:prompt}],stream:false})});
      const data=await res.json();
      const text=data.message?.content||data.content||"";
      const jsonMatch=text.match(/\{[\s\S]*\}/);
      if(jsonMatch){
        const map=JSON.parse(jsonMatch[0]);
        setPreview(p=>p.map(r=>{
          if(r.type!=="expense") return r;
          const suggested=map[r.merchant];
          if(suggested&&cats.includes(suggested)) return {...r,category:suggested,_aiCat:true};
          return r;
        }));
      }
    }catch(e){console.error("AI categorize failed",e);}
    setAiCatBusy(false);
  };

  const HL={background:"#f0f9ff",borderRadius:16,border:"1px solid #bae6fd",padding:24};
  const selCount=Object.values(checked).filter(Boolean).length;

  if(step==="done") return(
    <div style={HL}>
      <div style={{fontSize:32,marginBottom:12,color:"#059669",fontWeight:700}}>✓</div>
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
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <select value={profile} onChange={e=>{setProfile(e.target.value);}} style={{...IS,width:"auto",minWidth:200}}>
                {Object.entries(BANK_PROFILES).map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
              </select>
              {savedMappings[profile]&&<span style={{fontSize:11,color:"#0369a1",fontWeight:600}}>✓ Custom mapping saved</span>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:4}}>
            <div style={{border:"2px dashed #bae6fd",borderRadius:12,padding:32,textAlign:"center",cursor:"pointer",background:"#f8fafc"}} onClick={()=>fileRef.current?.click()}>
              <div style={{fontWeight:600,color:"#0369a1",marginBottom:4}}>CSV file</div>
              <div style={{fontSize:12,color:"#94a3b8"}}>Downloaded from online banking</div>
              <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={onFile}/>
            </div>
            <div style={{border:"2px dashed #c4b5fd",borderRadius:12,padding:32,textAlign:"center",cursor:"pointer",background:"#faf5ff",opacity:pdfBusy?0.6:1}} onClick={()=>!pdfBusy&&pdfRef.current?.click()}>
              <div style={{fontWeight:600,color:"#7c3aed",marginBottom:4}}>{pdfBusy?"Parsing PDF…":"PDF statement"}</div>
              <div style={{fontSize:12,color:"#94a3b8"}}>Auto-detected from bank format</div>
              <input ref={pdfRef} type="file" accept=".pdf" style={{display:"none"}} onChange={onPdfFile}/>
            </div>
          </div>
          {pdfError&&<div style={{marginTop:10,fontSize:12,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px"}}>{pdfError}</div>}
          <div style={{marginTop:12,fontSize:12,color:"#94a3b8"}}>
            CSV — TD: Accounts → Download → CSV &nbsp;|&nbsp; RBC: My Accounts → Download Transactions &nbsp;|&nbsp; BMO: Accounts → Download → Spreadsheet
          </div>
        </div>
      )}

      {step==="map"&&(
        <div style={HL}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>Map CSV Columns</div>
            {savedMappings[profile]&&<button onClick={()=>{const p=BANK_PROFILES[profile];const autoMap={};if(p.cols.date!==undefined)autoMap.date=String(p.cols.date);if(p.cols.desc!==undefined)autoMap.desc=String(p.cols.desc);if(p.cols.debit!==undefined)autoMap.debit=String(p.cols.debit);if(p.cols.credit!==undefined)autoMap.credit=String(p.cols.credit);if(p.cols.amount!==undefined)autoMap.amount=String(p.cols.amount);setMapping(autoMap);setSkipRows(p.skipRows||1);}} style={{fontSize:11,padding:"3px 10px",border:"1px solid #e2e8f0",borderRadius:99,cursor:"pointer",background:"#f8fafc",color:"#64748b",fontFamily:"inherit"}}>Reset to defaults</button>}
          </div>
          <div style={{marginBottom:12,fontSize:12,color:"#64748b"}}>
            {mappingFromSave
              ?<span style={{color:"#0369a1",fontWeight:600}}>✓ Using your saved mapping for {BANK_PROFILES[profile].name}.</span>
              :<span>Auto-detected from <strong>{BANK_PROFILES[profile].name}</strong> format. Adjust if needed.</span>
            }
          </div>
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
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={()=>{const a={};preview.forEach(r=>{if(!r.isDupe)a[r._id]=true;});setChecked(a);}} style={{fontSize:11,padding:"5px 10px",border:"1px solid #bae6fd",borderRadius:7,cursor:"pointer",background:"#f0f9ff",color:"#0369a1",fontFamily:"inherit"}}>Select Non-Dupes</button>
              <button onClick={()=>{const a={};preview.forEach(r=>a[r._id]=true);setChecked(a);}} style={{fontSize:11,padding:"5px 10px",border:"1px solid #bae6fd",borderRadius:7,cursor:"pointer",background:"#f0f9ff",color:"#0369a1",fontFamily:"inherit"}}>Select All</button>
              <button onClick={()=>setChecked({})} style={{fontSize:11,padding:"5px 10px",border:"1px solid #e2e8f0",borderRadius:7,cursor:"pointer",background:"#f8fafc",color:"#64748b",fontFamily:"inherit"}}>Deselect All</button>
              <button onClick={aiCategorize} disabled={aiCatBusy} style={{fontSize:11,padding:"5px 10px",border:"1px solid #ddd6fe",borderRadius:7,cursor:"pointer",background:"#f5f3ff",color:"#7c3aed",fontFamily:"inherit",fontWeight:600,opacity:aiCatBusy?0.6:1}}>{aiCatBusy?"Categorizing…":"✦ AI Categorize"}</button>
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
                  <div style={{fontSize:12,fontWeight:700,color:r.type==="income"?"#059669":"#111827"}}>{r.type==="income"?"+":""}{nfmt(r.amount)}</div>
                  <select value={r.category||cats[0]} onChange={e=>setPreview(p=>p.map(x=>x._id===r._id?{...x,category:e.target.value,_aiCat:false}:x))} style={{fontSize:11,border:"1px solid "+(r._aiCat?"#c4b5fd":"#e2e8f0"),borderRadius:6,padding:"2px 4px",background:r._aiCat?"#f5f3ff":"#fff",fontFamily:"inherit"}}>
                    {r.type==="income"?<option value="income">Income</option>:cats.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  {r.isDupe&&<span title="Possible duplicate" style={{fontSize:11,fontWeight:700,color:"#f59e0b"}}>!</span>}
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


export { CSVImport, BANK_PROFILES, parseCSVDate, parseCSV };

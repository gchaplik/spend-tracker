import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell, ReferenceLine, PieChart, Pie, AreaChart, Area } from "recharts";
import { T, IS, CA, Fld, Btn } from "../../theme/tokens.jsx";
import { DEFAULT_CATS, COLORS, CADENCES, NAV_ITEMS, DEFAULT_SETTINGS } from "../../constants/index.js";
import { fmt, fmtUSD, today, uid, toB64, cLabel, isPdf, fpHash } from "../../utils/formatters.js";
import { buildDates, _df, _label, _sqlDf } from "../../utils/dateUtils.js";
import { fetchData as loadServerData, patchData as saveServerData } from "../../api/client.js";
import { getCatIcon, ICON_SET, ICON_BY_KEY, ICON_GROUPS, ICON_KEYWORDS } from "../../icons/index.jsx";
import { nfmt, useNfmt, DiscreteModeCtx, DiscreteModeBlockedCard } from "../../utils/discrete.jsx";
import { fetchUsdCad } from "../../utils/fx.js";
import { DEFAULT_SCHEMA } from "./schema.js";

function DataModel({schema,onSave}){
  const [activeView,setActiveView]=useState(()=>Object.keys(schema.views)[0]);
  const [mode,setMode]=useState("visual"); // "visual" | "raw"
  const [rawText,setRawText]=useState(()=>JSON.stringify(schema,null,2));
  const [rawError,setRawError]=useState(null);
  const [editingDim,setEditingDim]=useState(null); // {viewKey, dimKey} or null
  const [editingMsr,setEditingMsr]=useState(null); // {viewKey, msrKey} or null
  const [editingJoin,setEditingJoin]=useState(null); // index or null
  const [dimForm,setDimForm]=useState({});
  const [msrForm,setMsrForm]=useState({});
  const [joinForm,setJoinForm]=useState({type:"UNION ALL",label:"",table:"",sql:""});
  const [addingView,setAddingView]=useState(false);
  const [newViewForm,setNewViewForm]=useState({key:"",label:"",description:"",source:"",table:""});

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

  // Join CRUD
  const startEditJoin=(idx)=>{
    setEditingJoin(idx);
    const j=(views[activeView].joins||[])[idx]||{type:"UNION ALL",label:"",table:"",sql:""};
    setJoinForm({...j});
    setEditingDim(null);setEditingMsr(null);
  };
  const saveJoin=()=>{
    const v={...views[activeView]};
    const joins=[...(v.joins||[])];
    if(editingJoin==="new") joins.push({...joinForm});
    else joins[editingJoin]={...joinForm};
    v.joins=joins;
    onSave({...schema,views:{...views,[activeView]:v}});
    setEditingJoin(null);
  };
  const deleteJoin=(idx)=>{
    const v={...views[activeView]};
    const joins=[...(v.joins||[])];
    joins.splice(idx,1);
    v.joins=joins;
    onSave({...schema,views:{...views,[activeView]:v}});
  };

  // Add view
  const saveNewView=()=>{
    if(!newViewForm.key.trim()||!newViewForm.source.trim())return;
    onSave({...schema,views:{...views,[newViewForm.key.trim()]:{label:newViewForm.label||newViewForm.key,description:newViewForm.description,source:newViewForm.source.trim(),table:newViewForm.table.trim()||newViewForm.source.trim(),dimensions:{},measures:{}}}});
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
        <Fld label="Source Field (SQLite column)"><input style={IS} value={dimForm.field||""} onChange={e=>setDimForm(p=>({...p,field:e.target.value}))} placeholder="columnName in SQLite table"/></Fld>
      </div>
      <Fld label="Description"><input style={IS} value={dimForm.description||""} onChange={e=>setDimForm(p=>({...p,description:e.target.value}))} placeholder="What does this field represent?"/></Fld>
      <Fld label="SQL Expression (use ${TABLE} for the table reference, e.g. ${TABLE}.date or strftime('%Y-%m', ${TABLE}.date))">
        <input style={{...IS,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11}} value={dimForm.sql||""} onChange={e=>setDimForm(p=>({...p,sql:e.target.value}))} placeholder={"e.g. ${TABLE}.amount"}/>
      </Fld>
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
      <Fld label="Query (JavaScript — 'data' is the full SQLite dataset: txns, bills, vacations, holdings, expected, goals, accounts, billPayments, vacationTxns, accountHistory)">
        <textarea style={{...IS,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11,minHeight:64,resize:"vertical"}} value={msrForm.query||""} onChange={e=>setMsrForm(p=>({...p,query:e.target.value}))} placeholder={"e.g. data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)"}/>
      </Fld>
      <Fld label="SQL Expression (use ${TABLE} for the table reference, e.g. SUM(${TABLE}.amount) or COUNT(*))">
        <input style={{...IS,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11}} value={msrForm.sql||""} onChange={e=>setMsrForm(p=>({...p,sql:e.target.value}))} placeholder={"e.g. SUM(${TABLE}.amount)"}/>
      </Fld>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <Btn sm onClick={saveMsr}>Save</Btn>
        <Btn sm v="secondary" onClick={()=>setEditingMsr(null)}>Cancel</Btn>
      </div>
    </div>
  );

  const JoinEditor=()=>(
    <div style={{...CA,border:"2px solid #059669",marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:700,color:"#059669",marginBottom:12}}>
        {editingJoin==="new"?"Add Join":"Edit Join"}
        <span style={{fontWeight:400,marginLeft:8,fontSize:11,color:T.tx3}}>Defines how this view's rows are extended via UNION ALL or LEFT JOIN</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
        <Fld label="Join Type">
          <select style={{...IS,background:T.surface}} value={joinForm.type} onChange={e=>setJoinForm(p=>({...p,type:e.target.value}))}>
            <option value="UNION ALL">UNION ALL — append rows</option>
            <option value="LEFT JOIN">LEFT JOIN — widen columns</option>
          </select>
        </Fld>
        <Fld label="Label (display name)">
          <input style={IS} value={joinForm.label||""} onChange={e=>setJoinForm(p=>({...p,label:e.target.value}))} placeholder="e.g. Vacation Transactions"/>
        </Fld>
        <Fld label="Source Table">
          <input style={IS} value={joinForm.table||""} onChange={e=>setJoinForm(p=>({...p,table:e.target.value}))} placeholder="e.g. vacation_txns"/>
        </Fld>
      </div>
      <Fld label={joinForm.type==="UNION ALL"
        ?"UNION ALL SQL — full SELECT matching the base columns (no ${TABLE} needed)"
        :"JOIN SQL — the ON clause, use ${TABLE} for the primary table alias"}>
        <textarea
          style={{...IS,fontFamily:"'Menlo','Monaco','Courier New',monospace",fontSize:11,minHeight:72,resize:"vertical"}}
          value={joinForm.sql||""}
          onChange={e=>setJoinForm(p=>({...p,sql:e.target.value}))}
          placeholder={joinForm.type==="UNION ALL"
            ?"SELECT amount, date, COALESCE(category,'Vacation') as category, COALESCE(merchant,'?') as merchant, '' as note FROM vacation_txns"
            :"LEFT JOIN vacation_txns vt ON vt.vacationId=${TABLE}.id"}
        />
      </Fld>
      <div style={{fontSize:11,color:T.tx3,marginTop:6,padding:"6px 10px",background:T.overlay,borderRadius:T.r}}>
        {joinForm.type==="UNION ALL"
          ?"Jarvis builds: <code>(baseSQL UNION ALL joinSQL) AS t</code> — both sides filtered by date WHERE clause"
          :"Jarvis builds: <code>SELECT ... FROM table AS t LEFT JOIN ...</code> — join added after the primary FROM"}
      </div>
      <div style={{display:"flex",gap:8,marginTop:10}}>
        <Btn sm onClick={saveJoin}>Save Join</Btn>
        <Btn sm v="secondary" onClick={()=>setEditingJoin(null)}>Cancel</Btn>
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
                {views[vk].table&&<div style={{fontSize:10,color:"#94a3b8"}}>table: <code style={{fontSize:10}}>{views[vk].table}</code></div>}
                <div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>{Object.keys(views[vk].dimensions||{}).length}d · {Object.keys(views[vk].measures||{}).length}m</div>
              </button>
            ))}
            {addingView?(
              <div style={{...CA,padding:12}}>
                <Fld label="Key"><input style={IS} value={newViewForm.key} onChange={e=>setNewViewForm(p=>({...p,key:e.target.value.replace(/\s/g,"_").toLowerCase()}))} placeholder="view_key" autoFocus/></Fld>
                <Fld label="Label"><input style={IS} value={newViewForm.label} onChange={e=>setNewViewForm(p=>({...p,label:e.target.value}))} placeholder="Display Name"/></Fld>
                <Fld label="Source (SQLite table key)"><input style={IS} value={newViewForm.source} onChange={e=>setNewViewForm(p=>({...p,source:e.target.value}))} placeholder="e.g. txns, bills, vacations, holdings"/></Fld>
                <Fld label="SQLite Table Name"><input style={IS} value={newViewForm.table} onChange={e=>setNewViewForm(p=>({...p,table:e.target.value}))} placeholder="e.g. transactions, bills, vacation_txns"/></Fld>
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
                      <code style={{fontSize:10,background:"#0f172a",color:"#a5f3fc",padding:"4px 8px",borderRadius:6,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.sql||m.query}</code>
                      {m.responseSchema&&<div style={{fontSize:10,color:T.tx3,marginTop:3}}>response: <code style={{fontSize:10,background:T.overlay,padding:"1px 5px",borderRadius:3}}>{JSON.stringify(m.responseSchema?.properties||m.responseSchema?.items?.properties||{}).slice(0,80)}</code></div>}
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button onClick={()=>startEditMsr(activeView,mk)} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
                      <button onClick={()=>deleteMsr(activeView,mk)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Joins — define how this view's FROM is assembled */}
              <div style={{...CA,marginTop:16}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:T.tx1}}>Joins </span>
                    <span style={{fontSize:11,color:T.tx3,fontWeight:400}}>— extend the view's rows or columns</span>
                    {tv.baseSQL&&<div style={{fontSize:10,color:T.tx3,marginTop:3}}>Base SQL: <code style={{fontSize:10,background:T.overlay,padding:"1px 5px",borderRadius:3,color:T.tx2}}>{tv.baseSQL.slice(0,80)}…</code></div>}
                  </div>
                  <button onClick={()=>{setEditingJoin("new");setJoinForm({type:"UNION ALL",label:"",table:"",sql:""});setEditingDim(null);setEditingMsr(null);}} style={{padding:"4px 12px",borderRadius:T.r,border:"1.5px solid #bbf7d0",background:"#f0fdf4",color:"#059669",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>+ Add Join</button>
                </div>
                {editingJoin!==null&&<JoinEditor/>}
                {(tv.joins||[]).length===0&&editingJoin===null&&(
                  <div style={{fontSize:11,color:T.tx3,padding:"8px 0"}}>No joins — queries run directly against <code style={{fontSize:10,background:T.overlay,padding:"1px 5px",borderRadius:3}}>{tv.table||tv.source}</code></div>
                )}
                {(tv.joins||[]).map((j,idx)=>(
                  <div key={idx} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 0",borderBottom:"1px solid "+T.border}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                        <span style={{fontWeight:600,fontSize:12,color:T.tx1}}>{j.label||j.table||"Unnamed Join"}</span>
                        <span style={{fontSize:10,fontWeight:700,background:"#dcfce7",color:"#059669",padding:"2px 8px",borderRadius:10,border:"1px solid #bbf7d0"}}>{j.type}</span>
                        {j.table&&<code style={{fontSize:10,background:T.overlay,padding:"1px 6px",borderRadius:4,color:T.tx2}}>{j.table}</code>}
                      </div>
                      <code style={{fontSize:10,background:"#0f172a",color:"#86efac",padding:"4px 8px",borderRadius:6,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{j.sql}</code>
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button onClick={()=>startEditJoin(idx)} style={{background:"none",border:"1px solid "+T.border,borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:T.tx2,fontFamily:"inherit"}}>Edit</button>
                      <button onClick={()=>deleteJoin(idx)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:11,color:T.red,fontFamily:"inherit"}}>×</button>
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

export { DataModel };

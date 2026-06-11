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

function IconPicker({value,onChange,onClose}){
  const [group,setGroup]=useState("All");
  const [search,setSearch]=useState("");
  const fileRef=useRef();
  const filtered=ICON_SET.filter(i=>(group==="All"||i.group===group)&&(!search||i.label.toLowerCase().includes(search.toLowerCase())));
  const handleUpload=e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=ev=>{onChange(ev.target.result);onClose();};
    reader.readAsDataURL(f);
  };
  return(
    <div style={{position:"fixed",inset:0,zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.35)"}} onClick={onClose}>
      <div style={{background:T.surface,borderRadius:T.rCard+4,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",width:380,maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{padding:"14px 16px 10px",borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <span style={{fontSize:14,fontWeight:700,color:T.tx1}}>Choose Icon</span>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tx3,lineHeight:1,padding:2}}>×</button>
        </div>
        {/* Search + upload row */}
        <div style={{padding:"10px 16px 8px",borderBottom:"1px solid "+T.border,display:"flex",gap:8,flexShrink:0}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search icons…" style={{...IS,flex:1,padding:"6px 10px",fontSize:12}}/>
          <button onClick={()=>fileRef.current.click()} style={{padding:"6px 12px",borderRadius:T.r,border:"1px solid "+T.border,background:T.overlay,fontSize:12,fontWeight:600,color:T.tx2,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit"}}>
            ↑ Upload image
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleUpload}/>
        </div>
        {/* Group tabs */}
        <div style={{padding:"8px 16px 0",display:"flex",gap:6,flexWrap:"wrap",flexShrink:0}}>
          {["All",...ICON_GROUPS].map(g=>(
            <button key={g} onClick={()=>setGroup(g)} style={{padding:"3px 10px",borderRadius:99,border:"1px solid "+(group===g?T.accent:T.border),background:group===g?T.accent:"transparent",color:group===g?"#fff":T.tx2,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all 0.12s"}}>{g}</button>
          ))}
        </div>
        {/* Grid */}
        <div style={{padding:"12px 16px 16px",overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
          {/* Clear option */}
          <button title="Auto-detect" onClick={()=>{onChange(null);onClose();}} style={{width:44,height:44,borderRadius:T.r,border:"1px dashed "+T.border,background:T.overlay,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:T.tx3}}>auto</button>
          {filtered.map(icon=>{
            const active=value===icon.key;
            return(
              <button key={icon.key} title={icon.label} onClick={()=>{onChange(icon.key);onClose();}}
                style={{width:44,height:44,borderRadius:T.r,border:"1px solid "+(active?T.accent:T.border),background:active?T.accentBg:T.surface,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.1s"}}
                onMouseEnter={e=>{if(!active){e.currentTarget.style.background=T.overlay;e.currentTarget.style.borderColor=T.tx3;}}}
                onMouseLeave={e=>{if(!active){e.currentTarget.style.background=T.surface;e.currentTarget.style.borderColor=T.border;}}}>
                {icon.svg(active?T.accent:T.tx2)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Categories({cats,onUpdate,catBudgets,onUpdateBudgets,catIcons={},onUpdateCatIcons,catRules=[],onUpdateCatRules}){
  const [newCat,setNewCat]=useState("");
  const [editIdx,setEditIdx]=useState(null);
  const [editVal,setEditVal]=useState("");
  const [budgetEdit,setBudgetEdit]=useState({});
  const [iconPickerFor,setIconPickerFor]=useState(null); // cat name
  const add=()=>{const t=newCat.trim();if(!t||cats.includes(t))return;onUpdate([...cats,t]);setNewCat("");};
  const del=i=>{
    const c=cats[i];
    onUpdate(cats.filter((_,j)=>j!==i));
    const b={...catBudgets};delete b[c];onUpdateBudgets(b);
    const ic={...catIcons};delete ic[c];onUpdateCatIcons&&onUpdateCatIcons(ic);
  };
  const startEdit=i=>{setEditIdx(i);setEditVal(cats[i]);};
  const saveEdit=()=>{
    const t=editVal.trim();if(!t)return;
    const old=cats[editIdx];const c=[...cats];c[editIdx]=t;onUpdate(c);
    if(catBudgets[old]!==undefined){const b={...catBudgets};b[t]=b[old];delete b[old];onUpdateBudgets(b);}
    if(catIcons[old]!==undefined){const ic={...catIcons};ic[t]=ic[old];delete ic[old];onUpdateCatIcons&&onUpdateCatIcons(ic);}
    setEditIdx(null);
  };
  const setBudget=(cat,val)=>setBudgetEdit(p=>({...p,[cat]:val}));
  const saveBudget=(cat)=>{const v=parseFloat(budgetEdit[cat]);onUpdateBudgets({...catBudgets,[cat]:isNaN(v)||v<=0?0:v});setBudgetEdit(p=>{const n={...p};delete n[cat];return n;});};
  const setIcon=(cat,val)=>{
    const ic={...catIcons};
    if(val==null) delete ic[cat]; else ic[cat]=val;
    onUpdateCatIcons&&onUpdateCatIcons(ic);
  };

  const [newRule,setNewRule]=useState({pattern:"",category:cats[0]||""});
  const addRule=()=>{
    const p=newRule.pattern.trim();
    if(!p||!newRule.category) return;
    onUpdateCatRules&&onUpdateCatRules([...catRules,{id:uid(),pattern:p,category:newRule.category}]);
    setNewRule({pattern:"",category:cats[0]||""});
  };
  const delRule=id=>onUpdateCatRules&&onUpdateCatRules(catRules.filter(r=>r.id!==id));

  return (
    <div style={{width:"100%"}}>
      {iconPickerFor&&<IconPicker value={catIcons[iconPickerFor]||null} onChange={v=>setIcon(iconPickerFor,v)} onClose={()=>setIconPickerFor(null)}/>}
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Categories</h2>
      <div style={CA}>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={newCat} onChange={e=>setNewCat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="New category name" style={{...IS,flex:1}}/>
          <Btn onClick={add} disabled={!newCat.trim()}>Add</Btn>
        </div>
        {/* Column headers */}
        <div style={{display:"grid",gridTemplateColumns:"36px 1fr 120px auto auto",alignItems:"center",gap:"0 10px",marginBottom:4,paddingBottom:6,borderBottom:"1px solid "+T.border}}>
          <span/>
          <span style={{fontSize:11,color:T.tx3,fontWeight:600,textTransform:"uppercase"}}>Category</span>
          <span style={{fontSize:11,color:T.tx3,fontWeight:600,textTransform:"uppercase",textAlign:"right"}}>Monthly Budget</span>
          <span/>
          <span/>
        </div>
        {cats.map((c,i)=>{
          const iconVal=catIcons[c];
          const isImg=iconVal&&(iconVal.startsWith("data:")||iconVal.startsWith("http"));
          const hasCustom=!!iconVal;
          return(
            <div key={i} style={{display:"grid",gridTemplateColumns:"36px 1fr 120px auto auto",alignItems:"center",gap:"0 10px",padding:"8px 0",borderBottom:"1px solid "+T.overlay}}>
              {/* Icon button */}
              <button title="Change icon" onClick={()=>setIconPickerFor(c)}
                style={{width:36,height:36,borderRadius:T.r,border:"1px solid "+(hasCustom?T.accent:T.border),background:hasCustom?T.accentBg:T.overlay,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all 0.12s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.background=T.accentBg;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=hasCustom?T.accent:T.border;e.currentTarget.style.background=hasCustom?T.accentBg:T.overlay;}}>
                {isImg
                  ?<img src={iconVal} style={{width:22,height:22,borderRadius:4,objectFit:"cover"}} alt=""/>
                  :getCatIcon(c,"expense",hasCustom?T.accent:T.tx3,catIcons)
                }
              </button>
              {/* Name / edit */}
              {editIdx===i
                ?<input value={editVal} onChange={e=>setEditVal(e.target.value)} autoFocus onKeyDown={e=>e.key==="Enter"&&saveEdit()} style={{...IS,padding:"5px 8px",fontSize:13}}/>
                :<span style={{fontSize:13,fontWeight:500,color:T.tx1}}>{c}</span>
              }
              {/* Budget */}
              {editIdx===i
                ?<span/>
                :<div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end"}}>
                  <span style={{fontSize:11,color:T.tx3}}>$</span>
                  <input type="number" min="0" placeholder="—"
                    value={budgetEdit[c]!==undefined?budgetEdit[c]:(catBudgets[c]||"")}
                    onChange={e=>setBudget(c,e.target.value)}
                    onBlur={()=>budgetEdit[c]!==undefined&&saveBudget(c)}
                    onKeyDown={e=>e.key==="Enter"&&saveBudget(c)}
                    style={{...IS,width:76,textAlign:"right",padding:"5px 8px",fontSize:13}}/>
                </div>
              }
              {/* Edit / Save button */}
              {editIdx===i
                ?<Btn sm onClick={saveEdit}>Save</Btn>
                :<button onClick={()=>startEdit(i)} style={{background:"none",border:"1px solid "+T.border,borderRadius:T.r,padding:"4px 10px",cursor:"pointer",fontSize:11,color:T.tx2,fontFamily:"inherit"}}>Edit</button>
              }
              {/* Remove / Cancel */}
              {editIdx===i
                ?<Btn sm v="secondary" onClick={()=>setEditIdx(null)}>Cancel</Btn>
                :<button onClick={()=>del(i)} style={{background:"none",border:"1px solid #fecaca",borderRadius:T.r,padding:"4px 10px",cursor:"pointer",fontSize:11,color:T.red,fontFamily:"inherit"}}>Remove</button>
              }
            </div>
          );
        })}
      </div>

      {/* Auto-categorization rules */}
      <h2 style={{margin:"28px 0 14px",fontSize:18,fontWeight:800,letterSpacing:"-0.3px"}}>Auto-categorization Rules</h2>
      <div style={CA}>
        <div style={{fontSize:12,color:T.tx3,marginBottom:14}}>When a merchant name contains the pattern, it's automatically assigned the category during import.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 160px auto",gap:8,marginBottom:16,alignItems:"center"}}>
          <input value={newRule.pattern} onChange={e=>setNewRule(p=>({...p,pattern:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addRule()} placeholder='Merchant contains… (e.g. "Sobeys")' style={{...IS}}/>
          <select value={newRule.category} onChange={e=>setNewRule(p=>({...p,category:e.target.value}))} style={{...IS}}>
            {cats.map(c=><option key={c}>{c}</option>)}
          </select>
          <Btn onClick={addRule} disabled={!newRule.pattern.trim()}>Add Rule</Btn>
        </div>
        {catRules.length===0
          ?<div style={{fontSize:12,color:T.tx3,textAlign:"center",padding:"16px 0"}}>No rules yet. Add one above to auto-categorize imports.</div>
          :<div style={{display:"flex",flexDirection:"column",gap:6}}>
            {catRules.map(r=>(
              <div key={r.id} style={{display:"grid",gridTemplateColumns:"1fr 160px auto",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:T.r,background:T.overlay,border:"1px solid "+T.border}}>
                <div style={{fontSize:13,fontWeight:500,color:T.tx1}}>Contains <span style={{background:T.accentBg,color:T.accent,borderRadius:4,padding:"1px 6px",fontWeight:600}}>{r.pattern}</span></div>
                <div style={{fontSize:13,color:T.tx2}}>→ {r.category}</div>
                <button onClick={()=>delRule(r.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:T.r,padding:"3px 10px",cursor:"pointer",fontSize:11,color:T.red,fontFamily:"inherit"}}>Remove</button>
              </div>
            ))}
          </div>
        }
      </div>
    </div>
  );
}


export { IconPicker, Categories };

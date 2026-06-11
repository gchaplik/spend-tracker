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
        <div style={{padding:"14px 16px 10px",borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <span style={{fontSize:14,fontWeight:700,color:T.tx1}}>Choose Icon</span>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tx3,lineHeight:1,padding:2}}>×</button>
        </div>
        <div style={{padding:"10px 16px 8px",borderBottom:"1px solid "+T.border,display:"flex",gap:8,flexShrink:0}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search icons…" style={{...IS,flex:1,padding:"6px 10px",fontSize:12}}/>
          <button onClick={()=>fileRef.current.click()} style={{padding:"6px 12px",borderRadius:T.r,border:"1px solid "+T.border,background:T.overlay,fontSize:12,fontWeight:600,color:T.tx2,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit"}}>
            ↑ Upload image
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleUpload}/>
        </div>
        <div style={{padding:"8px 16px 0",display:"flex",gap:6,flexWrap:"wrap",flexShrink:0}}>
          {["All",...ICON_GROUPS].map(g=>(
            <button key={g} onClick={()=>setGroup(g)} style={{padding:"3px 10px",borderRadius:99,border:"1px solid "+(group===g?T.accent:T.border),background:group===g?T.accent:"transparent",color:group===g?"#fff":T.tx2,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all 0.12s"}}>{g}</button>
          ))}
        </div>
        <div style={{padding:"12px 16px 16px",overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
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

function Categories({
  cats, onUpdate, catBudgets, onUpdateBudgets,
  catIcons={}, onUpdateCatIcons,
  catRules=[], onUpdateCatRules,
  catRollover={}, onUpdateCatRollover,
  merchantNorms=[], onUpdateMerchantNorms,
  txns=[], expectedMonthlyIncome=0, settings={},
}) {
  const [newCat,setNewCat]=useState("");
  const [editIdx,setEditIdx]=useState(null);
  const [editVal,setEditVal]=useState("");
  const [budgetEdit,setBudgetEdit]=useState({});
  const [iconPickerFor,setIconPickerFor]=useState(null);
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
    if(catRollover[old]!==undefined){const r={...catRollover};r[t]=r[old];delete r[old];onUpdateCatRollover&&onUpdateCatRollover(r);}
    setEditIdx(null);
  };
  const setBudget=(cat,val)=>setBudgetEdit(p=>({...p,[cat]:val}));
  const saveBudget=(cat)=>{const v=parseFloat(budgetEdit[cat]);onUpdateBudgets({...catBudgets,[cat]:isNaN(v)||v<=0?0:v});setBudgetEdit(p=>{const n={...p};delete n[cat];return n;});};
  const setIcon=(cat,val)=>{const ic={...catIcons};if(val==null)delete ic[cat];else ic[cat]=val;onUpdateCatIcons&&onUpdateCatIcons(ic);};
  const toggleRollover=cat=>{const r={...catRollover};r[cat]=!r[cat];if(!r[cat])delete r[cat];onUpdateCatRollover&&onUpdateCatRollover(r);};

  // Budget suggestions: 3-month average spend per category
  const budgetSuggestions=useMemo(()=>{
    const now=new Date();
    const months=Array.from({length:3},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()-2+i,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
    return cats.reduce((acc,c)=>{
      const total=months.reduce((s,ym)=>s+txns.filter(t=>t.type==="expense"&&t.category===c&&t.date?.startsWith(ym)).reduce((ss,t)=>ss+t.amount,0),0);
      const avg=Math.ceil(total/3/10)*10;
      if(avg>0) acc[c]=avg;
      return acc;
    },{});
  },[cats,txns]);
  const [showSuggestions,setShowSuggestions]=useState(false);
  const applySuggestion=cat=>{onUpdateBudgets({...catBudgets,[cat]:budgetSuggestions[cat]});};
  const applyAllSuggestions=()=>{const b={...catBudgets};Object.entries(budgetSuggestions).forEach(([c,v])=>{b[c]=v;});onUpdateBudgets(b);setShowSuggestions(false);};

  // Zero-based budget mode
  const zeroBudget=!!settings?.zeroBudget;
  const totalBudgeted=cats.reduce((s,c)=>s+(catBudgets[c]||0),0);
  const unallocated=expectedMonthlyIncome-totalBudgeted;

  // Autocategorization rules
  const [newRule,setNewRule]=useState({pattern:"",category:cats[0]||""});
  const addRule=()=>{const p=newRule.pattern.trim();if(!p||!newRule.category)return;onUpdateCatRules&&onUpdateCatRules([...catRules,{id:uid(),pattern:p,category:newRule.category}]);setNewRule({pattern:"",category:cats[0]||""}); };
  const delRule=id=>onUpdateCatRules&&onUpdateCatRules(catRules.filter(r=>r.id!==id));

  // Merchant name normalizer rules
  const [newNorm,setNewNorm]=useState({pattern:"",replacement:""});
  const addNorm=()=>{const p=newNorm.pattern.trim(),r=newNorm.replacement.trim();if(!p||!r)return;onUpdateMerchantNorms&&onUpdateMerchantNorms([...merchantNorms,{id:uid(),pattern:p,replacement:r}]);setNewNorm({pattern:"",replacement:""});};
  const delNorm=id=>onUpdateMerchantNorms&&onUpdateMerchantNorms(merchantNorms.filter(n=>n.id!==id));

  return (
    <div style={{width:"100%"}}>
      {iconPickerFor&&<IconPicker value={catIcons[iconPickerFor]||null} onChange={v=>setIcon(iconPickerFor,v)} onClose={()=>setIconPickerFor(null)}/>}

      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:8}}>
        <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Categories</h2>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {Object.keys(budgetSuggestions).length>0&&(
            <button onClick={()=>setShowSuggestions(v=>!v)} style={{fontSize:12,fontWeight:600,padding:"5px 14px",borderRadius:99,border:"1px solid "+T.accent,background:showSuggestions?T.accent:"transparent",color:showSuggestions?"#fff":T.accent,cursor:"pointer",fontFamily:"inherit",transition:"all 0.12s"}}>
              {showSuggestions?"Hide Suggestions":"✦ Budget Suggestions"}
            </button>
          )}
        </div>
      </div>

      {/* Zero-based mode banner */}
      {zeroBudget&&expectedMonthlyIncome>0&&(
        <div style={{...CA,marginBottom:16,background:unallocated>=0?T.accentBg:"#fff7ed",border:"1px solid "+(unallocated>=0?T.accentMid:"#fdba74")}}>
          <div style={{display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}>
            <div><div style={{fontSize:11,color:T.tx3,fontWeight:600,textTransform:"uppercase",marginBottom:2}}>Monthly Income</div><div style={{fontSize:18,fontWeight:700,color:T.tx1}}>{nfmt(expectedMonthlyIncome)}</div></div>
            <div><div style={{fontSize:11,color:T.tx3,fontWeight:600,textTransform:"uppercase",marginBottom:2}}>Total Budgeted</div><div style={{fontSize:18,fontWeight:700,color:T.tx1}}>{nfmt(totalBudgeted)}</div></div>
            <div><div style={{fontSize:11,color:T.tx3,fontWeight:600,textTransform:"uppercase",marginBottom:2}}>Unallocated</div><div style={{fontSize:18,fontWeight:700,color:unallocated>=0?"#059669":"#ea580c"}}>{unallocated>=0?"+":""}{nfmt(unallocated)}</div></div>
            {unallocated<0&&<div style={{fontSize:12,color:"#ea580c",background:"#fff7ed",border:"1px solid #fdba74",borderRadius:T.r,padding:"4px 10px"}}>Over-allocated by {nfmt(Math.abs(unallocated))}</div>}
          </div>
        </div>
      )}

      {/* Budget suggestions panel */}
      {showSuggestions&&(
        <div style={{...CA,marginBottom:16,background:T.accentBg,border:"1px solid "+T.accentMid}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:T.tx1}}>Suggested budgets based on your 3-month average</div>
            <button onClick={applyAllSuggestions} style={{fontSize:12,fontWeight:600,padding:"4px 14px",borderRadius:99,border:"none",background:T.accent,color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>Apply All</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(budgetSuggestions).map(([c,v])=>(
              <div key={c} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+T.accentMid}}>
                <span style={{fontSize:13,color:T.tx1}}>{c}</span>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  {catBudgets[c]>0&&<span style={{fontSize:12,color:T.tx3}}>current: ${catBudgets[c]}</span>}
                  <span style={{fontSize:13,fontWeight:600,color:T.accent}}>${v}/mo</span>
                  <button onClick={()=>applySuggestion(c)} style={{fontSize:11,padding:"3px 10px",borderRadius:99,border:"1px solid "+T.accent,background:"transparent",color:T.accent,cursor:"pointer",fontFamily:"inherit"}}>Apply</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category list */}
      <div style={CA}>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={newCat} onChange={e=>setNewCat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="New category name" style={{...IS,flex:1}}/>
          <Btn onClick={add} disabled={!newCat.trim()}>Add</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"36px 1fr 120px 80px auto auto",alignItems:"center",gap:"0 10px",marginBottom:4,paddingBottom:6,borderBottom:"1px solid "+T.border}}>
          <span/>
          <span style={{fontSize:11,color:T.tx3,fontWeight:600,textTransform:"uppercase"}}>Category</span>
          <span style={{fontSize:11,color:T.tx3,fontWeight:600,textTransform:"uppercase",textAlign:"right"}}>Monthly Budget</span>
          <span style={{fontSize:11,color:T.tx3,fontWeight:600,textTransform:"uppercase",textAlign:"center"}}>Rollover</span>
          <span/>
          <span/>
        </div>
        {cats.map((c,i)=>{
          const iconVal=catIcons[c];
          const isImg=iconVal&&(iconVal.startsWith("data:")||iconVal.startsWith("http"));
          const hasCustom=!!iconVal;
          return(
            <div key={i} style={{display:"grid",gridTemplateColumns:"36px 1fr 120px 80px auto auto",alignItems:"center",gap:"0 10px",padding:"8px 0",borderBottom:"1px solid "+T.overlay}}>
              <button title="Change icon" onClick={()=>setIconPickerFor(c)}
                style={{width:36,height:36,borderRadius:T.r,border:"1px solid "+(hasCustom?T.accent:T.border),background:hasCustom?T.accentBg:T.overlay,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all 0.12s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.background=T.accentBg;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=hasCustom?T.accent:T.border;e.currentTarget.style.background=hasCustom?T.accentBg:T.overlay;}}>
                {isImg
                  ?<img src={iconVal} style={{width:22,height:22,borderRadius:4,objectFit:"cover"}} alt=""/>
                  :getCatIcon(c,"expense",hasCustom?T.accent:T.tx3,catIcons)
                }
              </button>
              {editIdx===i
                ?<input value={editVal} onChange={e=>setEditVal(e.target.value)} autoFocus onKeyDown={e=>e.key==="Enter"&&saveEdit()} style={{...IS,padding:"5px 8px",fontSize:13}}/>
                :<span style={{fontSize:13,fontWeight:500,color:T.tx1}}>{c}</span>
              }
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
              <div style={{display:"flex",justifyContent:"center"}}>
                <button title={catRollover[c]?"Rollover on — unused budget carries forward":"Rollover off"} onClick={()=>toggleRollover(c)}
                  style={{width:30,height:18,borderRadius:99,border:"none",background:catRollover[c]?T.accent:T.border,cursor:"pointer",position:"relative",transition:"background 0.15s",flexShrink:0}}>
                  <div style={{position:"absolute",top:2,left:catRollover[c]?13:2,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left 0.15s"}}/>
                </button>
              </div>
              {editIdx===i
                ?<Btn sm onClick={saveEdit}>Save</Btn>
                :<button onClick={()=>startEdit(i)} style={{background:"none",border:"1px solid "+T.border,borderRadius:T.r,padding:"4px 10px",cursor:"pointer",fontSize:11,color:T.tx2,fontFamily:"inherit"}}>Edit</button>
              }
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

      {/* Merchant name normalizer */}
      <h2 style={{margin:"28px 0 14px",fontSize:18,fontWeight:800,letterSpacing:"-0.3px"}}>Merchant Name Normalizer</h2>
      <div style={CA}>
        <div style={{fontSize:12,color:T.tx3,marginBottom:14}}>Cleans up raw bank strings in transaction history. E.g. "AMZN MKTP CA*1A2B3" → "Amazon".</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,marginBottom:16,alignItems:"center"}}>
          <input value={newNorm.pattern} onChange={e=>setNewNorm(p=>({...p,pattern:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addNorm()} placeholder='Pattern (e.g. "AMZN MKTP")' style={{...IS}}/>
          <input value={newNorm.replacement} onChange={e=>setNewNorm(p=>({...p,replacement:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addNorm()} placeholder='Clean name (e.g. "Amazon")' style={{...IS}}/>
          <Btn onClick={addNorm} disabled={!newNorm.pattern.trim()||!newNorm.replacement.trim()}>Add</Btn>
        </div>
        {merchantNorms.length===0
          ?<div style={{fontSize:12,color:T.tx3,textAlign:"center",padding:"16px 0"}}>No rules yet. Add one above to normalize merchant names.</div>
          :<div style={{display:"flex",flexDirection:"column",gap:6}}>
            {merchantNorms.map(n=>(
              <div key={n.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:T.r,background:T.overlay,border:"1px solid "+T.border}}>
                <div style={{fontSize:13,fontWeight:500,color:T.tx1}}>Contains <span style={{background:T.accentBg,color:T.accent,borderRadius:4,padding:"1px 6px",fontWeight:600}}>{n.pattern}</span></div>
                <div style={{fontSize:13,color:T.tx2}}>→ <span style={{fontWeight:600,color:T.tx1}}>{n.replacement}</span></div>
                <button onClick={()=>delNorm(n.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:T.r,padding:"3px 10px",cursor:"pointer",fontSize:11,color:T.red,fontFamily:"inherit"}}>Remove</button>
              </div>
            ))}
          </div>
        }
      </div>
    </div>
  );
}


export { IconPicker, Categories };

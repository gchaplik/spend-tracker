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

const MEMBER_COLORS=["#0284C7","#7C3AED","#059669","#D97706","#DB2777","#0891B2"];
const MEMBER_AVATARS=["A","B","C","D","E","F","G","H","I","J"];

function Household({members,onSaveMembers,txns,onSaveTxns,splits,onSaveSplits,settlements,onSaveSettlements}){
  const [tab,setTab]=useState("members"); // members | splits | balances
  const [form,setForm]=useState({name:"",avatar:"",color:MEMBER_COLORS[0],monthlyIncome:""});
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState({});
  const setF=(k,v)=>setForm(p=>({...p,[k]:v}));
  const setEF=(k,v)=>setEditForm(p=>({...p,[k]:v}));

  const addMember=()=>{
    if(!form.name.trim()) return;
    const usedColors=members.map(m=>m.color);
    const nextColor=MEMBER_COLORS.find(c=>!usedColors.includes(c))||MEMBER_COLORS[members.length%MEMBER_COLORS.length];
    onSaveMembers([...members,{id:uid(),name:form.name.trim(),avatar:form.avatar,color:form.color||nextColor,monthlyIncome:parseFloat(form.monthlyIncome)||0,joinedDate:today()}]);
    setForm({name:"",avatar:"",color:nextColor,monthlyIncome:""});
  };
  const removeMember=id=>onSaveMembers(members.filter(m=>m.id!==id));
  const startEdit=m=>{setEditId(m.id);setEditForm({name:m.name,avatar:m.avatar,color:m.color,monthlyIncome:String(m.monthlyIncome||"")});};
  const saveEdit=()=>{
    onSaveMembers(members.map(m=>m.id===editId?{...m,name:editForm.name.trim()||m.name,avatar:editForm.avatar,color:editForm.color,monthlyIncome:parseFloat(editForm.monthlyIncome)||0}:m));
    setEditId(null);
  };

  const totalIncome=members.reduce((s,m)=>s+m.monthlyIncome,0);
  const incomePct=m=>totalIncome>0?+(m.monthlyIncome/totalIncome*100).toFixed(1):+(100/members.length).toFixed(1);

  // ── Split helpers ──────────────────────────────────────────────────────────
  const getSplit=id=>splits[id]||null;
  const txnMember=t=>t.assignedTo?members.find(m=>m.id===t.assignedTo):null;

  // Compute balances: shared expenses where each member paid different amounts
  const month=today().slice(0,7);
  const sharedTxns=txns.filter(t=>splits[t.id]&&splits[t.id].type!=="assigned"&&t.date&&t.date.startsWith(month));
  // For each shared txn: member who "paid" is assignedTo; others owe their split share
  const balances={};
  members.forEach(m=>{balances[m.id]=0;});
  sharedTxns.forEach(t=>{
    const sp=splits[t.id];
    if(!sp||!sp.payer) return;
    sp.shares.forEach(sh=>{
      if(sh.memberId===sp.payer) return; // payer doesn't owe themselves
      balances[sh.memberId]=(balances[sh.memberId]||0)-sh.amount; // owes payer
      balances[sp.payer]=(balances[sp.payer]||0)+sh.amount;       // is owed by them
    });
  });
  // Settle: already-settled amounts
  settlements.filter(s=>s.date&&s.date.startsWith(month)).forEach(s=>{
    balances[s.fromMemberId]=(balances[s.fromMemberId]||0)+s.amount;
    balances[s.toMemberId]=(balances[s.toMemberId]||0)-s.amount;
  });

  const [settleForm,setSettleForm]=useState({from:"",to:"",amount:"",note:""});
  const addSettlement=()=>{
    if(!settleForm.from||!settleForm.to||!settleForm.amount) return;
    onSaveSettlements([...settlements,{id:uid(),fromMemberId:settleForm.from,toMemberId:settleForm.to,amount:parseFloat(settleForm.amount)||0,date:today(),note:settleForm.note}]);
    setSettleForm({from:"",to:"",amount:"",note:""});
  };

  const tabBtn=(k,l)=><button onClick={()=>setTab(k)} style={{padding:"7px 18px",borderRadius:8,border:"none",background:tab===k?"#0284C7":"transparent",color:tab===k?"#fff":"#64748b",fontWeight:tab===k?700:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>;

  return(
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Household</h2>
      <div style={{display:"flex",gap:4,marginBottom:20,background:"#f8fafc",borderRadius:10,padding:4,width:"fit-content"}}>
        {tabBtn("members","Members")}{tabBtn("splits","Split Transactions")}{tabBtn("balances","Balances")}
      </div>

      {tab==="members"&&(
        <div>
          {/* Member cards */}
          {members.length>0&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:14,marginBottom:20}}>
              {members.map(m=>(
                <div key={m.id} style={{...CA,borderTop:`3px solid ${m.color}`}}>
                  {editId===m.id?(
                    <div>
                      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                        {MEMBER_AVATARS.map(a=><button key={a} onClick={()=>setEF("avatar",a)} style={{fontSize:20,background:editForm.avatar===a?"#f0f9ff":"transparent",border:`2px solid ${editForm.avatar===a?"#0284C7":"transparent"}`,borderRadius:8,padding:4,cursor:"pointer"}}>{a}</button>)}
                      </div>
                      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                        {MEMBER_COLORS.map(c=><button key={c} onClick={()=>setEF("color",c)} style={{width:22,height:22,borderRadius:"50%",background:c,border:`3px solid ${editForm.color===c?"#1e293b":"transparent"}`,cursor:"pointer"}}/>)}
                      </div>
                      <input style={{...IS,marginBottom:8}} value={editForm.name} onChange={e=>setEF("name",e.target.value)} placeholder="Name"/>
                      <input style={{...IS,marginBottom:10}} type="number" value={editForm.monthlyIncome} onChange={e=>setEF("monthlyIncome",e.target.value)} placeholder="Monthly income ($)"/>
                      <div style={{display:"flex",gap:8}}><Btn sm onClick={saveEdit} disabled={!editForm.name.trim()}>Save</Btn><Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn></div>
                    </div>
                  ):(
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                        <div style={{width:40,height:40,borderRadius:"50%",background:m.color+"22",border:`2px solid ${m.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{m.avatar}</div>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:15,color:"#1e293b"}}>{m.name}</div>
                          <div style={{fontSize:11,color:"#94a3b8"}}>Joined {m.joinedDate}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <span style={{fontSize:12,color:"#64748b"}}>Monthly income</span>
                        <span style={{fontSize:13,fontWeight:700,color:"#1e293b"}}>{m.monthlyIncome>0?nfmt(m.monthlyIncome):"Not set"}</span>
                      </div>
                      {totalIncome>0&&m.monthlyIncome>0&&(
                        <div style={{marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <span style={{fontSize:11,color:"#94a3b8"}}>Income share</span>
                            <span style={{fontSize:11,fontWeight:600,color:m.color}}>{incomePct(m)}%</span>
                          </div>
                          <div style={{height:5,borderRadius:99,background:"#f1f5f9"}}><div style={{height:"100%",borderRadius:99,width:incomePct(m)+"%",background:m.color}}/></div>
                        </div>
                      )}
                      <div style={{display:"flex",gap:6}}><Btn sm onClick={()=>startEdit(m)}>Edit</Btn><Btn sm v="danger" onClick={()=>removeMember(m.id)}>Remove</Btn></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Add member form */}
          <div style={CA}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1e293b"}}>Add Household Member</div>
            <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
              {MEMBER_AVATARS.map(a=><button key={a} onClick={()=>setF("avatar",a)} style={{fontSize:20,background:form.avatar===a?"#f0f9ff":"transparent",border:`2px solid ${form.avatar===a?"#0284C7":"transparent"}`,borderRadius:8,padding:4,cursor:"pointer"}}>{a}</button>)}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
              {MEMBER_COLORS.map(c=><button key={c} onClick={()=>setF("color",c)} style={{width:22,height:22,borderRadius:"50%",background:c,border:`3px solid ${form.color===c?"#1e293b":"transparent"}`,cursor:"pointer"}}/>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <Fld label="Name"><input style={IS} value={form.name} onChange={e=>setF("name",e.target.value)} placeholder="e.g. Alex, Jordan"/></Fld>
              <Fld label="Monthly Income ($)"><input style={IS} type="number" value={form.monthlyIncome} onChange={e=>setF("monthlyIncome",e.target.value)} placeholder="0.00"/></Fld>
            </div>
            <Btn onClick={addMember} disabled={!form.name.trim()} full>Add Member</Btn>
          </div>
          {/* Household income summary */}
          {members.length>1&&totalIncome>0&&(
            <div style={{...CA,marginTop:14}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1e293b"}}>Household Income Split</div>
              <div style={{display:"flex",height:16,borderRadius:99,overflow:"hidden",marginBottom:10}}>
                {members.filter(m=>m.monthlyIncome>0).map(m=><div key={m.id} style={{flex:m.monthlyIncome,background:m.color}} title={`${m.name}: ${incomePct(m)}%`}/>)}
              </div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                {members.map(m=>(
                  <div key={m.id} style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:m.color,flexShrink:0}}/>
                    <span style={{fontSize:12,color:"#64748b"}}>{m.name}: <strong style={{color:"#1e293b"}}>{incomePct(m)}%</strong>{m.monthlyIncome>0?` (${nfmt(m.monthlyIncome)}/mo)`:""}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,fontSize:12,color:"#94a3b8"}}>Combined household income: <strong style={{color:"#1e293b"}}>{nfmt(totalIncome)}/mo</strong></div>
            </div>
          )}
        </div>
      )}

      {tab==="splits"&&(
        <SplitTransactions txns={txns} members={members} splits={splits} onSaveSplits={onSaveSplits}/>
      )}

      {tab==="balances"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:14,marginBottom:20}}>
            {members.map(m=>{
              const bal=balances[m.id]||0;
              return(
                <div key={m.id} style={{...CA,borderTop:`3px solid ${m.color}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:m.color+"22",border:`2px solid ${m.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{m.avatar}</div>
                    <span style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{m.name}</span>
                  </div>
                  <div style={{fontSize:22,fontWeight:800,color:bal>0?"#059669":bal<0?"#dc2626":"#94a3b8",letterSpacing:"-0.5px"}}>{bal>0?"+":""}{nfmt(bal)}</div>
                  <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>{bal>0?"is owed this month":bal<0?"owes this month":"settled up"}</div>
                </div>
              );
            })}
          </div>
          {members.length>=2&&(
            <div style={CA}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#1e293b"}}>Log Settlement</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <Fld label="From">
                  <select style={{...IS,background:"#fff"}} value={settleForm.from} onChange={e=>setSettleForm(p=>({...p,from:e.target.value}))}>
                    <option value="">Select member</option>
                    {members.map(m=><option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
                  </select>
                </Fld>
                <Fld label="To">
                  <select style={{...IS,background:"#fff"}} value={settleForm.to} onChange={e=>setSettleForm(p=>({...p,to:e.target.value}))}>
                    <option value="">Select member</option>
                    {members.filter(m=>m.id!==settleForm.from).map(m=><option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
                  </select>
                </Fld>
                <Fld label="Amount ($)"><input style={IS} type="number" value={settleForm.amount} onChange={e=>setSettleForm(p=>({...p,amount:e.target.value}))}/></Fld>
                <Fld label="Note (optional)"><input style={IS} value={settleForm.note} onChange={e=>setSettleForm(p=>({...p,note:e.target.value}))} placeholder="e.g. e-transfer"/></Fld>
              </div>
              <Btn onClick={addSettlement} disabled={!settleForm.from||!settleForm.to||!settleForm.amount} full>Record Settlement</Btn>
            </div>
          )}
          {settlements.length>0&&(
            <div style={{...CA,marginTop:14}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1e293b"}}>Settlement History</div>
              {[...settlements].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20).map(s=>{
                const from=members.find(m=>m.id===s.fromMemberId);
                const to=members.find(m=>m.id===s.toMemberId);
                if(!from||!to) return null;
                return(
                  <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid #f8fafc"}}>
                    <span style={{fontSize:13}}>{from.avatar} <strong>{from.name}</strong> → {to.avatar} <strong>{to.name}</strong></span>
                    <span style={{flex:1,fontSize:11,color:"#94a3b8"}}>{s.date}{s.note?" · "+s.note:""}</span>
                    <span style={{fontWeight:700,fontSize:13,color:"#059669"}}>{nfmt(s.amount)}</span>
                    <button onClick={()=>onSaveSettlements(settlements.filter(x=>x.id!==s.id))} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"2px 7px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SplitTransactions({txns,members,splits,onSaveSplits}){
  const [search,setSearch]=useState("");
  const [splitModal,setSplitModal]=useState(null); // txn being split
  const [splitType,setSplitType]=useState("equal"); // equal | proportional | custom
  const [customShares,setCustomShares]=useState({});
  const [payer,setPayer]=useState("");

  const expenses=txns.filter(t=>t.type==="expense"&&(!search||((t.merchant||"")+" "+(t.category||"")).toLowerCase().includes(search.toLowerCase()))).slice(0,100);
  const totalIncome=members.reduce((s,m)=>s+m.monthlyIncome,0);

  const openSplit=t=>{
    setSplitModal(t);
    const sp=splits[t.id];
    setSplitType(sp?.type||"equal");
    setPayer(sp?.payer||members[0]?.id||"");
    if(sp?.type==="custom"){
      const map={};sp.shares.forEach(s=>{map[s.memberId]=String(s.amount);});setCustomShares(map);
    } else {
      setCustomShares({});
    }
  };
  const closeSplit=()=>setSplitModal(null);

  const computeShares=(t,type)=>{
    if(!t||members.length===0) return[];
    const amt=t.amount;
    if(type==="equal"){
      const each=+(amt/members.length).toFixed(2);
      const remainder=+(amt-each*(members.length-1)).toFixed(2);
      return members.map((m,i)=>({memberId:m.id,amount:i===members.length-1?remainder:each,pct:+(100/members.length).toFixed(1)}));
    }
    if(type==="proportional"&&totalIncome>0){
      let used=0;
      return members.map((m,i)=>{
        const pct=totalIncome>0?m.monthlyIncome/totalIncome:1/members.length;
        const share=i===members.length-1?+(amt-used).toFixed(2):+(amt*pct).toFixed(2);
        used+=share;
        return{memberId:m.id,amount:share,pct:+(pct*100).toFixed(1)};
      });
    }
    if(type==="custom"){
      return members.map(m=>({memberId:m.id,amount:parseFloat(customShares[m.id])||0,pct:+((parseFloat(customShares[m.id])||0)/amt*100).toFixed(1)}));
    }
    return[];
  };

  const saveSplit=()=>{
    if(!splitModal) return;
    const shares=computeShares(splitModal,splitType);
    onSaveSplits({...splits,[splitModal.id]:{type:splitType,payer,shares}});
    closeSplit();
  };
  const clearSplit=id=>{const n={...splits};delete n[id];onSaveSplits(n);};

  const shares=splitModal?computeShares(splitModal,splitType):[];
  const customTotal=Object.values(customShares).reduce((s,v)=>s+(parseFloat(v)||0),0);

  return(
    <div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search expenses…" style={{...IS,marginBottom:14,borderRadius:10}}/>
      {members.length<2&&<div style={{...CA,color:"#94a3b8",fontSize:13}}>Add at least 2 household members to split transactions.</div>}
      {members.length>=2&&(
        <div style={CA}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:"#1e293b"}}>Expense Transactions</div>
          {expenses.length===0&&<div style={{color:"#94a3b8",fontSize:13}}>No expenses found.</div>}
          {expenses.map(t=>{
            const sp=splits[t.id];
            const payerMember=sp?members.find(m=>m.id===sp.payer):null;
            return(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f8fafc",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:160}}>
                  <div style={{fontSize:13,fontWeight:500}}>{t.merchant||t.source}</div>
                  <div style={{fontSize:11,color:"#94a3b8"}}>{t.date} · {t.category||"Uncategorized"}</div>
                  {sp&&(
                    <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                      {sp.shares.map(sh=>{const m=members.find(x=>x.id===sh.memberId);return m?<span key={sh.memberId} style={{fontSize:10,padding:"1px 6px",borderRadius:99,background:m.color+"22",color:m.color,fontWeight:600,border:`1px solid ${m.color}44`}}>{m.name}: {nfmt(sh.amount)}</span>:null;})}
                      {payerMember&&<span style={{fontSize:10,color:"#94a3b8",padding:"1px 6px"}}>paid by {payerMember.name}</span>}
                    </div>
                  )}
                </div>
                <div style={{fontWeight:700,fontSize:13,color:"#dc2626"}}>{nfmt(t.amount)}</div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>openSplit(t)} style={{background:sp?"#f0fdf4":"#f0f9ff",border:`1px solid ${sp?"#86efac":"#7dd3fc"}`,borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:11,color:sp?"#15803d":"#0284C7",fontFamily:"inherit",fontWeight:600}}>{sp?"Edit Split":"Split"}</button>
                  {sp&&<button onClick={()=>clearSplit(t.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:6,padding:"3px 7px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Split modal */}
      {splitModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:440,boxShadow:"0 20px 60px rgba(0,0,0,0.18)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:"#1e293b"}}>{splitModal.merchant}</div>
                <div style={{fontSize:13,color:"#94a3b8"}}>{nfmt(splitModal.amount)} · {splitModal.date}</div>
              </div>
              <button onClick={closeSplit} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8",fontFamily:"inherit",lineHeight:1}}>×</button>
            </div>
            {/* Split type */}
            <div style={{display:"flex",gap:6,marginBottom:16}}>
              {[["equal","Equal"],["proportional","By Income"],["custom","Custom"]].map(([v,l])=>(
                <button key={v} onClick={()=>setSplitType(v)} style={{flex:1,padding:"7px 0",borderRadius:8,border:`2px solid ${splitType===v?"#0284C7":"#e2e8f0"}`,background:splitType===v?"#f0f9ff":"#fff",color:splitType===v?"#0284C7":"#64748b",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  {l}
                </button>
              ))}
            </div>
            {splitType==="proportional"&&totalIncome===0&&<div style={{fontSize:12,color:"#f59e0b",marginBottom:10,background:"#fffbeb",padding:"8px 12px",borderRadius:8,border:"1px solid #fde68a"}}>Set monthly incomes on member cards to use proportional split.</div>}
            {/* Who paid */}
            <Fld label="Who paid?" style={{marginBottom:14}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {members.map(m=>(
                  <button key={m.id} onClick={()=>setPayer(m.id)} style={{padding:"6px 12px",borderRadius:8,border:`2px solid ${payer===m.id?m.color:"#e2e8f0"}`,background:payer===m.id?m.color+"22":"#fff",color:payer===m.id?m.color:"#64748b",fontWeight:payer===m.id?700:400,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                    {m.avatar} {m.name}
                  </button>
                ))}
              </div>
            </Fld>
            {/* Share preview / custom inputs */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Split Breakdown</div>
              {members.map((m,i)=>{
                const sh=shares.find(s=>s.memberId===m.id);
                return(
                  <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:m.color+"22",border:`2px solid ${m.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{m.avatar}</div>
                    <span style={{fontSize:13,fontWeight:500,flex:1,color:"#1e293b"}}>{m.name}</span>
                    {splitType==="custom"?(
                      <input type="number" value={customShares[m.id]||""} onChange={e=>setCustomShares(p=>({...p,[m.id]:e.target.value}))} style={{...IS,width:90,padding:"5px 8px",fontSize:13}} placeholder="0.00"/>
                    ):(
                      <span style={{fontSize:14,fontWeight:700,color:m.color}}>{sh?nfmt(sh.amount):"-"}</span>
                    )}
                    {splitType!=="custom"&&sh&&<span style={{fontSize:11,color:"#94a3b8",width:36,textAlign:"right"}}>{sh.pct}%</span>}
                  </div>
                );
              })}
              {splitType==="custom"&&(
                <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderTop:"1px solid #f1f5f9",fontSize:12}}>
                  <span style={{color:"#64748b"}}>Total assigned</span>
                  <span style={{fontWeight:700,color:Math.abs(customTotal-splitModal.amount)<0.02?"#059669":"#dc2626"}}>{nfmt(customTotal)} / {nfmt(splitModal.amount)}</span>
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={saveSplit} full disabled={!payer||(splitType==="proportional"&&totalIncome===0)||(splitType==="custom"&&Math.abs(customTotal-splitModal.amount)>=0.02)}>Save Split</Btn>
              <Btn v="secondary" onClick={closeSplit}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export { Household, SplitTransactions, MEMBER_COLORS, MEMBER_AVATARS };

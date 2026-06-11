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
import { DepthCtx, SelectableWrapper } from "../../components/SelectableWrapper.jsx";
import { InsightWidget, RenderMD, fmtLabel, detectChartType, autoWidget, parseToolCalls } from "./utils.jsx";
import { TOOL_LIBRARY, buildSchemaQuery, schemaToTools, execTool, extractFacts, buildToolSummary, quickNavFastPath, DOMAIN_PATTERNS, classifyQuery } from "./toolLibrary.js";
import { DEFAULT_SCHEMA } from "./schema.js";

// ── SSE stream reader ─────────────────────────────────────────────────────────
async function streamSSE(response, onChunk, extractText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return full;
        try {
          const obj = JSON.parse(payload);
          const text = extractText(obj);
          if (text) { onChunk(text); full += text; }
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}

// ── Message bubble with tool pills ───────────────────────────────────────────
function MsgBubble({m,T,streaming=false,onPin,isPinned=false}){
  const [pillsOpen,setPillsOpen]=useState(false);
  const [pinHover,setPinHover]=useState(false);
  const isUser=m.role==="user";
  const hasCalls=m.toolCalls&&m.toolCalls.length>0;
  const hasWidgets=m.widgets&&m.widgets.length>0;

  const fmtCurrency=v=>"$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const renderWidget=(w)=>{
    if(!w) return null;
    if(w.type==="metric") return (
      <div style={{background:T.accentBg,border:"1px solid "+T.accentMid+"44",borderRadius:T.rCard,padding:"14px 18px",marginTop:6}}>
        <div style={{fontSize:11,color:T.tx3,fontWeight:500,marginBottom:4}}>{w.title}</div>
        <div style={{fontSize:28,fontWeight:700,color:T.accent,lineHeight:1,letterSpacing:"-0.5px"}}>{w.format==="currency"?fmtCurrency(w.value):w.value}</div>
        {w.subtitle&&<div style={{fontSize:11,color:T.tx3,marginTop:5}}>{w.subtitle}</div>}
        {w.label&&<div style={{fontSize:11,color:T.tx3,marginTop:4}}>{w.label}</div>}
      </div>
    );
    const rows=w.rows||(w.data?.map(d=>[d.name,d.value]))||[];
    const cols=w.columns||["Name","Value"];
    if(!rows.length) return null;
    return (
      <div style={{marginTop:6,overflowX:"auto",borderRadius:8,border:"1px solid #e2e8f0"}}>
        <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
          <thead><tr>{cols.map(c=><th key={c} style={{textAlign:"left",padding:"6px 10px",color:"#64748b",borderBottom:"1px solid #e2e8f0",fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",background:"#f8fafc"}}>{c}</th>)}</tr></thead>
          <tbody>{rows.slice(0,8).map((row,i)=><tr key={i} style={{borderBottom:i<rows.length-1?"1px solid #f1f5f9":""}}>{(Array.isArray(row)?row:[row]).map((cell,j)=><td key={j} style={{padding:"5px 10px",color:"#1e293b"}}>{typeof cell==="number"?fmtCurrency(cell):cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:isUser?"flex-end":"flex-start",gap:4}}>
      {m.items?.length>0&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:4,justifyContent:isUser?"flex-end":"flex-start"}}>
          {m.items.map(it=><span key={it.id} style={{background:"#eff6ff",border:"1px solid #bae6fd",color:"#0369a1",fontSize:10,padding:"2px 8px",borderRadius:12,fontWeight:500}}>{it.label}</span>)}
        </div>
      )}
      <div style={{maxWidth:"88%",background:isUser?T.accent:T.overlay,color:isUser?"#fff":T.tx1,padding:"9px 13px",borderRadius:isUser?"14px 14px 2px 14px":"14px 14px 14px 2px",fontSize:12,lineHeight:1.55,wordBreak:"break-word"}}>
        {m.text}{streaming&&<span style={{display:"inline-block",width:2,height:"0.85em",background:"currentColor",marginLeft:2,verticalAlign:"text-bottom",animation:"jarvisCursor .7s step-end infinite"}}/>}
        {hasCalls&&(
          <div style={{marginTop:6}}>
            <button onClick={()=>setPillsOpen(p=>!p)} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:4,color:isUser?"rgba(255,255,255,0.7)":T.tx3,fontSize:10,fontFamily:"inherit"}}>
              <span>{pillsOpen?"▲":"▼"}</span>
              <span>{m.toolCalls.map(t=>t.name).join(", ")}</span>
            </button>
          </div>
        )}
        {!isUser&&onPin&&m._question&&(
          <button
            onMouseEnter={()=>setPinHover(true)} onMouseLeave={()=>setPinHover(false)}
            onClick={()=>onPin(m._question,isPinned)}
            title={isPinned?"Unpin this query":"Pin this query for quick access"}
            style={{marginTop:4,background:"none",border:"none",cursor:"pointer",padding:0,fontSize:11,color:isPinned||pinHover?T.accent:T.tx3,fontFamily:"inherit",display:"flex",alignItems:"center",gap:2,transition:"color .15s"}}
          >{isPinned?"📌 Pinned":"📍 Pin"}</button>
        )}
      </div>
      {hasCalls&&pillsOpen&&(
        <div style={{maxWidth:"88%",display:"flex",gap:4,flexWrap:"wrap",paddingLeft:4}}>
          {m.toolCalls.map((t,i)=>(
            <span key={i} style={{fontSize:10,fontWeight:600,background:T.accentBg,color:T.accent,padding:"2px 8px",borderRadius:99,border:"1px solid "+T.accentMid}}>{t.name}</span>
          ))}
        </div>
      )}
      {hasWidgets&&(
        <div style={{maxWidth:"100%",width:"88%",alignSelf:isUser?"flex-end":"flex-start",display:"flex",flexDirection:"column",gap:6}}>
          {m.widgets.map((w,i)=><div key={i}>{renderWidget(w)}</div>)}
        </div>
      )}
    </div>
  );
}

// ── Global Chat FAB + slide-up panel ─────────────────────────────────────────
function GlobalChat({view,onNavigate,settings,schema,inDepthMode,onSetInDepthMode,selectedItems,onSetSelectedItems,open,onSetOpen,discreteMode,alerts=[],onSaveSettings}){
  const [input,setInput]=useState("");
  const [messages,setMessages]=useState(()=>{
    try{const s=JSON.parse(localStorage.getItem("ch_jarvis_msgs")||"null");return Array.isArray(s)?s:[];}catch{return[];}
  });
  const [loading,setLoading]=useState(false);
  const [toolsRunning,setToolsRunning]=useState([]);
  const [listening,setListening]=useState(false);
  const [speaking,setSpeaking]=useState(false);
  const [streamingText,setStreamingText]=useState(null); // null=idle, string=streaming
  const [streamingWidgets,setStreamingWidgets]=useState([]);
  const msgsEndRef=useRef(null);
  const inputRef=useRef(null);
  const hasGreeted=useRef(false);

  useEffect(()=>{msgsEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading,streamingText]);
  useEffect(()=>{if(open) setTimeout(()=>inputRef.current?.focus(),100);},[open]);
  // Persist history (capped at 50 messages)
  useEffect(()=>{try{localStorage.setItem("ch_jarvis_msgs",JSON.stringify(messages.slice(-50)));}catch{}},[messages]);

  // First-open greeting: proactive alerts + pinned query auto-run
  useEffect(()=>{
    if(!open||hasGreeted.current) return;
    hasGreeted.current=true;
    const greetMsgs=[];
    const activeAlerts=(alerts||[]).filter(a=>!a.dismissed);
    if(activeAlerts.length){
      const high=activeAlerts.filter(a=>a.severity==="high");
      const med=activeAlerts.filter(a=>a.severity==="medium");
      const parts=[];
      if(high.length) parts.push(`${high.length} urgent: ${high.map(a=>a.title).join("; ")}`);
      if(med.length) parts.push(`${med.length} pending: ${med.map(a=>a.title).join("; ")}`);
      greetMsgs.push({role:"assistant",text:"⚠ "+parts.join(" — ")+".",toolCalls:[],widgets:[]});
    }
    if(greetMsgs.length) setMessages(p=>[...p,...greetMsgs]);
    // Auto-run pinned queries when on dashboard
    if(view==="dashboard"){
      const pins=(settings?.pinnedQueries||[]).slice(0,3);
      pins.forEach((q,i)=>setTimeout(()=>sendText(q.question,false),greetMsgs.length*200+i*300+100));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open]);

  const TODAY=new Date().toISOString().slice(0,10);

  // ── Base system prompt ────────────────────────────────────────────────────
  const sysPrompt=`You are Jarvis, a sharp financial AI. Speak like Jarvis from Iron Man: concise, precise, no pleasantries.
RULES: Call tool(s) before answering any data question. NEVER invent numbers. No preamble, no sign-off.
TODAY: ${TODAY}

IMPORTANT — tool call format. You MUST use EXACTLY this format, nothing else:
<tool>{"name":"TOOLNAME","args":{"param":"value"}}</tool>

EXAMPLES:
<tool>{"name":"expenses","args":{"filter":"thismonth"}}</tool>
<tool>{"name":"expenses","args":{"filter":"thismonth","groupBy":"category"}}</tool>
<tool>{"name":"bills","args":{"status":"due"}}</tool>

TOOLS: expenses(filter?,groupBy?,aggregate?), income(filter?,groupBy?), net(filter?,groupBy?), budget(filter?,metric?)[metric:summary|proximity|over|remaining|utilization|targets], bills(filter?,status?,name?)[status:all|due|paid|overdue|history|total], goals(metric?,name?)[metric:progress|timeline|on_track|detail], net_worth(metric?,months?)[metric:current|trend|change|by_type|accounts], debts(metric?,type?)[metric:summary|interest|total], subscriptions(groupBy?,metric?), detect_subscriptions()[finds recurring charges from transaction history], vacations(name?,metric?)[metric:list|spending|txns|biggest|merchants], portfolio(metric?,ticker?)[metric:summary|detail|gain], expected_income(filter?,metric?)[metric:pending|confirmed|recurring|all|total], tax(year?,metric?), wishlist(metric?), household(metric?), trend(metric,months?)[metric:expenses|income|net|savings_rate], compare(metric,month1,month2), savings_rate(filter?), runway(), spending_anomalies(filter?), health_score(), cashflow_projection(days?), sql_query(sql), navigate(tab)
FILTER SYNTAX: thismonth | last30days | last3months | thisyear | month=YYYY-MM | year=YYYY | category=X | merchant=X | amount>N
TABS: dashboard, history, bills, stocks, networth, settings, expected, categories, vacations, goals`;

  // ── LLM call — onChunk enables token-by-token streaming ──────────────────
  const callLLM=async(msgs,sys,onChunk=null)=>{
    const prompt=sys||sysPrompt;
    const model=settings?.globalChatModel||"openrouter";
    if(model==="gemini"){
      const r=await fetch("/api/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:prompt}]},contents:msgs.map(m=>({role:m.role==="assistant"?"model":m.role,parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:512}})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error?.message||"Gemini error");
      const text=d.candidates?.[0]?.content?.parts?.[0]?.text||"No response.";
      if(onChunk) onChunk(text);
      return text;
    } else if(model==="openrouter"){
      const orKey=settings?.openrouterKey||"";
      const orModel=settings?.openrouterModel||"moonshotai/kimi-k2";
      if(!orKey) throw new Error("OpenRouter API key not set — add it in Settings → AI → OpenRouter");
      const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+orKey,"HTTP-Referer":"https://cashheap.app","X-Title":"CashHeap Jarvis"},
        body:JSON.stringify({model:orModel,messages:[{role:"system",content:prompt},...msgs],max_tokens:512,stream:!!onChunk})
      });
      if(!r.ok){const d=await r.json();throw new Error(d.error?.message||"OpenRouter error");}
      if(onChunk) return await streamSSE(r,onChunk,c=>c.choices?.[0]?.delta?.content||"");
      const d=await r.json();
      if(!r.ok) throw new Error(d.error?.message||"OpenRouter error");
      const raw=d.choices?.[0]?.message?.content||"No response.";
      return raw.replace(/<think>[\s\S]*?<\/think>/gi,"").trim()||"No response.";
    } else if(model==="deepseek"){
      const dsModel=settings?.deepseekModel||"deepseek-r1:8b";
      const r=await fetch("/api/llm/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:dsModel,messages:[{role:"system",content:prompt},...msgs],stream:!!onChunk})});
      if(onChunk) return await streamSSE(r,onChunk,c=>c.content||"");
      const d=await r.json();
      if(d.error) throw new Error(d.error);
      const raw=d.message?.content||"";
      return raw.replace(/<think>[\s\S]*?<\/think>/gi,"").trim()||"No response.";
    } else {
      const r=await fetch("/api/llm/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:settings?.ollamaModel||"phi3:mini",messages:[{role:"system",content:prompt},...msgs],stream:!!onChunk})});
      if(onChunk) return await streamSSE(r,onChunk,c=>c.content||"");
      const d=await r.json();
      return d.message?.content||"No response.";
    }
  };

  // ── Execute a single named tool ───────────────────────────────────────────
  // execTool — runs a named TOOL_LIBRARY function or a pre-built __SQL__: marker.
  // Pass prebuiltMarker to skip TOOL_LIBRARY lookup (used by schema-driven dispatch).
  const execTool=async(name,args={},prebuiltMarker=null)=>{
    try{
      const fn=TOOL_LIBRARY[name];
      const marker=prebuiltMarker||(fn?fn(args):null);
      if(!marker||typeof marker!=="string") return null;
      // JS-computed special markers — return as-is for synthesis to describe
      if(marker==="__HEALTH_SCORE__"||marker.startsWith("__CASHFLOW__:")) return marker;
      if(!marker.startsWith("__SQL__:")) return null;
      const{sql,params}=JSON.parse(marker.slice(8));
      const r=await fetch("/api/db/sql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sql,params})});
      const d=await r.json();
      if(d.error) return null;
      // Single scalar: {value, count} → return the scalar
      if(d.rows?.length===1&&d.columns?.length===1) return d.rows[0][d.columns[0]];
      return d.rows;
    }catch(e){return null;}
  };

  // ── Domain classifier — detects single vs multi-tool questions ────────────
  const DOMAIN_PATTERNS={
    expenses:      /\b(spend|spent|expense|expenses|spending|cost|costs|purchase|bought|transaction|charged?)\b/i,
    income:        /\b(income|earn|earned|salary|paycheck|revenue|received|deposit|pay(ment)?)\b/i,
    bills:         /\b(bill|bills|utilities|rent|due|overdue|monthly payment)\b/i,
    budget:        /\b(budget|budgets|over budget|allowance|spending limit)\b/i,
    goals:         /\b(goal|goals|saving for|savings goal|target amount|milestone)\b/i,
    debt:          /\b(debt|debts|loan|loans|credit card|owe|owed|interest rate|borrow)\b/i,
    subscriptions: /\b(subscription|subscriptions|recurring charge|netflix|spotify)\b/i,
    vacations:     /\b(vacation|vacations|trip|trips|travel|holiday)\b/i,
    portfolio:     /\b(portfolio|stock|stocks|holding|holdings|investment|investments|ticker|shares|etf)\b/i,
    net_worth:     /\b(net worth|assets|liabilities|total accounts?|balance sheet)\b/i,
    tax:           /\b(tax|taxes|deductible|rrsp|tfsa|write.?off)\b/i,
    wishlist:      /\b(wishlist|wish list|want to buy|planning to buy)\b/i,
    cashflow:      /\b(cash flow|cashflow|upcoming|forecast|next \d+ days?|runway)\b/i,
    household:     /\b(household|house members?|splits?|who owes|settle up)\b/i,
  };
  // Domain pairs that look multi but map cleanly to one tool
  const SINGLE_OVERRIDES=[
    new Set(["expenses","budget"]),  // "am I over budget" → budget tool
    new Set(["income","expenses"]),  // "income vs expenses" → net tool
  ];
  const CONJUNCTION_RE=/\b(and|also|as well|plus|alongside|both|in addition|while also|together with)\b/i;

  const classifyQuery=(text)=>{
    const domains=[...new Set(
      Object.entries(DOMAIN_PATTERNS)
        .filter(([,re])=>re.test(text))
        .map(([k])=>k)
    )];
    if(domains.length<=1) return{multi:false,domains};
    const hasConj=CONJUNCTION_RE.test(text);
    if(domains.length>=3) return{multi:true,domains};
    if(domains.length===2){
      const pair=new Set(domains);
      const isOverride=SINGLE_OVERRIDES.some(ov=>[...ov].every(d=>pair.has(d)));
      if(isOverride&&!hasConj) return{multi:false,domains};
      if(hasConj) return{multi:true,domains};
    }
    return{multi:false,domains};
  };

  // ── Parse all <tool> tags from LLM response (returns array, capped at 3) ──
  // Try to parse JSON even if the model hallucinated extra closing braces
  const tryParseJSON=(raw)=>{
    const s=raw.trim();
    try{return JSON.parse(s);}catch{}
    // Strip trailing extra } or ] one at a time until it parses
    let t=s;
    for(let i=0;i<5;i++){
      if(t.endsWith("}")) t=t.slice(0,-1).trimEnd(); else if(t.endsWith("]")) t=t.slice(0,-1).trimEnd(); else break;
      try{return JSON.parse(t);}catch{}
    }
    return null;
  };

  const parseToolCalls=(text)=>{
    const results=[];

    // Format 1: <tool>{"name":"...","args":{...}}</tool>
    for(const m of [...text.matchAll(/<tool>([\s\S]*?)<\/tool>/g)]){
      const d=tryParseJSON(m[1]);
      if(d?.name) results.push({name:d.name,args:d.args||d.arguments||{}});
    }
    if(results.length) return results.slice(0,3);

    // Format 2: <toolname><args><param>val</param>...</args></toolname>  (some small models)
    for(const toolName of Object.keys(TOOL_LIBRARY)){
      const re=new RegExp(`<${toolName}[^>]*>([\\s\\S]*?)<\\/${toolName}>|<${toolName}\\s*\\/>`,'gi');
      for(const m of [...text.matchAll(re)]){
        const inner=m[1]||'';
        const args={};
        for(const p of [...inner.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)]){
          const v=p[2].trim();
          args[p[1]]=isNaN(v)?v:Number(v);
        }
        // also parse nested <args> wrapper
        const argsInner=inner.match(/<args>([\s\S]*?)<\/args>/i)?.[1]||inner;
        for(const p of [...argsInner.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)]){
          const v=p[2].trim();
          args[p[1]]=isNaN(v)?v:Number(v);
        }
        results.push({name:toolName,args});
      }
    }
    if(results.length) return results.slice(0,3);

    // Format 3: ```json {...} ```
    for(const bm of [...text.matchAll(/```[a-z]*\s*(\{[\s\S]*?\})\s*```/g)]){
      const d=tryParseJSON(bm[1]);if(d?.name) results.push({name:d.name,args:d.args||{}});
    }
    if(results.length) return results.slice(0,3);

    // Format 4: bare inline JSON with "name" key
    for(const jm of [...text.matchAll(/(\{[^{}]*"name"\s*:[^{}]*\})/g)]){
      const d=tryParseJSON(jm[1]);if(d?.name&&TOOL_LIBRARY[d.name]) results.push({name:d.name,args:d.args||{}});
    }
    return results.slice(0,3);
  };

  // ── Synthesis — turns raw tool results into a natural answer ─────────────
  // Extract a flat list of {key, value} facts from tool results so the LLM
  // can only quote numbers that are literally present — no arithmetic, no inference.
  const extractFacts=(toolResults)=>{
    const facts=[];
    for(const {name,result} of toolResults){
      if(result===null||result===undefined) continue;
      if(typeof result==="number"||typeof result==="string"){
        facts.push({key:name, value:result});
      } else if(Array.isArray(result)){
        // Grouped rows: each row is a {name, value, count} object
        result.slice(0,20).forEach(row=>{
          if(row&&row.name!=null&&row.value!=null)
            facts.push({key:`${name}[${row.name}]`, value:row.value, count:row.count});
        });
        // Also add total
        const total=result.reduce((s,r)=>s+(typeof r?.value==="number"?r.value:0),0);
        if(total) facts.push({key:`${name}[TOTAL]`, value:+total.toFixed(2)});
      } else if(typeof result==="object"){
        // Single-row object like {value:722.68, count:17}
        Object.entries(result).forEach(([k,v])=>{
          if(typeof v==="number"||typeof v==="string") facts.push({key:`${name}.${k}`, value:v});
        });
      }
    }
    return facts;
  };

  const callSynthesis=async(question,toolResults,onChunk=null,history=[])=>{
    const facts=extractFacts(toolResults);
    if(!facts.length) return null; // no data → don't synthesize
    const factLines=facts.map(f=>`  ${f.key} = ${f.value}`).join("\n");
    const priorCtx=history.length
      ?"\n\nPRIOR CONVERSATION (last turns — for context/follow-ups only):\n"+
        history.slice(-10).map(m=>`${m.role==="user"?"User":"Jarvis"}: ${(m.content||"").slice(0,200)}`).join("\n")
      :"";
    const synthPrompt=`You are Jarvis. Answer ONLY using the exact values listed below — do NOT compute, round, add, or infer any number not explicitly listed.

FACTS FROM DATABASE:
${factLines}
${priorCtx}

User asked: "${question}"

Rules:
- Quote numbers verbatim from FACTS. If a fact says 722.68 you say 722.68, not ~$720 or $700.
- 1-2 sentences max. No preamble, no sign-off.
- If the FACTS don't contain enough info to answer, say "I don't have that data."`;
    // Build a set of known numeric values for post-validation
    const knownValues=new Set(facts.filter(f=>typeof f.value==="number").map(f=>f.value));
    // Helper: extract all numeric tokens from a string
    const extractNums=(s)=>[...s.matchAll(/[\d,]+(?:\.\d+)?/g)].map(m=>parseFloat(m[0].replace(/,/g,""))).filter(n=>!isNaN(n)&&n>0);

    let reply=null;
    try{ reply=await callLLM([{role:"user",content:"_"}],synthPrompt,onChunk); }catch(e){ reply=null; }

    if(reply){
      // Validate: every number in the reply must appear in our known facts (within 0.01)
      const replyNums=extractNums(reply);
      const hasInvented=replyNums.some(n=>{
        // Allow small integers (counts, ordinals like "1" or "2")
        if(n<100&&Number.isInteger(n)) return false;
        return![...knownValues].some(kv=>Math.abs(kv-n)<0.02);
      });
      if(hasInvented){
        // LLM made up a number — use deterministic fallback built from facts
        const mainFact=facts.find(f=>typeof f.value==="number"&&f.value>100)
          ||facts.find(f=>typeof f.value==="number");
        if(mainFact) return `${mainFact.key.replace(/[\[\]]/g,' ').trim()}: $${mainFact.value}`;
        return null;
      }
    }

    if(!reply){
      // LLM unavailable (no key, network error) — deterministic fallback from facts
      const keyFact=facts.find(f=>f.value!=null&&typeof f.value==="number");
      if(keyFact) return `${keyFact.key.replace(/[\[\]]/g,' ').trim()}: $${keyFact.value}`;
      return null;
    }
    return reply;
  };

  const curMonth=new Date().toISOString().slice(0,7);

  const NAV_TABS={
    dashboard:'dashboard',home:'dashboard',
    bills:'bills',bill:'bills',
    history:'history',transactions:'history',transaction:'history','spending history':'history',
    stocks:'stocks',stock:'stocks',portfolio:'stocks',holdings:'stocks',holding:'stocks',
    'net worth':'networth',networth:'networth',
    settings:'settings',setting:'settings',preferences:'settings',
    expected:'expected','expected income':'expected',
    categories:'categories',category:'categories',budget:'categories',budgets:'categories',
    vacations:'vacations',vacation:'vacations','vacation tab':'vacations',trips:'vacations',
    goals:'goals',goal:'goals','savings goals':'goals',
    insights:'insights',insight:'insights','ai chat':'insights','data model':'datamodel',datamodel:'datamodel',
  };

  const voiceModeRef=useRef(false);

  const speakAndResume=useCallback((text)=>{
    if(!settings?.jarvisVoice||!text){
      if(voiceModeRef.current) setTimeout(startVoice,300);
      return;
    }
    const synth=window.speechSynthesis;
    synth.cancel();
    const utter=new SpeechSynthesisUtterance(text);
    const loadVoice=()=>{
      const voices=synth.getVoices();
      const pick=voices.find(v=>v.name==='Zarvox')
        ||voices.find(v=>v.name==='Daniel')
        ||voices.find(v=>v.name.includes('Google UK English Male'))
        ||voices.find(v=>v.lang==='en-GB'&&!v.name.toLowerCase().includes('female'))
        ||voices.find(v=>v.lang==='en-GB')
        ||voices.find(v=>v.lang.startsWith('en')&&!v.name.toLowerCase().includes('female'));
      if(pick) utter.voice=pick;
      utter.pitch=0.6;
      utter.rate=0.95;
      utter.volume=1;
      utter.onstart=()=>setSpeaking(true);
      utter.onend=()=>{ setSpeaking(false); if(voiceModeRef.current) setTimeout(startVoice,400); };
      utter.onerror=()=>{ setSpeaking(false); if(voiceModeRef.current) setTimeout(startVoice,400); };
      synth.speak(utter);
    };
    if(synth.getVoices().length) loadVoice();
    else synth.addEventListener('voiceschanged',loadVoice,{once:true});
  },[settings?.jarvisVoice]);

  const sendText=async(text,isVoice=false)=>{
    if(!text&&selectedItems.length===0) return;
    if(isVoice) voiceModeRef.current=true;
    let userContent=text;
    if(selectedItems.length>0) userContent="[ATTACHED]\n"+selectedItems.map(i=>i.llmContext).join("\n")+"\n\n"+text;
    const history=messages.map(m=>({role:m.role==="assistant"?"assistant":"user",content:m.fullText||m.text}));
    const userMsg={role:"user",text,items:[...selectedItems]};
    setMessages(p=>[...p,userMsg]);
    setInput("");
    onSetSelectedItems([]);
    setLoading(true);
    setToolsRunning([]);

    const reply_=(replyTxt)=>{ speakAndResume(replyTxt); };
    const cleanLLM=(s)=>s.replace(/<tool>[\s\S]*?<\/tool>/g,"").replace(/```[\s\S]*?```/g,"").trim();

    try{
      // 1. Quick nav shortcut (no LLM needed)
      const navMatch=text.match(/\bnavigate\s+to\s+([a-z\s]+)/i)||text.match(/\bgo\s+to\s+([a-z\s]+)/i)||text.match(/\bopen\s+([a-z\s]+)/i);
      if(navMatch){
        const dest=navMatch[1].trim().toLowerCase();
        const tab=NAV_TABS[dest]||Object.entries(NAV_TABS).find(([k])=>dest.includes(k))?.[1];
        if(tab){onNavigate(tab);const navTxt=`Navigating to ${dest}.`;setMessages(p=>[...p,{role:"assistant",text:navTxt}]);reply_(navTxt);setLoading(false);return;}
      }

      // 2. Deterministic tool dispatch — JS picks tools, no LLM needed for routing
      const {domains}=classifyQuery(text);
      const t_lower=text.toLowerCase();

      const inferFilter=()=>{
        if(/last\s*month/i.test(text)) return"lastmonth";
        if(/this\s*(year|yr)/i.test(text)) return"thisyear";
        if(/last\s*(year|yr)/i.test(text)) return`year=${new Date().getFullYear()-1}`;
        if(/last\s*3\s*months?/i.test(text)) return"last3months";
        if(/last\s*6\s*months?/i.test(text)) return"last6months";
        if(/last\s*12\s*months?/i.test(text)) return"last12months";
        if(/last\s*30\s*days?/i.test(text)) return"last30days";
        const mYM=text.match(/\b(20\d\d)[- /](0?[1-9]|1[0-2])\b/);
        if(mYM) return`month=${mYM[1]}-${String(mYM[2]).padStart(2,"0")}`;
        const mMonth=t_lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
        if(mMonth){const mi=["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(mMonth[1]);if(mi>=0)return`month=${new Date().getFullYear()}-${String(mi+1).padStart(2,"0")}`;}
        const mYear=text.match(/\b(20\d\d)\b/);
        if(mYear) return`year=${mYear[1]}`;
        return"thismonth";
      };
      const inferGroupBy=()=>{
        if(/by\s*categor|per\s*categor|categor(y|ies)/i.test(text)) return"category";
        if(/by\s*merchant|per\s*merchant|by\s*store|by\s*shop/i.test(text)) return"merchant";
        if(/by\s*month|monthly|month\s*by\s*month/i.test(text)) return"month";
        return undefined;
      };
      const filter=inferFilter();
      const groupBy=inferGroupBy();

      // ── Schema-driven domain → view mapping ─────────────────────────────────────
      // Domains that map to a schema view (use buildSchemaQuery)
      const DOMAIN_SCHEMA_MAP={
        expenses:{viewKey:'expenses', defaultMeasure:'total'},
        income:  {viewKey:'income',   defaultMeasure:'total'},
        bills:   {viewKey:'bills',    defaultMeasure:'total_monthly'},
        goals:   {viewKey:'goals',    defaultMeasure:'avg_progress'},
        net_worth:{viewKey:'accounts',defaultMeasure:'net_worth'},
      };
      // Infer measure from question text (overrides the defaultMeasure)
      const inferMeasure=(viewKey,defaultKey)=>{
        if(/how many|count|number of/i.test(text)) return'count';
        if(/average|avg/i.test(text)) return'avg';
        if(viewKey==='bills'&&/yearly|annual|year/i.test(text)) return'total_yearly';
        if(viewKey==='goals'&&/remaining|left|still need/i.test(text)) return'total_remaining';
        if(viewKey==='goals'&&/saved|deposited/i.test(text)) return'total_saved';
        if(viewKey==='net_worth'&&/asset/i.test(text)) return'total_assets';
        if(viewKey==='net_worth'&&/liabilit|debt|owe/i.test(text)) return'total_liabilities';
        return defaultKey;
      };
      // Map inferred groupBy keyword → schema dimension key for a view
      const mapGroupByDim=(gby,view)=>{
        if(!gby||!view?.dimensions) return undefined;
        if(view.dimensions[gby]) return gby; // direct match
        const aliases={category:'category',merchant:'merchant',month:'month',source:'source',type:'type'};
        const k=aliases[gby];
        return k&&view.dimensions[k]?k:undefined;
      };

      // Fallback DOMAIN_TOOL for domains not in schema (complex multi-step)
      const DOMAIN_TOOL={
        budget:      ()=>({name:"budget",      args:{filter,metric:/over/i.test(text)?"over":/remain/i.test(text)?"remaining":/proximity|close|near/i.test(text)?"proximity":"summary"}}),
        debt:        ()=>({name:"debts",       args:{metric:/interest/i.test(text)?"interest":"summary"}}),
        subscriptions:()=>(/detect|recurring|find|identify|discover/i.test(text)?{name:"detect_subscriptions",args:{}}:{name:"subscriptions",args:{}}),
        vacations:   ()=>({name:"vacations",   args:{metric:/spend/i.test(text)?"spending":/txn|transaction|buy/i.test(text)?"txns":"list"}}),
        portfolio:   ()=>({name:"portfolio",   args:{metric:/gain|profit|loss/i.test(text)?"gain":/detail|holding/i.test(text)?"detail":"summary"}}),
        tax:         ()=>({name:"tax",         args:{}}),
        wishlist:    ()=>({name:"wishlist",     args:{}}),
        cashflow:    ()=>(/runway/i.test(text)?{name:"runway",args:{}}:{name:"cashflow_projection",args:{days:+(text.match(/(\d+)\s*days?/i)||[])[1]||30}}),
        household:   ()=>({name:"household",   args:{}}),
      };

      const wantsNet        =/\bnet\b.*(position|this month|month|total)|net\s*(income|position)/i.test(text);
      const wantsTrend      =/\btrend\b|over time|month.?by.?month|histor/i.test(text);
      const wantsAnomaly    =/unusual|anomal|suspicious|weird|unexpected/i.test(text);
      const wantsHealth     =/health\s*score|financial\s*health/i.test(text);
      const wantsSavings    =/savings?\s*rate/i.test(text);
      const wantsDetectSubs =/detect|find.*recurring|recurring.*charge|auto.?pay|subscription.*history/i.test(text);
      const wantsGoalProj   =/goal.*timeline|goal.*project|when.*goal|goal.*complet|on track.*goal/i.test(text);

      let dataCalls=[];
      if(wantsHealth)        dataCalls=[{name:"health_score",args:{}}];
      else if(wantsAnomaly)  dataCalls=[{name:"spending_anomalies",args:{filter}}];
      else if(wantsSavings)  dataCalls=[{name:"savings_rate",args:{filter}}];
      else if(wantsTrend)    dataCalls=[{name:"trend",args:{metric:domains.includes("income")?"income":"expenses",months:6}}];
      else if(wantsNet)      dataCalls=[{name:"net",args:{filter}}];
      else if(wantsDetectSubs) dataCalls=[{name:"detect_subscriptions",args:{}}];
      else if(wantsGoalProj) dataCalls=[{name:"goals",args:{metric:"timeline"}}];
      else{
        dataCalls=domains.slice(0,3).map(d=>{
          // Try schema-driven first
          const ref=DOMAIN_SCHEMA_MAP[d];
          if(ref&&schema?.views?.[ref.viewKey]){
            const view=schema.views[ref.viewKey];
            const mKey=inferMeasure(ref.viewKey,ref.defaultMeasure);
            const gbDim=mapGroupByDim(groupBy,view);
            const prebuiltMarker=buildSchemaQuery(view,mKey,{filter,groupByDim:gbDim});
            if(prebuiltMarker) return{name:d,args:{filter,groupBy,measure:mKey},_prebuiltMarker:prebuiltMarker};
          }
          // Fall back to TOOL_LIBRARY for complex domains
          return DOMAIN_TOOL[d]?.();
        }).filter(Boolean);
      }

      // Fallback: nothing matched → ask LLM to generate the tool call
      if(!dataCalls.length){
        let llmFallback;
        try{ llmFallback=await callLLM([...history,{role:"user",content:userContent}]); }
        catch(e){ llmFallback=""; }
        if(!llmFallback){
          const noKeyMsg=settings?.globalChatModel==="openrouter"&&!settings?.openrouterKey
            ?"To activate Jarvis, add your OpenRouter API key in Settings → AI → OpenRouter."
            :"I couldn't process that request. Please check your AI model settings.";
          setMessages(p=>[...p,{role:"assistant",text:noKeyMsg,toolCalls:[],widgets:[]}]);
          reply_(noKeyMsg);setLoading(false);setToolsRunning([]);
          if(!voiceModeRef.current) setTimeout(()=>inputRef.current?.focus(),50);
          return;
        }
        const navTool=parseToolCalls(llmFallback).find(t=>t.name==="navigate");
        if(navTool){
          const tab=navTool.args?.tab||"dashboard";
          onNavigate(tab);
          const msg=`Navigating to ${tab}.`;
          setMessages(p=>[...p,{role:"assistant",text:msg,fullText:llmFallback,toolCalls:[],widgets:[]}]);
          reply_(msg);setLoading(false);setToolsRunning([]);
          if(!voiceModeRef.current) setTimeout(()=>inputRef.current?.focus(),50);
          return;
        }
        const llmCalls=parseToolCalls(llmFallback).filter(t=>TOOL_LIBRARY[t.name]);
        if(!llmCalls.length){
          // Strip any invented numbers — if the LLM answered without a tool it can't be trusted for data
          const plain=cleanLLM(llmFallback)||llmFallback;
          const hasNumbers=/\$[\d,]+|\b\d+(\.\d+)?%|\b\d{3,}/.test(plain);
          const safeReply=hasNumbers
            ?"I need to look that up. Could you rephrase so I can find the right data for you?"
            :plain;
          setMessages(p=>[...p,{role:"assistant",text:safeReply,fullText:llmFallback,toolCalls:[],widgets:[]}]);
          reply_(safeReply);setLoading(false);setToolsRunning([]);
          if(!voiceModeRef.current) setTimeout(()=>inputRef.current?.focus(),50);
          return;
        }
        dataCalls=llmCalls;
      }

      // Execute tools in parallel — schema-driven calls pass _prebuiltMarker to skip TOOL_LIBRARY
      setToolsRunning(dataCalls.map(t=>t.name));
      let toolResults=await Promise.all(dataCalls.map(async t=>({name:t.name,args:t.args||{},result:await execTool(t.name,t.args||{},t._prebuiltMarker||null)})));

      // Task 2: retry with broader filter when all results are empty
      const allEmpty=toolResults.every(t=>!t.result||(Array.isArray(t.result)&&t.result.length===0));
      if(allEmpty&&filter==="thismonth"){
        setToolsRunning(["broadening…"]);
        const widerCalls=dataCalls.map(t=>({...t,args:{...(t.args||{}),filter:"last3months"}}));
        const retried=await Promise.all(widerCalls.map(async t=>({name:t.name,args:t.args||{},result:await execTool(t.name,t.args||{},null)})));
        if(retried.some(t=>t.result&&(!Array.isArray(t.result)||t.result.length>0))) toolResults=retried;
      }
      setToolsRunning([]);

      // Build widgets
      const widgets=toolResults.map(({name,result})=>autoWidget(uid(),name,result,null)).filter(Boolean);

      // Switch from dots→streaming bubble before synthesis starts
      setStreamingText("");
      setStreamingWidgets(widgets);
      setLoading(false);

      // Synthesis — stream tokens directly into the bubble, include conversation history for multi-turn context
      const synthText=await callSynthesis(text,toolResults,chunk=>setStreamingText(t=>(t||"")+chunk),history);
      const finalText=synthText||"Here is your data.";

      setStreamingText(null);
      setStreamingWidgets([]);
      setMessages(p=>[...p,{role:"assistant",text:finalText,fullText:"",toolCalls:toolResults,widgets,_question:text}]);
      reply_(finalText);
    }catch(e){
      setStreamingText(null);
      setStreamingWidgets([]);
      setMessages(p=>[...p,{role:"assistant",text:"Error: "+e.message,toolCalls:[],widgets:[]}]);
      if(voiceModeRef.current) setTimeout(startVoice,400);
    }
    setLoading(false);
    setToolsRunning([]);
    if(!voiceModeRef.current) setTimeout(()=>inputRef.current?.focus(),50);
  };

  const send=()=>sendText(input.trim(),false);

  const recRef=useRef(null);
  const stopVoice=()=>{
    voiceModeRef.current=false;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    if(recRef.current){recRef.current.abort();recRef.current=null;}
    setListening(false);
  };
  const startVoice=()=>{
    if(speaking){stopVoice();return;}
    if(listening){stopVoice();return;}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert("Voice input not supported in this browser.");return;}
    window.speechSynthesis?.cancel();
    const rec=new SR();
    recRef.current=rec;
    rec.interimResults=false;
    rec.lang="en-US";
    rec.onstart=()=>setListening(true);
    rec.onerror=e=>{
      if(e.error!=="aborted") setListening(false);
      recRef.current=null;
    };
    rec.onresult=e=>{
      const transcript=e.results[0][0].transcript.trim();
      if(!transcript) return;
      setInput(transcript);
      sendText(transcript,true);
    };
    rec.onend=()=>{setListening(false);recRef.current=null;};
    rec.start();
  };

  const pinnedQueries=settings?.pinnedQueries||[];
  const onPin=useCallback((question,alreadyPinned)=>{
    if(!onSaveSettings) return;
    const current=settings?.pinnedQueries||[];
    if(alreadyPinned){
      onSaveSettings({...settings,pinnedQueries:current.filter(q=>q.question!==question)});
    } else {
      if(current.some(q=>q.question===question)) return;
      onSaveSettings({...settings,pinnedQueries:[...current,{id:uid(),question}]});
    }
  },[settings,onSaveSettings]);

  if(discreteMode){
    return(
      <>
        <style>{`@keyframes gcSlideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}@keyframes gcDot{0%,80%,100%{transform:scale(0.7);opacity:0.4}40%{transform:scale(1.1);opacity:1}}@keyframes jarvisCursor{0%,100%{opacity:1}50%{opacity:0}}`}</style>
        <button
          onClick={()=>onSetOpen(!open)}
          title="AI blocked in discrete mode"
          style={{position:"fixed",bottom:24,right:24,width:52,height:52,borderRadius:"50%",background:T.overlay,border:"1px solid "+T.border,cursor:"pointer",color:T.tx2,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:T.shadow,zIndex:9999,transition:"background .2s,transform .15s",fontFamily:"inherit"}}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M4 19h16"/><path d="M6 17V7a2 2 0 012-2h4l6 6v6"/><path d="M12 5v6h6"/></svg>
        </button>
        {open&&(
          <div style={{position:"fixed",bottom:84,right:24,width:390,maxHeight:550,borderRadius:T.rCard,background:T.surface,boxShadow:T.shadowMd,zIndex:9998,display:"flex",flexDirection:"column",overflow:"hidden",animation:"gcSlideUp .22s ease",padding:20}}>
            <DiscreteModeBlockedCard />
          </div>
        )}
      </>
    );
  }

  if(view==="insights") return null;

  return(
    <>
      <style>{`@keyframes gcSlideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}@keyframes gcDot{0%,80%,100%{transform:scale(0.7);opacity:0.4}40%{transform:scale(1.1);opacity:1}}@keyframes jarvisCursor{0%,100%{opacity:1}50%{opacity:0}}`}</style>

      {/* FAB */}
      <button
        onClick={()=>onSetOpen(!open)}
        title={open?"Close Jarvis":"Open Jarvis"}
        data-tutorial="jarvis"
        style={{position:"fixed",bottom:24,right:24,width:52,height:52,borderRadius:"50%",background:open?T.overlay:T.accent,border:open?"1px solid "+T.border:"none",cursor:"pointer",color:open?T.tx2:"#fff",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:open?T.shadow:T.shadowMd,zIndex:9999,transition:"background .2s,transform .15s",fontFamily:"inherit"}}
        onMouseEnter={e=>e.currentTarget.style.transform="scale(1.09)"}
        onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}
      >{open
        ?<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1={18} y1={6} x2={6} y2={18}/><line x1={6} y1={6} x2={18} y2={18}/></svg>
        :<svg width={26} height={26} viewBox="0 0 32 32" fill="none">
          {/* Neural / spark logo */}
          <circle cx={16} cy={16} r={5} fill="rgba(255,255,255,0.95)"/>
          <circle cx={16} cy={5} r={2.2} fill="rgba(255,255,255,0.7)"/>
          <circle cx={16} cy={27} r={2.2} fill="rgba(255,255,255,0.7)"/>
          <circle cx={5} cy={16} r={2.2} fill="rgba(255,255,255,0.7)"/>
          <circle cx={27} cy={16} r={2.2} fill="rgba(255,255,255,0.7)"/>
          <circle cx={8.1} cy={8.1} r={2.2} fill="rgba(255,255,255,0.5)"/>
          <circle cx={23.9} cy={8.1} r={2.2} fill="rgba(255,255,255,0.5)"/>
          <circle cx={8.1} cy={23.9} r={2.2} fill="rgba(255,255,255,0.5)"/>
          <circle cx={23.9} cy={23.9} r={2.2} fill="rgba(255,255,255,0.5)"/>
          <line x1={16} y1={11} x2={16} y2={7.2} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2}/>
          <line x1={16} y1={21} x2={16} y2={24.8} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2}/>
          <line x1={11} y1={16} x2={7.2} y2={16} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2}/>
          <line x1={21} y1={16} x2={24.8} y2={16} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2}/>
          <line x1={12.5} y1={12.5} x2={9.9} y2={9.9} stroke="rgba(255,255,255,0.4)" strokeWidth={1.2}/>
          <line x1={19.5} y1={12.5} x2={22.1} y2={9.9} stroke="rgba(255,255,255,0.4)" strokeWidth={1.2}/>
          <line x1={12.5} y1={19.5} x2={9.9} y2={22.1} stroke="rgba(255,255,255,0.4)" strokeWidth={1.2}/>
          <line x1={19.5} y1={19.5} x2={22.1} y2={22.1} stroke="rgba(255,255,255,0.4)" strokeWidth={1.2}/>
        </svg>
      }</button>

      {/* Panel */}
      {open&&(
        <div style={{position:"fixed",bottom:84,right:24,width:390,maxHeight:550,borderRadius:T.rCard,background:T.surface,boxShadow:T.shadowMd,zIndex:9998,display:"flex",flexDirection:"column",overflow:"hidden",animation:"gcSlideUp .22s ease"}}>

          {/* Header */}
          <div style={{display:"flex",alignItems:"center",gap:9,padding:"12px 16px 10px",borderBottom:"1px solid "+T.border,background:T.surface,flexShrink:0}}>
            <div style={{width:30,height:30,borderRadius:"50%",background:T.overlay,border:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width={18} height={18} viewBox="0 0 32 32" fill="none">
                <circle cx={16} cy={16} r={5} fill={T.tx1}/>
                <circle cx={16} cy={5} r={2.2} fill={T.tx2}/>
                <circle cx={16} cy={27} r={2.2} fill={T.tx2}/>
                <circle cx={5} cy={16} r={2.2} fill={T.tx2}/>
                <circle cx={27} cy={16} r={2.2} fill={T.tx2}/>
                <circle cx={8.1} cy={8.1} r={2.2} fill={T.tx3}/>
                <circle cx={23.9} cy={8.1} r={2.2} fill={T.tx3}/>
                <circle cx={8.1} cy={23.9} r={2.2} fill={T.tx3}/>
                <circle cx={23.9} cy={23.9} r={2.2} fill={T.tx3}/>
                <line x1={16} y1={11} x2={16} y2={7.2} stroke={T.tx3} strokeWidth={1.2}/>
                <line x1={16} y1={21} x2={16} y2={24.8} stroke={T.tx3} strokeWidth={1.2}/>
                <line x1={11} y1={16} x2={7.2} y2={16} stroke={T.tx3} strokeWidth={1.2}/>
                <line x1={21} y1={16} x2={24.8} y2={16} stroke={T.tx3} strokeWidth={1.2}/>
                <line x1={12.5} y1={12.5} x2={9.9} y2={9.9} stroke={T.border} strokeWidth={1.2}/>
                <line x1={19.5} y1={12.5} x2={22.1} y2={9.9} stroke={T.border} strokeWidth={1.2}/>
                <line x1={12.5} y1={19.5} x2={9.9} y2={22.1} stroke={T.border} strokeWidth={1.2}/>
                <line x1={19.5} y1={19.5} x2={22.1} y2={22.1} stroke={T.border} strokeWidth={1.2}/>
              </svg>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"#1e293b",lineHeight:1}}>Jarvis</div>
              <div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>{(()=>{const m=settings?.globalChatModel||"openrouter";if(m==="gemini")return "Gemini";if(m==="openrouter")return "OpenRouter · "+(settings?.openrouterModel||"moonshotai/kimi-k2");if(m==="deepseek")return "DeepSeek · "+(settings?.deepseekModel||"deepseek-r1:8b");return "Ollama · "+(settings?.ollamaModel||"phi3:mini");})()}</div>
            </div>
            <button
              onClick={()=>onSetInDepthMode(!inDepthMode)}
              title="Toggle In-Depth Mode: click any card to attach as context"
              style={{padding:"5px 11px",borderRadius:8,border:"1.5px solid",borderColor:inDepthMode?"#0284C7":"#e2e8f0",background:inDepthMode?"#eff6ff":"#fff",color:inDepthMode?"#0284C7":"#94a3b8",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4,transition:"all .15s",flexShrink:0}}
            >⊕{inDepthMode?" Active":" In-Depth"}</button>
            {messages.length>0&&<button onClick={()=>{setMessages([]);try{localStorage.removeItem("ch_jarvis_msgs");}catch{}}} title="Clear chat history" style={{padding:"5px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#fff",color:"#94a3b8",fontSize:11,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",flexShrink:0}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#dc2626";e.currentTarget.style.color="#dc2626";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#94a3b8";}}>✕ Clear</button>}
          </div>

          {/* Messages */}
          <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:8,minHeight:0}}>
            {messages.length===0&&(
              <div style={{textAlign:"center",color:"#94a3b8",fontSize:12,marginTop:32,lineHeight:1.8}}>
                At your service.<br/>Ask me anything, or say <em>"navigate to bills"</em>.
                {inDepthMode&&<div style={{marginTop:8,color:"#0284C7",fontWeight:600,fontSize:11}}>⊕ Click any card on the page to attach it.</div>}
              </div>
            )}
            {messages.map((m,i)=>(
              <MsgBubble key={i} m={m} T={T} onPin={onPin} isPinned={pinnedQueries.some(q=>q.question===m._question)}/>
            ))}
            {loading&&(
              <div style={{alignSelf:"flex-start",background:T.overlay,padding:"10px 14px",borderRadius:"14px 14px 14px 2px",display:"flex",flexDirection:"column",gap:6}}>
                <div style={{display:"flex",gap:5,alignItems:"center"}}>
                  {[0,1,2].map(i=><span key={i} style={{width:6,height:6,borderRadius:"50%",background:T.tx3,display:"inline-block",animation:`gcDot 1.2s ${i*0.18}s infinite ease-in-out`}}/>)}
                  <span style={{fontSize:11,color:T.tx3,marginLeft:4}}>{toolsRunning.length>0?"running tools…":"thinking…"}</span>
                </div>
                {toolsRunning.length>0&&(
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {toolsRunning.map(name=>(
                      <span key={name} style={{fontSize:10,fontWeight:600,background:T.accentBg,color:T.accent,padding:"2px 7px",borderRadius:99,border:"1px solid "+T.accentMid}}>{name}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {streamingText!==null&&(
              <MsgBubble m={{role:"assistant",text:streamingText,toolCalls:[],widgets:streamingWidgets}} T={T} streaming/>
            )}
            <div ref={msgsEndRef}/>
          </div>

          {/* Attached items chips */}
          {selectedItems.length>0&&(
            <div style={{padding:"7px 14px",borderTop:"1px solid #f1f5f9",display:"flex",flexWrap:"wrap",gap:5,alignItems:"center",background:"#f8fafc",flexShrink:0}}>
              <span style={{fontSize:10,color:"#94a3b8",fontWeight:700,letterSpacing:"0.05em",marginRight:2}}>ATTACHED:</span>
              {selectedItems.map(it=>(
                <span key={it.id} style={{display:"inline-flex",alignItems:"center",gap:4,background:"#eff6ff",border:"1px solid #bae6fd",color:"#0369a1",fontSize:11,padding:"3px 8px 3px 9px",borderRadius:12}}>
                  {it.label}
                  <button onClick={()=>onSetSelectedItems(p=>p.filter(x=>x.id!==it.id))} style={{background:"none",border:"none",cursor:"pointer",color:"#64748b",fontSize:14,lineHeight:1,padding:"0 0 1px",fontFamily:"inherit",display:"flex",alignItems:"center"}}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* Pinned queries */}
          {pinnedQueries.length>0&&(
            <div style={{padding:"6px 12px",borderTop:"1px solid #f1f5f9",display:"flex",flexWrap:"wrap",gap:5,alignItems:"center",background:"#f8fafc",flexShrink:0}}>
              <span style={{fontSize:10,color:"#94a3b8",fontWeight:700,letterSpacing:"0.05em",flexShrink:0}}>PINNED:</span>
              {pinnedQueries.map(q=>(
                <button key={q.id} onClick={()=>sendText(q.question,false)} title={q.question}
                  style={{background:"#eff6ff",border:"1px solid #bae6fd",color:"#0369a1",fontSize:11,padding:"2px 9px",borderRadius:12,cursor:"pointer",fontFamily:"inherit",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  📌 {q.question.length>28?q.question.slice(0,28)+"…":q.question}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{padding:"10px 12px 13px",borderTop:"1px solid #f1f5f9",display:"flex",gap:7,alignItems:"flex-end",flexShrink:0}}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
              placeholder="Ask about your finances…"
              rows={2}
              style={{flex:1,resize:"none",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 11px",fontSize:12,fontFamily:"inherit",outline:"none",lineHeight:1.45,color:"#1e293b",background:"#fff",transition:"border-color .15s"}}
              onFocus={e=>e.target.style.borderColor="#0284C7"}
              onBlur={e=>e.target.style.borderColor="#e2e8f0"}
            />
            <button onClick={startVoice} title={speaking?"Jarvis is speaking (tap to stop)":listening?"Listening… (tap to stop)":"Start voice conversation"} style={{width:34,height:34,borderRadius:"50%",border:"1.5px solid",borderColor:speaking?"#f59e0b":listening?"#dc2626":"#e2e8f0",background:speaking?"#fffbeb":listening?"#fef2f2":"#f8fafc",cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,opacity:speaking?0.6:1,transition:"all .15s"}}>{speaking?"▐▐":"●"}</button>
            <button onClick={send} disabled={loading||(!input.trim()&&selectedItems.length===0)} style={{width:34,height:34,borderRadius:"50%",background:"#0284C7",border:"none",cursor:"pointer",color:"#fff",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,opacity:loading||(!input.trim()&&selectedItems.length===0)?0.4:1,transition:"opacity .15s"}}>↑</button>
          </div>
        </div>
      )}
    </>
  );
}


export { GlobalChat, MsgBubble };

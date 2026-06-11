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
import { InsightWidget, RenderMD, fmtLabel, detectChartType, autoWidget } from "./utils.jsx";
import { TOOL_LIBRARY, buildSchemaQuery, schemaToTools, execTool, extractFacts, buildToolSummary, quickNavFastPath, DOMAIN_PATTERNS, classifyQuery } from "./toolLibrary.js";
import { DEFAULT_SCHEMA } from "./schema.js";
import { ToolCoveragePanel } from "./ToolCoverage.jsx";

function Insights({schema,settings,onNavigate,widgets,onSetWidgets,messages,onSetMessages,discreteMode}){
  const setMessages = onSetMessages;
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const chatEndRef=useRef(null);
  const inputRef=useRef(null);

  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);
  const blocked=discreteMode;


  // Build system prompt for GlobalChat
  const buildSystemPrompt=()=>{
    const curMonth=new Date().toISOString().slice(0,7);
    // Build schema view descriptions (each view's joins define what data it covers)
    const schemaDefs=schema?.views?Object.entries(schema.views).map(([vk,v])=>{
      const msrKeys=Object.keys(v.measures||{}).join('|');
      const dimKeys=Object.keys(v.dimensions||{}).join('|');
      const joinDesc=(v.joins||[]).filter(j=>j.type==='UNION ALL').map(j=>j.label);
      const joinNote=joinDesc.length?` [UNION: ${joinDesc.join('+')}]`:'';
      return `  ${vk}${joinNote}  measures:${msrKeys}  groupBy:${dimKeys}`;
    }).join('\n'):'';

    return `You are CashHeap Assistant (Jarvis). Answer finance questions by calling ONE tool. NEVER invent numbers.

RULES:
- Always call a tool before answering any financial question.
- Call exactly ONE tool per response.
- Report returned values in 1-2 sentences using ONLY the numbers returned.
- For spending/income/goals/bills/accounts: the system dispatches schema-driven queries automatically.
  Only emit a <tool> block for complex queries (budget, vacations, trend, compare, portfolio, debts, etc.)

═══ DATA MODEL VIEWS (schema-driven — dispatched automatically) ══════════════
${schemaDefs}

Each view's SQL is built from its baseSQL + UNION ALL joins as defined in the Data Model.
The "expenses" view includes vacation_txns via UNION ALL — totals always include vacation spending.

═══ COMPLEX TOOLS (emit <tool> block for these) ═════════════════════════════

net(filter?,groupBy?)         Income minus all expenses. groupBy: month | year
budget(filter?,metric?)       metric: summary|proximity|over|remaining|utilization|targets
vacations(name?,metric?)      metric: list|spending|txns|biggest|merchants
trend(metric,months?)         metric: expenses|income|net|net_worth|savings_rate
compare(metric,month1,month2) metric: expenses|income|net
debts(metric?)                metric: summary|interest|total
subscriptions(metric?)        metric: total
portfolio(metric?,ticker?)    metric: summary|detail|gain
expected_income(filter?,metric?) metric: pending|confirmed|recurring|all|total
tax(year?,metric?)            metric: deductible|summary|rrsp|compare
savings_rate(filter?)
runway()
spending_anomalies(filter?)
health_score()
cashflow_projection(days?)
sql_query(sql)                Raw SELECT — escape hatch
navigate(tab)                 home|bills|history|stocks|cashflow|networth|goals|debt|settings

═══ ROUTING ════════════════════════════════════════════════════════════════

- "how much spent / total spending" → handled by schema expenses view (auto)
- "income this month / total earned" → handled by schema income view (auto)
- "how much do I pay in bills" → handled by schema bills view (auto)
- "net worth / total assets" → handled by schema accounts view (auto)
- "goal progress / how close to goal" → handled by schema goals view (auto)
- "over budget / budget remaining" → budget(metric=over|remaining)
- "what did I spend on [vacation]" → vacations(name=X,metric=spending)
- "trend / over time / month by month" → trend(metric=expenses)
- "compare month X vs Y" → compare(metric=expenses,month1=X,month2=Y)
- "runway / how long can I last" → runway()
- "unusual / anomalous charges" → spending_anomalies()
- "health score" → health_score()

═══ EXAMPLES ═══════════════════════════════════════════════════════════════

User: am I over budget anywhere this month
<tool>{"name":"budget","args":{"filter":"month=${curMonth}","metric":"over"}}</tool>

User: spending trend last 6 months
<tool>{"name":"trend","args":{"metric":"expenses","months":6}}</tool>

User: how much did I spend on my Montreal vacation
<tool>{"name":"vacations","args":{"name":"Montreal","metric":"spending"}}</tool>

User: what was my savings rate for Q1 2026
<tool>{"name":"savings_rate","args":{"filter":"from=2026-01 AND to=2026-03"}}</tool>

User: how long could I survive on my savings
<tool>{"name":"runway","args":{}}}</tool>

Current month: ${curMonth}`;
  };

  // LLM caller for Insights — routes through the selected model (Gemini / DeepSeek / Ollama)
  const callInsightsLLM=async(msgs)=>{
    const model=settings?.globalChatModel||"openrouter";
    const systemMsg=msgs.find(m=>m.role==="system");
    const chatMsgs=msgs.filter(m=>m.role!=="system");
    const sysContent=systemMsg?.content||"";
    try{
      if(model==="gemini"){
        const r=await fetch("/api/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:sysContent}]},contents:chatMsgs.map(m=>({role:m.role==="assistant"?"model":m.role,parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:256}})});
        const d=await r.json();
        return d.candidates?.[0]?.content?.parts?.[0]?.text||"";
      } else if(model==="deepseek"){
        const dsModel=settings?.deepseekModel||"deepseek-r1:8b";
        const r=await fetch("/api/llm/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:dsModel,messages:msgs,stream:false})});
        const d=await r.json();
        const raw=d.message?.content||"";
        return raw.replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
      } else {
        const r=await fetch("/api/llm/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:settings?.ollamaModel||"phi3:mini",messages:msgs,options:{num_predict:200,temperature:0.1}})});
        const d=await r.json();
        return d.message?.content||"";
      }
    }catch(e){return "";}
  };

  const executeTool=async(tool)=>{
    const{name,args}=tool;
    if(name==="navigate"){
      onNavigate(args.tab);
      return{success:true,navigatedTo:args.tab};
    }
    // Named library tool
    if(TOOL_LIBRARY[name]){
      try{
        const marker=TOOL_LIBRARY[name](args||{});
        // JS-only special markers
        if(marker==='__HEALTH_SCORE__'){
          // Handled separately — fall through to health score logic below
          return{id:name,result:'__HEALTH_SCORE__'};
        }
        if(typeof marker==='string'&&marker.startsWith('__CASHFLOW__:')){
          return{id:name,result:'__CASHFLOW__',days:+marker.split(':')[1]||30};
        }
        if(typeof marker!=='string'||!marker.startsWith('__SQL__:'))
          return{id:name,error:'Tool returned unexpected value'};
        const{sql,params}=JSON.parse(marker.slice(8));
        const r=await fetch("/api/db/sql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sql,params})});
        const d=await r.json();
        if(d.error)return{id:name,error:d.error};
        // Normalize: 1 row × 1 column → scalar value
        if(d.rows&&d.rows.length===1&&d.columns&&d.columns.length===1)return{id:name,result:d.rows[0][d.columns[0]]};
        return{id:name,result:d.rows,columns:d.columns,count:d.count};
      }catch(e){return{id:name,error:e.message};}
    }
    // Legacy raw query tool (fallback only)
    if(name==="query"){
      try{
        const r=await fetch("/api/llm/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:args.js})});
        const d=await r.json();
        return{id:args.id||"result",result:d.result,error:d.error};
      }catch(e){return{id:args.id||"result",error:e.message};}
    }
    if(name==="chart"){
      return{widget:{id:uid(),type:args.type,title:args.title,data:args.data||[],xKey:args.xKey||"name",yKey:args.yKey||"value",multiKeys:args.multiKeys,format:args.format,color:args.color,colors:args.colors}};
    }
    if(name==="metric"){
      return{widget:{id:uid(),type:"metric",title:args.title,value:args.value,label:args.label,format:args.format||"number"}};
    }
    if(name==="table"){
      return{widget:{id:uid(),type:"table",title:args.title,columns:args.columns||[],rows:args.rows||[],format:args.format}};
    }
    return{error:"Unknown tool: "+name};
  };

  // Returns true if text contains financial figures that may be hallucinated
  const looksLikeFinancialClaim=text=>/\$[\d,]+|\d[\d,]*\.\d{2}|\b\d{3,}[\d,]*\b/.test(text);

  // ─── Preloaded queries: instant answers for known question patterns ──────────
  // Each entry has: test(msg)→bool, and either action() for side-effects
  // or queries:[{label, chartType, js(), buildWidget?(result)→widget}]
  // The fast-path runs these BEFORE hitting the LLM, making responses instant.
  const PRELOADED_QUERIES=[
    // Navigate
    {
      test:msg=>/navigate.*net.?worth|go.*net.?worth/i.test(msg),
      action:()=>{ onNavigate("networth"); setMessages(prev=>[...prev,{role:"assistant",display:"Navigating to Net Worth…",content:"",widgets:[]}]); }
    },
    // Spending this month
    {
      test:msg=>/(how much|total).*(spent|spend|spending)|spent.*(this month|month)/i.test(msg),
      queries:[{
        label:"Spent This Month",chartType:null,
        js:()=>TOOL_LIBRARY.expenses({filter:`month=${new Date().toISOString().slice(0,7)}`}),
      }]
    },
    // Monthly income vs expenses (bar) — check before generic "income" or "bar"
    {
      test:msg=>/monthly.*(income|expense)|income.*vs.*expense|expense.*vs.*income|income.*expense.*bar|monthly.*bar/i.test(msg),
      queries:[{
        label:"Monthly Income vs Expenses",chartType:"bar",multiSeries:true,
        js:()=>TOOL_LIBRARY.trend({metric:"expenses",months:8}),
        buildWidget:(result)=>({id:uid(),type:"bar",title:"Monthly Income vs Expenses",data:result,xKey:"name",multiKeys:["Income","Expenses"],format:"currency"})
      }]
    },
    // Spending by category (pie)
    {
      test:msg=>/categor|pie chart|breakdown/i.test(msg),
      queries:[{
        label:"Spending by Category",chartType:"pie",
        js:()=>TOOL_LIBRARY.expenses({filter:`month=${new Date().toISOString().slice(0,7)}`,groupBy:"category"}),
      }]
    },
    // Net position this month
    {
      test:msg=>/net.*(position|worth|this month)|what.*net/i.test(msg),
      queries:[
        {label:"Income This Month",chartType:null,
          js:()=>TOOL_LIBRARY.income({filter:`month=${new Date().toISOString().slice(0,7)}`}),
        },
        {label:"Expenses This Month",chartType:null,
          js:()=>TOOL_LIBRARY.expenses({filter:`month=${new Date().toISOString().slice(0,7)}`}),
        },
        {label:"Net This Month",chartType:null,
          js:()=>TOOL_LIBRARY.net({filter:`month=${new Date().toISOString().slice(0,7)}`}),
        },
      ]
    },
    // Bills
    {
      test:msg=>/bill/i.test(msg),
      queries:[
        {label:"Bills Due",chartType:null,js:()=>TOOL_LIBRARY.bills({status:"due"})},
        {label:"Bills Breakdown",chartType:"bar",js:()=>TOOL_LIBRARY.bills({status:"all"})},
      ]
    },
    // Pending / unconfirmed expected income
    {
      test:msg=>/(income|pay|salary).*(pending|unconfirmed|expected|not.*confirmed|hasn.?t.*confirmed)|(pending|unconfirmed|expected|hasn.?t.*confirmed).*(income|pay|salary)/i.test(msg),
      queries:[{
        label:"Pending Income",chartType:"bar",
        js:()=>TOOL_LIBRARY.expected_income({metric:"pending"}),
      }]
    },
    // Portfolio value
    {
      test:msg=>/portfolio|stock.*value|total.*stock/i.test(msg),
      queries:[
        {label:"Portfolio Summary",chartType:null,js:()=>TOOL_LIBRARY.portfolio({metric:"summary"})},
        {label:"Holdings by Value",chartType:"bar",js:()=>TOOL_LIBRARY.portfolio({metric:"detail"})},
      ]
    },
  ];

  const runAgent=async(userMsg)=>{
    setLoading(true);setError(null);
    const userEntry={role:"user",display:userMsg,content:userMsg,widgets:[]};
    setMessages(prev=>[...prev,userEntry]);

    // ── Fast path: preloaded queries bypass the LLM entirely ──────────────────
    const preloaded=PRELOADED_QUERIES.find(p=>p.test(userMsg));
    let skipLLM=false;
    if(preloaded){
      if(preloaded.action){
        preloaded.action();
        setLoading(false);
        setTimeout(()=>inputRef.current?.focus(),50);
        return;
      }
      const widgets=[];
      const rawResults=[];
      for(const q of preloaded.queries){
        try{
          const marker=q.js();
          let result;
          if(typeof marker==="string"&&marker.startsWith("__SQL__:")){
            const{sql,params}=JSON.parse(marker.slice(8));
            const r=await fetch("/api/db/sql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sql,params})});
            const d=await r.json();
            if(d.error){console.warn("Preloaded query error:",q.label,d.error);continue;}
            result=d.rows?.length===1&&d.columns?.length===1?d.rows[0][d.columns[0]]:d.rows;
          } else if(typeof marker==="string"&&marker.startsWith("__HEALTH_SCORE__")){
            continue;
          } else {
            continue;
          }
          rawResults.push({label:q.label,result});
          const w=q.buildWidget?q.buildWidget(result):autoWidget(uid(),q.label,result,q.chartType);
          if(w) widgets.push(w);
        }catch(e){console.warn("Preloaded query exception:",q.label,e.message);}
      }
      if(widgets.length>0){
        // Show widgets immediately, then synthesize answer
        setMessages(prev=>[...prev,{role:"assistant",display:null,content:"",widgets,_pending:true}]);
        const dataText=rawResults.map(({label,result})=>`${label}: ${JSON.stringify(result).slice(0,400)}`).join("\n");
        let reply;
        try{
          reply=await callInsightsLLM([
            {role:"system",content:"You are Jarvis. Answer the user's question in 1-2 sentences using ONLY the data provided. Be direct, no preamble, no sign-off. Never invent numbers."},
            {role:"user",content:`Question: "${userMsg}"\n\nData:\n${dataText}`},
          ]);
        }catch(e){ reply=null; }
        setMessages(prev=>prev.map(m=>m._pending?{...m,display:reply||null,content:reply,_pending:false}:m));
        skipLLM=true;
      }
      // If widgets.length===0, fall through to LLM path below
    }
    // ── End fast path ──────────────────────────────────────────────────────────
    if(skipLLM){setLoading(false);setTimeout(()=>inputRef.current?.focus(),50);return;}

    const systemPrompt=buildSystemPrompt();
    const histForLLM=[
      {role:"system",content:systemPrompt},
      ...messages.map(m=>({role:m.role,content:m.content})),
      {role:"user",content:userMsg}
    ];

    let llmMsgs=[...histForLLM];
    const MAX_ITER=3;
    let iter=0;
    let queriesRan=0;
    let queriesSucceeded=0;
    const preferredChartType=detectChartType(userMsg); // honour user's explicit chart preference

    try{
      while(iter<MAX_ITER){
        iter++;
        const _insModel=settings?.globalChatModel||"openrouter";
        const _insOllamaModel=_insModel==="deepseek"?(settings?.deepseekModel||"deepseek-r1:8b"):(settings?.ollamaModel||"phi3:mini");
        const res=await fetch("/api/llm/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:_insOllamaModel,messages:llmMsgs,options:{num_predict:400,temperature:0.1}})});
        if(!res.ok){const e=await res.json();throw new Error(e.error||"LLM error");}
        const llmData=await res.json();
        const assistantText=llmData.message?.content||"(no response)";
        const toolCalls=parseToolCalls(assistantText);
        // Strip tool tags, code fences, and all meta/privacy boilerplate
        let cleanText=assistantText
          .replace(/<tool>[\s\S]*?<\/tool>/g,"")
          .replace(/```[\w]*\n?[\s\S]*?```/g,"")   // closed code fences
          .replace(/```[\s\S]*/g,"")                // unclosed code fences → strip to end
          .replace(/\(this placeholder[^)]*\)/gi,"")
          .trim();
        // Remove lines that are meta-commentary, instructions, or privacy warnings
        const badPatterns=[
          /to (create|visualize|generate|display|render|produce)/i,
          /execute this query/i,/run (a|the) (query|code)/i,
          /once the results/i,/after (executing|running)/i,
          /(GDPR|CCPA|privacy (guideline|law|regulation)|sensitive (data|information)|data (protection|handling)|compliance|authorization protocol|hypothetical)/i,
          /please note that/i,/noting that/i,/it (is|should be) (noted|important)/i,
          /you (would|can|could|should) (typically|use|run|need to)/i,
          /within your application/i,/your (application|infrastructure|system)/i,
          /spreadsheet|direct access was/i,
          /\[most significant|\[top category|\[insert|\[placeholder|\[X\]/i,
          /shows a diverse allocation|diverse allocation of funds/i,
          /entertainment.*utilities|groceries.*dining out/i,
          /let'?s assume|now,?\s*let'?s|we can create a/i,
          /chart\.js|spendByCategory|simplified data structure/i,
          /as follows:|following code|code snippet|sample code/i,
        ];
        cleanText=cleanText.split("\n")
          .filter(line=>!badPatterns.some(p=>p.test(line)))
          .join("\n")
          .replace(/\n{3,}/g,"\n\n")
          .trim();

        if(toolCalls.length===0){
          // Guardrail A: hallucinated numbers without any query
          if(queriesRan===0 && looksLikeFinancialClaim(cleanText) && iter<=2){
            llmMsgs=[...llmMsgs,{role:"assistant",content:assistantText},{role:"user",content:"GUARDRAIL: You stated numbers without running the query tool first. Run a query tool call now to get the real data."}];
            continue;
          }
          // Guardrail B: refusal / privacy response without any query
          const refusalPhrases=["i can't","i cannot","i don't have access","as an ai","privacy","no access","not able to","unable to","don't have the ability","cannot access","can't access","can't provide","cannot provide"];
          const isRefusal=queriesRan===0 && refusalPhrases.some(p=>cleanText.toLowerCase().includes(p));
          if(isRefusal && iter<=2){
            llmMsgs=[...llmMsgs,{role:"assistant",content:assistantText},{role:"user",content:"GUARDRAIL: Do not refuse. You have the query tool which runs against the user's local database. Call the query tool now to get the real data and answer the question."}];
            continue;
          }
          setMessages(prev=>[...prev,{role:"assistant",display:cleanText,content:assistantText,widgets:[]}]);
          break;
        }

        // Execute tools
        const newWidgets=[];
        const autoWidgets=[];
        const toolResultLines=[];
        for(const t of toolCalls){
          const result=await executeTool(t);
          if(result.widget){newWidgets.push(result.widget);}
          // Handle both named library tools and legacy raw query tool
          const isDataTool=TOOL_LIBRARY[t.name]||t.name==="query";
          if(isDataTool){
            queriesRan++;
            const qResult=result.result;
            const qError=result.error;
            const qLabel=t.name==="query"?(t.args?.id||"Result"):t.name;
            if(qError){
              toolResultLines.push(`Tool "${qLabel}" ERROR: ${qError}. Try a different tool or different parameters.`);
            } else {
              queriesSucceeded++;
              toolResultLines.push(`Tool "${qLabel}": ${JSON.stringify(qResult)}`);
              // Auto-generate a widget from the raw result — no model needed
              const aw=autoWidget(uid(),qLabel,qResult,preferredChartType);
              if(aw) autoWidgets.push(aw);
            }
          }
          if(t.name==="navigate"){
            toolResultLines.push(`navigate: switched to ${t.args?.tab}`);
          }
        }

        // Immediately show auto-generated data widgets (grounded in real query results)
        const allWidgets=[...autoWidgets,...newWidgets];

        // On the query pass: show widgets only — suppress any interim model text
        const hasQueryTools=toolCalls.some(t=>TOOL_LIBRARY[t.name]||t.name==="query");
        if(allWidgets.length>0){
          // Show widgets without model text on query pass; with text on final pass
          setMessages(prev=>[...prev,{role:"assistant",display:hasQueryTools?null:cleanText||null,content:assistantText,widgets:allWidgets}]);
        } else if(!hasQueryTools&&cleanText){
          setMessages(prev=>[...prev,{role:"assistant",display:cleanText,content:assistantText,widgets:[]}]);
        }

        // If no data tools were called (only navigate/chart/etc), done
        if(!hasQueryTools) break;

        // After successful queries, generate a brief client-side summary from widgets
        // instead of looping back to the model (which causes context overflow + hallucinations)
        if(queriesSucceeded>0){
          const summaryLines=allWidgets.map(w=>{
            if(w.type==="metric"){
              const val=w.format==="currency"?"$"+Number(w.value).toFixed(2):Number(w.value).toFixed(2);
              return `**${w.title}:** ${val}`;
            }
            if(w.type==="pie"||w.type==="bar"||w.type==="line"||w.type==="area"){
              const top=w.data&&w.data[0];
              return top?`Top category: **${top.name}** at $${Number(top.value).toFixed(2)}`:`Here is your ${w.title} breakdown.`;
            }
            if(w.type==="table"&&w.rows&&w.rows.length>0){
              return `Found ${w.rows.length} results.`;
            }
            return null;
          }).filter(Boolean);
          // Update last message to include summary text if we have it
          if(summaryLines.length>0){
            const summaryText=summaryLines.join("\n");
            setMessages(prev=>{
              const copy=[...prev];
              // Find the last assistant message we just added and give it display text
              for(let idx=copy.length-1;idx>=0;idx--){
                if(copy[idx].role==="assistant"){
                  copy[idx]={...copy[idx],display:summaryText};
                  break;
                }
              }
              return copy;
            });
          }
          break;
        }
        // No successful queries yet — feed results back for model to retry/fix its query
        llmMsgs=[
          ...llmMsgs,
          {role:"assistant",content:assistantText},
          {role:"user",content:`QUERY RESULTS:\n${toolResultLines.join("\n")}\n\nIf there were errors, fix the JavaScript and try again with a corrected query call.`}
        ];
      }
    }catch(e){
      setError(e.message);
      setMessages(prev=>[...prev,{role:"assistant",display:"Error: "+e.message,content:"",widgets:[]}]);
    }

    // Last-resort fallback: if no query succeeded (refused, errored, or never tried)
    // run a reliable pre-built query directly — no model involvement
    // Also clear any model text shown, since it's boilerplate not real data
    if(queriesSucceeded===0){
      setMessages(prev=>{
        const copy=[...prev];
        for(let i=copy.length-1;i>=0;i--){
          if(copy[i].role==="assistant"&&copy[i].display){
            copy[i]={...copy[i],display:null};
            break;
          }
        }
        return copy;
      });
      const q=userMsg.toLowerCase();
      const curM=new Date().toISOString().slice(0,7);
      // Ordered by specificity — first match wins
      const FALLBACKS=[
        {
          test:q=>q.includes("most")&&(q.includes("categor")||q.includes("spend")),
          js:`(function(){var acc={};data.txns.filter(function(t){return t.type==='expense';}).forEach(function(t){var c=t.category||'Other';acc[c]=(acc[c]||0)+t.amount;});var sorted=Object.entries(acc).sort(function(a,b){return b[1]-a[1];});return sorted.map(function(e){return {name:e[0],value:e[1]};});})()`,
          label:"Spending by category"
        },
        {
          test:q=>q.includes("categor")||q.includes("breakdown"),
          js:`(function(){var acc={};data.txns.filter(function(t){return t.type==='expense';}).forEach(function(t){var c=t.category||'Other';acc[c]=(acc[c]||0)+t.amount;});return Object.entries(acc).sort(function(a,b){return b[1]-a[1];}).map(function(e){return {name:e[0],value:e[1]};});})()`,
          label:"Spending by category"
        },
        {
          test:q=>(q.includes("spend")||q.includes("spent"))&&q.includes("month"),
          js:`(function(){var m='${curM}';return data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);})()`,
          label:"Spending this month"
        },
        {
          test:q=>q.includes("income")&&q.includes("month"),
          js:`(function(){var m='${curM}';return data.txns.filter(function(t){return t.type==='income'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);})()`,
          label:"Income this month"
        },
        {
          test:q=>q.includes("bill"),
          js:`data.bills.filter(function(b){return b.active!==false;}).map(function(b){return {name:b.name,value:b.amount};})`,
          label:"Monthly bills"
        },
        {
          test:q=>q.includes("net")||(q.includes("income")&&q.includes("expense")),
          js:`(function(){var m='${curM}';var inc=data.txns.filter(function(t){return t.type==='income'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);var exp=data.txns.filter(function(t){return t.type==='expense'&&t.date&&t.date.slice(0,7)===m;}).reduce(function(s,t){return s+t.amount;},0);return inc-exp;})()`,
          label:"Net position this month"
        },
        {
          test:q=>q.includes("spend")||q.includes("spent"),
          js:`data.txns.filter(function(t){return t.type==='expense';}).reduce(function(s,t){return s+t.amount;},0)`,
          label:"Total spending"
        },
        {
          test:q=>q.includes("income"),
          js:`data.txns.filter(function(t){return t.type==='income';}).reduce(function(s,t){return s+t.amount;},0)`,
          label:"Total income"
        },
      ];
      const match=FALLBACKS.find(f=>f.test(q));
      if(match){
        try{
          const r=await fetch("/api/llm/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:match.js})});
          const d=await r.json();
          if(d.result!==undefined&&!d.error){
            const aw=autoWidget(uid(),match.label,d.result,preferredChartType);
            if(aw) setMessages(prev=>[...prev,{role:"assistant",display:null,content:"",widgets:[aw]}]);
          }
        }catch{}
      }
    }

    setLoading(false);
    setTimeout(()=>inputRef.current?.focus(),50);
  };

  const send=()=>{
    const msg=input.trim();
    if(!msg||loading)return;
    setInput("");
    runAgent(msg);
  };

  const SUGGESTIONS=["How much have I spent this month?","Show spending by category as a pie chart","What's my net position?","Show my monthly income vs expenses as a bar chart","How much do I pay in bills per month?","What's my total portfolio value?","Navigate to net worth"];

  const hasMsgs=messages.length>0;

  if(blocked) return <DiscreteModeBlockedCard />;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 120px)",minHeight:500}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexShrink:0}}>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Insights &amp; Analytics</h2>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>Local processing only · powered by {settings?.ollamaModel||"phi3:mini"}</div>
        </div>
        {(widgets.length>0||hasMsgs)&&(
          <div style={{display:"flex",gap:8}}>
            {widgets.length>0&&<button onClick={()=>onSetWidgets([])} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #fecaca",background:"#fef2f2",color:"#dc2626",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>Clear Charts</button>}
            {hasMsgs&&<button onClick={()=>setMessages([])} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",color:"#64748b",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>Clear Chat</button>}
          </div>
        )}
      </div>

      {/* Pinned widgets board */}
      {widgets.length>0&&(
        <div style={{marginBottom:16,flexShrink:0}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Pinned Charts</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
            {widgets.map(w=><InsightWidget key={`pin-${w.id}`} w={w} onRemove={id=>onSetWidgets(prev=>prev.filter(x=>x.id!==id))}/>)}
          </div>
        </div>
      )}

      {/* Chat area */}
      <div style={{flex:1,overflowY:"auto",marginBottom:12,display:"flex",flexDirection:"column",gap:12}}>
        {/* Welcome / suggestions */}
        {!hasMsgs&&(
          <div style={{...CA,textAlign:"center",padding:"32px 24px"}}>
            <div style={{fontWeight:700,fontSize:16,color:"#1E293B",marginBottom:6}}>Ask anything about your finances</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>Runs locally — your data stays on your machine.</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center"}}>
              {SUGGESTIONS.map(s=>(
                <button key={s} onClick={()=>runAgent(s)} style={{padding:"7px 14px",borderRadius:20,border:"1.5px solid #bae6fd",background:"#f0f9ff",color:"#0284C7",cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:500}}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((m,i)=>{
          const isUser=m.role==="user";
          const hasWidgets=m.widgets&&m.widgets.length>0;
          const isMetricOnly=hasWidgets&&m.widgets.every(w=>w.type==="metric")&&!m.display;
          return(
            <div key={i} style={{display:"flex",flexDirection:"column",alignItems:isUser?"flex-end":"flex-start",gap:10}}>
              {/* User bubble */}
              {isUser&&m.display&&(
                <div style={{maxWidth:"72%",padding:"9px 15px",borderRadius:"18px 18px 4px 18px",background:"linear-gradient(135deg,#0284C7,#0369a1)",color:"#fff",fontSize:13,lineHeight:1.6,boxShadow:"0 1px 6px rgba(2,132,199,0.25)"}}>
                  {m.display}
                </div>
              )}
              {/* Assistant text bubble */}
              {!isUser&&m.display&&(
                <div style={{maxWidth:"82%",padding:"12px 16px",borderRadius:"4px 18px 18px 18px",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",border:"1px solid #e2e8f0"}}>
                  <RenderMD text={m.display}/>
                </div>
              )}
              {/* Widgets — full-width standalone cards */}
              {hasWidgets&&(
                <div style={{width:"100%",display:"grid",gridTemplateColumns:isMetricOnly?"repeat(auto-fill,minmax(180px,1fr))":"1fr",gap:10}}>
                  {m.widgets.map(w=>(
                    <div key={`msg-${i}-${w.id}`} style={{position:"relative"}}>
                      <InsightWidget w={w} onRemove={id=>setMessages(prev=>prev.map(msg=>({...msg,widgets:(msg.widgets||[]).filter(x=>x.id!==id)})))}/>
                      <button
                        onClick={()=>onSetWidgets(prev=>[...prev,w])}
                        title="Pin to board"
                        style={{position:"absolute",top:8,right:32,background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:10,color:"#0284C7",fontFamily:"inherit",fontWeight:600}}
                      >Pin</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Loading indicator */}
        {loading&&(
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{display:"flex",gap:4}}>
              {[0,1,2].map(i=><span key={i} style={{width:7,height:7,borderRadius:"50%",background:"#0284C7",display:"inline-block",animation:`bounce 1.2s ${i*0.2}s infinite`}}/>)}
            </div>
            <span style={{fontSize:12,color:"#94a3b8"}}>Thinking…</span>
          </div>
        )}
        <div ref={chatEndRef}/>
      </div>

      {/* Input bar */}
      <div style={{flexShrink:0,display:"flex",gap:10,alignItems:"flex-end",background:"#fff",borderRadius:14,border:"1.5px solid #e2e8f0",padding:"10px 14px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="Ask anything… e.g. 'Show my spending by category' or 'Navigate to net worth'"
          style={{flex:1,border:"none",outline:"none",resize:"none",fontSize:13,fontFamily:"inherit",lineHeight:1.5,maxHeight:120,minHeight:24,overflow:"auto",background:"transparent",color:"#1E293B"}}
          rows={1}
          disabled={loading}
        />
        <button onClick={send} disabled={loading||!input.trim()} style={{flexShrink:0,padding:"8px 18px",borderRadius:10,border:"none",background:loading||!input.trim()?"#e2e8f0":"linear-gradient(135deg,#0284C7,#0369a1)",color:loading||!input.trim()?"#94a3b8":"#fff",cursor:loading||!input.trim()?"not-allowed":"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",transition:"all .15s"}}>
          Send
        </button>
      </div>

      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
    </div>
  );
}

// NAV_ITEMS imported from ./constants/index.js

// ── In-depth mode context — lets any component make itself selectable ─────────

export { Insights };

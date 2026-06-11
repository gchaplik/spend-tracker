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

function parseToolCalls(text){
  const out=[];
  const re=/<tool>([\s\S]*?)<\/tool>/g;
  let m;
  while((m=re.exec(text))!==null){
    try{out.push(JSON.parse(m[1].trim()));}catch{}
  }
  return out;
}

function InsightWidget({w,onRemove}){
  const CHART_H=220;
  const colors=COLORS;
  const fmtVal=(v,fmt_)=>{
    if(fmt_==="currency")return fmt(Number(v));
    if(fmt_==="percent")return Number(v).toFixed(1)+"%";
    if(typeof v==="number")return Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
    return String(v);
  };
  return(
    <div style={{...CA,position:"relative",padding:"16px 18px"}}>
      <button onClick={()=>onRemove(w.id)} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",fontSize:15,color:"#cbd5e1",lineHeight:1,zIndex:2,fontFamily:"inherit"}}>×</button>
      {w.title&&<div style={{fontSize:12,fontWeight:600,color:"#64748b",marginBottom:10,paddingRight:24}}>{fmtLabel(w.title)}</div>}

      {w.type==="metric"&&(
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <div style={{fontSize:34,fontWeight:800,color:"#0284C7",letterSpacing:"-1.5px",lineHeight:1}}>{fmtVal(w.value,w.format)}</div>
          {w.label&&<div style={{fontSize:12,color:"#94a3b8",fontWeight:500}}>{w.label}</div>}
        </div>
      )}

      {w.type==="bar"&&(
        <ResponsiveContainer width="100%" height={CHART_H}>
          <BarChart data={w.data} margin={{top:4,right:4,left:0,bottom:30}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey={w.xKey||"name"} tick={{fontSize:10}} angle={-30} textAnchor="end" interval={0}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>w.format==="currency"?("$"+Math.round(v)):v}/>
            <Tooltip formatter={(v)=>fmtVal(v,w.format)} contentStyle={{borderRadius:8,fontSize:12}}/>
            {(w.multiKeys||[w.yKey||"value"]).map((k,i)=>(
              <Bar key={k} dataKey={k} fill={w.colors?.[i]||w.color||colors[i%colors.length]} radius={[4,4,0,0]}>
                {!w.multiKeys&&w.data.map((_,ci)=><Cell key={ci} fill={w.color||colors[ci%colors.length]}/>)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {w.type==="line"&&(
        <ResponsiveContainer width="100%" height={CHART_H}>
          <LineChart data={w.data} margin={{top:4,right:4,left:0,bottom:20}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey={w.xKey||"name"} tick={{fontSize:10}}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>w.format==="currency"?("$"+Math.round(v)):v}/>
            <Tooltip formatter={(v)=>fmtVal(v,w.format)} contentStyle={{borderRadius:8,fontSize:12}}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            {(w.multiKeys||[w.yKey||"value"]).map((k,i)=>(
              <Line key={k} type="monotone" dataKey={k} stroke={w.colors?.[i]||w.color||colors[i%colors.length]} strokeWidth={2} dot={false}/>
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {w.type==="area"&&(
        <ResponsiveContainer width="100%" height={CHART_H}>
          <AreaChart data={w.data} margin={{top:4,right:4,left:0,bottom:20}}>
            <defs>
              {(w.multiKeys||[w.yKey||"value"]).map((k,i)=>(
                <linearGradient key={k} id={`ag${w.id}${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={w.colors?.[i]||w.color||colors[i%colors.length]} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={w.colors?.[i]||w.color||colors[i%colors.length]} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey={w.xKey||"name"} tick={{fontSize:10}}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>w.format==="currency"?("$"+Math.round(v)):v}/>
            <Tooltip formatter={(v)=>fmtVal(v,w.format)} contentStyle={{borderRadius:8,fontSize:12}}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            {(w.multiKeys||[w.yKey||"value"]).map((k,i)=>(
              <Area key={k} type="monotone" dataKey={k} stroke={w.colors?.[i]||w.color||colors[i%colors.length]} strokeWidth={2} fill={`url(#ag${w.id}${i})`}/>
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {w.type==="pie"&&(
        <ResponsiveContainer width="100%" height={320}>
          <PieChart margin={{top:20,right:90,bottom:20,left:90}}>
            <Pie
              data={w.data}
              dataKey={w.yKey||"value"}
              nameKey={w.xKey||"name"}
              cx="50%" cy="50%"
              outerRadius={75}
              paddingAngle={2}
              labelLine={{stroke:"#94a3b8",strokeWidth:1}}
              label={({name,percent,x,y,textAnchor})=>{
                if(percent<0.05) return <text/>;
                const short=name.length>9?name.slice(0,9)+"…":name;
                return(
                  <text x={x} y={y} textAnchor={textAnchor} fill="#374151" fontSize={11} fontFamily="system-ui,sans-serif">
                    {`${short} ${(percent*100).toFixed(0)}%`}
                  </text>
                );
              }}
            >
              {(w.data||[]).map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}
            </Pie>
            <Tooltip formatter={(v)=>fmtVal(v,w.format)} contentStyle={{borderRadius:8,fontSize:12}}/>
            <Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>
          </PieChart>
        </ResponsiveContainer>
      )}

      {w.type==="table"&&(
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>{(w.columns||[]).map(c=><th key={c} style={{textAlign:"left",padding:"6px 10px 6px 0",color:"#94a3b8",fontWeight:600,borderBottom:"1px solid #f1f5f9",whiteSpace:"nowrap"}}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {(w.rows||[]).map((row,i)=>(
                <tr key={i} style={{borderBottom:"1px solid #f8fafc"}}>
                  {row.map((cell,j)=><td key={j} style={{padding:"6px 10px 6px 0",color:"#374151"}}>{typeof cell==="number"&&w.format==="currency"?fmtVal(cell,"currency"):String(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Simple markdown-lite renderer for assistant responses
function RenderMD({text}){
  if(!text) return null;
  const parseBold=str=>{
    const parts=str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p,i)=>p.startsWith("**")&&p.endsWith("**")?<strong key={i} style={{fontWeight:700}}>{p.slice(2,-2)}</strong>:p);
  };
  const lines=text.split("\n");
  const out=[];
  let listItems=[];
  let keyIdx=0;
  const k=()=>keyIdx++;
  const flushList=()=>{
    if(!listItems.length) return;
    const items=[...listItems]; listItems=[];
    out.push(<ul key={k()} style={{margin:"6px 0 6px 4px",paddingLeft:16,display:"flex",flexDirection:"column",gap:3}}>{items.map((li,i)=><li key={i} style={{fontSize:13,color:"#1E293B",lineHeight:1.55}}>{parseBold(li)}</li>)}</ul>);
  };
  lines.forEach(line=>{
    const t=line.trim();
    if(!t){flushList();return;}
    if(t.startsWith("### ")){flushList();out.push(<div key={k()} style={{fontSize:13,fontWeight:700,color:"#0284C7",marginTop:8,marginBottom:2}}>{t.slice(4)}</div>);return;}
    if(t.startsWith("## ")){flushList();out.push(<div key={k()} style={{fontSize:15,fontWeight:800,color:"#0f172a",marginTop:10,marginBottom:4}}>{t.slice(3)}</div>);return;}
    if(t.startsWith("# ")){flushList();out.push(<div key={k()} style={{fontSize:17,fontWeight:800,color:"#0f172a",marginTop:10,marginBottom:6}}>{t.slice(2)}</div>);return;}
    if(t.startsWith("- ")||t.startsWith("* ")){listItems.push(t.slice(2));return;}
    if(/^\d+\.\s/.test(t)){listItems.push(t.replace(/^\d+\.\s/,""));return;}
    flushList();
    out.push(<p key={k()} style={{margin:"2px 0",fontSize:13,color:"#1E293B",lineHeight:1.6}}>{parseBold(t)}</p>);
  });
  flushList();
  return <div style={{display:"flex",flexDirection:"column"}}>{out}</div>;
}

// Format a snake_case or raw query id into a readable label
function fmtLabel(s){
  return s.replace(/[_-]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

// Detect preferred chart type from a user message string
function detectChartType(msg){
  const m=(msg||"").toLowerCase();
  if(m.includes("pie")) return "pie";
  if(m.includes("line")) return "line";
  if(m.includes("area")) return "area";
  if(m.includes("bar")) return "bar";
  if(m.includes("table")) return "table";
  return null; // no preference — autoWidget picks best
}

// Auto-generate a widget from a raw query result
function autoWidget(id,label,result,preferredType){
  label=fmtLabel(label);
  if(result===null||result===undefined) return null;
  // Plain number → always metric regardless of preference
  if(typeof result==="number"){
    const isCurrency=/(spend|income|total|amount|balance|value|paid|net|bill|cost|price)/i.test(label);
    return{id:uid(),type:"metric",title:label,value:result,format:isCurrency?"currency":"number"};
  }
  // Normalise plain object → array
  let data=null;
  if(typeof result==="object"&&!Array.isArray(result)){
    const entries=Object.entries(result);
    if(entries.length>0&&entries.every(([,v])=>typeof v==="number")){
      data=entries.map(([k,v])=>({name:k,value:v}));
    }
  }
  if(!data&&Array.isArray(result)&&result.length>0){
    if(typeof result[0]==="object"&&result[0]!==null){
      const keys=Object.keys(result[0]);
      // Scalar-with-metadata shape: [{value:X, count:N}] — single row, no name key
      // Render as metric using the `value` field, ignore `count`
      if(result.length===1&&result[0].value!=null&&!keys.includes("name")){
        const v=result[0].value;
        const isCurrency=/(spend|income|total|amount|balance|value|paid|net|bill|cost|price)/i.test(label);
        const cnt=typeof result[0].count==="number"?result[0].count:null;
        return{id:uid(),type:"metric",title:label,value:v,format:isCurrency?"currency":"number",subtitle:cnt!=null?`${cnt} transaction${cnt!==1?"s":""} `:undefined};
      }
      const numKey=keys.find(k=>typeof result[0][k]==="number");
      const strKey=keys.find(k=>typeof result[0][k]==="string");
      if(numKey&&strKey){
        data=result.slice(0,20).map(r=>({name:String(r[strKey]),value:r[numKey]}));
      } else {
        // table fallback — skip pure-numeric columns named 'count' to avoid currency formatting
        const displayKeys=keys.filter(k=>k!=="count");
        return{id:uid(),type:"table",title:label,columns:displayKeys,rows:result.slice(0,20).map(r=>displayKeys.map(k=>r[k]??"")),format:"currency"};
      }
    } else if(typeof result[0]==="number"){
      data=result.map((v,i)=>({name:String(i+1),value:v}));
    }
  }
  if(!data) return null;
  // Apply preferred type or fall back to sensible defaults
  const chartType=preferredType||(data.length<=8?"pie":"bar");
  if(chartType==="table"){
    return{id:uid(),type:"table",title:label,columns:["Category","Amount"],rows:data.map(d=>[d.name,d.value]),format:"currency"};
  }
  return{id:uid(),type:chartType,title:label,data,xKey:"name",yKey:"value",format:"currency"};
}



export { parseToolCalls, InsightWidget, RenderMD, fmtLabel, detectChartType, autoWidget };

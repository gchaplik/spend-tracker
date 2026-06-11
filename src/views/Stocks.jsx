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

const STOCK_COLORS=["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#ec4899","#f97316"];

function StockPriceChart({holdings}){
  const RANGES=[
    {l:"1W",v:"5d",iv:"1h"},
    {l:"1M",v:"1mo",iv:"1d"},
    {l:"3M",v:"3mo",iv:"1d"},
    {l:"6M",v:"6mo",iv:"1wk"},
    {l:"1Y",v:"1y",iv:"1wk"},
    {l:"YTD",v:"ytd",iv:"1d"},
    {l:"5Y",v:"5y",iv:"1mo"},
    {l:"All",v:"max",iv:"3mo"},
  ];
  const [range,setRange]=useState("1mo");
  const [chartData,setChartData]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [pinA,setPinA]=useState(null); // {date, vals:{ticker: normalizedPct}}
  const [hover,setHover]=useState(null); // same shape, tracks mouse position
  const chartRef=useRef(null);

  // Clear pin when clicking outside the chart card
  useEffect(()=>{
    const onDocClick=(e)=>{
      if(chartRef.current&&!chartRef.current.contains(e.target)){
        setPinA(null);setHover(null);
      }
    };
    document.addEventListener("mousedown",onDocClick);
    return()=>document.removeEventListener("mousedown",onDocClick);
  },[]);

  useEffect(()=>{
    if(!holdings.length){setChartData([]);return;}
    setPinA(null);setHover(null);
    setLoading(true);setError(null);
    const rv=RANGES.find(r=>r.v===range)||RANGES[1];
    Promise.all(holdings.map(h=>
      fetch(`/api/stocks/history?symbol=${h.ticker}&range=${rv.v}&interval=${rv.iv}`)
        .then(r=>r.json()).catch(()=>({symbol:h.ticker,points:[]}))
    )).then(results=>{
      const seriesMap={};
      results.forEach(({symbol,points})=>{
        if(!points||!points.length)return;
        const base=points[0].close;
        points.forEach(p=>{
          if(!seriesMap[p.date])seriesMap[p.date]={date:p.date};
          seriesMap[p.date][symbol]=base>0?+((p.close-base)/base*100).toFixed(4):0;
        });
      });
      setChartData(Object.values(seriesMap).sort((a,b)=>a.date.localeCompare(b.date)));
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[holdings.map(h=>h.ticker).join(","),range]);

  const [selected,setSelected]=useState(()=>new Set(holdings.map(h=>h.ticker)));
  // Keep selected in sync when holdings change (add newly added tickers, remove deleted)
  useEffect(()=>{
    const all=new Set(holdings.map(h=>h.ticker));
    setSelected(prev=>{
      const next=new Set([...prev].filter(t=>all.has(t)));
      all.forEach(t=>{if(!prev.has(t))next.add(t);});
      return next;
    });
  },[holdings.map(h=>h.ticker).join(",")]);// eslint-disable-line

  const toggleTicker=(tk)=>setSelected(prev=>{
    const next=new Set(prev);
    if(next.has(tk)){if(next.size>1)next.delete(tk);}
    else next.add(tk);
    return next;
  });

  if(!holdings.length)return null;

  const tickers=holdings.map(h=>h.ticker);
  const activeTickers=tickers.filter(t=>selected.has(t));

  // Period change for each active ticker (first → last data point)
  const periodChange=tk=>{
    const pts=chartData.filter(d=>d[tk]!=null);
    if(pts.length<2)return null;
    return pts[pts.length-1][tk]; // normalized pct from period start
  };

  const extractPoint=(data)=>{
    if(!data||!data.activeLabel)return null;
    const vals={};
    (data.activePayload||[]).forEach(p=>{vals[p.dataKey]=p.value;});
    return{date:data.activeLabel,vals};
  };

  const handleClick=(data)=>{
    const pt=extractPoint(data);
    if(!pt)return;
    if(!pinA||pt.date===pinA.date){setPinA(pt);}
    else{setPinA(pt);}  // clicking always resets the pin to the new point
  };

  const handleMouseMove=(data)=>{
    const pt=extractPoint(data);
    setHover(pt);
  };

  const handleMouseLeave=()=>setHover(null);

  // % return from pinA to any point
  const compareReturn=(a,b)=>((1+b/100)/(1+a/100)-1)*100;

  const comparePoint=pinA&&hover&&hover.date!==pinA.date?hover:null;

  const fmtPct=v=>(v>=0?"+":"")+v.toFixed(2)+"%";

  return(
    <div ref={chartRef} style={{...CA,marginTop:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>Stock Performance</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {RANGES.map(r=>(
            <button key={r.v} onClick={()=>setRange(r.v)} style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(range===r.v?"#3b82f6":"#e2e8f0"),background:range===r.v?"#3b82f6":"#fff",color:range===r.v?"#fff":"#64748b",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{r.l}</button>
          ))}
        </div>
      </div>

      {/* Ticker filter chips + period change summary */}
      <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
        {tickers.map((tk,i)=>{
          const color=STOCK_COLORS[i%STOCK_COLORS.length];
          const isOn=selected.has(tk);
          const pct=periodChange(tk);
          return(
            <button key={tk} onClick={()=>toggleTicker(tk)} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:20,border:`1.5px solid ${isOn?color:"#e2e8f0"}`,background:isOn?color+"18":"#f8fafc",cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:isOn?color:"#cbd5e1",flexShrink:0,display:"inline-block"}}/>
              <span style={{fontSize:11,fontWeight:700,color:isOn?color:"#94a3b8"}}>{tk}</span>
              {pct!=null&&isOn&&<span style={{fontSize:11,fontWeight:700,color:pct>=0?"#059669":"#dc2626"}}>{fmtPct(pct)}</span>}
            </button>
          );
        })}
      </div>

      {/* Compare panel — hover after pin */}
      {pinA&&comparePoint&&(
        <div style={{marginBottom:10,padding:"10px 14px",borderRadius:10,background:"#f0f9ff",border:"1px solid #bae6fd",display:"flex",flexWrap:"wrap",gap:14,alignItems:"center"}}>
          <div style={{fontSize:11,color:"#0284C7",fontWeight:600}}>{pinA.date} → {comparePoint.date}</div>
          {activeTickers.map((tk,i)=>{
            const globalIdx=tickers.indexOf(tk);
            const a=pinA.vals[tk]??null;
            const b=comparePoint.vals[tk]??null;
            if(a==null||b==null)return null;
            const ret=compareReturn(a,b);
            return(
              <div key={tk} style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:STOCK_COLORS[globalIdx%STOCK_COLORS.length],display:"inline-block"}}/>
                <span style={{fontSize:12,fontWeight:600,color:"#374151"}}>{tk}</span>
                <span style={{fontSize:13,fontWeight:800,color:ret>=0?"#059669":"#dc2626"}}>{fmtPct(ret)}</span>
              </div>
            );
          })}
          <button onClick={(e)=>{e.stopPropagation();setPinA(null);}} style={{marginLeft:"auto",fontSize:11,color:"#94a3b8",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>✕ Clear</button>
        </div>
      )}
      {pinA&&!comparePoint&&(
        <div style={{marginBottom:10,padding:"8px 14px",borderRadius:10,background:"#fefce8",border:"1px solid #fde68a",fontSize:11,color:"#92400e",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span>From: <strong>{pinA.date}</strong> — hover to compare · click to repin</span>
          <button onClick={(e)=>{e.stopPropagation();setPinA(null);}} style={{fontSize:11,color:"#94a3b8",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",marginLeft:12}}>✕ Clear</button>
        </div>
      )}

      {loading&&<div style={{textAlign:"center",padding:"32px 0",color:"#94a3b8",fontSize:13}}>Loading…</div>}
      {error&&<div style={{color:"#dc2626",fontSize:12,padding:"8px 0"}}>{error}</div>}
      {!loading&&chartData.length>0&&(
        <>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{top:4,right:8,left:0,bottom:0}} onClick={handleClick} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} style={{cursor:pinA?"crosshair":"default"}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="date" tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={d=>d.slice(5)} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={v=>v.toFixed(0)+"%"} tickLine={false} axisLine={false} width={40}/>
              <Tooltip formatter={(v,name)=>[fmtPct(Number(v)),name]} labelStyle={{fontSize:11,color:"#64748b"}} contentStyle={{fontSize:12,borderRadius:8,border:"1px solid #e2e8f0",boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}/>
              {pinA&&<ReferenceLine x={pinA.date} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2" label={{value:"from",position:"top",fill:"#f59e0b",fontSize:10,fontWeight:700}}/>}
              {tickers.map((tk,i)=>(
                <Line key={tk} type="monotone" dataKey={tk} stroke={STOCK_COLORS[i%STOCK_COLORS.length]} strokeWidth={selected.has(tk)?2:0} strokeOpacity={selected.has(tk)?1:0} dot={false} activeDot={selected.has(tk)?{r:4}:false} connectNulls hide={!selected.has(tk)}/>
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div style={{fontSize:10,color:"#94a3b8",marginTop:2,textAlign:"right"}}>% change · normalized · {pinA?"hover to compare · click to repin":"click to pin start date"}</div>
        </>
      )}
    </div>
  );
}

function Stocks({holdings,onSaveHoldings,onPricesUpdate,onFxRateUpdate}){
  const nfmt=useNfmt();
  const [prices,setPrices]=useState({});
  const [fxRate,setFxRate]=useState(1.38); // USD→CAD live rate
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [lastUpdated,setLastUpdated]=useState(null);

  // helpers
  const getCur=tk=>prices[tk]?.currency??(tk.toUpperCase().endsWith('.TO')?'CAD':'USD');
  const fmtN=(n,cur)=>cur==='USD'&&!window.__discreteMode?fmtUSD(n):nfmt(n);
  const toCAD=(amount,cur)=>cur==='USD'?amount*fxRate:amount;
  const [form,setForm]=useState({ticker:"",shares:"",costBasis:""});
  const [editId,setEditId]=useState(null);
  const [editF,setEditF]=useState({});
  const setF=(k,v)=>setForm(p=>({...p,[k]:v}));

  const fetchPrices=async(hdgs=holdings)=>{
    if(!hdgs.length)return;
    setLoading(true);setError(null);
    try{
      const symbols=hdgs.map(h=>h.ticker.toUpperCase()).join(",");
      const [stockRes,fxRes]=await Promise.all([
        fetch(`/api/stocks?symbols=${encodeURIComponent(symbols)}`),
        fetch(`/api/stocks?symbols=USDCAD%3DX`),
      ]);
      const stockData=await stockRes.json();
      const fxData=await fxRes.json();
      if(stockData.error)throw new Error(stockData.error);
      const map=Object.fromEntries((stockData.quotes||[]).map(q=>[q.symbol,q]));
      const rate=fxData.quotes?.[0]?.price??fxRate;
      setPrices(map);
      setFxRate(rate);
      onPricesUpdate&&onPricesUpdate(map);
      onFxRateUpdate&&onFxRateUpdate(rate);
      setLastUpdated(new Date());
    }catch(e){setError("Could not fetch prices: "+e.message);}
    setLoading(false);
  };

  useEffect(()=>{
    if(holdings.length){fetchPrices();}
    const iv=setInterval(()=>{if(holdings.length)fetchPrices();},60000);
    return()=>clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[holdings.map(h=>h.ticker).join(",")]);

  const add=()=>{
    const tk=form.ticker.trim().toUpperCase();
    if(!tk||!form.shares)return;
    if(holdings.some(h=>h.ticker===tk)){setError("Already tracking "+tk);return;}
    const next=[...holdings,{id:uid(),ticker:tk,shares:parseFloat(form.shares)||0,costBasis:form.costBasis?parseFloat(form.costBasis):null}];
    onSaveHoldings(next);setForm({ticker:"",shares:"",costBasis:""});setError(null);
    setTimeout(()=>fetchPrices(next),300);
  };
  const remove=id=>onSaveHoldings(holdings.filter(h=>h.id!==id));
  const saveEdit=()=>{
    onSaveHoldings(holdings.map(h=>h.id===editId?{...h,shares:parseFloat(editF.shares)||0,costBasis:editF.costBasis?parseFloat(editF.costBasis):null}:h));
    setEditId(null);
  };

  const [showAdd,setShowAdd]=useState(false);
  const [quickId,setQuickId]=useState(null);
  const [quickShares,setQuickShares]=useState("");

  const confirmQuickAdd=()=>{
    const n=parseFloat(quickShares);
    if(!n||n<=0){setQuickId(null);setQuickShares("");return;}
    onSaveHoldings(holdings.map(h=>{
      if(h.id!==quickId)return h;
      const curPrice=prices[h.ticker]?.price??null;
      const newShares=h.shares+n;
      let newCostBasis=h.costBasis;
      if(curPrice!=null){
        const oldCost=(h.costBasis??curPrice)*h.shares;
        newCostBasis=+(( oldCost+curPrice*n)/newShares).toFixed(4);
      }
      return{...h,shares:+newShares.toFixed(6),costBasis:newCostBasis};
    }));
    setQuickId(null);setQuickShares("");
  };
  // Native-currency per-holding value
  const hVal=h=>(prices[h.ticker]?.price??0)*h.shares;
  // CAD-converted totals (for combined display)
  const totalValueCAD=holdings.reduce((s,h)=>s+toCAD(hVal(h),getCur(h.ticker)),0);
  const totalCostCAD=holdings.filter(h=>h.costBasis!=null).reduce((s,h)=>s+toCAD(h.costBasis*h.shares,getCur(h.ticker)),0);
  const totalGainCAD=totalCostCAD>0?totalValueCAD-totalCostCAD:null;
  // For USD-only / CAD-only display
  const hasUSD=holdings.some(h=>getCur(h.ticker)==='USD');
  const hasCAD=holdings.some(h=>getCur(h.ticker)==='CAD');
  const isMixed=hasUSD&&hasCAD;
  const anyOpen=Object.values(prices).some(q=>q.marketState==="REGULAR");

  return(
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-0.3px"}}>Stock Portfolio</h2>
          {lastUpdated&&<div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Prices as of {lastUpdated.toLocaleTimeString()} · {anyOpen?<span style={{color:"#059669",fontWeight:600}}>Market Open</span>:<span style={{color:"#94a3b8"}}>Market Closed</span>}</div>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setShowAdd(v=>!v)} style={{padding:"7px 14px",borderRadius:10,border:"1.5px solid "+(showAdd?"#0284C7":"#e2e8f0"),background:showAdd?"#0284C7":"#fff",color:showAdd?"#fff":"#374151",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
            {showAdd?"✕ Close":"+ Add Holding"}
          </button>
          <button onClick={()=>fetchPrices()} disabled={loading||!holdings.length} style={{padding:"7px 14px",borderRadius:10,border:"1.5px solid #bae6fd",background:"#fff",color:"#0284C7",cursor:loading||!holdings.length?"not-allowed":"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:loading||!holdings.length?0.5:1}}>
            {loading?"Updating…":"↻ Refresh"}
          </button>
        </div>
      </div>

      {error&&<div style={{marginBottom:14,padding:"10px 14px",borderRadius:10,background:"#fee2e2",color:"#b91c1c",fontSize:13,border:"1px solid #fecaca"}}>{error}</div>}

      {/* Collapsible add form */}
      {(showAdd||holdings.length===0)&&(
        <div style={{...CA,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:6}}>
            <div style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>{holdings.length===0?"Add Your First Holding":"Add Holding"}</div>
            <div style={{fontSize:11,color:"#94a3b8"}}>Canadian stocks: use <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:4,fontSize:11}}>SHOP.TO</code>, <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:4,fontSize:11}}>RY.TO</code>, etc.</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <Fld label="Ticker Symbol"><input style={IS} value={form.ticker} onChange={e=>setF("ticker",e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="e.g. AAPL, TSLA" autoFocus={showAdd}/></Fld>
            <Fld label="Number of Shares"><input style={IS} type="number" min="0" step="any" value={form.shares} onChange={e=>setF("shares",e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="10"/></Fld>
            <Fld label="Cost per Share (optional)"><input style={IS} type="number" min="0" step="any" value={form.costBasis} onChange={e=>setF("costBasis",e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="For gain/loss"/></Fld>
          </div>
          <Btn onClick={()=>{add();setShowAdd(false);}} disabled={!form.ticker.trim()||!form.shares} full>Add &amp; Fetch Price</Btn>
        </div>
      )}

      {/* Chart */}
      <StockPriceChart holdings={holdings}/>

      {/* Summary cards */}
      {holdings.length>0&&(
        <div style={{marginTop:14,marginBottom:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
            {/* Portfolio Value card — shows mixed currencies if applicable */}
            <div style={{...CA,padding:"16px 20px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Portfolio Value</div>
              {isMixed?(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {hasUSD&&<div style={{display:"flex",alignItems:"baseline",gap:6}}>
                    <span style={{fontSize:18,fontWeight:800,color:"#1E293B",letterSpacing:"-0.4px"}}>{fmtN(holdings.filter(h=>getCur(h.ticker)==='USD').reduce((s,h)=>s+hVal(h),0),'USD')}</span>
                    <span style={{fontSize:11,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:20}}>USD</span>
                  </div>}
                  {hasCAD&&<div style={{display:"flex",alignItems:"baseline",gap:6}}>
                    <span style={{fontSize:18,fontWeight:800,color:"#1E293B",letterSpacing:"-0.4px"}}>{nfmt(holdings.filter(h=>getCur(h.ticker)==='CAD').reduce((s,h)=>s+hVal(h),0))}</span>
                    <span style={{fontSize:11,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:20}}>CAD</span>
                  </div>}
                </div>
              ):(
                <div style={{fontSize:22,fontWeight:800,color:"#1E293B",letterSpacing:"-0.5px"}}>{hasUSD?fmtN(totalValueCAD/fxRate,'USD'):nfmt(totalValueCAD)}</div>
              )}
            </div>
            {/* Gain/Loss card */}
            {totalGainCAD!=null&&(
              <div style={{...CA,padding:"16px 20px"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Total Gain / Loss</div>
                {isMixed?(
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {hasUSD&&(()=>{const usdHlds=holdings.filter(h=>getCur(h.ticker)==='USD'&&h.costBasis!=null);const g=usdHlds.reduce((s,h)=>s+hVal(h)-h.costBasis*h.shares,0);const c=usdHlds.reduce((s,h)=>s+h.costBasis*h.shares,0);return usdHlds.length?<div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:18,fontWeight:800,color:g>=0?"#059669":"#dc2626",letterSpacing:"-0.4px"}}>{g>=0?"+":""}{fmtN(g,'USD')}</span><span style={{fontSize:11,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:20}}>USD</span>{c>0&&<span style={{fontSize:11,color:g>=0?"#059669":"#dc2626",fontWeight:600}}>{g>=0?"+":""}{((g/c)*100).toFixed(2)}%</span>}</div>:null;})()}
                    {hasCAD&&(()=>{const cadHlds=holdings.filter(h=>getCur(h.ticker)==='CAD'&&h.costBasis!=null);const g=cadHlds.reduce((s,h)=>s+hVal(h)-h.costBasis*h.shares,0);const c=cadHlds.reduce((s,h)=>s+h.costBasis*h.shares,0);return cadHlds.length?<div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:18,fontWeight:800,color:g>=0?"#059669":"#dc2626",letterSpacing:"-0.4px"}}>{g>=0?"+":""}{nfmt(g)}</span><span style={{fontSize:11,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:20}}>CAD</span>{c>0&&<span style={{fontSize:11,color:g>=0?"#059669":"#dc2626",fontWeight:600}}>{g>=0?"+":""}{((g/c)*100).toFixed(2)}%</span>}</div>:null;})()}
                  </div>
                ):(
                  <>
                    <div style={{fontSize:20,fontWeight:800,color:totalGainCAD>=0?"#059669":"#dc2626",letterSpacing:"-0.5px"}}>{totalGainCAD>=0?"+":""}{hasUSD?fmtN(totalGainCAD/fxRate,'USD'):nfmt(totalGainCAD)}</div>
                    {totalCostCAD>0&&<div style={{fontSize:11,fontWeight:600,color:totalGainCAD>=0?"#059669":"#dc2626",marginTop:3}}>{totalGainCAD>=0?"+":""}{((totalGainCAD/totalCostCAD)*100).toFixed(2)}%</div>}
                  </>
                )}
              </div>
            )}
          </div>
          {/* Combined CAD subcard — only when mixed currencies */}
          {isMixed&&(
            <div style={{marginTop:8,padding:"10px 16px",borderRadius:12,background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1px solid #bae6fd",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:11,fontWeight:700,color:"#0369a1",textTransform:"uppercase",letterSpacing:"0.07em"}}>Combined Value</span>
                <span style={{fontSize:11,color:"#64748b",background:"#fff",border:"1px solid #bae6fd",padding:"1px 7px",borderRadius:20,fontWeight:600}}>CAD · 1 USD = {nfmt(fxRate)}</span>
              </div>
              <div style={{display:"flex",gap:24,alignItems:"baseline"}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:600}}>Portfolio</div>
                  <div style={{fontSize:18,fontWeight:800,color:"#0369a1",letterSpacing:"-0.4px"}}>{nfmt(totalValueCAD)}</div>
                </div>
                {totalGainCAD!=null&&<div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:600}}>Gain / Loss</div>
                  <div style={{fontSize:18,fontWeight:800,color:totalGainCAD>=0?"#059669":"#dc2626",letterSpacing:"-0.4px"}}>{totalGainCAD>=0?"+":""}{nfmt(totalGainCAD)}</div>
                </div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Holdings table */}
      {holdings.length>0&&(
        <div style={CA}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:quickId?"10px":"14px"}}>
            <div style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>Holdings</div>
            {!quickId
              ?<button onClick={()=>{setQuickId(holdings[0].id);setQuickShares("");setEditId(null);}} style={{padding:"4px 12px",borderRadius:8,border:"1.5px solid #bbf7d0",background:"#f0fdf4",color:"#059669",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>+ Add Shares</button>
              :<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <select value={quickId} onChange={e=>setQuickId(e.target.value)} style={{...IS,padding:"4px 8px",fontSize:12,width:"auto"}}>
                  {holdings.map(h=><option key={h.id} value={h.id}>{h.ticker}{prices[h.ticker]?.price!=null?" — "+fmtN(prices[h.ticker].price,getCur(h.ticker)):""}</option>)}
                </select>
                <input type="number" min="0" step="any" value={quickShares} onChange={e=>setQuickShares(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")confirmQuickAdd();if(e.key==="Escape"){setQuickId(null);setQuickShares("");} }} placeholder="# shares" style={{...IS,width:90,padding:"4px 8px",fontSize:12}} autoFocus/>
                {(()=>{const h=holdings.find(x=>x.id===quickId);const p=h&&prices[h.ticker]?.price;const c=h&&getCur(h.ticker);return p?<span style={{fontSize:11,color:"#94a3b8",whiteSpace:"nowrap"}}>@ {fmtN(p,c)}</span>:null;})()}
                <button onClick={confirmQuickAdd} disabled={!quickShares} style={{padding:"4px 12px",borderRadius:8,border:"none",background:"#059669",color:"#fff",cursor:quickShares?"pointer":"not-allowed",fontSize:12,fontWeight:600,fontFamily:"inherit",opacity:quickShares?1:0.5}}>Add</button>
                <button onClick={()=>{setQuickId(null);setQuickShares("");}} style={{padding:"4px 8px",borderRadius:8,border:"1px solid #e2e8f0",background:"none",color:"#94a3b8",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>✕</button>
              </div>
            }
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{borderBottom:"1px solid #f1f5f9"}}>
                  {["Symbol","Name","Shares","Price","Value","Gain / Loss",""].map(h=>(
                    <th key={h} style={{textAlign:h===""||h==="Shares"||h==="Price"||h==="Value"||h==="Gain / Loss"?"right":"left",padding:"0 12px 10px 0",color:"#94a3b8",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h=>{
                  const q=prices[h.ticker];
                  const cur=getCur(h.ticker);
                  const val=(q?.price??0)*h.shares;
                  const gain=h.costBasis!=null?val-h.costBasis*h.shares:null;
                  const gainPct=h.costBasis!=null&&h.costBasis>0?((gain/(h.costBasis*h.shares))*100):null;
                  return editId===h.id?(
                    <tr key={h.id} style={{borderBottom:"1px solid #f1f5f9",background:"#f8fbff"}}>
                      <td style={{padding:"10px 12px 10px 0",fontWeight:700,color:"#0284C7"}}>{h.ticker}</td>
                      <td colSpan={4} style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                          <input type="number" value={editF.shares} onChange={e=>setEditF(p=>({...p,shares:e.target.value}))} placeholder="Shares" style={{...IS,width:90}} autoFocus/>
                          <input type="number" value={editF.costBasis} onChange={e=>setEditF(p=>({...p,costBasis:e.target.value}))} placeholder="Cost/share (opt)" style={{...IS,width:130}}/>
                          <Btn sm onClick={saveEdit}>Save</Btn>
                          <Btn sm v="secondary" onClick={()=>setEditId(null)}>Cancel</Btn>
                        </div>
                      </td>
                      <td/><td/>
                    </tr>
                  ):(
                    <tr key={h.id} style={{borderBottom:"1px solid #f8fafc",background:quickId===h.id?"#f0fdf4":"transparent",transition:"background .15s"}}>
                      <td style={{padding:"12px 12px 12px 0",fontWeight:700,color:"#0284C7",whiteSpace:"nowrap"}}>
                        {h.ticker}
                        {q?.marketState==="REGULAR"&&<span style={{marginLeft:5,fontSize:9,background:"#dcfce7",color:"#059669",padding:"1px 5px",borderRadius:20,fontWeight:600}}>LIVE</span>}
                      </td>
                      <td style={{padding:"12px",color:"#374151",fontSize:12,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q?.name||"—"}</td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:500}}>{h.shares}</td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:700,color:"#1E293B"}}>
                        {q?.price!=null?<><span>{fmtN(q.price,cur)}</span>{isMixed&&<span style={{fontSize:9,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 4px",borderRadius:8,marginLeft:4}}>{cur}</span>}</>:<span style={{color:"#94a3b8"}}>—</span>}
                      </td>
                      <td style={{padding:"12px",textAlign:"right",fontWeight:700}}>
                        {q?.price!=null?<><span>{fmtN(val,cur)}</span>{isMixed&&<span style={{fontSize:9,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 4px",borderRadius:8,marginLeft:4}}>{cur}</span>}</>:<span style={{color:"#94a3b8"}}>—</span>}
                      </td>
                      <td style={{padding:"12px",textAlign:"right",whiteSpace:"nowrap"}}>
                        {gain!=null?<><span style={{fontWeight:600,color:gain>=0?"#059669":"#dc2626"}}>{gain>=0?"+":""}{fmtN(gain,cur)}</span>{isMixed&&<span style={{fontSize:9,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 4px",borderRadius:8,marginLeft:4}}>{cur}</span>}{gainPct!=null&&<span style={{fontSize:11,color:gain>=0?"#059669":"#dc2626",marginLeft:4}}>({gainPct>=0?"+":""}{gainPct.toFixed(2)}%)</span>}</>:<span style={{color:"#e2e8f0",fontSize:12}}>no cost</span>}
                      </td>
                      <td style={{padding:"12px 0 12px 8px",textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{display:"flex",gap:5,justifyContent:"flex-end"}}>
                          <button onClick={()=>{setEditId(h.id);setEditF({shares:String(h.shares),costBasis:h.costBasis!=null?String(h.costBasis):""});setQuickId(null);}} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"}}>Edit</button>
                          <button onClick={()=>remove(h.id)} style={{background:"none",border:"1px solid #fecaca",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11,color:"#dc2626",fontFamily:"inherit"}}>×</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


export { Stocks, StockPriceChart, STOCK_COLORS };

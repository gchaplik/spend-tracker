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
import { displayCombo } from "../utils/shortcuts.js";

function DevUpdateButton(){
  const [status,setStatus]=useState(null); // null|'building'|'done'|'error'
  const trigger=()=>{
    if(status==='building') return;
    setStatus('building');
    window.electronLocalUpdate.onProgress(()=>{});
    window.electronLocalUpdate.onDone((ok)=>setStatus(ok?'done':'error'));
    window.electronLocalUpdate.trigger();
  };
  return(
    <button
      onClick={trigger}
      disabled={status==='building'}
      title="Build & reinstall app from local source"
      style={{width:"100%",padding:"7px 8px",borderRadius:8,border:"1.5px solid",borderColor:status==='error'?"#fecaca":status==='building'?"#bae6fd":"#fde047",background:status==='error'?"#fef2f2":status==='building'?"#f0f9ff":"#fefce8",color:status==='error'?"#dc2626":status==='building'?"#0284C7":"#854d0e",fontSize:11,fontWeight:700,cursor:status==='building'?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all .15s"}}
    >
      {status==='building'
        ?<><span style={{display:"inline-block",width:10,height:10,border:"2px solid currentColor",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>Building…</>
        :status==='error'?'✗ Build failed'
        :'Update App'}
    </button>
  );
}

// ── Sidebar component ─────────────────────────────────────────────────────────
function Sidebar({ view, onNavigate, favourites, onToggleFavourite, onReorderFavourites, pendingCount, unpaidBillCount, devMode, onShowWhatsNew, onSignOut, shortcuts = {} }) {
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [hoveredApp, setHoveredApp] = useState(null);
  const [tooltip, setTooltip] = useState(null); // {label, y}
  const flyoutRef = useRef(null);
  const appsButtonRef = useRef(null);
  const flyoutTimer = useRef(null);
  const dragItem = useRef(null);   // key being dragged
  const dragOver = useRef(null);   // key currently hovered
  const [dragKey, setDragKey] = useState(null); // for visual feedback

  const appItems = NAV_ITEMS.filter(n => !n.alwaysShow && !n.isBottom);
  const devItems = devMode ? [
    { k:"datamodel", l:"Data Model", icon:"DM", desc:"Directly edit the FinanceLookML schema used by the Insights agent.", isBottom:true },
  ] : [];
  const bottomItems = [...NAV_ITEMS.filter(n=>n.isBottom && (!n.devOnly || devMode)), ...devItems];
  // Maintain favourites order from the prop array
  const pinnedItems = favourites.map(k=>NAV_ITEMS.find(n=>n.k===k)).filter(Boolean);

  // Drag handlers for the pinned section
  const onDragStart=(k)=>{ dragItem.current=k; setDragKey(k); };
  const onDragEnter=(k)=>{ dragOver.current=k; };
  const onDragEnd=()=>{
    setDragKey(null);
    if(!dragItem.current||!dragOver.current||dragItem.current===dragOver.current) return;
    const next=[...favourites];
    const fromIdx=next.indexOf(dragItem.current);
    const toIdx=next.indexOf(dragOver.current);
    if(fromIdx===-1||toIdx===-1) return;
    next.splice(fromIdx,1);
    next.splice(toIdx,0,dragItem.current);
    onReorderFavourites(next);
    dragItem.current=null; dragOver.current=null;
  };

  const [flyoutTop, setFlyoutTop] = useState(0);
  const openFlyout = () => {
    clearTimeout(flyoutTimer.current);
    if (appsButtonRef.current) {
      const r = appsButtonRef.current.getBoundingClientRect();
      setFlyoutTop(r.top);
    }
    setFlyoutOpen(true);
  };
  const closeFlyout = () => { flyoutTimer.current = setTimeout(()=>setFlyoutOpen(false), 120); };

  // Render function (not a component) — avoids remount-on-rerender killing hover state
  const navBtn = (item) => {
    const active = view === item.k;
    const badge = (item.k==="expected"&&pendingCount>0) ? pendingCount
                : (item.k==="bills"&&unpaidBillCount>0) ? unpaidBillCount
                : 0;
    return (
      <button
        key={item.k}
        onClick={() => { onNavigate(item.k); setFlyoutOpen(false); }}
        onMouseEnter={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const sc = shortcuts[item.k] ? `  ${displayCombo(shortcuts[item.k])}` : "";
        setTooltip({ label: item.l + sc + (badge ? ` (${badge})` : ""), y: r.top + r.height / 2 });
          if (!active) e.currentTarget.style.background = T.overlay;
        }}
        onMouseLeave={e => {
          setTooltip(null);
          if (!active) e.currentTarget.style.background = "transparent";
        }}
          data-tutorial={item.k}
        style={{
          width:40, height:40, borderRadius:T.r, border:"none", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontFamily:"inherit", fontSize:16, position:"relative",
          background: active ? T.accentBg : "transparent",
          color: active ? T.accent : T.tx3,
          borderLeft: active ? "3px solid "+T.accent : "3px solid transparent",
          transition:"background 0.12s, color 0.12s",
          flexShrink:0,
        }}
      >
        {item.icon}
        {badge>0&&<span style={{position:"absolute",top:4,right:4,minWidth:14,height:14,borderRadius:7,background:T.red,color:"#fff",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px",lineHeight:1,fontFamily:"inherit"}}>{badge>9?"9+":badge}</span>}
      </button>
    );
  };

  return (
    <>
      <div style={{ width:52, flexShrink:0, background:T.surface, display:"flex", flexDirection:"column", height:"100vh", position:"sticky", top:0, zIndex:30, userSelect:"none", boxShadow:"1px 0 0 "+T.border }}>
        {/* Logo */}
        <div style={{ height:52, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <div style={{ width:26, height:26, borderRadius:6, background:"#111", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
              <polygon points="2,27 16,5 30,27" fill="#fff"/>
              <rect x="2" y="27" width="28" height="2.5" rx="1" fill="#fff"/>
            </svg>
          </div>
        </div>

        {/* Top divider */}
        <div style={{ height:1, background:T.border, marginBottom:4, flexShrink:0 }}/>

        {/* Scrollable nav */}
        <div style={{ flex:1, overflowY:"auto", padding:"4px 6px", display:"flex", flexDirection:"column", gap:2, alignItems:"center" }}>
          {NAV_ITEMS.filter(n=>n.alwaysShow).map(item=>navBtn(item))}

          {pinnedItems.length > 0 && <>
            <div style={{ width:24, height:1, background:T.border, margin:"4px 0" }}/>
            {pinnedItems.map(item=>(
              <div key={item.k}
                draggable
                onDragStart={()=>onDragStart(item.k)}
                onDragEnter={()=>onDragEnter(item.k)}
                onDragEnd={onDragEnd}
                onDragOver={e=>e.preventDefault()}
                style={{
                  opacity: dragKey===item.k ? 0.35 : 1,
                  transition:"opacity 0.15s",
                  borderRadius:T.r,
                  outline: dragOver.current===item.k&&dragKey&&dragKey!==item.k ? "2px solid "+T.tx1 : "none",
                  cursor:"grab",
                }}
              >
                {navBtn(item)}
              </div>
            ))}
          </>}

          {/* Apps button */}
          <div style={{ width:24, height:1, background:T.border, margin:"4px 0" }}/>
          <button
            ref={appsButtonRef}
            onMouseEnter={e => { openFlyout(); const r=e.currentTarget.getBoundingClientRect(); setTooltip({label:"Applications",y:r.top+r.height/2}); if(!flyoutOpen) e.currentTarget.style.background=T.overlay; }}
            onMouseLeave={e => { closeFlyout(); setTooltip(null); if(!flyoutOpen) e.currentTarget.style.background="transparent"; }}
            style={{ width:40, height:40, borderRadius:T.r, border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit", fontSize:16, background:flyoutOpen?T.accentBg:"transparent", color:flyoutOpen?T.accent:T.tx3, borderLeft:"3px solid transparent", transition:"background 0.12s, color 0.12s", flexShrink:0 }}
          >▦</button>
        </div>

        {/* Bottom divider */}
        <div style={{ height:1, background:T.border, margin:"4px 0", flexShrink:0 }}/>

        {/* Bottom items */}
        <div style={{ padding:"4px 6px 8px", display:"flex", flexDirection:"column", gap:2, alignItems:"center", flexShrink:0 }}>
          {bottomItems.map(item=>navBtn(item))}
          {onSignOut && (
            <button
              onClick={onSignOut}
              onMouseEnter={e => { const r=e.currentTarget.getBoundingClientRect(); setTooltip({label:"Sign Out",y:r.top+r.height/2}); e.currentTarget.style.background=T.redBg; e.currentTarget.style.color=T.red; }}
              onMouseLeave={e => { setTooltip(null); e.currentTarget.style.background="transparent"; e.currentTarget.style.color=T.tx3; }}
              style={{ width:40, height:40, borderRadius:T.r, border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:"transparent", color:T.tx3, borderLeft:"3px solid transparent", transition:"background 0.12s, color 0.12s", flexShrink:0 }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div style={{ position:"fixed", left:58, top:tooltip.y-14, background:T.surface, boxShadow:T.shadowMd, borderRadius:T.r, padding:"5px 10px", fontSize:12, fontWeight:500, color:T.tx1, whiteSpace:"nowrap", zIndex:200, pointerEvents:"none", transform:"translateY(0)" }}>
          {tooltip.label}
        </div>
      )}

      {/* Applications flyout panel */}
      {flyoutOpen && (
        <div
          ref={flyoutRef}
          onMouseEnter={openFlyout}
          onMouseLeave={closeFlyout}
          style={{ position:"fixed", left:58, top:flyoutTop, background:T.surface, borderRadius:T.rCard, boxShadow:T.shadowMd, width:260, padding:"8px 6px", zIndex:100, maxHeight:`calc(100vh - ${flyoutTop+16}px)`, overflowY:"auto" }}
        >
          <div style={{ fontSize:11, fontWeight:500, color:T.tx3, padding:"4px 10px 8px" }}>Applications</div>
          {/* Favourites (pinned) section — draggable to reorder */}
          {pinnedItems.length>0&&<>
            <div style={{fontSize:10,fontWeight:500,color:T.tx3,padding:"8px 10px 4px",borderTop:"1px solid "+T.border,marginTop:4}}>Pinned — drag to reorder</div>
            {pinnedItems.map(item=>(
              <div key={item.k}
                draggable
                onDragStart={()=>onDragStart(item.k)}
                onDragEnter={()=>onDragEnter(item.k)}
                onDragEnd={onDragEnd}
                onDragOver={e=>e.preventDefault()}
                onMouseEnter={()=>setHoveredApp(item.k)} onMouseLeave={()=>setHoveredApp(null)}
                style={{display:"flex",alignItems:"center",gap:4,borderRadius:T.r,padding:"2px 4px 2px 6px",background:hoveredApp===item.k?T.overlay:"transparent",transition:"background 0.1s",opacity:dragKey===item.k?0.35:1,cursor:"grab",outline:dragOver.current===item.k&&dragKey&&dragKey!==item.k?"2px solid "+T.tx1:"none"}}
              >
                <span style={{color:T.tx3,fontSize:10,flexShrink:0,cursor:"grab",padding:"0 2px"}}>⠿</span>
                <button onClick={()=>{onNavigate(item.k);setFlyoutOpen(false);}}
                  style={{display:"flex",alignItems:"center",gap:9,flex:1,padding:"6px 4px",border:"none",background:"transparent",cursor:"pointer",fontSize:13,fontWeight:view===item.k?600:400,color:view===item.k?T.accent:T.tx1,textAlign:"left",fontFamily:"inherit"}}>
                  <span style={{fontSize:13,width:18,textAlign:"center",flexShrink:0,color:T.tx3}}>{item.icon}</span>
                  <div style={{flex:1}}><div style={{lineHeight:1.3}}>{item.l}</div></div>
                </button>
                <button onClick={()=>onToggleFavourite(item.k)} title="Remove from sidebar"
                  style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#f59e0b",padding:"4px",borderRadius:6,flexShrink:0,lineHeight:1}}
                  onMouseEnter={e=>e.currentTarget.style.color="#d97706"}
                  onMouseLeave={e=>e.currentTarget.style.color="#f59e0b"}
                >★</button>
              </div>
            ))}
            <div style={{height:1,background:T.border,margin:"6px 4px"}}/>
            <div style={{fontSize:10,fontWeight:500,color:T.tx3,padding:"0 10px 4px"}}>All applications</div>
          </>}
          {appItems.filter(item=>!favourites.includes(item.k)).map(item => {
            const isFav = favourites.includes(item.k);
            return (
              <div key={item.k} onMouseEnter={()=>setHoveredApp(item.k)} onMouseLeave={()=>setHoveredApp(null)}
                style={{ display:"flex", alignItems:"center", gap:4, borderRadius:T.r, padding:"2px 4px 2px 6px", background:hoveredApp===item.k?T.overlay:"transparent", transition:"background 0.1s" }}
              >
                <button
                  onClick={() => { onNavigate(item.k); setFlyoutOpen(false); }}
                  style={{ display:"flex", alignItems:"center", gap:9, flex:1, padding:"6px 4px", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight:view===item.k?600:400, color:view===item.k?T.accent:T.tx1, textAlign:"left", fontFamily:"inherit" }}
                >
                  <span style={{ fontSize:13, width:18, textAlign:"center", flexShrink:0, color:T.tx3 }}>{item.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ lineHeight:1.3 }}>{item.l}</div>
                    {hoveredApp===item.k && <div style={{ fontSize:11, color:T.tx3, marginTop:2, lineHeight:1.4 }}>{item.desc}</div>}
                  </div>
                </button>
                <button
                  onClick={() => onToggleFavourite(item.k)}
                  title={isFav ? "Remove from sidebar" : "Pin to sidebar"}
                  style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:isFav?"#f59e0b":T.border, padding:"4px", borderRadius:6, flexShrink:0, lineHeight:1, transition:"color 0.12s" }}
                  onMouseEnter={e=>e.currentTarget.style.color=isFav?"#d97706":"#a8a29e"}
                  onMouseLeave={e=>e.currentTarget.style.color=isFav?"#f59e0b":T.border}
                >★</button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}


export { Sidebar, DevUpdateButton };

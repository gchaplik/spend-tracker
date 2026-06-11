import React, { useRef, useState, useEffect, useCallback } from "react";
import { T } from "../theme/tokens.jsx";
import { NAV_ITEMS } from "../constants/index.js";
import { displayCombo } from "../utils/shortcuts.js";

const BY_KEY = Object.fromEntries(NAV_ITEMS.map(n => [n.k, n]));

// ── Context menu ──────────────────────────────────────────────────────────────
function ContextMenu({ x, y, tabKey, isHome, isPinned, onClose, onCloseOthers, onCloseAll, onPin, onDismiss }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp inside viewport after first render
  useEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth  - width  - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  // Click-outside dismiss
  useEffect(() => {
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    setTimeout(() => window.addEventListener("mousedown", fn), 0);
    return () => window.removeEventListener("mousedown", fn);
  }, [onDismiss]);

  const canClose = !isHome && !isPinned;
  const items = [
    { label:"Close Tab",    shortcut:"⌘W", action:onClose,       disabled:!canClose },
    { label:"Close Others", action:onCloseOthers, disabled:isHome },
    { label:"Close All",    action:onCloseAll,    disabled:isHome },
    null,
    { label: isPinned ? "Unpin Tab" : "Pin Tab", action:onPin, disabled:isHome },
  ];

  return (
    <div ref={ref} style={{
      position:"fixed", left:pos.x, top:pos.y, zIndex:9999,
      background:T.surface, border:"1px solid "+T.border,
      borderRadius:T.rCard, boxShadow:T.shadowMd,
      minWidth:180, padding:"4px 0", userSelect:"none",
    }}>
      {items.map((item, i) => {
        if (!item) return <div key={i} style={{ height:1, background:T.border, margin:"4px 0" }}/>;
        return (
          <button key={i}
            onClick={() => { if (!item.disabled) { item.action(); onDismiss(); } }}
            style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              width:"100%", padding:"7px 14px", border:"none",
              background:"transparent",
              cursor: item.disabled ? "default" : "pointer",
              color: item.disabled ? T.tx3 : T.tx1,
              fontSize:12, fontFamily:"inherit", textAlign:"left",
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span style={{ fontSize:10, color:T.tx3, marginLeft:16 }}>{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Individual tab ────────────────────────────────────────────────────────────
function Tab({ tabKey, active, pinned, badge, onNavigate, onClose, onContextMenu, shortcuts, isDragOver, dragHandlers }) {
  const [hovered,  setHovered]  = useState(false);
  const [xHovered, setXHovered] = useState(false);

  const item    = BY_KEY[tabKey];
  const label   = item?.l  ?? tabKey;
  const icon    = item?.icon ?? "●";
  const isHome  = tabKey === "dashboard";
  const sc      = shortcuts[tabKey];
  const compact = pinned && !isHome;   // icon-only when pinned (non-home)
  const showX   = !isHome && !pinned && (hovered || active);

  return (
    <div
      {...dragHandlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setXHovered(false); }}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e, tabKey); }}
      onClick={() => onNavigate(tabKey)}
      title={compact ? label + (sc ? "  " + displayCombo(sc) : "") : [item?.desc, sc ? displayCombo(sc) : null].filter(Boolean).join("  ·  ")}
      style={{
        display:"flex", alignItems:"center",
        gap: compact ? 0 : 5,
        padding: compact ? "0" : "0 8px 0 10px",
        justifyContent: compact ? "center" : undefined,
        flexShrink:0,
        width:    compact ? 38 : undefined,
        maxWidth: compact ? 38 : 180,
        minWidth: compact ? 38 : 82,
        cursor:"pointer", position:"relative",
        borderRight:"1px solid "+T.border,
        boxShadow: isDragOver ? "inset 3px 0 0 "+T.accent : "none",
        background: active ? T.accentBg : hovered ? T.overlay : "transparent",
        borderBottom: active ? "2px solid "+T.accent : "2px solid transparent",
        transition:"background 0.1s, box-shadow 0.1s",
        overflow:"hidden",
      }}
    >
      {/* Badge */}
      {badge > 0 && (
        <span style={{
          position:"absolute", top:5, right: showX ? 22 : compact ? 4 : 6,
          minWidth:14, height:14, borderRadius:7,
          background:T.red, color:"#fff", fontSize:9, fontWeight:700,
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:"0 3px", lineHeight:1, zIndex:1,
        }}>{badge > 9 ? "9+" : badge}</span>
      )}

      {/* Icon */}
      <span style={{ fontSize:12, color: active ? T.accent : T.tx3, flexShrink:0 }}>{icon}</span>

      {/* Label — hidden in compact (pinned) mode */}
      {!compact && (
        <span style={{
          fontSize:12, fontWeight: active ? 600 : 400,
          color: active ? T.accent : T.tx2,
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1,
        }}>{label}</span>
      )}

      {/* Shortcut chip — hidden when close button is visible */}
      {sc && !showX && !compact && (
        <span style={{
          flexShrink:0, fontSize:9, lineHeight:1,
          color: active ? T.accent : T.tx3,
          background: active ? "transparent" : T.overlay,
          border:"1px solid "+(active ? T.accent : T.border),
          borderRadius:4, padding:"1px 3px", fontFamily:"inherit",
        }}>{displayCombo(sc)}</span>
      )}

      {/* Close button */}
      {!isHome && !pinned && (
        <button
          onMouseEnter={e => { e.stopPropagation(); setXHovered(true); }}
          onMouseLeave={e => { e.stopPropagation(); setXHovered(false); }}
          onClick={e => { e.stopPropagation(); onClose(tabKey); }}
          title="Close tab"
          style={{
            flexShrink:0, width:16, height:16, borderRadius:"50%",
            border:"none", fontSize:13, lineHeight:1, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            padding:0, fontFamily:"inherit",
            background: xHovered ? (active ? T.accent : T.border) : "transparent",
            color: xHovered ? (active ? "#fff" : T.tx1) : (active ? T.accent : T.tx3),
            opacity: showX ? 1 : 0,
            pointerEvents: showX ? "auto" : "none",
            transition:"background 0.1s, color 0.1s, opacity 0.15s",
          }}
        >×</button>
      )}

      {/* Pin indicator dot */}
      {compact && (
        <span style={{
          position:"absolute", bottom:3, right:3,
          width:4, height:4, borderRadius:"50%",
          background: active ? T.accent : T.tx3,
        }}/>
      )}
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
export function TabBar({ tabs, activeTab, pinnedTabs, onNavigate, onClose, onCloseOthers, onCloseAll, onPin, onUnpin, onReorder, onOpenPalette, shortcuts = {}, badges = {} }) {
  const scrollRef     = useRef(null);
  const dragSrcRef    = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [ctxMenu,     setCtxMenu]     = useState(null); // {x,y,tabKey}

  const openCtx = useCallback((e, tabKey) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, tabKey });
  }, []);

  const getDragHandlers = (idx, tabKey) => {
    if (tabKey === "dashboard") return {};
    return {
      draggable: true,
      onDragStart: () => { dragSrcRef.current = idx; },
      onDragOver:  (e) => { e.preventDefault(); if (idx !== 0) setDragOverIdx(idx); },
      onDragLeave: ()  => { setDragOverIdx(n => n === idx ? null : n); },
      onDrop: (e) => {
        e.preventDefault();
        const from = dragSrcRef.current;
        if (from !== null && from !== idx && idx !== 0) onReorder(from, idx);
        dragSrcRef.current = null;
        setDragOverIdx(null);
      },
      onDragEnd: () => { dragSrcRef.current = null; setDragOverIdx(null); },
    };
  };

  const cm = ctxMenu ? {
    ...ctxMenu,
    isHome:   ctxMenu.tabKey === "dashboard",
    isPinned: pinnedTabs.has(ctxMenu.tabKey),
  } : null;

  return (
    <>
      <div style={{
        display:"flex", alignItems:"stretch",
        background:T.surface, borderBottom:"1px solid "+T.border,
        flexShrink:0, height:38, userSelect:"none",
      }}>
        {/* ‹ scroll */}
        <button onClick={() => scrollRef.current?.scrollBy({ left:-160, behavior:"smooth" })}
          style={{ flexShrink:0, width:22, border:"none", background:"transparent", color:T.tx3, cursor:"pointer", fontSize:14, padding:0, display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>

        {/* Tab strip */}
        <div ref={scrollRef} style={{ flex:1, display:"flex", alignItems:"stretch", overflowX:"auto", scrollbarWidth:"none", msOverflowStyle:"none" }}>
          {tabs.map((k, idx) => (
            <Tab
              key={k}
              tabKey={k}
              active={k === activeTab}
              pinned={pinnedTabs.has(k)}
              badge={badges[k] || 0}
              onNavigate={onNavigate}
              onClose={onClose}
              onContextMenu={openCtx}
              shortcuts={shortcuts}
              isDragOver={dragOverIdx === idx}
              dragHandlers={getDragHandlers(idx, k)}
            />
          ))}
        </div>

        {/* + new tab */}
        <button
          onClick={onOpenPalette}
          title="New tab  ⌘K"
          style={{ flexShrink:0, width:34, border:"none", borderLeft:"1px solid "+T.border, background:"transparent", color:T.tx3, cursor:"pointer", fontSize:17, padding:0, display:"flex", alignItems:"center", justifyContent:"center" }}
        >+</button>

        {/* › scroll */}
        <button onClick={() => scrollRef.current?.scrollBy({ left:160, behavior:"smooth" })}
          style={{ flexShrink:0, width:22, border:"none", background:"transparent", color:T.tx3, cursor:"pointer", fontSize:14, padding:0, display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
      </div>

      {cm && (
        <ContextMenu
          x={cm.x} y={cm.y}
          tabKey={cm.tabKey} isHome={cm.isHome} isPinned={cm.isPinned}
          onClose={() => onClose(cm.tabKey)}
          onCloseOthers={() => onCloseOthers(cm.tabKey)}
          onCloseAll={onCloseAll}
          onPin={() => cm.isPinned ? onUnpin(cm.tabKey) : onPin(cm.tabKey)}
          onDismiss={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

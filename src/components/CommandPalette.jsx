import React, { useState, useEffect, useRef, useMemo } from "react";
import { T } from "../theme/tokens.jsx";
import { NAV_ITEMS } from "../constants/index.js";

const QUICK_ACTIONS = [
  { k:"manual",   l:"Add Expense",    icon:"+",  desc:"Log a new expense" },
  { k:"income",   l:"Add Income",     icon:"+",  desc:"Record income" },
  { k:"insights", l:"Open Jarvis",    icon:"◈",  desc:"Ask Jarvis a question" },
  { k:"import",   l:"Import CSV",     icon:"⇩",  desc:"Import bank transactions" },
];

const NAVIGABLE = NAV_ITEMS.filter(n => !n.devOnly);

export function CommandPalette({ open, onClose, onNavigate, devMode }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const items = useMemo(() => {
    const pool = q.trim()
      ? NAVIGABLE.filter(n => !n.devOnly || devMode).filter(n =>
          n.l.toLowerCase().includes(q.toLowerCase()) ||
          (n.desc||"").toLowerCase().includes(q.toLowerCase())
        )
      : [...QUICK_ACTIONS, ...NAVIGABLE.filter(n => !QUICK_ACTIONS.some(a => a.k === n.k) && (!n.devOnly || devMode))];
    return pool;
  }, [q, devMode]);

  useEffect(() => { setIdx(0); }, [q]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[idx];
    el?.scrollIntoView({ block: "nearest" });
  }, [idx, open]);

  useEffect(() => {
    const onKey = (e) => {
      if (!open) return;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, items.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
      if (e.key === "Enter" && items[idx]) { onNavigate(items[idx].k); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, idx, onNavigate, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:"15vh"}}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{width:"100%",maxWidth:520,background:T.surface,border:"1px solid "+T.border,borderRadius:12,boxShadow:T.shadowMd,overflow:"hidden"}}
      >
        {/* Search input */}
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:"1px solid "+T.border}}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={T.tx3} strokeWidth={2} strokeLinecap="round" style={{flexShrink:0}}>
            <circle cx={11} cy={11} r={8}/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Go to… (type to search)"
            style={{flex:1,background:"transparent",border:"none",outline:"none",fontSize:15,color:T.tx1,fontFamily:"inherit"}}
          />
          <kbd style={{fontSize:11,color:T.tx3,background:T.overlay,border:"1px solid "+T.border,borderRadius:4,padding:"2px 6px"}}>Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{maxHeight:360,overflowY:"auto",padding:"6px 0"}}>
          {items.length === 0 && (
            <div style={{padding:"20px 16px",textAlign:"center",color:T.tx3,fontSize:13}}>No results for "{q}"</div>
          )}
          {items.map((item, i) => (
            <button
              key={item.k + i}
              onClick={() => { onNavigate(item.k); onClose(); }}
              onMouseEnter={() => setIdx(i)}
              style={{
                display:"flex",alignItems:"center",gap:12,width:"100%",padding:"9px 16px",
                background: i === idx ? T.overlay : "transparent",
                border:"none",cursor:"pointer",textAlign:"left",transition:"background 0.1s",
              }}
            >
              <span style={{width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",background:T.overlay,borderRadius:6,fontSize:12,color:T.tx2,flexShrink:0}}>
                {item.icon}
              </span>
              <span style={{flex:1,minWidth:0}}>
                <span style={{fontSize:13,fontWeight:500,color:T.tx1,display:"block"}}>{item.l}</span>
                {item.desc && <span style={{fontSize:11,color:T.tx3,display:"block",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.desc}</span>}
              </span>
              {i === idx && (
                <kbd style={{fontSize:10,color:T.tx3,background:T.overlay,border:"1px solid "+T.border,borderRadius:4,padding:"1px 5px",flexShrink:0}}>↵</kbd>
              )}
            </button>
          ))}
        </div>

        <div style={{padding:"8px 16px",borderTop:"1px solid "+T.border,display:"flex",gap:16,fontSize:11,color:T.tx3}}>
          <span><kbd style={{background:T.overlay,border:"1px solid "+T.border,borderRadius:3,padding:"1px 4px",fontSize:10}}>↑↓</kbd> navigate</span>
          <span><kbd style={{background:T.overlay,border:"1px solid "+T.border,borderRadius:3,padding:"1px 4px",fontSize:10}}>↵</kbd> open</span>
          <span><kbd style={{background:T.overlay,border:"1px solid "+T.border,borderRadius:3,padding:"1px 4px",fontSize:10}}>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

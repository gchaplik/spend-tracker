import React, { useState, useEffect, useRef } from "react";
import { T, IS, Btn } from "../theme/tokens.jsx";
import { today, uid } from "../utils/formatters.js";

export function QuickAdd({ cats, onSave, onClose }) {
  const [type, setType] = useState("expense");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(cats[0] || "Other");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const amtRef = useRef();

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    const amt = parseFloat(amount);
    if (!amt || !merchant.trim()) return;
    onSave({
      id: uid(), type, merchant: merchant.trim(),
      source: type === "income" ? merchant.trim() : undefined,
      amount: amt, date, category: type === "expense" ? category : undefined,
      note: note.trim() || undefined, hasReceipt: false,
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div style={{ background: T.surface, borderRadius: T.rCard + 4, boxShadow: "0 8px 40px rgba(0,0,0,0.2)", width: 400, padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.tx1 }}>Quick Add</div>
          <div style={{ display: "flex", gap: 6 }}>
            {["expense", "income"].map(t => (
              <button key={t} onClick={() => setType(t)}
                style={{ padding: "4px 14px", borderRadius: 99, border: "1px solid " + (type === t ? T.accent : T.border), background: type === t ? T.accent : "transparent", color: type === t ? "#fff" : T.tx2, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.tx3, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Merchant</div>
              <input autoFocus value={merchant} onChange={e => setMerchant(e.target.value)}
                onKeyDown={e => { if (e.key === "Tab") { e.preventDefault(); amtRef.current?.focus(); } if (e.key === "Enter") save(); }}
                placeholder="e.g. Sobeys" style={{ ...IS, width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.tx3, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Amount ($)</div>
              <input ref={amtRef} type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                onKeyDown={e => e.key === "Enter" && save()}
                placeholder="0.00" style={{ ...IS, width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: type === "expense" ? "1fr 1fr" : "1fr", gap: 10 }}>
            {type === "expense" && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.tx3, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Category</div>
                <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...IS, width: "100%", boxSizing: "border-box" }}>
                  {cats.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.tx3, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Date</div>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...IS, width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.tx3, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Note (optional)</div>
            <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === "Enter" && save()}
              placeholder="Add a note…" style={{ ...IS, width: "100%", boxSizing: "border-box" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <Btn v="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save} disabled={!amount || !merchant.trim()}>Add Transaction</Btn>
        </div>
        <div style={{ fontSize: 11, color: T.tx3, marginTop: 10, textAlign: "center" }}>Enter to save · Esc to cancel</div>
      </div>
    </div>
  );
}

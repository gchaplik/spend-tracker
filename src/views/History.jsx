import React, { useState, useMemo } from "react";
import { T, IS, CA, Fld, Btn } from "../theme/tokens.jsx";
import { CADENCES } from "../constants/index.js";
import { today, uid, cLabel } from "../utils/formatters.js";
import { buildDates } from "../utils/dateUtils.js";
import { nfmt } from "../utils/discrete.jsx";
import { learnCategory } from "../utils/catLearn.js";

const parseTags = note => (note || "").match(/#\w+/g) || [];

function SplitModal({ t, cats, onSave, onClose }) {
  const initAmt = parseFloat(t.amount) || 0;
  const half = (initAmt / 2).toFixed(2);
  const [splits, setSplits] = useState([
    { id: uid(), category: cats[0] || "Other", amount: half },
    { id: uid(), category: cats[1] || cats[0] || "Other", amount: half },
  ]);
  const total = splits.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const valid = Math.abs(total - initAmt) < 0.01;
  const setRow = (id, field, val) => setSplits(p => p.map(r => r.id === id ? { ...r, [field]: val } : r));
  const addRow = () => setSplits(p => [...p, { id: uid(), category: cats[0] || "Other", amount: "0" }]);
  const removeRow = id => setSplits(p => p.filter(r => r.id !== id));
  const save = () => {
    if (!valid) return;
    onSave(splits.map(r => ({ ...t, id: uid(), category: r.category, amount: parseFloat(r.amount), note: (t.note ? t.note + " " : "") + "[split]" })));
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div style={{ background: T.surface, borderRadius: T.rCard + 4, boxShadow: "0 8px 40px rgba(0,0,0,0.2)", width: 440, padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.tx1, marginBottom: 4 }}>Split Transaction</div>
        <div style={{ fontSize: 12, color: T.tx3, marginBottom: 16 }}>{t.merchant || t.source} · {nfmt(initAmt)} total</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {splits.map(r => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 28px", gap: 6, alignItems: "center" }}>
              <select value={r.category} onChange={e => setRow(r.id, "category", e.target.value)} style={{ ...IS, fontSize: 12 }}>
                {cats.map(c => <option key={c}>{c}</option>)}
              </select>
              <input type="number" min="0" step="0.01" value={r.amount} onChange={e => setRow(r.id, "amount", e.target.value)} style={{ ...IS, fontSize: 12, textAlign: "right" }} placeholder="0.00" />
              {splits.length > 2 ? <button onClick={() => removeRow(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: T.tx3, padding: 0, lineHeight: 1 }}>×</button> : <span />}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={addRow} style={{ fontSize: 12, color: T.accent, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>+ Add row</button>
          <span style={{ fontSize: 12, color: valid ? T.tx3 : T.red, fontWeight: 600 }}>
            {nfmt(total)} / {nfmt(initAmt)}{!valid && ` (${nfmt(Math.abs(initAmt - total))} ${total > initAmt ? "over" : "short"})`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn v="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save} disabled={!valid}>Split</Btn>
        </div>
      </div>
    </div>
  );
}

function History({ txns, cats, onUpdate, fMonth, setFMonth, onToast, subscriptions = [], merchantNorms = [] }) {
  const [fCat, setFCat] = useState("all");
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);
  const [ed, setEd] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [editGroupId, setEditGroupId] = useState(null);
  const [gEd, setGEd] = useState({});
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [splitId, setSplitId] = useState(null);
  const [showDupes, setShowDupes] = useState(false);
  const [dismissedDupes, setDismissedDupes] = useState(new Set());

  const subNames = useMemo(() => subscriptions.map(s => (s.name || "").toLowerCase()).filter(Boolean), [subscriptions]);
  const normalizeMerchant = m => {
    if (!m || !merchantNorms.length) return m;
    for (const n of merchantNorms) {
      if (n.pattern && m.toLowerCase().includes(n.pattern.toLowerCase())) return n.replacement;
    }
    return m;
  };
  const isSubscription = m => { if (!m || !subNames.length) return false; const ml = m.toLowerCase(); return subNames.some(n => ml.includes(n) || n.includes(ml)); };

  const dupeGroups = useMemo(() => {
    const singles = txns.filter(t => !t.groupId).slice(-600);
    const groups = [], seen = new Set();
    for (let i = 0; i < singles.length; i++) {
      for (let j = i + 1; j < singles.length; j++) {
        const a = singles[i], b = singles[j];
        const key = a.id < b.id ? a.id + "-" + b.id : b.id + "-" + a.id;
        if (seen.has(key) || dismissedDupes.has(key)) continue;
        const amtMatch = Math.abs(a.amount - b.amount) < 0.02;
        const mA = (a.merchant || a.source || "").toLowerCase();
        const mB = (b.merchant || b.source || "").toLowerCase();
        const nameMatch = mA && mB && mA === mB;
        const dMs = a.date && b.date ? Math.abs(new Date(a.date) - new Date(b.date)) : Infinity;
        if (amtMatch && nameMatch && dMs <= 3 * 86400000) { seen.add(key); groups.push({ a, b, key }); }
      }
    }
    return groups;
  }, [txns, dismissedDupes]);

  const months = [...new Set(txns.map(t => t.date && t.date.slice(0, 7)).filter(Boolean))].sort().reverse();
  const sq = search.toLowerCase().trim();
  const filtered = txns.filter(t => {
    if (fMonth !== "all" && !(t.date && t.date.startsWith(fMonth))) return false;
    if (fCat !== "all") { if (fCat === "income" && t.type !== "income") return false; if (fCat !== "income" && (t.type !== "expense" || t.category !== fCat)) return false; }
    if (sq) { const hay = ((t.merchant || t.source || "") + " " + (t.note || "") + " " + (t.category || "") + " " + String(t.amount || "")).toLowerCase(); if (!hay.includes(sq)) return false; }
    return true;
  });
  const exportCSV = () => {
    const rows = [["Date", "Type", "Merchant", "Amount", "Category", "Note"]];
    filtered.forEach(t => rows.push([t.date || "", t.type, t.merchant || t.source || "", t.amount, t.category || "", t.note || ""]));
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv); a.download = "transactions-" + (fMonth === "all" ? "all" : fMonth) + ".csv"; a.click();
  };
  const groupMap = {};
  const displayItems = [];
  filtered.forEach(t => { if (t.groupId) { (groupMap[t.groupId] = groupMap[t.groupId] || []).push(t); } else displayItems.push({ kind: "single", t, sortDate: t.date || "" }); });
  Object.keys(groupMap).forEach(gid => { const gTxns = [...groupMap[gid]].sort((a, b) => (a.date || "").localeCompare(b.date || "")); displayItems.push({ kind: "group", groupId: gid, txns: gTxns, sortDate: gTxns[gTxns.length - 1] ? gTxns[gTxns.length - 1].date || "" : "" }); });
  displayItems.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  const del = id => { const prev = [...txns]; onUpdate(txns.filter(t => t.id !== id)); onToast && onToast("Transaction deleted", () => onUpdate(prev)); };
  const delGroup = gid => { const prev = [...txns]; onUpdate(txns.filter(t => t.groupId !== gid)); onToast && onToast("Recurring group deleted", () => onUpdate(prev)); };
  const startEdit = t => { setEditId(t.id); setEd({ ...t }); };
  const saveEdit = () => {
    const orig = txns.find(t => t.id === editId);
    const updated = { ...ed, amount: parseFloat(ed.amount) || 0 };
    if (orig && updated.category && updated.category !== orig.category && (updated.merchant || updated.source)) learnCategory(updated.merchant || updated.source, updated.category);
    onUpdate(txns.map(t => t.id === editId ? updated : t));
    setEditId(null);
  };
  const toggleExpand = gid => setExpanded(prev => { const n = new Set(prev); n.has(gid) ? n.delete(gid) : n.add(gid); return n; });
  const startEditGroup = (gid, gTxns) => { const rep = gTxns[0]; setEditGroupId(gid); setGEd({ merchant: rep.merchant || rep.source || "", amount: String(rep.amount || ""), category: rep.category || cats[0] || "Other", cadence: rep.cadence || "monthly", startDate: gTxns[0].date || today(), occurrences: String(gTxns.length), note: rep.note || "", type: rep.type }); };
  const saveGroup = () => { const amtNum = parseFloat(gEd.amount) || 0; const count = Math.max(1, parseInt(gEd.occurrences) || 1); const dates = buildDates(gEd.startDate, gEd.cadence, count); const newEntries = dates.map(date => ({ id: uid(), groupId: editGroupId, cadence: gEd.cadence, type: gEd.type, merchant: gEd.merchant, source: gEd.merchant, amount: amtNum, date, category: gEd.type === "expense" ? gEd.category : undefined, note: gEd.note })); onUpdate([...txns.filter(t => t.groupId !== editGroupId), ...newEntries]); setEditGroupId(null); };
  const totI = filtered.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totE = filtered.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const ss = { padding: "7px 10px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 12, background: "#fff", fontFamily: "inherit" };
  const rBtn = (onClick, bdr, col, txt) => <button onClick={onClick} style={{ background: "none", border: "1px solid " + bdr, borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 11, color: col, fontFamily: "inherit" }}>{txt}</button>;
  const toggleSelect = id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (gTxns, allSelected) => setSelected(prev => { const n = new Set(prev); gTxns.forEach(t => allSelected ? n.delete(t.id) : n.add(t.id)); return n; });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const deleteSelected = () => { const prev = [...txns]; onUpdate(txns.filter(t => !selected.has(t.id))); onToast && onToast(`${selected.size} transaction${selected.size !== 1 ? "s" : ""} deleted`, () => onUpdate(prev)); exitSelect(); };
  const [bulkCat, setBulkCat] = useState("");
  const bulkReassign = () => {
    if (!bulkCat) return;
    const ids = new Set(selected);
    onUpdate(txns.map(t => ids.has(t.id) && t.type === "expense" ? { ...t, category: bulkCat } : t));
    onToast && onToast(`${selected.size} transaction${selected.size !== 1 ? "s" : ""} moved to ${bulkCat}`);
    exitSelect();
  };
  const selectedIds = [...selected];
  const selectedGroups = [...new Set(selectedIds.map(id => { const t = txns.find(x => x.id === id); return t?.groupId; }).filter(Boolean))];
  const canEditGroup = selectedGroups.length === 1 && selectedIds.every(id => { const t = txns.find(x => x.id === id); return t?.groupId === selectedGroups[0]; });
  const splitTxn = splitId ? txns.find(t => t.id === splitId) : null;

  if (editGroupId) {
    const gCount = Math.max(1, parseInt(gEd.occurrences) || 1); const gAmt = parseFloat(gEd.amount) || 0;
    return (
      <div style={{ width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}><button onClick={() => setEditGroupId(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#9ca3af", padding: 0, fontFamily: "inherit" }}>←</button><h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.3px" }}>Edit Recurring Group</h2></div>
        <div style={CA}>
          <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 13px", marginBottom: 16, fontSize: 12, color: "#92400e" }}>This replaces all entries in this group with new ones based on your updated settings.</div>
          <Fld label="Merchant / Source"><input style={IS} value={gEd.merchant} onChange={e => setGEd(p => ({ ...p, merchant: e.target.value }))} /></Fld>
          <Fld label="Amount per payment ($)"><input style={IS} type="number" value={gEd.amount} onChange={e => setGEd(p => ({ ...p, amount: e.target.value }))} /></Fld>
          {gEd.type === "expense" && <Fld label="Category"><select style={{ ...IS, background: "#fff" }} value={gEd.category} onChange={e => setGEd(p => ({ ...p, category: e.target.value }))}>{cats.map(c => <option key={c}>{c}</option>)}</select></Fld>}
          <Fld label="Start Date"><input style={IS} type="date" value={gEd.startDate} onChange={e => setGEd(p => ({ ...p, startDate: e.target.value }))} /></Fld>
          <Fld label="Cadence"><select style={{ ...IS, background: "#fff" }} value={gEd.cadence} onChange={e => setGEd(p => ({ ...p, cadence: e.target.value }))}>{CADENCES.filter(c => c.v !== "once").map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></Fld>
          <Fld label="Number of entries"><input style={IS} type="number" min="1" max="120" value={gEd.occurrences} onChange={e => setGEd(p => ({ ...p, occurrences: e.target.value }))} /></Fld>
          <Fld label="Note (optional)" style={{ marginBottom: 12 }}><input style={IS} value={gEd.note} onChange={e => setGEd(p => ({ ...p, note: e.target.value }))} /></Fld>
          {gAmt > 0 && <div style={{ background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: 8, padding: "10px 13px", marginBottom: 16, fontSize: 13, color: "#0284C7" }}>{gCount} entries of {nfmt(gAmt)} = <strong>{nfmt(gAmt * gCount)}</strong> — {cLabel(gEd.cadence).toLowerCase()}, starting {gEd.startDate}</div>}
          <div style={{ display: "flex", gap: 8 }}><Btn onClick={saveGroup} disabled={!gEd.merchant.trim() || !gEd.amount} full>Save Group</Btn><Btn v="secondary" onClick={() => setEditGroupId(null)}>Cancel</Btn></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {splitTxn && (
        <SplitModal t={splitTxn} cats={cats}
          onSave={parts => { const prev = [...txns]; onUpdate([...txns.filter(t => t.id !== splitTxn.id), ...parts]); setSplitId(null); onToast && onToast("Transaction split", () => onUpdate(prev)); }}
          onClose={() => setSplitId(null)} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, marginRight: "auto" }}>History</h2>
        <select value={fMonth} onChange={e => setFMonth(e.target.value)} style={ss}><option value="all">All Months</option>{months.map(m => <option key={m} value={m}>{new Date(m + "-02").toLocaleString("default", { month: "long", year: "numeric" })}</option>)}</select>
        <select value={fCat} onChange={e => setFCat(e.target.value)} style={ss}><option value="all">All Types</option><option value="income">Income</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <button onClick={() => { setSelectMode(s => !s); setSelected(new Set()); }} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid " + (selectMode ? "#0284C7" : "#bae6fd"), fontSize: 12, background: selectMode ? "#eff6ff" : "#fff", color: selectMode ? "#0284C7" : "#1E293B", cursor: "pointer", fontFamily: "inherit", fontWeight: selectMode ? 600 : 400 }}>Select</button>
        {dupeGroups.length > 0 && <button onClick={() => setShowDupes(v => !v)} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #fde68a", fontSize: 12, background: showDupes ? "#fef3c7" : "#fff", color: "#92400e", cursor: "pointer", fontFamily: "inherit" }}>⚠ {dupeGroups.length} Dupe{dupeGroups.length !== 1 ? "s" : ""}</button>}
        <button onClick={exportCSV} disabled={filtered.length === 0} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #bae6fd", fontSize: 12, background: "#fff", color: "#0284C7", cursor: filtered.length === 0 ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: filtered.length === 0 ? 0.4 : 1 }}>Export CSV</button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search merchant, category, note, #tag, amount…" style={{ ...IS, borderRadius: 10, paddingLeft: 13 }} />
      </div>
      {selectMode && selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 14px", background: "#f0f9ff", borderRadius: 8, border: "1px solid #7dd3fc", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#0284C7" }}>{selected.size} selected</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
            <select value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #bae6fd", background: "#fff", fontFamily: "inherit", color: "#0f172a" }}>
              <option value="">Move to category…</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <Btn sm onClick={bulkReassign} disabled={!bulkCat}>Apply</Btn>
          </div>
          {canEditGroup && <Btn sm onClick={() => { const gTxns = txns.filter(t => t.groupId === selectedGroups[0]); startEditGroup(selectedGroups[0], gTxns); exitSelect(); }}>Edit Group</Btn>}
          <Btn sm v="danger" onClick={deleteSelected}>Delete</Btn>
          <Btn sm v="secondary" onClick={exitSelect}>Cancel</Btn>
        </div>
      )}
      {showDupes && (
        <div style={{ marginBottom: 16, padding: "14px 16px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>Potential Duplicates</div>
            <button onClick={() => setShowDupes(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: T.tx3, lineHeight: 1 }}>×</button>
          </div>
          {dupeGroups.length === 0
            ? <div style={{ fontSize: 12, color: T.tx3 }}>No duplicates found.</div>
            : dupeGroups.map(({ a, b, key }) => (
              <div key={key} style={{ padding: "8px 0", borderBottom: "1px solid #fde68a" }}>
                <div style={{ fontSize: 12, color: T.tx1, marginBottom: 4 }}>
                  <strong>{a.merchant || a.source}</strong> · {nfmt(a.amount)} · {a.date} vs {b.date}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {rBtn(() => { const prev = [...txns]; onUpdate(txns.filter(t => t.id !== b.id)); setDismissedDupes(p => new Set([...p, key])); onToast && onToast("Kept first, deleted second", () => onUpdate(prev)); }, "#bae6fd", "#0284C7", "Keep first")}
                  {rBtn(() => { const prev = [...txns]; onUpdate(txns.filter(t => t.id !== a.id)); setDismissedDupes(p => new Set([...p, key])); onToast && onToast("Kept second, deleted first", () => onUpdate(prev)); }, "#bae6fd", "#0284C7", "Keep second")}
                  {rBtn(() => setDismissedDupes(p => new Set([...p, key])), "#e5e7eb", "#6b7280", "Not a dupe")}
                </div>
              </div>
            ))}
        </div>
      )}
      {filtered.length > 0 && <div style={{ display: "flex", gap: 16, marginBottom: 12 }}><span style={{ fontSize: 12, color: "#6b7280" }}>{filtered.length} transactions</span>{totI > 0 && <span style={{ fontSize: 12, color: "#059669" }}>+{nfmt(totI)}</span>}{totE > 0 && <span style={{ fontSize: 12, color: "#dc2626" }}>{nfmt(totE)}</span>}</div>}
      <div style={CA}>
        {displayItems.length === 0 ? <div style={{ color: "#9ca3af", fontSize: 13 }}>No transactions found</div> : displayItems.map(item => {
          if (item.kind === "group") {
            const gid = item.groupId, gTxns = item.txns, rep = gTxns[0];
            const isExp = expanded.has(gid);
            const total = gTxns.reduce((s, t) => s + t.amount, 0);
            const first = gTxns[0] ? gTxns[0].date : "", last = gTxns[gTxns.length - 1] ? gTxns[gTxns.length - 1].date : "";
            return (
              <div key={gid} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", flexWrap: "wrap" }}>
                  {selectMode && (() => { const allSel = gTxns.every(t => selected.has(t.id)); const someSel = gTxns.some(t => selected.has(t.id)); return <input type="checkbox" checked={allSel} ref={el => { if (el) el.indeterminate = someSel && !allSel; }} onChange={() => toggleGroup(gTxns, allSel)} style={{ width: 15, height: 15, cursor: "pointer", flexShrink: 0 }} />; })()}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{rep.merchant || rep.source}</span>
                      <span style={{ fontSize: 11, background: "#f0f9ff", color: "#0284C7", padding: "1px 7px", borderRadius: 20, fontWeight: 500 }}>{cLabel(rep.cadence || "monthly")}</span>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{gTxns.length} entries</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{first} – {last}{rep.category ? " · " + rep.category : ""}</div>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: rep.type === "income" ? "#059669" : "#111827", whiteSpace: "nowrap" }}>{rep.type === "income" ? "+" : ""}{nfmt(total)}</div>
                  {!selectMode && <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    {rBtn(() => toggleExpand(gid), "#e5e7eb", "#6b7280", isExp ? "Collapse" : "Expand")}
                    {rBtn(() => startEditGroup(gid, gTxns), "#bae6fd", "#0284C7", "Edit Group")}
                    {rBtn(() => delGroup(gid), "#fecaca", "#dc2626", "Delete All")}
                  </div>}
                  {selectMode && rBtn(() => toggleExpand(gid), "#e5e7eb", "#6b7280", isExp ? "Collapse" : "Expand")}
                </div>
                {isExp && gTxns.map(t => (
                  <div key={t.id} style={{ marginLeft: 16, borderLeft: "2px solid #e5e7eb", paddingLeft: 12, background: selectMode && selected.has(t.id) ? "#eff6ff" : "transparent", borderRadius: selectMode && selected.has(t.id) ? 4 : 0 }}>
                    {editId === t.id
                      ? <div style={{ padding: "10px 0" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}><Fld label="Amount ($)"><input style={IS} type="number" value={ed.amount || ""} onChange={e => setEd(d => ({ ...d, amount: e.target.value }))} /></Fld><Fld label="Date"><input style={IS} type="date" value={ed.date || ""} onChange={e => setEd(d => ({ ...d, date: e.target.value }))} /></Fld><Fld label="Note"><input style={IS} value={ed.note || ""} onChange={e => setEd(d => ({ ...d, note: e.target.value }))} /></Fld></div><div style={{ display: "flex", gap: 8 }}><Btn sm onClick={saveEdit}>Save</Btn><Btn sm v="secondary" onClick={() => setEditId(null)}>Cancel</Btn></div></div>
                      : <div style={{ display: "flex", alignItems: "center", padding: "7px 0", gap: 10, borderBottom: "1px solid #f9fafb" }}>
                        {selectMode && <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} style={{ width: 15, height: 15, cursor: "pointer", flexShrink: 0 }} />}
                        <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: "#1E293B" }}>{t.date}</div>{t.note && <div style={{ fontSize: 11, color: "#9ca3af" }}>{t.note}</div>}</div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: t.type === "income" ? "#059669" : "#111827" }}>{t.type === "income" ? "+" : ""}{nfmt(t.amount)}</div>
                        {!selectMode && <div style={{ display: "flex", gap: 4 }}>{rBtn(() => startEdit(t), "#e5e7eb", "#6b7280", "Edit")}{rBtn(() => del(t.id), "#fecaca", "#dc2626", "Delete")}</div>}
                      </div>}
                  </div>
                ))}
              </div>
            );
          }
          const t = item.t;
          const tags = parseTags(t.note);
          const isSub = isSubscription(t.merchant || t.source);
          const displayName = normalizeMerchant(t.merchant || t.source);
          return (
            <div key={t.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              {editId === t.id
                ? <div style={{ padding: "12px 0" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}><Fld label="Merchant / Source"><input style={IS} value={ed.merchant || ed.source || ""} onChange={e => setEd(d => ({ ...d, merchant: e.target.value, source: e.target.value }))} /></Fld><Fld label="Amount ($)"><input style={IS} type="number" value={ed.amount || ""} onChange={e => setEd(d => ({ ...d, amount: e.target.value }))} /></Fld><Fld label="Date"><input style={IS} type="date" value={ed.date || ""} onChange={e => setEd(d => ({ ...d, date: e.target.value }))} /></Fld>{ed.type === "expense" && <Fld label="Category"><select style={{ ...IS, background: "#fff" }} value={ed.category || cats[0]} onChange={e => setEd(d => ({ ...d, category: e.target.value }))}>{cats.map(c => <option key={c}>{c}</option>)}</select></Fld>}<Fld label="Note"><input style={IS} value={ed.note || ""} onChange={e => setEd(d => ({ ...d, note: e.target.value }))} /></Fld></div><div style={{ display: "flex", gap: 8 }}><Btn sm onClick={saveEdit}>Save</Btn><Btn sm v="secondary" onClick={() => setEditId(null)}>Cancel</Btn></div></div>
                : <div style={{ display: "flex", alignItems: "center", padding: "9px 0", gap: 10, background: selectMode && selected.has(t.id) ? "#eff6ff" : "transparent", borderRadius: 4 }}>
                  {selectMode && <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} style={{ width: 15, height: 15, cursor: "pointer", flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                      {displayName}
                      {isSub && <span title="Recurring subscription" style={{ fontSize: 10, color: "#7c3aed", background: "#ede9fe", padding: "1px 5px", borderRadius: 99, fontWeight: 600 }}>↻</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                      <span>{t.date} · {t.type === "income" ? "Income" : t.category || "Uncategorized"}</span>
                      {t.note && !tags.length && <span>· {t.note}</span>}
                      {t.originalAmountUSD && <span>· ${t.originalAmountUSD.toFixed(2)} USD @ {Number(t.fxRate).toFixed(4)}</span>}
                      {tags.map(tag => (
                        <button key={tag} onClick={() => setSearch(tag)} style={{ fontSize: 10, color: T.accent, background: T.accentBg, border: "none", borderRadius: 99, padding: "1px 6px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>{tag}</button>
                      ))}
                      {t.note && tags.length > 0 && <span style={{ color: "#b0b7c3" }}>{t.note.replace(/#\w+/g, "").trim()}</span>}
                    </div>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: t.type === "income" ? "#059669" : "#111827", whiteSpace: "nowrap" }}>{t.type === "income" ? "+" : ""}{nfmt(t.amount)}</div>
                  {!selectMode && <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    {t.type === "expense" && rBtn(() => setSplitId(t.id), "#e5e7eb", "#6b7280", "Split")}
                    {rBtn(() => startEdit(t), "#e5e7eb", "#6b7280", "Edit")}
                    {rBtn(() => del(t.id), "#fecaca", "#dc2626", "Delete")}
                  </div>}
                </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}


export { History };

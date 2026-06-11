// Converts a keydown event to a canonical combo string like "Meta+1" or "Ctrl+Shift+H"
export function eventToCombo(e) {
  const mods = [];
  if (e.metaKey)  mods.push("Meta");
  if (e.ctrlKey)  mods.push("Ctrl");
  if (e.altKey)   mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const key = e.key;
  if (["Meta","Control","Alt","Shift"].includes(key)) return null;
  if (!mods.length) return null; // require at least one modifier
  return [...mods, key].join("+");
}

// Format a stored combo for display, e.g. "Meta+1" → "⌘1"
export function displayCombo(combo) {
  if (!combo) return "";
  return combo.split("+").map(k => {
    if (k === "Meta")    return "⌘";
    if (k === "Ctrl")    return "⌃";
    if (k === "Alt")     return "⌥";
    if (k === "Shift")   return "⇧";
    return k.length === 1 ? k.toUpperCase() : k;
  }).join("");
}

// Returns true when an event matches a stored combo string
export function matchesCombo(e, combo) {
  if (!combo) return false;
  const parts  = combo.split("+");
  const key    = parts[parts.length - 1];
  const meta   = parts.includes("Meta");
  const ctrl   = parts.includes("Ctrl");
  const alt    = parts.includes("Alt");
  const shift  = parts.includes("Shift");
  return (
    e.metaKey  === meta  &&
    e.ctrlKey  === ctrl  &&
    e.altKey   === alt   &&
    e.shiftKey === shift &&
    e.key      === key
  );
}

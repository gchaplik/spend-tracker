const KEY = "ch_cat_learn";
const THRESHOLD = 3;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}

export function learnCategory(merchant, category) {
  if (!merchant || !category) return;
  const data = load();
  const key = merchant.toLowerCase().trim();
  if (!data[key]) data[key] = {};
  data[key][category] = (data[key][category] || 0) + 1;
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function getLearnedCategory(merchant) {
  const data = load();
  const key = merchant.toLowerCase().trim();
  const counts = data[key];
  if (!counts) return null;
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  return count >= THRESHOLD ? best : null;
}

export function clearLearnedCategory(merchant) {
  const data = load();
  delete data[merchant.toLowerCase().trim()];
  localStorage.setItem(KEY, JSON.stringify(data));
}

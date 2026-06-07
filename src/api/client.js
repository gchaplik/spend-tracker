let _serverData = null;

export async function fetchData() {
  const res = await fetch("/api/data");
  _serverData = await res.json();
  return _serverData;
}

export async function patchData(patch) {
  if (!_serverData) _serverData = await fetch("/api/data").then(r => r.json());
  _serverData = { ..._serverData, ...patch };
  await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function sendMessage(body) {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function queryLLM(query) {
  const res = await fetch("/api/llm/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

export async function chatLLM(body) {
  const res = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function fetchStocks(symbols) {
  const res = await fetch(`/api/stocks?symbols=${encodeURIComponent(symbols)}`);
  return res.json();
}

export async function fetchStockHistory(symbol, range, interval) {
  const params = new URLSearchParams({ symbol, ...(range && { range }), ...(interval && { interval }) });
  const res = await fetch(`/api/stocks/history?${params}`);
  return res.json();
}

export async function fetchLLMModels() {
  const res = await fetch("/api/llm/models");
  return res.json();
}

// Legacy aliases for backward compat
export const loadServerData = fetchData;
export const saveServerData = patchData;

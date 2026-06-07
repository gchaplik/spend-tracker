export const fetchQuotes = async (symbols) => {
  const tickers = symbols.split(",").map(s => s.trim()).filter(Boolean);
  const quotes = await Promise.all(tickers.map(async symbol => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    const data = await r.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const price = meta.regularMarketPrice ?? null;
    const change = price != null && prev != null ? price - prev : null;
    const changePercent = change != null && prev > 0 ? (change / prev) * 100 : null;
    return {
      symbol: meta.symbol || symbol,
      name: meta.shortName || meta.symbol || symbol,
      price,
      change,
      changePercent,
      prevClose: prev,
      currency: meta.currency || "USD",
      marketState: meta.marketState || "CLOSED",
    };
  }));
  return quotes.filter(Boolean);
};

export const fetchHistory = async (symbol, range = "1mo", interval = "1d") => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
  const data = await r.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("No data");
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().split("T")[0],
    close: closes[i] ?? null,
  })).filter(p => p.close !== null);
};

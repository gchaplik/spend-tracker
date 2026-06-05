import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 3001;
const DATA_FILE = join(__dirname, "data.json");

function readData() {
  if (!existsSync(DATA_FILE)) return { txns: [], cats: null, expected: [] };
  try { return JSON.parse(readFileSync(DATA_FILE, "utf8")); } catch { return { txns: [], cats: null, expected: [] }; }
}
function writeData(data) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.use(express.json({ limit: "100mb" }));

app.get("/api/data", (_req, res) => res.json(readData()));
app.post("/api/data", (req, res) => { writeData(req.body); res.json({ ok: true }); });

// Proxy Gemini API calls — keeps the key server-side
app.post("/api/messages", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: { message: "GEMINI_API_KEY not set in .env" } });
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// Proxy Yahoo Finance quotes via v8 chart endpoint (v7 quote API is restricted)
app.get("/api/stocks", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.json({ quotes: [] });
  const tickers = symbols.split(",").map(s => s.trim()).filter(Boolean);
  try {
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
    res.json({ quotes: quotes.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Yahoo Finance historical chart data
app.get("/api/stocks/history", async (req, res) => {
  const { symbol, range = "1mo", interval = "1d" } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data" });
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split("T")[0],
      close: closes[i] ?? null,
    })).filter(p => p.close !== null);
    res.json({ symbol, points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve built frontend in production
const distPath = join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(join(distPath, "index.html")));
}

createServer(app).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠️  GEMINI_API_KEY is not set — add your key to .env");
  }
});

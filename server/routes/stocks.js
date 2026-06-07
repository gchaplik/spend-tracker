import { Router } from "express";
import { fetchQuotes, fetchHistory } from "../services/stockService.js";

const router = Router();

router.get("/api/stocks", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.json({ quotes: [] });
  try {
    const quotes = await fetchQuotes(symbols);
    res.json({ quotes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/stocks/history", async (req, res) => {
  const { symbol, range = "1mo", interval = "1d" } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const points = await fetchHistory(symbol, range, interval);
    res.json({ symbol, points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

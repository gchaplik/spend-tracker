import { Router } from "express";
import { getFullData, mergeData } from "../services/dataService.js";
import { db } from "../db/index.js";

const router = Router();

router.get("/api/data", (_req, res) => {
  try {
    res.json(getFullData());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/data", (req, res) => {
  try {
    mergeData(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/holdings/prices — update currentPrice for each ticker without replacing holdings
// Body: { prices: { "TSLA": 250.10, "XEQT.TO": 31.45, ... } }
router.patch("/api/holdings/prices", (req, res) => {
  try {
    const { prices } = req.body;
    if (!prices || typeof prices !== "object") return res.status(400).json({ error: "prices object required" });
    const stmt = db.prepare("UPDATE holdings SET currentPrice=@price, priceUpdatedAt=@ts WHERE UPPER(ticker)=UPPER(@ticker)");
    const ts = new Date().toISOString();
    db.transaction(() => {
      for (const [ticker, price] of Object.entries(prices)) {
        if (typeof price === "number") stmt.run({ ticker, price, ts });
      }
    })();
    res.json({ ok: true, updated: Object.keys(prices).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

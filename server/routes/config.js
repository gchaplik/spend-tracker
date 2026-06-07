import { Router } from "express";
import { getSetting, setSetting } from "../dal/settings.js";

const router = Router();

// GET /api/config/gemini-key — returns whether a key is set (never returns the key itself)
router.get("/api/config/gemini-key", (_req, res) => {
  const stored = getSetting("geminiApiKey");
  const envKey = process.env.GEMINI_API_KEY;
  res.json({ set: !!(stored || envKey), source: stored ? "db" : envKey ? "env" : "none" });
});

// POST /api/config/gemini-key — saves key to the settings DB table
router.post("/api/config/gemini-key", (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== "string" || key.trim().length < 10) {
    return res.status(400).json({ error: "Invalid key" });
  }
  setSetting("geminiApiKey", key.trim());
  res.json({ ok: true });
});

// DELETE /api/config/gemini-key — removes the stored key (env var is unaffected)
router.delete("/api/config/gemini-key", (_req, res) => {
  setSetting("geminiApiKey", null);
  res.json({ ok: true });
});

export default router;

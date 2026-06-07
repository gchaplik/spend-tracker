import { Router } from "express";
import { execQuery } from "../services/llmService.js";

const router = Router();
const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";

router.get("/api/llm/models", async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!r.ok) return res.status(r.status).json({ error: "Ollama not reachable" });
    res.json(await r.json());
  } catch (err) {
    res.status(503).json({ error: "Ollama not running: " + err.message });
  }
});

router.post("/api/llm/chat", async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req.body, stream: false }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "Ollama error " + r.status });
    res.json(await r.json());
  } catch (err) {
    res.status(503).json({ error: "Ollama not running: " + err.message });
  }
});

router.post("/api/llm/query", (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  try {
    res.json({ result: execQuery(query) });
  } catch (err) {
    res.status(400).json({ error: "Query error: " + err.message });
  }
});

export default router;

import { Router } from "express";
import { getSetting } from "../dal/settings.js";

const router = Router();

// Resolve Gemini key: prefer DB-stored key so users can set it via Settings UI;
// fall back to environment variable for server-side configuration.
const getGeminiKey = () => getSetting("geminiApiKey") || process.env.GEMINI_API_KEY || null;

router.post("/api/messages", async (req, res) => {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    return res.status(500).json({ error: { message: "Gemini API key not set — add it in Settings or set GEMINI_API_KEY in .env" } });
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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

export default router;

import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
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

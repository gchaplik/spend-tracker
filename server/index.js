import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";

import { migrate, seedFromJson } from "./db/index.js";
import dataRouter from "./routes/data.js";
import llmRouter from "./routes/llm.js";
import stocksRouter from "./routes/stocks.js";
import messagesRouter from "./routes/messages.js";
import configRouter from "./routes/config.js";
import sqlRouter from "./routes/sql.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.SERVER_PORT || process.env.PORT || 3001;

// Initialize DB
migrate();

// One-time seed from data.json if DB is empty and data.json exists
const DATA_FILE = process.env.SEED_DATA_PATH || join(__dirname, "..", "data.json");
if (existsSync(DATA_FILE)) {
  try {
    const dataJson = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    seedFromJson(dataJson);
  } catch (e) {
    console.warn("Could not seed from data.json:", e.message);
  }
}

const app = express();
app.use(express.json({ limit: "100mb" }));

app.use(dataRouter);
app.use(llmRouter);
app.use(stocksRouter);
app.use(messagesRouter);
app.use(configRouter);
app.use(sqlRouter);

// Serve built frontend in production
const distPath = join(__dirname, "..", "dist");
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

export { app };

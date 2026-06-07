import { Router } from "express";
import { getFullData, mergeData } from "../services/dataService.js";

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

export default router;

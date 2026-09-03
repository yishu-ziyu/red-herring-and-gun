import cors from "cors";
import express from "express";

export const DEFAULT_PORT = 3100;

export function createApp() {
  const app = express();
  app.use(cors());
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

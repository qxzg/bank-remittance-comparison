import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import express, { type Express } from "express";
import type { FeeSnapshot } from "../shared/types";
import { RateService, UpstreamError } from "./rate-service";

interface AppOptions {
  rateService?: Pick<RateService, "getRates">;
  feesPath: string;
  distPath?: string;
}

async function loadFees(feesPath: string): Promise<FeeSnapshot> {
  const content = await readFile(feesPath, "utf8");
  return JSON.parse(content) as FeeSnapshot;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const rateService = options.rateService ?? new RateService();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get("/api/rates", async (request, response) => {
    try {
      const rates = await rateService.getRates(request.query.refresh === "1");
      response.set("Cache-Control", "no-store").json(rates);
    } catch (error) {
      const message = error instanceof Error ? error.message : "牌价服务异常";
      response
        .status(error instanceof UpstreamError ? 502 : 500)
        .json({ error: message });
    }
  });

  app.get("/api/fees", async (_request, response) => {
    try {
      const fees = await loadFees(options.feesPath);
      response
        .set("Cache-Control", "no-store, no-cache, must-revalidate")
        .set("Pragma", "no-cache")
        .json(fees);
    } catch (error) {
      const message = error instanceof Error ? error.message : "手续费数据异常";
      response.status(500).json({ error: message });
    }
  });

  if (options.distPath && existsSync(options.distPath)) {
    app.use(express.static(options.distPath));
    app.use((request, response, next) => {
      if (request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(path.join(options.distPath as string, "index.html"));
    });
  }

  return app;
}

import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

import { appRouter, llmInsightsRouter, agencyRouter } from "../routers";
import { costTrackingRouter } from "../costTrackingRouter";
import { prospectAuditRouter } from "../prospectAuditRouter";
import { trainingQueryRouter } from "../trainingQueryRouter";
import { v7AccountRouter } from "../v7AccountRouter";
import { router } from "./trpc";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { trainingWorker } from "../trainingQueue";
import { startTrainingWorkerV2 } from "../trainingQueueV2";
import { startScheduler } from "../scheduler";
import { createWebhookRouter } from "../webhookHandler";
import {
  ensureMonkeyIndexerEnumValue,
  ensureIsTargetLocationColumn,
  ensureModelConfigEnumValue,
  ensureCampaignScopeColumn,
  ensureNoChargeColumn,
  ensureBusinessNoChargeColumn,
  ensureCampaignColumns,
  ensureBusinessCredibilityUrlsColumn,
  ensureBusinessBillingTypeColumn,
  ensureAuditLeadColumns,
  ensureAgencyWebhookColumns,
  ensureAuditSourceColumn,
  ensureAuditCampaignScopeColumn,
  ensureTrainingQueryTables,
} from "../db";

// Combined router with all sub-routers including llmInsights, agency, costTracking, prospectAudit, and trainingQuery
const combinedRouter = router({
  ...appRouter._def.procedures,
  llmInsights: llmInsightsRouter,
  agency: agencyRouter,
  costTracking: costTrackingRouter,
  prospectAudit: prospectAuditRouter,
  trainingQuery: trainingQueryRouter,
  v7Accounts: v7AccountRouter,
});
export type CombinedRouter = typeof combinedRouter;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Increase timeouts to handle long-running AI audit requests (~2-3 min for 15 queries × 3 platforms in parallel)
  server.headersTimeout = 600_000; // 10 min (default is 60s — too short for audits)
  server.requestTimeout = 600_000; // 10 min (default is 300s — may be too short)
  server.timeout = 0;              // Disable socket inactivity timeout
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Webhook routes (must be before tRPC to avoid conflicts)
  app.use(createWebhookRouter());

  // ── Audit widget embed script ──────────────────────────────────────────────
  // Served at /embed/audit-widget.js
  // Drop a <script> tag on any landing page. Supports:
  //   data-agency       — agency ID to scope the audit (optional)
  //   data-button-text  — button label (default: "Check Your AI Visibility")
  //   data-button-color — button background color (default: #2563eb)
  app.get("/embed/audit-widget.js", (_req, res) => {
    const origin = process.env.PUBLIC_URL ?? "";
    const script = `
(function() {
  var cfg = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
  var agencyId  = cfg.getAttribute('data-agency') || '';
  var btnText   = cfg.getAttribute('data-button-text') || 'Check Your AI Visibility';
  var btnColor  = cfg.getAttribute('data-button-color') || '#2563eb';
  var ORIGIN    = '${origin}';

  // Inject styles
  var style = document.createElement('style');
  style.textContent =
    '.manus-audit-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;' +
    'background:' + btnColor + ';color:#fff;font-family:system-ui,sans-serif;font-size:16px;' +
    'font-weight:700;border:none;border-radius:12px;cursor:pointer;transition:opacity .2s;}' +
    '.manus-audit-btn:hover{opacity:.88;}' +
    '.manus-audit-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.7);' +
    'backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;}' +
    '.manus-audit-modal{position:relative;width:min(96vw,520px);height:min(92vh,800px);' +
    'border-radius:16px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,.6);}' +
    '.manus-audit-modal iframe{width:100%;height:100%;border:none;}' +
    '.manus-audit-close{position:absolute;top:10px;right:10px;background:rgba(255,255,255,.15);' +
    'border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;' +
    'font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;z-index:1;}';
  document.head.appendChild(style);

  // Create button and insert after the script tag
  var btn = document.createElement('button');
  btn.className = 'manus-audit-btn';
  btn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"' +
    ' stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2">' +
    '</polygon></svg>' + btnText;
  cfg.parentNode.insertBefore(btn, cfg.nextSibling);

  btn.addEventListener('click', function() {
    var overlay = document.createElement('div');
    overlay.className = 'manus-audit-overlay';

    var modal = document.createElement('div');
    modal.className = 'manus-audit-modal';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'manus-audit-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function() { document.body.removeChild(overlay); };

    var src = ORIGIN + '/audit-widget';
    if (agencyId) src += '?agency=' + encodeURIComponent(agencyId);

    var iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.allow = 'clipboard-write';

    modal.appendChild(iframe);
    modal.appendChild(closeBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
  });
})();
`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(script);
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: combinedRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    
    // Start the training workers if Redis is configured
    if (process.env.REDIS_HOST) {
      console.log(`[Training Worker] Starting training queue workers...`);
      console.log(`[Training Worker] Connected to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
      
      // V1 worker (legacy sessions)
      trainingWorker.on("ready", () => {
        console.log(`[Training Worker V1] Worker is ready and listening for jobs`);
      });
      
      // V2 worker (phase-based sessions)
      const v2Worker = startTrainingWorkerV2();
      v2Worker.on("ready", () => {
        console.log(`[Training Worker V2] Worker is ready and listening for jobs`);
      });
    } else {
      console.log(`[Training Worker] Redis not configured, training queue disabled`);
    }
    
    // Start the scheduler service
    startScheduler();
  });
}

// Run column/enum migrations before starting the server
ensureMonkeyIndexerEnumValue().catch((err) =>
  console.warn("[Startup] ensureMonkeyIndexerEnumValue failed (non-fatal):", err.message)
);
ensureIsTargetLocationColumn().catch((err) =>
  console.warn("[Startup] ensureIsTargetLocationColumn failed (non-fatal):", err.message)
);
ensureModelConfigEnumValue().catch((err) =>
  console.warn("[Startup] ensureModelConfigEnumValue failed (non-fatal):", err.message)
);
ensureCampaignScopeColumn().catch((err) =>
  console.warn("[Startup] ensureCampaignScopeColumn failed (non-fatal):", err.message)
);
ensureNoChargeColumn().catch((err) =>
  console.warn("[Startup] ensureNoChargeColumn failed (non-fatal):", err.message)
);
ensureBusinessNoChargeColumn().catch((err) =>
  console.warn("[Startup] ensureBusinessNoChargeColumn failed (non-fatal):", err.message)
);
// Comprehensive campaigns column backfill — adds every column that exists in schema.ts
// but may be missing from the live database due to missing migrations.
ensureCampaignColumns().catch((err) =>
  console.warn("[Startup] ensureCampaignColumns failed (non-fatal):", err.message)
);
ensureBusinessCredibilityUrlsColumn().catch((err) =>
  console.warn("[Startup] ensureBusinessCredibilityUrlsColumn failed (non-fatal):", err.message)
);
ensureBusinessBillingTypeColumn().catch((err) =>
  console.warn("[Startup] ensureBusinessBillingTypeColumn failed (non-fatal):", err.message)
);
ensureAuditLeadColumns().catch((err) =>
  console.warn("[Startup] ensureAuditLeadColumns failed (non-fatal):", err.message)
);
ensureAgencyWebhookColumns().catch((err) =>
  console.warn("[Startup] ensureAgencyWebhookColumns failed (non-fatal):", err.message)
);
ensureAuditSourceColumn().catch((err) =>
  console.warn("[Startup] ensureAuditSourceColumn failed (non-fatal):", err.message)
);
ensureAuditCampaignScopeColumn().catch((err) =>
  console.warn("[Startup] ensureAuditCampaignScopeColumn failed (non-fatal):", err.message)
);
ensureTrainingQueryTables().catch((err) =>
  console.warn("[Startup] ensureTrainingQueryTables failed (non-fatal):", err.message)
);

// One-time migration: set Eagle Air Co (campaign 3) to V4 training engine.
// Safe to run on every startup — no-ops if already set.
import("../db").then(({ getDb }) => {
  getDb().then(async (db) => {
    if (!db) return;
    try {
      const client = (db as any).$client as import("postgres").Sql;
      await client`UPDATE "campaigns" SET "trainingVersion" = 'v4' WHERE id = 3 AND "trainingVersion" = 'v3'`;
      console.log('[Startup] Eagle Air Co (campaign 3) set to V4 training engine');
    } catch (err: any) {
      console.warn('[Startup] Eagle Air V4 migration (non-fatal):', err.message);
    }
  });
}).catch(() => {});

startServer().catch(console.error);

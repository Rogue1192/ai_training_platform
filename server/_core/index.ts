import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { trainingWorker } from "../trainingQueue";
import { startTrainingWorkerV2 } from "../trainingQueueV2";
import { startScheduler } from "../scheduler";
import { createWebhookRouter } from "../webhookHandler";

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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Webhook routes (must be before tRPC to avoid conflicts)
  app.use(createWebhookRouter());
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
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

startServer().catch(console.error);

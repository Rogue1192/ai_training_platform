/**
 * Model Configuration Service
 *
 * Stores and retrieves the active AI model selections for:
 *   - trainerModel: the MiniMax model used to generate training conversation turns
 *   - contentModel: the Anthropic/OpenAI model used for credibility content generation
 *
 * Config is stored as a JSON string in the service_keys table under service = 'model_config'.
 * It is NOT encrypted (models are not secrets).
 */

import { getDb } from "./db";
import { eq } from "drizzle-orm";

export interface ModelConfig {
  trainerModel: string;       // e.g. "MiniMax-M2.7"
  trainerProvider: string;    // e.g. "minimax"
  contentModel: string;       // e.g. "claude-sonnet-4-5-20250929"
  contentProvider: string;    // e.g. "anthropic"
}

const DEFAULTS: ModelConfig = {
  trainerModel: "MiniMax-M2.7",
  trainerProvider: "minimax",
  contentModel: "claude-sonnet-4-5-20250929",
  contentProvider: "anthropic",
};

export async function getModelConfig(): Promise<ModelConfig> {
  try {
    const db = await getDb();
    if (!db) return DEFAULTS;
    const { serviceKeys } = await import("../drizzle/schema");
    const [row] = await db
      .select()
      .from(serviceKeys)
      .where(eq(serviceKeys.service as any, "model_config"))
      .limit(1);
    if (!row) return DEFAULTS;
    const parsed = JSON.parse(row.encryptedValue);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export async function saveModelConfig(config: Partial<ModelConfig>): Promise<ModelConfig> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { serviceKeys } = await import("../drizzle/schema");
  const current = await getModelConfig();
  const updated: ModelConfig = { ...current, ...config };
  const json = JSON.stringify(updated);
  const [existing] = await db
    .select()
    .from(serviceKeys)
    .where(eq(serviceKeys.service as any, "model_config"))
    .limit(1);
  if (existing) {
    await db
      .update(serviceKeys)
      .set({ encryptedValue: json, updatedAt: new Date() })
      .where(eq(serviceKeys.service as any, "model_config"));
  } else {
    await db.insert(serviceKeys).values({
      service: "model_config" as any,
      encryptedValue: json,
      status: "connected",
    });
  }
  return updated;
}

/**
 * Detect whether an API error indicates a deprecated / removed model.
 * Returns true if the error message matches known deprecation patterns.
 */
export function isModelDeprecatedError(error: any): boolean {
  const msg: string = (
    error?.response?.data?.error?.message ||
    error?.message ||
    String(error)
  ).toLowerCase();

  return (
    msg.includes("model_not_found") ||
    msg.includes("model not found") ||
    msg.includes("deprecated") ||
    msg.includes("no longer available") ||
    msg.includes("sunset") ||
    msg.includes("does not exist") ||
    (msg.includes("invalid") && msg.includes("model")) ||
    // HTTP 404 with model-related text
    (error?.response?.status === 404 && msg.includes("model")) ||
    // HTTP 400 with model-related text
    (error?.response?.status === 400 && (msg.includes("model") || msg.includes("deprecated")))
  );
}

/**
 * Build a human-readable deprecation notice for admin alerts.
 */
export function buildDeprecationAlert(modelName: string, context: "trainer" | "content", campaignId?: number): string {
  const contextLabel = context === "trainer"
    ? "MiniMax Trainer"
    : "Content Generation";
  return [
    `⚠️ MODEL DEPRECATED: ${modelName}`,
    ``,
    `The ${contextLabel} model "${modelName}" has been deprecated by its provider and is no longer accepting requests.`,
    ``,
    campaignId ? `Affected campaign ID: ${campaignId}` : "",
    ``,
    `Action required:`,
    `  1. Go to Settings → AI Models`,
    `  2. Select a replacement ${contextLabel} model`,
    `  3. Click "Resume Paused Campaigns" to restart affected campaigns`,
  ].filter(Boolean).join("\n");
}

/**
 * Standalone script: trigger a post-training rank check for campaign 10 (Right On Plumbing)
 * Run with: npx tsx scripts/run_rank_check.ts
 */
import { runScheduledRankCheck } from "../server/rankTrackingEngine.js";

const campaignId = 10;
console.log(`[RankCheck] Starting rank check for campaign ${campaignId}...`);

try {
  const result = await runScheduledRankCheck(campaignId);
  console.log(`[RankCheck] Done. Snapshots created: ${result.snapshotsCreated}`);
  console.log(`[RankCheck] Wins detected: ${result.winsDetected.length}`);
  console.log(`[RankCheck] Current score:`, JSON.stringify(result.currentScore, null, 2));
  if (result.error) {
    console.error(`[RankCheck] Error: ${result.error}`);
  }
} catch (err) {
  console.error(`[RankCheck] Fatal error:`, err);
  process.exit(1);
}
process.exit(0);

// Diagnostic script: query Titan Cleaning Company's rank data directly
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("No DATABASE_URL set");
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: "require", prepare: false });

try {
  // 1. Find Titan's campaign
  const campaigns = await sql`
    SELECT c.id, c.campaign_name, c.status, b.name as business_name
    FROM campaigns c
    JOIN businesses b ON b.id = c.business_id
    WHERE LOWER(b.name) LIKE '%titan%'
    ORDER BY c.id
  `;
  console.log("\n=== TITAN CAMPAIGNS ===");
  console.table(campaigns);

  if (campaigns.length === 0) {
    console.log("No Titan campaigns found");
    process.exit(0);
  }

  const campaignId = campaigns[0].id;
  console.log(`\nUsing campaign ID: ${campaignId}`);

  // 2. All query-location rows for this campaign
  const queryLocs = await sql`
    SELECT id, query_text, location, is_target_location, is_tracked, created_at
    FROM campaign_query_locations
    WHERE campaign_id = ${campaignId}
    ORDER BY is_target_location DESC, created_at
  `;
  console.log(`\n=== QUERY LOCATIONS (total: ${queryLocs.length}) ===`);
  console.log(`  isTargetLocation=true: ${queryLocs.filter(r => r.is_target_location).length}`);
  console.log(`  isTargetLocation=false: ${queryLocs.filter(r => !r.is_target_location).length}`);
  console.table(queryLocs.map(r => ({
    id: r.id,
    query: r.query_text?.substring(0, 50),
    location: r.location,
    isTarget: r.is_target_location,
    isTracked: r.is_tracked,
    created: r.created_at?.toISOString?.()?.substring(0, 10),
  })));

  // 3. All rank snapshots for this campaign
  const snapshots = await sql`
    SELECT id, query_location_id, checked_at, is_tracked, is_baseline,
           chatgpt_mentioned, gemini_mentioned, ai_overview_mentioned
    FROM rank_snapshots
    WHERE campaign_id = ${campaignId}
    ORDER BY checked_at DESC
    LIMIT 100
  `;
  console.log(`\n=== RANK SNAPSHOTS (total: ${snapshots.length}) ===`);

  // Group by check date
  const byDate = {};
  for (const s of snapshots) {
    const date = s.checked_at?.toISOString?.()?.substring(0, 10) || "unknown";
    if (!byDate[date]) byDate[date] = { total: 0, isTracked: 0, isBaseline: 0, mentioned: 0 };
    byDate[date].total++;
    if (s.is_tracked) byDate[date].isTracked++;
    if (s.is_baseline) byDate[date].isBaseline++;
    if (s.chatgpt_mentioned || s.gemini_mentioned || s.ai_overview_mentioned) byDate[date].mentioned++;
  }
  console.log("\nSnapshots grouped by check date:");
  console.table(byDate);

  // 4. Latest snapshot per query_location_id (what getLatestSnapshots returns)
  const latestByQl = {};
  for (const s of snapshots) {
    if (s.is_tracked && !latestByQl[s.query_location_id]) {
      latestByQl[s.query_location_id] = s;
    }
  }
  const latestSnaps = Object.values(latestByQl);
  console.log(`\n=== LATEST SNAPSHOTS (one per query-location, isTracked=true): ${latestSnaps.length} ===`);

  // 5. Baseline snapshots
  const baselineSnaps = snapshots.filter(s => s.is_baseline);
  console.log(`\n=== BASELINE SNAPSHOTS: ${baselineSnaps.length} ===`);

  // 6. Compute the score exactly as calculateVisibilityScore does
  const targetQueryLocs = queryLocs.filter(r => r.is_target_location);
  const totalQueries = targetQueryLocs.length;
  console.log(`\n=== SCORE COMPUTATION ===`);
  console.log(`totalQueries (getQueryLocationsByCampaignId result): ${totalQueries}`);
  console.log(`latestSnaps used in score: ${latestSnaps.length}`);

  let chatgptCount = 0, geminiCount = 0, aiCount = 0, mentionedCount = 0;
  for (const s of latestSnaps) {
    let mentioned = false;
    if (s.chatgpt_mentioned) { chatgptCount++; mentioned = true; }
    if (s.gemini_mentioned) { geminiCount++; mentioned = true; }
    if (s.ai_overview_mentioned) { aiCount++; mentioned = true; }
    if (mentioned) mentionedCount++;
  }

  const chatgptNorm = Math.round((chatgptCount / totalQueries) * 100);
  const geminiNorm = Math.round((geminiCount / totalQueries) * 100);
  const aiNorm = Math.round((aiCount / totalQueries) * 100);
  const overall = Math.round(chatgptNorm * 0.4 + geminiNorm * 0.3 + aiNorm * 0.3);

  console.log(`\nMentioned counts from latest snaps:`);
  console.log(`  ChatGPT: ${chatgptCount}/${totalQueries} = ${chatgptNorm}`);
  console.log(`  Gemini:  ${geminiCount}/${totalQueries} = ${geminiNorm}`);
  console.log(`  AIO:     ${aiCount}/${totalQueries} = ${aiNorm}`);
  console.log(`  Overall: ${overall}`);
  console.log(`  mentionedQueries: ${mentionedCount} of ${totalQueries}`);

  // 7. Check if there are query-location rows NOT in the latest snapshots
  const snappedQlIds = new Set(latestSnaps.map(s => s.query_location_id));
  const unsnappedTargetQls = targetQueryLocs.filter(ql => !snappedQlIds.has(ql.id));
  console.log(`\n=== TARGET QUERY-LOCATIONS WITH NO LATEST SNAPSHOT: ${unsnappedTargetQls.length} ===`);
  if (unsnappedTargetQls.length > 0) {
    console.table(unsnappedTargetQls.map(r => ({
      id: r.id,
      query: r.query_text?.substring(0, 50),
      location: r.location,
    })));
  }

} catch (err) {
  console.error("Error:", err.message);
} finally {
  await sql.end();
}

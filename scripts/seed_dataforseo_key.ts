/**
 * One-time script: encrypt and store DataForSEO credentials in the serviceKeys table.
 * Run with: npx tsx scripts/seed_dataforseo_key.ts
 */
import { upsertServiceKey } from "../server/db";
import { encrypt } from "../server/encryption";

async function main() {
  const creds = {
    login: "casey@roguebusinessmarketing.com",
    password: "15a64ed03674b140",
  };
  const encrypted = encrypt(JSON.stringify(creds));
  await upsertServiceKey("dataforseo", encrypted);
  console.log("✅ DataForSEO credentials saved to serviceKeys table.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import OpenAI from "openai";

config({ path: resolve(process.cwd(), ".env") });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Decrypt helper (simplified for script)
import crypto from "crypto";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
function decrypt(encryptedText) {
  if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY not set");
  const [ivHex, authTagHex, encryptedHex] = encryptedText.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

async function getApiKey(provider) {
  const { data } = await supabase
    .from("apiKeys")
    .select("encryptedKey")
    .eq("provider", provider)
    .single();
  if (!data) throw new Error(`No key for ${provider}`);
  return decrypt(data.encryptedKey);
}

function businessMentioned(text, businessName) {
  const lower = text.toLowerCase();
  const nameLower = businessName.toLowerCase();
  if (lower.includes(nameLower)) return true;
  const words = nameLower.split(/\s+/).filter((w) => w.length >= 3);
  const matchCount = words.filter((w) => lower.includes(w)).length;
  return matchCount >= Math.ceil(words.length * 0.6);
}

async function runBaseline() {
  console.log("Starting V6 Baseline Probe...");

  const openaiKey = await getApiKey("openai");
  const googleKey = await getApiKey("google");

  const openai = new OpenAI({ apiKey: openaiKey });
  const google = new OpenAI({
    apiKey: googleKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });

  // Get V6 campaigns
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, businessId, primary_keywords")
    .in("id", [3, 10, 11, 12]);

  for (const campaign of campaigns) {
    const { data: business } = await supabase
      .from("businesses")
      .select("name, location")
      .eq("id", campaign.businessId)
      .single();

    const keywords = (campaign.primary_keywords || []).filter(Boolean);
    const locations = (business.location || "")
      .split(";")
      .map((l) => l.trim())
      .filter(Boolean);

    if (!keywords.length || !locations.length) continue;

    console.log(`\n--- Campaign ${campaign.id}: ${business.name} ---`);

    for (const keyword of keywords) {
      for (const location of locations) {
        const query = `best ${keyword} in ${location}`;
        console.log(`\nProbing: "${query}"`);

        // OpenAI
        try {
          const oRes = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: query }],
          });
          const oText = oRes.choices[0].message.content;
          const oMentioned = businessMentioned(oText, business.name);
          console.log(`  OpenAI: ${oMentioned ? "✅ MENTIONED" : "❌ Not mentioned"}`);
        } catch (e) {
          console.log(`  OpenAI Error: ${e.message}`);
        }

        // Google
        try {
          const gRes = await google.chat.completions.create({
            model: "gemini-2.5-flash",
            messages: [{ role: "user", content: query }],
          });
          const gText = gRes.choices[0].message.content;
          const gMentioned = businessMentioned(gText, business.name);
          console.log(`  Google: ${gMentioned ? "✅ MENTIONED" : "❌ Not mentioned"}`);
        } catch (e) {
          console.log(`  Google Error: ${e.message}`);
        }
      }
    }
  }
  console.log("\nBaseline complete.");
}

runBaseline().catch(console.error);

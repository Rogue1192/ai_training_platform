import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DATABASE_URL, {
  ssl: 'require',
});

// Delete duplicate businesses, keeping only the first one of each name
const result = await sql`
  DELETE FROM businesses
  WHERE id NOT IN (
    SELECT MIN(id)
    FROM businesses
    GROUP BY name, "userId"
  )
`;

console.log("Deleted duplicate businesses");

// Show remaining businesses
const remaining = await sql`
  SELECT id, name, "businessType", location FROM businesses ORDER BY id
`;

console.log("\nRemaining businesses:");
remaining.forEach(b => console.log(`  ${b.id}: ${b.name} (${b.businessType}) - ${b.location}`));

await sql.end();

import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DATABASE_URL, {
  ssl: 'require',
});

const tables = await sql`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public'
  ORDER BY table_name
`;

console.log("Tables in database:");
tables.forEach(t => console.log("  -", t.table_name));

await sql.end();

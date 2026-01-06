import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DATABASE_URL, {
  ssl: 'require',
});

// First get the user ID for accounts@roguebusinessmarketing.com
const users = await sql`
  SELECT id FROM users WHERE email = 'accounts@roguebusinessmarketing.com'
`;

if (users.length === 0) {
  console.log("User not found!");
  await sql.end();
  process.exit(1);
}

const userId = users[0].id;
console.log("Found user ID:", userId);

// Dummy businesses data
const businesses = [
  {
    name: "Acme HVAC Services",
    businessType: "HVAC Company",
    location: "Phoenix, AZ",
    phone: "(555) 123-4567",
    website: "https://acmehvac.example.com",
    address: "123 Main St, Phoenix, AZ 85001",
    description: "Full-service HVAC installation, repair, and maintenance for residential and commercial properties.",
    notes: "Test business for AI training"
  },
  {
    name: "Smith Plumbing Co",
    businessType: "Plumbing",
    location: "Scottsdale, AZ",
    phone: "(555) 234-5678",
    website: "https://smithplumbing.example.com",
    address: "456 Oak Ave, Scottsdale, AZ 85251",
    description: "24/7 emergency plumbing services, drain cleaning, and water heater installation.",
    notes: "Test business for AI training"
  },
  {
    name: "Green Lawn Care",
    businessType: "Landscaping",
    location: "Mesa, AZ",
    phone: "(555) 345-6789",
    website: "https://greenlawn.example.com",
    address: "789 Palm Dr, Mesa, AZ 85201",
    description: "Professional lawn care, landscaping design, and irrigation system installation.",
    notes: "Test business for AI training"
  },
  {
    name: "Quick Auto Repair",
    businessType: "Auto Repair",
    location: "Tempe, AZ",
    phone: "(555) 456-7890",
    website: "https://quickauto.example.com",
    address: "321 Motor Way, Tempe, AZ 85281",
    description: "Complete auto repair services including oil changes, brake service, and engine diagnostics.",
    notes: "Test business for AI training"
  },
  {
    name: "Bright Dental Clinic",
    businessType: "Dental Practice",
    location: "Chandler, AZ",
    phone: "(555) 567-8901",
    website: "https://brightdental.example.com",
    address: "555 Smile Blvd, Chandler, AZ 85224",
    description: "Family dental care including cleanings, fillings, crowns, and cosmetic dentistry.",
    notes: "Test business for AI training"
  }
];

// Insert businesses
for (const biz of businesses) {
  await sql`
    INSERT INTO businesses (
      "userId", name, "businessType", location, phone, website, address, description, notes, "createdAt", "updatedAt"
    ) VALUES (
      ${userId}, ${biz.name}, ${biz.businessType}, ${biz.location}, ${biz.phone}, ${biz.website}, ${biz.address}, ${biz.description}, ${biz.notes}, NOW(), NOW()
    )
    ON CONFLICT DO NOTHING
  `;
  console.log("Inserted:", biz.name);
}

console.log("\nDone! Inserted", businesses.length, "dummy businesses.");

await sql.end();

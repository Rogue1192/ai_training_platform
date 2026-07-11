# Current Work Context

## Last commit pushed: f30652a
- billingType column added to businesses table in schema.ts
- ensureBusinessBillingTypeColumn() added to db.ts and registered in index.ts
- createManual and onboardClient updated to read business.billingType first
- getCampaignCosts per-client breakdown fixed (ANY() → inArray())
- backfillBillingTypes updated to also fix businesses.billingType
- submitIntakeForm: contactName/contactEmail now required
- ClientIntakeForm.tsx: submit guard + disabled button

## Currently fixing (NOT YET COMMITTED):
1. Bim Heating and Eagle Air Co disappeared from Double X agency dashboard
   - Root cause: pendingClients = !agencyPackageTier, activeClients = agencyPackageTier
   - These are legacy clients with campaigns but no agencyPackageTier → showed as Pending AND invisible in Active
   - Fix: myClients endpoint now returns hasCampaign flag
   - Fix: AgencyPortal.tsx pendingClients filter now excludes hasCampaign=true and billingType='legacy'
   - Fix: activeClients now includes hasCampaign=true and billingType='legacy'

2. Still TODO (5 issues from user's latest message):
   a. Legacy clients show "Assign Package" prompt — FIXED by above
   b. White-label agency has no place to add/update billing info — TODO
   c. LLM Insights cards collapsed by default (both agency and super admin) — TODO
   d. Agency portal needs Client Links section — ALREADY EXISTS in AgencyClientDetail.tsx
   e. Client Visibility tab (embedded report) in agency portal and super admin — TODO

## Key files:
- /home/ubuntu/ai_training_platform/client/src/pages/AgencyPortal.tsx
- /home/ubuntu/ai_training_platform/client/src/pages/AgencyClientDetail.tsx
- /home/ubuntu/ai_training_platform/client/src/pages/AgencyLLMInsights.tsx (collapsed state at line 84-86)
- /home/ubuntu/ai_training_platform/client/src/pages/LLMInsights.tsx (collapsed state at line 173-179)
- /home/ubuntu/ai_training_platform/client/src/pages/AgencySettings.tsx (billing card at lines 247-273)
- /home/ubuntu/ai_training_platform/server/routers.ts
- /home/ubuntu/ai_training_platform/drizzle/schema.ts

## Agency billing fields in schema (agencies table):
- stripeCustomerId, stripePaymentMethodId, hasPaymentMethod (lines 75-78)
- Agency self-service update restricted to brandName, brandLogoUrl, brandFromName (lines 3371-3390)

## myClients endpoint: now returns hasCampaign flag
## AgencyPortal pendingClients: now excludes hasCampaign=true and billingType='legacy'

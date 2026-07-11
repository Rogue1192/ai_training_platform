# Context Notes

## Client Report URL
- Format: https://app.aianswerforge.com/report/{token}
- Example: https://app.aianswerforge.com/report/542654abf54ad964fc324dc55396b10d507557d26233d717714c1242eff2aff1
- The token comes from the clientDashboards table (field: `reportToken` or similar)
- The report page is ClientDashboard.tsx rendered at /report/:token

## Agency Portal Nav (App.tsx BASE_AGENCY_NAV)
- /agency → My Clients (Building2 icon)
- /agency/llm-insights → LLM Insights (BarChart3 icon)
- /agency/settings → Settings (SettingsIcon icon)
- Need to add: /agency/client-reports → Client Reports (FileText or BarChart2 icon)

## Agency Routes in App.tsx
- AgencyRoute wrapper injects blocked count badge into My Clients nav item
- Routes: /agency, /agency/client/:id, /agency/llm-insights, /agency/settings, /agency/intake

## myClientDashboards endpoint
- Already added to agency router in routers.ts
- Returns client dashboards for the agency's clients

## Verification Fix Summary
- Added llmTxtVerified and schemaVerified boolean columns to campaigns table (DB migration applied)
- Updated Drizzle schema.ts with these columns
- verifyCampaignContent mutation now persists results to DB
- getClientContentPages now returns llmTxtVerified and schemaVerified
- getContentPages (admin) now returns { pages, llmTxtVerified, schemaVerified }
- AgencyClientDetail seeds state from DB on load, invalidates myClients after scan
- CampaignDetail seeds state from DB on load
- myClients blocked check now uses llmTxtVerified === false || schemaVerified === false

## Tier Structure
- Starter: 15 query slots
- Growth: 25 query slots  
- Pro: 50 query slots

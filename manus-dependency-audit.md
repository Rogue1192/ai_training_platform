# Manus Dependency Audit — Complete Catalog

## Files That NEED Changes (Manus Dependencies)

### 1. `server/_core/llm.ts` — MANUS LLM PROXY
- Uses `ENV.forgeApiUrl` and `ENV.forgeApiKey` to call `forge.manus.im/v1/chat/completions`
- **NOT actually used** by any server file (app uses `aiProviders.ts` with direct OpenAI/Anthropic/Google calls)
- **ACTION**: Replace with a wrapper around `aiProviders.ts` or delete entirely

### 2. `server/_core/imageGeneration.ts` — MANUS IMAGE PROXY
- Uses `ENV.forgeApiUrl` and `ENV.forgeApiKey` for `images.v1.ImageService/GenerateImage`
- **NOT actually imported** by any server file
- **ACTION**: Replace with direct OpenAI DALL-E or just leave as dead code to delete

### 3. `server/_core/voiceTranscription.ts` — MANUS WHISPER PROXY
- Uses `ENV.forgeApiUrl` and `ENV.forgeApiKey` for `v1/audio/transcriptions`
- **NOT actually imported** by any server file
- **ACTION**: Replace with direct OpenAI Whisper API or delete

### 4. `server/_core/dataApi.ts` — MANUS DATA API PROXY
- Uses `ENV.forgeApiUrl` and `ENV.forgeApiKey` for `webdevtoken.v1.WebDevService/CallApi`
- **NOT actually imported** by any server file
- **ACTION**: Delete — app uses DataForSEO directly

### 5. `server/_core/map.ts` — MANUS GOOGLE MAPS PROXY
- Uses `ENV.forgeApiUrl` and `ENV.forgeApiKey` for `/v1/maps/proxy`
- **NOT actually imported** by any server file
- **ACTION**: Replace with direct Google Maps API or delete

### 6. `client/src/components/Map.tsx` — MANUS MAPS PROXY (FRONTEND)
- Uses `VITE_FRONTEND_FORGE_API_KEY` and `VITE_FRONTEND_FORGE_API_URL`
- **ACTION**: Replace with direct Google Maps JavaScript API (needs GOOGLE_MAPS_API_KEY)

### 7. `server/_core/sdk.ts` — MANUS OAUTH SDK
- Full Manus OAuth implementation (ExchangeToken, GetUserInfo, etc.)
- Only imported by `oauth.ts` which is NOT imported anywhere
- **ACTION**: Delete — app already uses Supabase Auth via `supabaseAuth.ts`

### 8. `server/_core/oauth.ts` — MANUS OAUTH ROUTES
- Registers `/api/oauth/callback` using the Manus SDK
- **NOT imported** by `index.ts` or any other file
- **ACTION**: Delete — dead code

### 9. `server/_core/env.ts` — MANUS ENV VARS
- Contains `forgeApiUrl`, `forgeApiKey`, `appId`, `oAuthServerUrl` — all Manus-specific
- **ACTION**: Remove these 4 vars, keep the rest (databaseUrl, cookieSecret, etc.)

### 10. `server/_core/types/manusTypes.ts` — MANUS TYPE DEFINITIONS
- Only imported by `sdk.ts`
- **ACTION**: Delete along with sdk.ts

## Files That Are ALREADY Standalone (No Changes Needed)

- `server/aiProviders.ts` — Direct OpenAI/Anthropic/Google API calls ✅
- `server/storage.ts` — Direct Supabase Storage ✅
- `server/_core/supabase.ts` — Direct Supabase client ✅
- `server/_core/supabaseAuth.ts` — Supabase Auth ✅
- `server/_core/context.ts` — Uses supabaseAuth ✅
- `server/_core/notification.ts` — Uses Resend directly ✅
- `server/_core/trpc.ts` — No Manus deps ✅
- `server/_core/cookies.ts` — No Manus deps ✅
- `server/_core/vite.ts` — No Manus deps ✅
- `server/_core/index.ts` — No Manus deps ✅
- `server/_core/systemRouter.ts` — Uses notification.ts (Resend) ✅
- `client/src/const.ts` — Already redirects to `/login` ✅
- All other server/*.ts files — Use aiProviders.ts directly ✅

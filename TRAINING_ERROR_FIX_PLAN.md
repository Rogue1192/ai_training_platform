# Training Session Error Analysis & Fix Plan

**Date:** January 20, 2026  
**Status:** Analysis Complete - Ready for Implementation

---

## Executive Summary

Analysis of the training sessions revealed **three distinct issues** causing failures:

| Issue | Sessions Affected | Root Cause | Priority |
|-------|------------------|------------|----------|
| **Encryption/JWT Mismatch** | 3 (IDs 35, 36, 37) | Production `JWT_SECRET` differs from dev | **CRITICAL** |
| **Redis Authentication** | All production sessions | Missing `REDIS_PASSWORD` in production | **CRITICAL** |
| **Stuck Sessions** | 9 (IDs 25-33) | Jobs not processing on production | **HIGH** |

---

## Issue #1: Encryption Key Mismatch (CRITICAL)

### Problem
The error `"Unsupported state or unable to authenticate data"` is a cryptographic error from Node.js's `crypto.createDecipheriv()`. This occurs when:
- The `JWT_SECRET` used to encrypt API keys differs from the one used to decrypt them
- API keys were encrypted in the dev environment but are being decrypted in production with a different secret

### Evidence
```
Sandbox (dev): JWT_SECRET length = 22 chars → Decryption SUCCESS
Production: Different JWT_SECRET → Decryption FAILS
```

All 3 API keys (OpenAI, Google, Anthropic) decrypt successfully in the sandbox but fail in production.

### Fix Plan

**Option A: Sync JWT_SECRET (Recommended)**
1. Copy the `JWT_SECRET` from the sandbox environment
2. Update the production environment variable to match
3. Restart the production server
4. Re-test API key decryption

**Option B: Re-encrypt API Keys**
1. Keep production `JWT_SECRET` as-is
2. Create a migration script to:
   - Decrypt keys using the old (sandbox) secret
   - Re-encrypt using the new (production) secret
   - Update the database
3. This is more complex and error-prone

**Recommendation:** Option A is simpler and safer.

---

## Issue #2: Redis Authentication (CRITICAL)

### Problem
Production server crashes with:
```
ReplyError: NOAUTH Authentication required.
```

The BullMQ job queue cannot connect to Redis because `REDIS_PASSWORD` is not set in production.

### Evidence
- Sandbox has `REDIS_PASSWORD` set and works
- Production throws NOAUTH error immediately when starting a training session

### Fix Plan
1. Add `REDIS_PASSWORD` environment variable to production
2. Ensure `REDIS_HOST` and `REDIS_PORT` are also correctly set
3. Restart the production server
4. Verify Redis connection with a test command

**Required Environment Variables:**
```
REDIS_HOST=<your-redis-host>
REDIS_PORT=<your-redis-port>
REDIS_PASSWORD=<your-redis-password>
```

---

## Issue #3: Stuck Sessions (HIGH)

### Problem
9 sessions are marked as `in_progress` but haven't made any progress:
- All stuck at `baseline` phase
- Last updated 1.6 to 4.1 hours ago
- No conversations recorded for these sessions

### Root Cause
These sessions were started but their jobs never executed because:
1. Redis connection failed (Issue #2)
2. Server crashed before processing could begin

### Fix Plan
After fixing Issues #1 and #2:

**Step 1: Reset Stuck Sessions**
```sql
UPDATE "trainingSessions" 
SET status = 'paused', 
    trainingPhase = 'pending',
    errorMessage = 'Reset after infrastructure fix'
WHERE status = 'in_progress' 
  AND id IN (25, 26, 27, 28, 29, 30, 31, 32, 33);
```

**Step 2: Restart Sessions**
- Users can manually restart each session from the UI
- Or create a bulk restart script

---

## Issue #4: Legacy Error Sessions (LOW)

### Problem
Old sessions (IDs 5, 9, 11, 19) have timeout or API key errors from before fixes were applied.

### Fix Plan
These can be safely deleted or archived:
```sql
-- Option 1: Delete old error sessions
DELETE FROM "trainingSessions" WHERE id IN (5, 9, 11, 19);

-- Option 2: Archive them (change status)
UPDATE "trainingSessions" 
SET status = 'archived'
WHERE id IN (5, 9, 11, 19);
```

---

## Implementation Order

### Phase 1: Environment Setup (Do First)
1. ✅ Verify sandbox environment works (confirmed)
2. 🔲 Copy `JWT_SECRET` from sandbox to production
3. 🔲 Add `REDIS_PASSWORD` to production
4. 🔲 Verify `REDIS_HOST` and `REDIS_PORT` in production
5. 🔲 Restart production server

### Phase 2: Verification
1. 🔲 Test API key decryption in production (check server logs)
2. 🔲 Test Redis connection (check for NOAUTH errors)
3. 🔲 Start a test training session
4. 🔲 Verify baseline test executes

### Phase 3: Recovery
1. 🔲 Reset the 9 stuck sessions to `paused` status
2. 🔲 Clean up or archive old error sessions
3. 🔲 Restart sessions that users want to continue

### Phase 4: Monitoring
1. 🔲 Watch server logs for any new errors
2. 🔲 Verify sessions progress through phases
3. 🔲 Check that conversations are being saved

---

## Session Status Summary

| Status | Count | IDs | Action Needed |
|--------|-------|-----|---------------|
| **Error** (encryption) | 3 | 35, 36, 37 | Fix JWT_SECRET, then restart |
| **Error** (timeout) | 4 | 5, 9, 11, 19 | Delete or archive |
| **In Progress** (stuck) | 9 | 25-33 | Reset to paused, then restart |
| **Completed** | 4 | 1, 2, 20, 21 | No action |
| **Paused** | 9 | 4, 7, 8, 12-18 | Can be restarted after fix |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Wrong JWT_SECRET copied | Low | High | Double-check value before updating |
| Redis password incorrect | Low | High | Test connection before restarting sessions |
| Data loss during reset | Low | Medium | Only reset status, don't delete data |
| New sessions fail | Medium | Medium | Test with one session before bulk restart |

---

## Testing Checklist

After implementing fixes:

- [ ] Server starts without errors
- [ ] No NOAUTH Redis errors in logs
- [ ] API key decryption succeeds (check logs for "SUCCESS")
- [ ] New training session starts successfully
- [ ] Baseline test executes and saves conversation
- [ ] Training iterations progress
- [ ] Session completes with influence score

---

## Notes

1. **The bias fix is already deployed** - baseline/evaluation now use clean system prompts
2. **Real-time UI updates are working** - timer ticks, auto-refresh enabled
3. **The code is correct** - issues are purely environmental (missing/mismatched env vars)

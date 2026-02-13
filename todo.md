# AI Training Platform TODO

## Database Schema & Backend
- [x] Design and implement database schema for businesses, training sessions, conversations, API keys, and scheduled jobs
- [x] Create database query helpers for all entities
- [x] Implement tRPC procedures for business CRUD operations
- [x] Implement tRPC procedures for training session management
- [x] Implement tRPC procedures for API key management
- [x] Implement tRPC procedures for scheduled training jobs

## Authentication & Security
- [x] Set up user authentication with Manus OAuth
- [x] Implement secure API key storage with encryption
- [x] Create API key management interface
- [ ] Add role-based access control if needed

## Dashboard & Layout
- [x] Design and implement dashboard layout with sidebar navigation
- [x] Create dashboard home page with metrics (active trainings, completed goals, API calls, response time)
- [x] Implement navigation structure for all main sections

## Business Management
- [x] Create business list page with CRUD operations
- [x] Implement business creation form
- [x] Implement business edit functionality
- [x] Implement business deletion with confirmation
- [ ] Add business search and filtering

## Training Session Management
- [x] Create training session creation form with all configuration options
- [x] Implement AI provider selection (OpenAI, Anthropic, Google)
- [x] Implement AI model selection based on provider
- [x] Add training prompt management (multiple prompts)
- [x] Add training context and goal configuration
- [x] Implement iteration and retry interval settings
- [x] Create training session list view
- [x] Implement training session status tracking (PAUSED, IN_PROGRESS, COMPLETED)
- [x] Add pause/resume functionality
- [x] Add restart functionality
- [x] Add delete functionality
- [x] Implement progress tracking and display

## AI Provider Integration
- [x] Integrate OpenAI API for training
- [x] Integrate Anthropic API for training
- [x] Integrate Google AI API for training
- [x] Implement training orchestration logic
- [x] Handle API errors and retries
- [x] Track API usage and response times

## Scheduled Training
- [x] Design scheduled job system with cron-like scheduling
- [x] Implement job creation interface
- [x] Add interval configuration (daily, weekly, monthly)
- [ ] Implement job execution engine
- [x] Add job status monitoring
- [x] Implement job history tracking

## Training History & Conversations
- [ ] Create training history page with all sessions
- [ ] Implement filtering and sorting for history
- [ ] Create conversation viewer component
- [ ] Display training dialogue and iterations
- [ ] Show completion percentages and progress bars
- [ ] Add export functionality for conversations

## Settings & Configuration
- [x] Create settings page layout
- [x] Implement API key management UI
- [ ] Add security settings options
- [ ] Implement connection status indicators for AI providers

## Testing & Quality
- [x] Write unit tests for critical backend procedures
- [x] Test all CRUD operations
- [x] Test training session lifecycle
- [ ] Test scheduled job execution
- [ ] Test API provider integrations
- [x] Verify security and encryption

## Deployment & Documentation
- [ ] Create checkpoint for initial version
- [ ] Push to GitHub repository
- [ ] Document setup instructions
- [ ] Document API provider configuration


## Critical Security Fixes
- [x] Fix hardcoded salt in encryption system
- [x] Implement job queue to prevent memory leaks in training sessions
- [x] Fix API key exposure by implementing just-in-time decryption
- [x] Add rate limiting and retry logic for AI API calls (built into queue)
- [ ] Add error notifications for failed training sessions


## Supabase Auth Integration
- [x] Install Supabase client libraries
- [x] Replace Manus OAuth with Supabase Auth backend
- [x] Update frontend authentication components
- [x] Update environment variables documentation
- [ ] Test login/logout flow (requires Supabase project setup)
- [x] Update deployment guides


## Railway Deployment Fixes (In Progress)
- [x] Remove remaining OAuth initialization code
- [ ] Fix undefined path resolution error
- [ ] Test deployment on Railway


## PostgreSQL Migration
- [x] Install PostgreSQL dependencies (postgres driver)
- [x] Update Drizzle config to use PostgreSQL
- [x] Convert schema from MySQL to PostgreSQL syntax
- [x] Update database connection code
- [x] Generate PostgreSQL migrations
- [x] Update deployment documentation
- [ ] Test with real Supabase database connection


## Railway Deployment Error Fix
- [x] Identify source of undefined path error at dist/index.js:1401
- [x] Fix undefined environment variable causing path resolution error (replaced import.meta.dirname with __dirname for Node.js 18 compatibility)
- [ ] Test deployment on Railway


## Invalid URL Error Fix
- [x] Identify source of Invalid URL error in Supabase client (was actually in getLoginUrl using old OAuth variables)
- [x] Fix getLoginUrl to redirect to /login instead of old OAuth portal
- [x] Add fallback handling for missing Supabase environment variables
- [ ] Test fix on Railway deployment


## Authentication Flow Issue (In Progress)
- [ ] Test login flow on Railway deployment
- [ ] Identify why login shows success toast but doesn't redirect
- [ ] Review Supabase auth integration with backend
- [ ] Fix authentication and session management
- [ ] Verify user is properly authenticated after login
- [ ] Test redirect to dashboard after successful login


## UI/UX Fixes
- [x] Fix modal/popup forms being cut off - add scrolling support
- [x] Fix dashboard query error - fixed date parameter formatting for PostgreSQL
- [x] Fix API key validation error on Settings page - updated model names to Claude 4.5
- [x] Add Test API Key button to verify keys are valid and have necessary permissions
- [x] Fix Select.Item empty value error on Training page
- [x] Set up Redis connection for training queue
- [x] Initialize training worker on server startup
- [x] Test training session execution with Redis queue


## Conversation Viewer Feature
- [x] Create tRPC endpoint to fetch conversation history for a training session
- [x] Design conversation viewer UI component with chat-style layout
- [x] Display iteration number, timestamp, and goal achieved status
- [x] Show full conversation history (user prompts and AI responses)
- [x] Add expand/collapse functionality for long conversations
- [x] Integrate viewer into Training Sessions page (view button or modal)
- [ ] Add syntax highlighting or markdown rendering for AI responses
- [x] Write tests for conversation viewer endpoint

## Bug Fixes
- [x] Fix Conversation Viewer modal scrolling - content gets cut off and no scrollbar visible
- [x] Update session status to 'error' when job fails after all retries
- [x] Store error message in session for display in UI
- [x] Add Retry button for sessions in error state
- [x] Display error message in session card UI
- [x] Clean up stuck sessions (2 and 5) with proper error status

## API Key Validation Before Training
- [x] Add validation function to check if required API keys exist for a training session
- [x] Return clear error message indicating which provider's API key is missing
- [x] Update the updateStatus tRPC endpoint to validate before starting
- [x] Show validation error in UI toast when trying to start without required keys
- [x] Clear error message when retrying from error state
- [x] Add 'Go to Settings' link in API key error toast


## Suggestive Prompting Implementation
- [x] Update training queue to generate suggestive prompts that introduce the business
- [x] Add prompt templates that naturally mention the business name
- [x] Fix goal evaluation to check for exact business name match
- [x] Update UI to show prompt type (neutral vs suggestive)
- [x] Test with a real training session

## Multi-Turn Conversations
- [x] Add follow-up prompt templates for when business is not mentioned
- [x] Implement logic to check if business was mentioned after first response
- [x] Send follow-up prompt to Target AI if business not mentioned
- [x] Store multi-turn conversation history (multiple user/assistant pairs)
- [x] Update UI to display multi-turn conversations with clear turn indicators
- [x] Fix business name extraction to use topic field instead of trainingName
- [ ] Test with real training session (pending - need AI to not mention business in first response)


## Training Page Filters
- [x] Add filter dropdown to filter training sessions by business
- [x] Extract unique businesses from training sessions
- [x] Show "All Businesses" option as default
- [x] Filter sessions in real-time when business is selected
- [x] Add "Unassigned" filter option for sessions without a business link

## Search and Pagination Enhancements
- [x] Add search bar inside business filter dropdown to search businesses
- [x] Implement numbered pagination for training sessions
- [x] Add page size selector dropdown (e.g., 5, 10, 25, 50 items per page)
- [x] Show current page info (e.g., "Showing 1-10 of 17 sessions")
- [x] Add first/prev/next/last navigation buttons


## Status Filter Feature
- [x] Add status filter dropdown next to business filter
- [x] Include options: All Statuses, In Progress, Paused, Completed, Error
- [x] Filter sessions in real-time when status is selected
- [x] Combine with business filter for multi-criteria filtering
- [x] Reset pagination to page 1 when status filter changes

## Business Required for Training Sessions
- [x] Make business selection required in training session creation form
- [x] Add frontend validation to prevent submission without business
- [x] Update backend validation to require businessId
- [x] Show clear error message when business is not selected

## Bulk Operations for Training Sessions
- [x] Add checkbox column for selecting individual sessions
- [x] Add "Select All" checkbox in header
- [x] Show bulk action bar when items are selected
- [x] Implement bulk delete with confirmation dialog
- [x] Implement bulk start for paused sessions
- [x] Implement bulk restart for completed/error sessions
- [x] Add backend procedures for bulk operations (uses existing single-item procedures with Promise.all)
- [x] Clear selection after bulk operation completes

## Full Scheduler Implementation
- [x] Make training session required for scheduled jobs (remove business-only option)
- [x] Create scheduler service that runs on a timer (every minute)
- [x] Implement next run calculation for daily/weekly/monthly/custom schedules
- [x] Query for active jobs where nextRun <= now and trigger training sessions
- [x] Update lastRun, nextRun, and runCount after each execution
- [x] Add run history tracking to show how many times training was run over time
- [x] Update Schedule UI to display linked training session name
- [x] Show next run time in job cards
- [x] Add "Run Now" button for manual triggering
- [x] Display total run count and last run time prominently

## Two-Factor Authentication (2FA/MFA)
- [x] Review current Supabase Auth implementation
- [x] Create 2FA enrollment UI in Settings page
- [x] Generate QR code for authenticator app setup
- [x] Implement TOTP verification during enrollment
- [x] Add 2FA challenge during login flow
- [x] Create 2FA management section (view status, disable)
- [ ] Add recovery codes generation and display (future enhancement)
- [x] Test full 2FA enrollment and login flow

## 2FA Permanent (No Disable)
- [x] Remove disable 2FA button once 2FA is enabled
- [x] Update UI to show 2FA is permanently enabled

## AI Training Logic Fix (Major Refactor)
**Problem:** Current implementation creates false positives by mentioning business name in prompts then checking if AI echoes it back.
**Solution:** Separate training phase (suggestive prompts) from evaluation phase (clean prompts).

### Phase 1: Database Schema Updates
- [x] Add `trainingPhase` varchar field to trainingSessions (pending/baseline/training/evaluation/completed)
- [x] Add `baselineMentioned` boolean field to trainingSessions
- [x] Add `evaluationMentioned` boolean field to trainingSessions
- [x] Add `influenceScore` integer field to trainingSessions
- [x] Add `conversationType` field to trainingConversations (baseline/training/evaluation)
- [x] Add `promptType` field to trainingConversations (clean/suggestive/follow_up)
- [x] Create and run database migration
- [x] Mark existing sessions as legacy

### Phase 2: Prompt Generation Refactor
- [x] Create `generateCleanPrompt()` function (no business name)
- [x] Refactor `generateSuggestivePrompt()` for training phase only
- [x] Create `generateFollowUpPrompt()` function
- [x] Add prompt type validation and business name detection
- [ ] Write unit tests for prompt generation

### Phase 3: Training Queue Refactor
- [x] Implement `executeBaselineTest()` function
- [x] Refactor `executeTrainingIteration()` to skip goal scoring
- [x] Implement `executeEvaluationTest()` function
- [x] Add phase state machine transitions
- [x] Update job scheduling for phase transitions
- [x] Create trainingQueueV2.ts with new phase-based system

### Phase 4: Goal Achievement Logic
- [x] Create `checkBusinessMention()` function with confidence scoring
- [x] Remove goal checking from training iterations (goalAchieved always false in training)
- [x] Implement influence score calculation (evaluation - baseline)
- [x] Add confidence scoring (0-100%)

### Phase 5: UI Updates
- [x] Update Training Session card with phase indicator badge
- [x] Display baseline vs evaluation comparison in results section
- [x] Add influence score visualization with color coding
- [x] Add Legacy badge for old sessions
- [x] Integrate V2 worker with server startup
- [ ] Add tooltips explaining new metrics

### Phase 6: Testing & Migration
- [x] Mark legacy sessions appropriately (existing sessions marked as isLegacy=true)
- [ ] Write integration tests for full training cycle
- [ ] Test with real AI providers

## Allow Disabling 2FA
- [x] Restore disable 2FA button in TwoFactorAuth component
- [x] Require verification code to disable 2FA
- [x] Show confirmation dialog with warning before disabling

## Supabase Session Token Fix
- [x] Fix Supabase session token not being sent to API endpoints
- [x] Store session token in global window variable
- [x] Update tRPC client to wait for session to be loaded
- [x] Implement auth state change listener to update token
- [x] Test authentication flow with browser


## User-Reported Issues (Jan 15, 2026)
- [x] Fix training content being marked as 'optional' - should be required
- [x] Diagnose and fix Training tab slow loading issue (fixed database schema mismatch - missing columns)
- [x] Fix infinite loading after switching tabs (fixed by adding missing database columns and session management)
- [ ] Review Businesses tab functionality and purpose
- [ ] Review Schedule tab functionality and purpose
- [ ] Optimize Training tab performance for faster loading


## Edit Paused Training Sessions Feature
- [ ] Analyze current training session structure and identify editable fields
- [ ] Create backend API endpoint for updating training sessions (training.update)
- [ ] Build edit dialog UI component with pre-populated form fields
- [ ] Add edit button to paused session cards
- [ ] Wire up edit functionality to open dialog and save changes
- [ ] Test edit feature end-to-end


## Edit Paused Sessions Feature
- [x] Create Edit button on paused and error training sessions
- [x] Implement edit dialog with all session configuration fields
- [x] Allow editing of Target AI, Influencer AI, iterations, retry interval, and training context
- [x] Implement Save Changes button to update session configuration
- [x] Add form validation for required fields
- [x] Show success/error toasts for edit operations
- [x] Write comprehensive unit tests for edit functionality
- [x] Test editing paused sessions
- [x] Test editing error status sessions
- [x] Verify session status is preserved during edit


## Restart Conversation Feature
- [x] Add "Restart Conversation" button to completed training session cards
- [x] Create restart conversation backend procedure
- [x] Implement restart logic to create new session with same configuration
- [x] Allow customizing iterations when restarting
- [x] Write comprehensive unit tests for restart functionality
- [x] Test restart feature end-to-end


## Edit Button for Completed Sessions
- [x] Modify Edit button condition to show on both paused and completed sessions
- [x] Ensure in-progress sessions do not have Edit button
- [x] Test edit functionality on completed sessions
- [x] Verify session status is preserved when editing completed sessions


## Training Session Completion Fixes (Bug Fixes)
- [x] Fix Issue #1: Add explicit isLegacy flag to new sessions
- [x] Fix Issue #2: Add comprehensive error logging to V2 worker
- [x] Fix Issue #4: Update scheduler to use trainingEngine


## Training Session UI Improvements
- [x] Show session start date/time on each card
- [x] Display running duration for in-progress sessions
- [x] Add "stuck" indicator for sessions running longer than expected ("Possibly Stuck" badge)
- [x] Show last activity timestamp
- [x] Add visual warning for sessions that may have errors
- [x] Display training phase (baseline/training/evaluation) for V2 sessions
- [x] Show progress (current iteration / total iterations) for in-progress sessions


## Reset Stuck Sessions Feature
- [x] Create backend procedure to identify and reset stuck sessions
- [x] Define "stuck" criteria: in_progress status with no update for >1 hour
- [x] When resetting, change status to "error" with descriptive error message
- [x] Store error message with timeout duration, last phase, and progress
- [x] Add "Reset Stuck Sessions" button to Training Sessions page header
- [x] Show AlertDialog confirmation with count of sessions to be reset
- [x] Display success toast with number of sessions reset
- [x] Show error reason in session card for reset sessions
- [x] Auto-hide button when no stuck sessions exist
- [x] Test bulk reset functionality


## Training Session UI Fixes (Jan 20, 2026)
- [x] Remove error message display when session is restarted or started (clear errorMessage field)
- [x] Investigated why Kitsap Roof Pros shows 5/5 iterations but still in_progress - caused by database insert failure
- [x] Fixed conversation history - shows "No conversations yet" when DB insert fails (expected behavior)
- [x] Improved UI clarity - simplified technical error messages for users
- [x] Clean up confusing error dialogs - error messages only show for error status sessions


## Database Error Investigation (Jan 20, 2026)
- [x] Checked server logs and Redis queue - found 5 failed jobs with database insert errors
- [x] Identified why trainingConversations insert was failing - missing V2 columns
- [x] Compared database schema with Drizzle schema - found 4 missing columns
- [x] Fixed schema mismatches by adding missing columns (conversationType, promptType, businessMentionedUnprompted, mentionConfidence)
- [x] Tested training session execution after fix - sessions now complete successfully with all V2 fields populated


## Real-Time Training Session UI Updates
- [x] Create LiveTimer component that ticks every second
- [x] Display elapsed time in format: "Xd Xh Xm Xs" with seconds (e.g., "7d 23h 31m 6s")
- [x] Implement auto-refresh for session data (every 10 seconds)
- [x] Auto-update progress counter without manual refresh
- [x] Auto-update session status (completed, error, stuck) without manual refresh
- [x] Auto-update "Possibly Stuck" badge in real-time
- [x] Only enable auto-refresh when there are in-progress sessions
- [x] Added visual progress bar with percentage for in-progress sessions
- [x] Added "Auto-refreshing every 10s" indicator in header
- [x] Test real-time updates work correctly - verified timer ticks and data refreshes

## Fix Training Bias - Remove Context from Baseline/Evaluation
- [x] Remove trainingContext from baseline test system prompt
- [x] Remove trainingContext from evaluation test system prompt
- [x] Keep trainingContext only in training phase (suggestive prompts)
- [x] Server restarted with fix applied
- [x] Workers ready and listening for jobs

## Fix Redis NOAUTH Error on Production
- [ ] Investigate Redis connection configuration
- [ ] Fix Redis authentication for BullMQ queues
- [ ] Test training session starts without error


## Global Prompt Management Feature
- [x] Add promptTemplates table to database schema
- [x] Run database migration (created table via SQL)
- [x] Create database helpers for prompt templates (CRUD operations)
- [x] Add tRPC procedures for prompt template management
- [x] Update promptGeneration.ts to use database templates (async versions)
- [x] Create PromptTemplateEditor component
- [x] Update Settings page with Prompt Templates tab
- [x] Add default template seeding logic (seeds on first access)
- [x] Test prompt template CRUD operations (14 tests passing)
- [x] Updated trainingQueueV2.ts to use async prompt generation


## Update Default Global Prompts (Influenx Structure)
- [x] Update Context Integration prompt (suggestive template) - Now uses natural conversational style
- [x] Update Intelligent Follow-up prompt (follow_up template) - Maintains specific details (location, business type)
- [x] Keep clean prompts as user-configured variations - Updated to Influenx style
- [x] Update category-based prompts - Simplified to match Influenx patterns
- [x] Test updated prompts work correctly - 14 tests passing


## Fix promptTemplates Table Error (Feb 10, 2026)
- [x] Identified table was missing from Supabase PostgreSQL database
- [x] Created promptTemplates table directly in Supabase PostgreSQL with correct schema
- [x] Fixed drizzle.config.ts to use SUPABASE_DATABASE_URL instead of DATABASE_URL
- [x] Verified Settings page loads without errors - Prompt Templates section displays correctly
- [x] Verified Training page loads without errors


## Clean Up Test/Dummy Businesses (Feb 10, 2026)
- [x] Log in and review all 57 businesses
- [x] Identify 16 test/dummy businesses (no domain, test names, dummy data)
- [x] Present list to user for confirmation before deletion
- [x] Delete 16 confirmed test businesses (41 legitimate remain)
- [x] Delete 19 test training sessions and 18 linked conversations
- [x] Verify cleanup is complete (41 businesses, 84 sessions remain)


## Remove Training Phase Bias - Priority 1 Fix
- [x] Remove trainingContext from training phase system prompt in trainingQueueV2.ts
- [x] Verify tests pass (14/14 passing)
- [x] Deploy fix (checkpoint saved, auto-deploys to Railway via GitHub)


## End-to-End Test - Titan Cleaning Company
- [ ] Crawl Titan Cleaning Company website for business details
- [ ] Log in as paul@roguebusinessmarketing.com test account
- [ ] Create Titan Cleaning Company business profile
- [ ] Create training session for the business
- [ ] Start training session and monitor progress
- [ ] Validate baseline, training, and evaluation phases work correctly
- [ ] Verify no bias in prompts


## Scheduling/Cron Audit
- [ ] Audit training session scheduling/cron implementation
- [ ] Verify scheduled sessions are automatically triggered at configured times
- [ ] Fix any gaps in the scheduling pipeline
- [ ] Test scheduling flow end-to-end

## Scheduler Overhaul
- [x] Add scheduledJobRuns history table to database schema
- [x] Add scheduledAt (exact datetime) and timeOfDay fields to scheduledJobs table
- [x] Push database migration
- [x] Refactor scheduler to use exact date/time instead of relative intervals
- [x] Implement proper session reset (clear all V2 fields) before re-run
- [x] Add duplicate run protection (skip if session already in_progress)
- [x] Log every run to scheduledJobRuns history table
- [x] Refactor Schedule UI with date/time picker for exact scheduling
- [x] Add run history view showing all past executions with status
- [x] Show exact next run date/time prominently on job cards
- [x] Update tRPC procedures for new scheduling fields
- [x] Write tests for scheduler logic (12 tests passing)
- [x] Verify end-to-end scheduling flow

## Bug Fixes
- [x] Fix deprecated Google AI model: gemini-2.0-flash-exp → gemini-2.0-flash

## Scheduler Fixes (from analysis report)
- [x] Batch 0: Add deprecated model fallback mapping (gemini-2.0-flash-exp → gemini-2.0-flash)
- [x] Batch 1a: Clear old conversations when scheduler resets a session for re-run (already implemented)
- [x] Batch 1b: Fix trainingPrompts double-encoding with defensive JSON parsing
- [x] Batch 2: Update run history records when sessions complete/fail (connect V2 worker to scheduledJobRuns)
- [x] Batch 3a: Add ownership validation to schedule.delete
- [x] Batch 3b: Add ownership validation to schedule.runNow
- [x] Batch 3c: Add ownership validation to schedule.getRunHistory (jobId path)
- [x] Batch 6a: Add staleness detection for stuck in_progress sessions (2hr threshold, auto-marks as error)
- [x] Batch 7a: Fix monthly day overflow for day 29-31 (clamp to last day of month)
- [x] Batch 7b: Custom cron falls back to daily with warning log (kept for future expansion)
- [x] Write tests for all scheduler fixes (27 tests passing)

## Bug: Logout not working on dev server
- [ ] Investigate and fix logout redirecting back to dashboard instead of logging out

## Scheduler: Replace Custom with Hourly
- [x] Add "hourly" to schedule type enum in schema
- [x] Add hourly case to calculateNextRun in scheduler.ts
- [x] Update getScheduleDescription for hourly
- [x] Update routers.ts to accept "hourly" schedule type
- [x] Update ScheduledJobs.tsx UI to show Hourly instead of Custom (Cron)
- [x] Update tests for hourly scheduling (32 tests passing)

## Fix: Auto-update deprecated model names for existing sessions
- [x] Add model migration logic when starting/restarting a session (update DB record if model is deprecated)
- [x] Ensure the model fallback map in aiProviders.ts is used consistently (exported resolveModel)
- [x] Test that restarting a session with old model name auto-corrects it (32 scheduler tests passing)

## Bug: Logout redirect not working — stuck on dashboard
- [x] Trace and fix the full logout flow: clicking Sign Out now clears Supabase session + token + cookie and redirects to /login

## Fix: Unify login screens — remove "Sign in to continue" intermediary
- [x] Replace DashboardLayout's "Sign in to continue" UI with direct redirect to /login
- [x] Ensure logout flow goes directly to /login (the real login form)


## Bug: Copper & Cable session stuck in_progress (Feb 12, 2026)
- [ ] Analyze why session gets stuck despite correct model names (gemini-2.0-flash / gpt-4o)
- [ ] Check training queue V2 worker for failure points
- [ ] Check AI provider error handling and timeout logic
- [ ] Check Redis connectivity and BullMQ job processing
- [ ] Identify root cause and implement fix


## Fix: Dynamic staleness detection (Feb 12, 2026)
- [x] Replace fixed 2-hour stale threshold with dynamic threshold based on session retryInterval
- [x] Use retryInterval * 3 as the minimum stale window per session
- [x] Set a floor of 30 minutes and a ceiling of 24 hours for the dynamic threshold
- [x] Update staleness detection to fetch all in_progress sessions and evaluate per-session
- [x] Update unit tests for new staleness logic (41/41 passing)

## Bug Investigation: Sessions stop progressing after ~12 iterations (Feb 13, 2026)
- [ ] Analyze why BullMQ delayed jobs are being lost after iteration 12
- [ ] Check Redis connectivity, worker concurrency, and job chaining logic
- [ ] Identify the true root cause (not just the staleness detector symptom)

## Critical Bug: API keys keep breaking across deployments (Feb 13, 2026)
- [x] Investigate why JWT_SECRET changes between deployments causing decrypt failures
- [x] Implement a stable ENCRYPTION_KEY that survives redeployments
- [x] Add fallback decryption with JWT_SECRET for backward compatibility
- [x] All 15 encryption tests passing including stability and fallback tests

## UI: Searchable business filter on /training (Feb 13, 2026)
- [x] Replace Select dropdown with searchable Combobox for business filter

## Critical Bug: Sessions still dying - delayed jobs lost (Feb 13, 2026)
- [x] Investigated BullMQ delayed job loss — jobs vanish between iterations
- [x] Traced exact failure: after iter 4 completes, no "added" event for iter 5 in Redis
- [x] Added recoverStuckSessions() to scheduler — re-queues lost jobs before staleness kills them
- [x] Added try/catch around queue.add() in the worker with graceful fallback to scheduler recovery
- [x] updatedAt refreshed both after iteration AND after successful queue.add()
- [x] Recovery fires at retryInterval × 1.5 (15 min for 10-min retry), well before staleness threshold (30 min)
- [x] All 50 scheduler tests passing including 9 new recovery threshold tests

## Feature: Restart All Error Sessions button (Feb 13, 2026)
- [x] Add restartAllError backend procedure (batch processing in groups of 5)
- [x] Add getErrorSessionsCount query endpoint
- [x] Add "Restart All Error Sessions" button to training page UI with green styling
- [x] Show AlertDialog confirmation with count of error sessions
- [x] Show per-session results with success/failure details in toast
- [x] Include API key validation and model migration per session
- [x] Auto-hide button when no error sessions exist
- [x] All 9 tests passing

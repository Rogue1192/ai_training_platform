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

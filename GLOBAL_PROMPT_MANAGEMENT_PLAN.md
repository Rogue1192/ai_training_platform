# Global Prompt Management - Implementation Plan

## Overview

This plan outlines the implementation of a **Global Prompt Management** feature in the Settings page, allowing users to view and edit the underlying prompts used by the AI training system. This enables centralized curation of all prompt templates without modifying code.

---

## Current State Analysis

### How Prompts Work Today

The training system uses **three types of prompts**:

| Prompt Type | Purpose | When Used |
|-------------|---------|-----------|
| **Clean Prompts** | Generic questions without business mentions | Baseline & Evaluation phases |
| **Suggestive Prompts** | Questions that naturally introduce the business | Training phase |
| **Follow-up Prompts** | Reinforce business mentions in conversations | When AI doesn't mention business initially |

### Current Prompt Storage

1. **User-defined prompts** (`trainingPrompts`): Stored per session in the database as JSON array
2. **System prompt templates**: Hardcoded in `server/promptGeneration.ts`
   - Clean prompt templates (lines 161-169)
   - Suggestive prompt templates (lines 107-113)
   - Follow-up prompt templates (lines 136-144)

### Key Files Involved

```
server/promptGeneration.ts    → Contains all prompt template logic
server/trainingQueueV2.ts     → Uses prompts during training execution
drizzle/schema.ts             → Database schema (trainingSessions.trainingPrompts)
client/src/pages/Settings.tsx → Current settings page (API keys only)
```

---

## Proposed Feature Design

### 1. Database Changes

Create a new `promptTemplates` table to store global prompt configurations:

```sql
CREATE TABLE promptTemplates (
  id SERIAL PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES users(id),
  templateType VARCHAR(50) NOT NULL,  -- 'clean', 'suggestive', 'follow_up', 'category_based'
  templateName VARCHAR(255) NOT NULL,
  templateContent TEXT NOT NULL,
  isActive BOOLEAN DEFAULT true,
  sortOrder INTEGER DEFAULT 0,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
```

### 2. Prompt Template Categories

| Category | Description | Variables Available |
|----------|-------------|---------------------|
| **Clean (Baseline/Evaluation)** | Generic prompts without business name | `{businessType}`, `{location}` |
| **Suggestive (Training)** | Prompts that introduce the business | `{cleanPrompt}`, `{businessName}` |
| **Follow-up** | Prompts when AI doesn't mention business | `{businessName}` |
| **Category-Based** | Fallback prompts by business type | `{businessType}`, `{location}` |

### 3. UI Components

#### Settings Page - New "Prompt Templates" Section

```
┌─────────────────────────────────────────────────────────────┐
│ ⚙️ Settings                                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ [API Keys]  [Prompt Templates]  [2FA]                       │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📝 Prompt Templates                                     │ │
│ │                                                         │ │
│ │ Configure the underlying prompts used by AI training.   │ │
│ │ Changes apply to all new training sessions.             │ │
│ │                                                         │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ Clean Prompts (Baseline & Evaluation)               │ │ │
│ │ │                                                     │ │ │
│ │ │ These prompts are used to test if the AI knows the  │ │ │
│ │ │ business WITHOUT any hints or suggestions.          │ │ │
│ │ │                                                     │ │ │
│ │ │ Variables: {businessType}, {location}               │ │ │
│ │ │                                                     │ │ │
│ │ │ ┌─────────────────────────────────────────────────┐ │ │ │
│ │ │ │ What are the best {businessType} services in    │ │ │ │
│ │ │ │ {location}?                                  [✏️]│ │ │ │
│ │ │ └─────────────────────────────────────────────────┘ │ │ │
│ │ │ ┌─────────────────────────────────────────────────┐ │ │ │
│ │ │ │ Can you recommend a good {businessType} in      │ │ │ │
│ │ │ │ {location}?                                  [✏️]│ │ │ │
│ │ │ └─────────────────────────────────────────────────┘ │ │ │
│ │ │                                                     │ │ │
│ │ │ [+ Add Clean Prompt]                                │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ │                                                         │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ Suggestive Prompts (Training Phase)                 │ │ │
│ │ │                                                     │ │ │
│ │ │ These prompts naturally introduce the business name │ │ │
│ │ │ to train the AI to associate it with the category.  │ │ │
│ │ │                                                     │ │ │
│ │ │ Variables: {cleanPrompt}, {businessName}            │ │ │
│ │ │                                                     │ │ │
│ │ │ ┌─────────────────────────────────────────────────┐ │ │ │
│ │ │ │ {cleanPrompt} I've been hearing good things     │ │ │ │
│ │ │ │ about {businessName} locally. Are they          │ │ │ │
│ │ │ │ reputable?                                   [✏️]│ │ │ │
│ │ │ └─────────────────────────────────────────────────┘ │ │ │
│ │ │                                                     │ │ │
│ │ │ [+ Add Suggestive Prompt]                           │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ │                                                         │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ Follow-up Prompts                                   │ │ │
│ │ │                                                     │ │ │
│ │ │ Used when the AI doesn't mention the business in    │ │ │
│ │ │ its initial response.                               │ │ │
│ │ │                                                     │ │ │
│ │ │ Variables: {businessName}                           │ │ │
│ │ │                                                     │ │ │
│ │ │ ┌─────────────────────────────────────────────────┐ │ │ │
│ │ │ │ What about {businessName}? I've heard they're   │ │ │ │
│ │ │ │ really good. Have you heard of them?         [✏️]│ │ │ │
│ │ │ └─────────────────────────────────────────────────┘ │ │ │
│ │ │                                                     │ │ │
│ │ │ [+ Add Follow-up Prompt]                            │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ │                                                         │ │
│ │ [Reset to Defaults]                    [Save Changes]   │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Database & Backend (Est. 2-3 hours)

1. **Add `promptTemplates` table to schema**
   - File: `drizzle/schema.ts`
   - Add table definition with userId, templateType, templateContent, isActive, sortOrder

2. **Create database migration**
   - Run `pnpm db:push` to apply schema changes

3. **Add database helpers in `server/db.ts`**
   - `getPromptTemplates(userId, templateType?)` - Get all templates for a user
   - `createPromptTemplate(data)` - Create new template
   - `updatePromptTemplate(id, data)` - Update existing template
   - `deletePromptTemplate(id)` - Delete template
   - `resetPromptTemplatesToDefaults(userId)` - Reset to system defaults

4. **Seed default templates**
   - Create a function to insert default templates when user first accesses the feature
   - Copy current hardcoded templates from `promptGeneration.ts`

### Phase 2: API Routes (Est. 1-2 hours)

5. **Add tRPC procedures in `server/routers.ts`**
   ```typescript
   promptTemplate: {
     list: protectedProcedure.query(...)      // Get all templates
     create: protectedProcedure.mutation(...) // Create new template
     update: protectedProcedure.mutation(...) // Update template
     delete: protectedProcedure.mutation(...) // Delete template
     resetDefaults: protectedProcedure.mutation(...) // Reset to defaults
   }
   ```

### Phase 3: Update Training Logic (Est. 2-3 hours)

6. **Modify `server/promptGeneration.ts`**
   - Add function to fetch templates from database
   - Fall back to hardcoded defaults if no custom templates exist
   - Update `generateCleanPrompt`, `generateSuggestivePrompt`, `generateFollowUpPrompt` to use database templates

7. **Update `server/trainingQueueV2.ts`**
   - Pass userId to prompt generation functions
   - Ensure templates are fetched at runtime (not cached)

### Phase 4: Frontend UI (Est. 3-4 hours)

8. **Create `PromptTemplateEditor` component**
   - File: `client/src/components/PromptTemplateEditor.tsx`
   - Textarea for editing template content
   - Variable chips showing available placeholders
   - Preview with sample data
   - Enable/disable toggle

9. **Update Settings page**
   - File: `client/src/pages/Settings.tsx`
   - Add tabs: "API Keys" | "Prompt Templates" | "2FA"
   - Integrate PromptTemplateEditor for each template type
   - Add "Reset to Defaults" button
   - Add "Save Changes" with optimistic updates

### Phase 5: Testing & Polish (Est. 1-2 hours)

10. **Write tests**
    - Test database operations
    - Test prompt generation with custom templates
    - Test API endpoints

11. **Add validation**
    - Ensure templates contain required variables
    - Prevent empty templates
    - Validate variable syntax

---

## Technical Considerations

### Variable Interpolation

Templates will use `{variableName}` syntax for placeholders:

```typescript
function interpolateTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => variables[key] || match);
}
```

### Caching Strategy

- Templates should be fetched fresh for each training session
- Consider caching for 5 minutes with invalidation on update
- Use React Query's cache for frontend

### Migration Path

- Existing sessions continue using their stored `trainingPrompts`
- New sessions use global templates + session-specific prompts
- Global templates act as "system prompts", session prompts are "user prompts"

### Permissions

- Each user has their own set of templates
- Admin users could potentially manage global defaults (future feature)

---

## Estimated Timeline

| Phase | Task | Time |
|-------|------|------|
| 1 | Database & Backend | 2-3 hours |
| 2 | API Routes | 1-2 hours |
| 3 | Training Logic Updates | 2-3 hours |
| 4 | Frontend UI | 3-4 hours |
| 5 | Testing & Polish | 1-2 hours |
| **Total** | | **9-14 hours** |

---

## Future Enhancements

1. **Template Categories by Business Type**
   - Different templates for HVAC, Roofing, Plumbing, etc.

2. **A/B Testing**
   - Test different prompt variations to see which performs better

3. **Template Sharing**
   - Share effective templates between users

4. **AI-Assisted Template Generation**
   - Use AI to suggest improved prompt templates

5. **Template Analytics**
   - Track which templates lead to higher influence scores

---

## Files to Create/Modify

### New Files
- `client/src/components/PromptTemplateEditor.tsx`
- `client/src/components/PromptTemplateSection.tsx`

### Modified Files
- `drizzle/schema.ts` - Add promptTemplates table
- `server/db.ts` - Add database helpers
- `server/routers.ts` - Add tRPC procedures
- `server/promptGeneration.ts` - Use database templates
- `server/trainingQueueV2.ts` - Pass userId for template lookup
- `client/src/pages/Settings.tsx` - Add Prompt Templates tab

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing training sessions | Keep hardcoded defaults as fallback |
| Invalid template syntax | Validate templates before saving |
| Performance impact | Cache templates with short TTL |
| User confusion | Add clear documentation and examples |

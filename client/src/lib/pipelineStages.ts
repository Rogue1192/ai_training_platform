/**
 * pipelineStages.ts
 * Shared utility that maps campaign DB fields to the 7-stage pipeline model.
 * Used by both the campaign list card and the campaign detail page header.
 *
 * IMPORTANT: The pipeline is strictly sequential. A stage can only show as
 * "complete" (green) if ALL prior stages are also complete. This prevents
 * orphaned timestamps from previous pipeline runs from lighting up stages
 * out of order.
 *
 * Gate logic (mirrors server/contentVerifier.ts):
 *
 *  Stage 4 — Content Published
 *    Complete when: publishingCompletedAt is set AND no content pages are
 *    missing a URL. llm.txt and schema are NOT required here — they can be
 *    added before or after the URLs in any order.
 *
 *  Stage 5 — Indexing
 *    Complete when: indexingVerifiedAt is set AND llmTxtVerified AND
 *    schemaVerified. This means the Indexing pill stays amber/active until
 *    all three are done, preventing the "gap" that would appear if indexing
 *    completed before llm.txt/schema were verified.
 */

export type StageStatus =
  | "complete"     // green — step is done AND all prior steps are done
  | "active"       // blue — step is currently running
  | "action"       // amber — step needs user action to proceed
  | "pending"      // grey — step hasn't started yet (or prior steps not done)
  | "sprint"       // yellow pulsing — training sprint in progress
  | "maintenance"; // teal — ongoing post-sprint maintenance

export interface PipelineStage {
  id: string;
  label: string;
  status: StageStatus;
  /** Short tooltip / description shown on hover */
  description: string;
  /** True if this is the current active step the user should focus on */
  isCurrent: boolean;
}

interface CampaignPipelineFields {
  keywordResearchCompletedAt: Date | string | null;
  baselineCheckCompletedAt: Date | string | null;
  credibilityResearchCompletedAt: Date | string | null;
  contentGenerationCompletedAt: Date | string | null;
  publishingCompletedAt: Date | string | null;
  indexingSubmittedAt: Date | string | null;
  indexingVerifiedAt: Date | string | null;
  trainingStartedAt: Date | string | null;
  sprintCompletedAt: Date | string | null;
  llmTxtVerified: boolean | null;
  schemaVerified: boolean | null;
  isBlocked: boolean;
  missingUrlCount: number;
  status: string | null;
}

export function computePipelineStages(c: CampaignPipelineFields): PipelineStage[] {
  const done = (v: Date | string | null | undefined): boolean =>
    v !== null && v !== undefined && v !== "";

  // ── Raw completion checks (timestamp-only, no sequencing) ──
  const s1_keywordsDone  = done(c.keywordResearchCompletedAt);
  const s2_baselineDone  = done(c.baselineCheckCompletedAt);
  const s3_credDone      = done(c.credibilityResearchCompletedAt) && done(c.contentGenerationCompletedAt);

  // Stage 4 — Content Published
  // Complete when: publishingCompletedAt set AND no content pages missing a URL.
  // llm.txt and schema are NOT required here.
  const s4_contentPubDone =
    done(c.publishingCompletedAt) &&
    (c.missingUrlCount ?? 0) === 0;

  // Stage 5 — Indexing
  // Only two states: pending (not submitted yet) or submitted (active/blue).
  // We cannot guarantee pages are actually indexed, so we never show "complete".
  // llm.txt and schema do NOT affect this pill — they are handled at training gate.
  const s5_indexingSubmitted = done(c.indexingSubmittedAt);
  // For sequential gating purposes, treat indexing as "done" once submitted
  // so stage 6 (training) can become the active step.
  const s5_indexingDone = s5_indexingSubmitted;

  const s6_sprintStarted = done(c.trainingStartedAt);
  const s6_sprintDone    = done(c.sprintCompletedAt);

  // ── Sequential gating ──
  const stage1Complete = s1_keywordsDone;
  const stage2Complete = stage1Complete && s2_baselineDone;
  const stage3Complete = stage2Complete && s3_credDone;
  const stage4Complete = stage3Complete && s4_contentPubDone;
  // Stage 5 advances once submitted — we don't wait for verification or llm.txt/schema
  const stage5Complete = stage4Complete && s5_indexingSubmitted;
  const stage6Complete = stage5Complete && s6_sprintDone;
  const stage7Active   = stage6Complete;

  // ── Determine which stage is currently active ──
  let currentStep: number;
  if (!stage1Complete)      currentStep = 1;
  else if (!stage2Complete) currentStep = 2;
  else if (!stage3Complete) currentStep = 3;
  else if (!stage4Complete) currentStep = 4;
  else if (!stage5Complete) currentStep = 5;
  else if (!stage6Complete) currentStep = 6;
  else                      currentStep = 7;

  // ── Helper: compute status for a given stage ──
  function stageStatus(
    stepNum: number,
    isComplete: boolean,
    isRunning: boolean,
    needsAction: boolean,
    isSprint = false,
    isMaintenance = false
  ): StageStatus {
    if (isComplete) return "complete";
    if (stepNum !== currentStep) return "pending";
    if (isMaintenance) return "maintenance";
    if (isSprint) return "sprint";
    if (needsAction) return "action";
    if (isRunning) return "active";
    return "pending";
  }

  // Stage 4 needs action when: stage 3 done but content URLs or publishingCompletedAt missing
  const stage4NeedsAction = stage3Complete && !stage4Complete;
  // Stage 2 needs action when: stage 1 done but baseline hasn't run
  const stage2NeedsAction = stage1Complete && !stage2Complete;

  // Stage 5 description — show what's still pending
  function indexingDescription(): string {
    if (stage5Complete) return "Indexing verified · llm.txt & schema confirmed";
    if (!stage4Complete) return "Awaiting content publication";
    const pending: string[] = [];
    if (!s5_indexingSubmitted) pending.push("URL submission pending");
    else if (!done(c.indexingVerifiedAt)) pending.push("indexing in progress");
    if (c.llmTxtVerified !== true) pending.push("llm.txt not verified");
    if (c.schemaVerified !== true) pending.push("schema not verified");
    return pending.length > 0 ? pending.join(" · ") : "Verifying indexing…";
  }

  // Stage 4 description
  function contentPubDescription(): string {
    if (stage4Complete) return "All content URLs submitted";
    if (!stage3Complete) return "Awaiting credibility content";
    if (!done(c.publishingCompletedAt)) return "Add content to site and submit live URLs";
    if ((c.missingUrlCount ?? 0) > 0) return `${c.missingUrlCount} content URL${c.missingUrlCount === 1 ? "" : "s"} still missing`;
    return "Content published";
  }

  return [
    {
      id: "keywords",
      label: "Keywords",
      status: stageStatus(1, stage1Complete, !stage1Complete && currentStep === 1, false),
      description: stage1Complete ? "Query matrix generated" : "Generating keyword queries…",
      isCurrent: currentStep === 1,
    },
    {
      id: "baseline",
      label: "Baseline",
      status: stageStatus(2, stage2Complete, false, stage2NeedsAction),
      description: stage2Complete
        ? "Baseline report complete"
        : "Run baseline check to record Day 0 visibility",
      isCurrent: currentStep === 2,
    },
    {
      id: "credibility",
      label: "Credibility Content",
      status: stageStatus(3, stage3Complete, !stage3Complete && currentStep === 3, false),
      description: stage3Complete ? "Credibility content generated" : "Generating credibility content…",
      isCurrent: currentStep === 3,
    },
    {
      id: "content_published",
      label: "Content Published",
      status: stageStatus(4, stage4Complete, false, stage4NeedsAction),
      description: contentPubDescription(),
      isCurrent: currentStep === 4,
    },
    {
      id: "indexing",
      label: "Indexing",
      // Only two states: pending (grey) or submitted (blue).
      // Never shows complete — we can't guarantee indexing actually happened.
      status: !stage4Complete
        ? "pending"
        : s5_indexingSubmitted
        ? "active"
        : currentStep === 5 ? "pending" : "pending",
      description: !stage4Complete
        ? "Awaiting content publication"
        : s5_indexingSubmitted
        ? "URLs submitted to indexer"
        : "Ready to submit to indexer",
      isCurrent: currentStep === 5,
    },
    {
      id: "training",
      label: s6_sprintDone ? "Sprint Complete" : "Training Sprint",
      status: stageStatus(
        6,
        stage6Complete,
        s6_sprintStarted && !s6_sprintDone && stage5Complete,
        false,
        s6_sprintStarted && !s6_sprintDone && stage5Complete
      ),
      description: stage6Complete
        ? "4-day training sprint complete"
        : s6_sprintStarted && stage5Complete
        ? "Training sprint in progress (Day 1–4)"
        : "Awaiting training sprint start",
      isCurrent: currentStep === 6,
    },
    {
      id: "maintenance",
      label: "Maintenance",
      status: stage7Active ? "maintenance" : "pending",
      description: stage7Active
        ? "Weekly rank tracking & bonus query scans active"
        : "Begins after sprint completes",
      isCurrent: currentStep === 7,
    },
  ];
}

/** Returns a single CSS color class string for a given StageStatus */
export function stageColor(status: StageStatus): string {
  switch (status) {
    case "complete":     return "bg-green-500";
    case "active":       return "bg-blue-500";
    case "action":       return "bg-amber-500";
    case "sprint":       return "bg-yellow-400";
    case "maintenance":  return "bg-teal-500";
    case "pending":
    default:             return "bg-muted";
  }
}

export function stageBorderColor(status: StageStatus): string {
  switch (status) {
    case "complete":     return "border-green-500";
    case "active":       return "border-blue-500";
    case "action":       return "border-amber-500";
    case "sprint":       return "border-yellow-400";
    case "maintenance":  return "border-teal-500";
    case "pending":
    default:             return "border-border";
  }
}

export function stageTextColor(status: StageStatus): string {
  switch (status) {
    case "complete":     return "text-green-400";
    case "active":       return "text-blue-400";
    case "action":       return "text-amber-400";
    case "sprint":       return "text-yellow-300";
    case "maintenance":  return "text-teal-400";
    case "pending":
    default:             return "text-muted-foreground/40";
  }
}

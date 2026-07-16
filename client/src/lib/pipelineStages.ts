/**
 * pipelineStages.ts
 * Shared utility that maps campaign DB fields to the 7-stage pipeline model.
 * Used by both the campaign list card and the campaign detail page header.
 *
 * IMPORTANT: The pipeline is strictly sequential. A stage can only show as
 * "complete" (green) if ALL prior stages are also complete. This prevents
 * orphaned timestamps from previous pipeline runs from lighting up stages
 * out of order.
 */

export type StageStatus =
  | "complete"     // green — step is done AND all prior steps are done
  | "active"       // blue — step is currently running
  | "action"       // amber — step needs user action to proceed
  | "pending"      // grey — step hasn't started yet (or prior steps not done)
  | "sprint"       // yellow — training sprint in progress
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
  const s1_keywordsDone   = done(c.keywordResearchCompletedAt);
  const s2_baselineDone   = done(c.baselineCheckCompletedAt);
  const s3_credDone       = done(c.credibilityResearchCompletedAt) && done(c.contentGenerationCompletedAt);
  // Content Published requires publishing timestamp AND llm.txt + schema + no missing URLs
  const s4_contentPubRaw  = done(c.publishingCompletedAt);
  const s4_contentPubFull =
    s4_contentPubRaw &&
    c.llmTxtVerified === true &&
    c.schemaVerified === true &&
    (c.missingUrlCount ?? 0) === 0;
  const s5_indexingDone   = done(c.indexingVerifiedAt);
  const s6_sprintStarted  = done(c.trainingStartedAt);
  const s6_sprintDone     = done(c.sprintCompletedAt);

  // ── Sequential gating: each stage only "counts" if all prior stages are done ──
  // Stage 1 complete: keywords done
  const stage1Complete = s1_keywordsDone;
  // Stage 2 complete: baseline done AND stage 1 done
  const stage2Complete = stage1Complete && s2_baselineDone;
  // Stage 3 complete: credibility done AND stage 2 done
  const stage3Complete = stage2Complete && s3_credDone;
  // Stage 4 complete: content fully published AND stage 3 done
  const stage4Complete = stage3Complete && s4_contentPubFull;
  // Stage 5 complete: indexing done AND stage 4 done
  const stage5Complete = stage4Complete && s5_indexingDone;
  // Stage 6 complete: sprint done AND stage 5 done
  const stage6Complete = stage5Complete && s6_sprintDone;
  // Stage 7: maintenance (post-sprint)
  const stage7Active = stage6Complete;

  // ── Determine which stage is currently active ──
  // currentStep = the first incomplete stage
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

  // Stage 4 needs action when: stage 3 is done but content isn't fully published
  // (either publishing not done, or llm.txt/schema/URLs missing)
  const stage4NeedsAction = stage3Complete && !stage4Complete;
  // Stage 2 needs action when: stage 1 is done but baseline hasn't run
  const stage2NeedsAction = stage1Complete && !stage2Complete;

  return [
    {
      id: "keywords",
      label: "Keywords",
      status: stageStatus(1, stage1Complete, !stage1Complete && currentStep === 1, false),
      description: stage1Complete
        ? "Query matrix generated"
        : "Generating keyword queries…",
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
      description: stage3Complete
        ? "Credibility content generated"
        : "Generating credibility content…",
      isCurrent: currentStep === 3,
    },
    {
      id: "content_published",
      label: "Content Published",
      status: stageStatus(4, stage4Complete, false, stage4NeedsAction),
      description: stage4Complete
        ? "Content live, llm.txt & schema verified"
        : s4_contentPubRaw
          ? "Content published — verify llm.txt, schema & content URLs"
          : "Add content to site, verify llm.txt & schema",
      isCurrent: currentStep === 4,
    },
    {
      id: "indexing",
      label: "Indexing",
      status: stageStatus(5, stage5Complete, !stage5Complete && currentStep === 5, false),
      description: stage5Complete
        ? "Indexing verified"
        : "Submitting to indexing…",
      isCurrent: currentStep === 5,
    },
    {
      id: "training",
      label: s6_sprintDone ? "Sprint Complete" : s6_sprintStarted ? "Training Sprint" : "Training Sprint",
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

/**
 * pipelineStages.ts
 * Shared utility that maps campaign DB fields to the 7-stage pipeline model.
 * Used by both the campaign list card and the campaign detail page header.
 */

export type StageStatus =
  | "complete"    // green — step is done
  | "active"      // blue — step is currently running
  | "action"      // amber — step needs user action to proceed
  | "pending"     // grey — step hasn't started yet
  | "sprint"      // yellow — training sprint in progress
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
  const done = (v: Date | string | null): boolean => v !== null && v !== undefined;

  // Stage 1: Keywords
  const keywordsDone = done(c.keywordResearchCompletedAt);

  // Stage 2: Baseline — needs user action after keywords
  const baselineDone = done(c.baselineCheckCompletedAt);

  // Stage 3: Credibility Content Generated
  const credibilityDone = done(c.credibilityResearchCompletedAt) && done(c.contentGenerationCompletedAt);

  // Stage 4: Content Published — all three conditions must be met
  const contentPublished =
    done(c.publishingCompletedAt) &&
    c.llmTxtVerified === true &&
    c.schemaVerified === true &&
    c.missingUrlCount === 0;

  // Stage 5: Indexing Complete
  const indexingDone = done(c.indexingVerifiedAt);

  // Stage 6: Training Sprint
  const sprintStarted = done(c.trainingStartedAt);
  const sprintDone = done(c.sprintCompletedAt);

  // Stage 7: Maintenance (post-sprint)
  const inMaintenance = sprintDone;

  // Determine current step
  let currentStep = 1;
  if (keywordsDone && !baselineDone) currentStep = 2;
  else if (baselineDone && !credibilityDone) currentStep = 3;
  else if (credibilityDone && !contentPublished) currentStep = 4;
  else if (contentPublished && !indexingDone) currentStep = 5;
  else if (indexingDone && !sprintDone) currentStep = 6;
  else if (sprintDone) currentStep = 7;

  function stageStatus(
    stepNum: number,
    isDone: boolean,
    isRunning: boolean,
    needsAction: boolean,
    isSprint = false,
    isMaintenance = false
  ): StageStatus {
    if (isDone) return "complete";
    if (stepNum !== currentStep) return "pending";
    if (isMaintenance) return "maintenance";
    if (isSprint) return "sprint";
    if (needsAction) return "action";
    if (isRunning) return "active";
    return "pending";
  }

  return [
    {
      id: "keywords",
      label: "Keywords",
      status: stageStatus(1, keywordsDone, !keywordsDone && currentStep === 1, false),
      description: keywordsDone
        ? "Query matrix generated"
        : "Generating keyword queries…",
      isCurrent: currentStep === 1,
    },
    {
      id: "baseline",
      label: "Baseline",
      status: stageStatus(2, baselineDone, false, !baselineDone && currentStep === 2),
      description: baselineDone
        ? "Baseline report complete"
        : "Run baseline check to record Day 0 visibility",
      isCurrent: currentStep === 2,
    },
    {
      id: "credibility",
      label: "Credibility Content",
      status: stageStatus(3, credibilityDone, !credibilityDone && currentStep === 3, false),
      description: credibilityDone
        ? "Credibility content generated"
        : "Generating credibility content…",
      isCurrent: currentStep === 3,
    },
    {
      id: "content_published",
      label: "Content Published",
      status: stageStatus(4, contentPublished, false, !contentPublished && currentStep === 4),
      description: contentPublished
        ? "Content live, llm.txt & schema verified"
        : "Add content to site, verify llm.txt & schema",
      isCurrent: currentStep === 4,
    },
    {
      id: "indexing",
      label: "Indexing",
      status: stageStatus(5, indexingDone, !indexingDone && currentStep === 5, false),
      description: indexingDone
        ? "Indexing verified"
        : "Submitting to indexing…",
      isCurrent: currentStep === 5,
    },
    {
      id: "training",
      label: sprintDone ? "Sprint Complete" : sprintStarted ? "Training Sprint" : "Training Sprint",
      status: stageStatus(6, sprintDone, sprintStarted && !sprintDone, false, sprintStarted && !sprintDone),
      description: sprintDone
        ? "4-day training sprint complete"
        : sprintStarted
        ? "Training sprint in progress (Day 1–4)"
        : "Awaiting training sprint start",
      isCurrent: currentStep === 6,
    },
    {
      id: "maintenance",
      label: "Maintenance",
      status: inMaintenance ? "maintenance" : "pending",
      description: inMaintenance
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
    default:             return "bg-gray-600";
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
    default:             return "border-gray-600";
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
    default:             return "text-gray-500";
  }
}

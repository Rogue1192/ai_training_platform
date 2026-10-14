/**
 * Training execution safety policy.
 *
 * Keep the values accepted by the campaign UI, the pipeline, and the scheduler
 * in one place. A campaign is held unless an administrator explicitly releases
 * it, and only a version with an implemented worker may execute.
 */

export const SUPPORTED_TRAINING_VERSIONS = ["v6", "v7"] as const;
export type SupportedTrainingVersion = (typeof SUPPORTED_TRAINING_VERSIONS)[number];

export const DEFAULT_TRAINING_VERSION: SupportedTrainingVersion = "v7";
export const DEFAULT_TRAINING_HELD = true;

export interface TrainingExecutionInput {
  /** A missing value is treated as held for backward compatibility and safety. */
  trainingHeld?: boolean | null;
  trainingVersion?: string | null;
}

export type TrainingExecutionDecision =
  | {
      allowed: true;
      version: SupportedTrainingVersion;
      worker: "v6" | "v7";
    }
  | {
      allowed: false;
      reason: "held" | "unsupported_version";
      requestedVersion: string;
    };

export function normalizeTrainingVersion(version?: string | null): string {
  return version?.trim().toLowerCase() ?? "";
}

export function isSupportedTrainingVersion(
  version?: string | null,
): version is SupportedTrainingVersion {
  return (SUPPORTED_TRAINING_VERSIONS as readonly string[]).includes(
    normalizeTrainingVersion(version),
  );
}

/**
 * Resolves the only two conditions that allow a browser-training worker to run.
 * Never default an unknown version to a worker: that would execute a campaign
 * using a configuration the operator did not choose.
 */
export function getTrainingExecutionEligibility(
  input: TrainingExecutionInput,
): TrainingExecutionDecision {
  const requestedVersion = normalizeTrainingVersion(input.trainingVersion);

  if (input.trainingHeld !== false) {
    return {
      allowed: false,
      reason: "held",
      requestedVersion,
    };
  }

  if (!isSupportedTrainingVersion(requestedVersion)) {
    return {
      allowed: false,
      reason: "unsupported_version",
      requestedVersion,
    };
  }

  return {
    allowed: true,
    version: requestedVersion,
    worker: requestedVersion,
  };
}

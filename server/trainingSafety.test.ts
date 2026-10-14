import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAINING_HELD,
  DEFAULT_TRAINING_VERSION,
  getTrainingExecutionEligibility,
  isSupportedTrainingVersion,
} from "../shared/trainingSafety";

describe("training execution safety policy", () => {
  it("defaults newly created campaigns to held V7", () => {
    expect(DEFAULT_TRAINING_HELD).toBe(true);
    expect(DEFAULT_TRAINING_VERSION).toBe("v7");
  });

  it.each([undefined, null, true])(
    "blocks a campaign when its hold is %s",
    (trainingHeld) => {
      expect(
        getTrainingExecutionEligibility({ trainingHeld, trainingVersion: "v7" }),
      ).toMatchObject({ allowed: false, reason: "held" });
    },
  );

  it.each(["v3", "v4", "v5", "unknown", "", undefined])(
    "blocks a released campaign with unsupported engine %s",
    (trainingVersion) => {
      expect(
        getTrainingExecutionEligibility({ trainingHeld: false, trainingVersion }),
      ).toMatchObject({ allowed: false, reason: "unsupported_version" });
    },
  );

  it.each(["v6", "V6", " v7 ", "V7"])(
    "allows implemented engine %s only when explicitly released",
    (trainingVersion) => {
      const decision = getTrainingExecutionEligibility({
        trainingHeld: false,
        trainingVersion,
      });
      expect(decision).toMatchObject({ allowed: true });
      if (decision.allowed) {
        expect(["v6", "v7"]).toContain(decision.worker);
        expect(decision.worker).toBe(decision.version);
      }
    },
  );

  it("recognizes only worker-backed engine identifiers", () => {
    expect(isSupportedTrainingVersion("v6")).toBe(true);
    expect(isSupportedTrainingVersion("v7")).toBe(true);
    expect(isSupportedTrainingVersion("v3")).toBe(false);
  });
});

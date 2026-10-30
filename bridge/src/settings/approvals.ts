import { z } from "zod";
import { SettingRejectedError, type HermesSettingsChange } from "./hermes-settings";

const ThresholdSchema = z.enum(["none", "low", "medium", "high"]);
export const ThresholdsSchema = z.object({ interactive: ThresholdSchema, autonomous: ThresholdSchema, headless: ThresholdSchema });
type Thresholds = z.infer<typeof ThresholdsSchema>;
type Threshold = Thresholds["interactive"];

const MODE = "approvals.mode";
const CRON_MODE = "approvals.cron_mode";
const UNATTENDED_MODE = "approvals.unattended_mode";

export const APPROVAL_KEYS: readonly string[] = [MODE, CRON_MODE, UNATTENDED_MODE];

function interactiveThreshold(mode: unknown): Threshold {
  if (mode === false || mode === "off") {
    return "high";
  }
  return mode === "smart" ? "medium" : "none";
}

function unattendedThreshold(mode: unknown): Threshold {
  return mode === "approve" ? "high" : "none";
}

function interactiveMode(threshold: Threshold): string {
  switch (threshold) {
    case "none":
      return "manual";
    case "medium":
      return "smart";
    case "high":
      return "off";
    default:
      throw new SettingRejectedError(`Hermes has no approval mode for ${threshold} risk`);
  }
}

function unattendedMode(threshold: Threshold): string {
  switch (threshold) {
    case "none":
      return "deny";
    case "high":
      return "approve";
    default:
      throw new SettingRejectedError(`Hermes can only block or allow unattended commands, not ${threshold} risk`);
  }
}

export function approvalThresholds(values: Readonly<Record<string, unknown>>): Thresholds {
  return {
    interactive: interactiveThreshold(values[MODE]),
    autonomous: unattendedThreshold(values[CRON_MODE]),
    headless: unattendedThreshold(values[UNATTENDED_MODE]),
  };
}

export function approvalChange(thresholds: Thresholds): HermesSettingsChange {
  return {
    set: {
      [MODE]: interactiveMode(thresholds.interactive),
      [CRON_MODE]: unattendedMode(thresholds.autonomous),
      [UNATTENDED_MODE]: unattendedMode(thresholds.headless),
    },
  };
}

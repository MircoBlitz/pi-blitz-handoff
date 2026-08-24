import type { HandoffThresholds } from "./core.ts";

function configuredPercent(name: string, fallback: number): number {
	const value = process.env[name];
	return value === undefined || value.trim() === "" ? fallback : Number(value);
}

/**
 * Configure with PI_SIMPLE_HANDOFF_WARNING_THRESHOLD and
 * PI_SIMPLE_HANDOFF_CRITICAL_THRESHOLD, then restart Pi.
 */
export const HANDOFF_THRESHOLDS: HandoffThresholds = {
	warningThreshold: configuredPercent("PI_SIMPLE_HANDOFF_WARNING_THRESHOLD", 60),
	criticalThreshold: configuredPercent("PI_SIMPLE_HANDOFF_CRITICAL_THRESHOLD", 80),
};

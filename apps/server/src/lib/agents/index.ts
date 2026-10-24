import { factChecker } from "./factChecker.js";
import type { AgentJob } from "./job.js";
import { rumorDetector } from "./rumorDetector.js";
import { sourceValidator } from "./sourceValidator.js";

export const AGENT_JOBS: AgentJob[] = [rumorDetector, factChecker, sourceValidator];

export * from "./job.js";

import { anthropic } from "./anthropic.js";
import { minimax } from "./minimax.js";
import { stepfun } from "./stepfun.js";
import type { ModelProvider } from "./provider.js";

/** Default order: MiniMax is the main chat provider, StepFun the fallback; StepFun and Claude read images. */
export const MODEL_PROVIDERS: ModelProvider[] = [minimax, stepfun, anthropic];

export * from "./provider.js";

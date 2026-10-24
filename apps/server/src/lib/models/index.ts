import { minimax } from "./minimax.js";
import { stepfun } from "./stepfun.js";
import type { ModelProvider } from "./provider.js";

/** Default order: MiniMax is the main chat provider, StepFun the fallback and the only one that reads images. */
export const MODEL_PROVIDERS: ModelProvider[] = [minimax, stepfun];

export * from "./provider.js";

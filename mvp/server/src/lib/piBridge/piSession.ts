/**
 * piSession.ts — pi-agent 会话组装（P0a 试点）。
 *
 * 按 SKILL「二开起步检查清单」：覆盖 pi 默认人设（systemPromptOverride）、
 * 清掉编码工具（tools 白名单为空，只留 piTools 注册的业务工具）、
 * 会话用 SessionManager.inMemory()（Web 多用户，不落 ~/.pi）。
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { piProviderConfigs, registerProviders, pickFirstModel } from "./piModels.js";
import { toolExtension, type PiToolDeps } from "./piTools.js";
import { PiEventCollector, type PiStreamItem } from "./piEvents.js";

export interface PiCheckSession {
  session: AgentSession;
  model: string;
  events: PiStreamItem[];
  /** web_search 透出的可点开 URL（按调用顺序收集，供 URL 闸）。 */
  searchUrls: string[];
  /** 读取 submit_verdict 草稿（若模型调用过；需在 prompt 完成/进行中调用）。 */
  getSubmittedVerdict: () => Record<string, unknown> | undefined;
  dispose: () => void;
}

export interface CreatePiCheckSessionOptions {
  env: Record<string, string>;
  /** 核查工作台系统提示（默认覆盖为「信息真相猎人核查助手」，绝不自称 pi 编码助手）。 */
  systemPrompt?: string;
  onTodo?: (item: string) => void;
}

const DEFAULT_SYSTEM_PROMPT = `你是「红鲱鱼与枪」信息真相猎人核查助手。你只负责对用户的一句话做溯源核查。
你必须完成这一整套动作，缺一不可：
1. 先用 todo_write 写下你的证据缺口（找官方回应 / 找原始出处 / 找反证）。
2. 至少执行 2 次 web_search，覆盖不同关键词角度（原句直查 + 辟谣/官方方向）。
3. 综合检索结果，调用 submit_verdict 提交逐条判定草稿（claimAtoms / claimAtomTypes / subclaimVerdicts / verdictType / conclusion），
   来源 URL 填进 subclaimVerdicts 的 sources。
纪律：没有可点开来源的判定只能写 unverified；不要编造结论。最终报告由系统根据你的草稿再经过自证与来源闸产出。`;

/**
 * 组装一个 pi 核查会话：注册现网模型 → inMemory 会话 + 业务工具 + 事件归一化。
 * P0 仅用于试点/冒烟；生产编排仍走 casePipeline，直到 P1 质量门。
 */
export async function createPiCheckSession(
  options: CreatePiCheckSessionOptions
): Promise<PiCheckSession> {
  const { env, onTodo } = options;
  const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const modelRuntime = await ModelRuntime.create();
  const cfgList = piProviderConfigs(env);
  const registered = await registerProviders(modelRuntime, env);
  const modelPath = pickFirstModel(cfgList, registered);
  const [providerId, modelId] = (modelPath ?? "").split("/");
  const model = providerId && modelId ? modelRuntime.getModel(providerId, modelId) : undefined;

  const searchUrls: string[] = [];
  let submittedVerdict: Record<string, unknown> | undefined;

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
    extensionFactories: [
      toolExtension({
        env,
        onTodo,
        onSearchResult: (urls) => {
          for (const u of urls) if (!searchUrls.includes(u)) searchUrls.push(u);
        },
        onSubmit: (args) => {
          submittedVerdict = args;
        },
      } satisfies PiToolDeps),
    ],
  });
  await resourceLoader.reload();

  const collector = new PiEventCollector();
  const { session } = await createAgentSession({
    modelRuntime,
    model,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    // 只关 pi 内置编码工具（read/bash/edit/write）；扩展注册的业务工具保持启用
    noTools: "builtin",
  });
  session.subscribe(collector.handle);

  return {
    session,
    model: modelPath ?? "",
    events: collector.items,
    searchUrls,
    getSubmittedVerdict: () => submittedVerdict,
    dispose: () => session.dispose(),
  };
}
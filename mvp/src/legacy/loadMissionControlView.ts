/**
 * LegacyDesk 工作台 chunk 的唯一 loader。
 * 投机预取与 React.lazy 实际加载共用同一缓存；失败必须清缓存后继续拒绝。
 */
export type MissionControlModule = typeof import("../components/v3/phases/MissionControlView");

export type MissionControlImporter = () => Promise<MissionControlModule>;

const defaultImporter: MissionControlImporter = () =>
  import("../components/v3/phases/MissionControlView");

let importer: MissionControlImporter = defaultImporter;
let missionControlViewPromise: Promise<MissionControlModule> | null = null;

export function loadMissionControlView(): Promise<MissionControlModule> {
  missionControlViewPromise ??= importer().catch((error: unknown) => {
    missionControlViewPromise = null;
    throw error;
  });
  return missionControlViewPromise;
}

/** 可选预取：消费 rejection，不把 loader 本身改成成功。 */
export function prefetchMissionControlView(): Promise<void> {
  return loadMissionControlView().then(
    () => undefined,
    () => undefined
  );
}

export function resetMissionControlViewLoaderForTests(next?: MissionControlImporter): void {
  missionControlViewPromise = null;
  importer = next ?? defaultImporter;
}

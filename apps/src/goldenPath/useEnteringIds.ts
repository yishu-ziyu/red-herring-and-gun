import { useEffect, useRef, useState } from "react";

/** 一批新对象的错开上限：只让人看清入场，不把真实等待拉长。 */
const STAGGER_MS = 90;
const STAGGER_CAP = 6;
const ENTER_HOLD_MS = 560;

/**
 * 调查进行中才给「刚出现」的 id 打入场标记。存量（含首次 live=false 挂载）不闪。
 * 动画结束后摘掉 class，同一批 id 再渲染不会重闪。
 */
export function useEnteringIds(ids: readonly string[], live: boolean) {
  const seenRef = useRef(new Set<string>());
  const [entering, setEntering] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!live) {
      for (const id of ids) seenRef.current.add(id);
      return;
    }
    const fresh = ids.filter((id) => !seenRef.current.has(id));
    for (const id of ids) seenRef.current.add(id);
    if (fresh.length === 0) return undefined;
    const delays: Record<string, number> = {};
    fresh.forEach((id, index) => {
      delays[id] = Math.min(index, STAGGER_CAP) * STAGGER_MS;
    });
    setEntering((prev) => ({ ...prev, ...delays }));
    const timer = window.setTimeout(() => {
      setEntering((prev) => {
        const next = { ...prev };
        for (const id of fresh) delete next[id];
        return next;
      });
    }, ENTER_HOLD_MS + STAGGER_CAP * STAGGER_MS);
    return () => window.clearTimeout(timer);
  }, [ids.join("\0"), live]);

  return {
    isEntering: (id: string) => Object.prototype.hasOwnProperty.call(entering, id),
    delayMs: (id: string) => entering[id] ?? 0,
  };
}

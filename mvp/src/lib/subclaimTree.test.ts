/**
 * subclaimTree.test.ts — Plan P1-2 · Kialo 风格子命题树构建测试
 *
 * 不验证 React 渲染（受 jsdom env 限制），只验证纯逻辑层。
 */

import { describe, expect, it } from "vitest";
import type { Subclaim } from "./schemas";
import {
  buildSubclaimTree,
  countStances,
  iterateSubclaimTree,
} from "./subclaimTree";

function sc(id: string, parentId?: string, stance?: Subclaim["stance"]): Subclaim {
  return {
    id,
    text: `命题 ${id}`,
    type: "事件事实",
    roleInArgument: "前提",
    parentId,
    stance,
  };
}

describe("Plan P1-2 · buildSubclaimTree", () => {
  it("空输入：roots 为空 + cycles/orphans 为空", () => {
    const t = buildSubclaimTree([]);
    expect(t.roots).toEqual([]);
    expect(t.byId.size).toBe(0);
    expect(t.cycles).toEqual([]);
    expect(t.orphans).toEqual([]);
  });

  it("所有节点都无 parentId → 全部为根（forest）", () => {
    const t = buildSubclaimTree([sc("a"), sc("b"), sc("c")]);
    expect(t.roots.length).toBe(3);
    expect(t.roots.every((n) => n.depth === 0)).toBe(true);
    expect(t.orphans).toEqual([]);
  });

  it("5 节点树（1 根 + 2 子 + 2 孙）：DOM 应含 5 节点 + ≥4 edge", () => {
    const tree = buildSubclaimTree([
      sc("root"),
      sc("a", "root", "support"),
      sc("b", "root", "oppose"),
      sc("a1", "a", "support"),
      sc("a2", "a", "support"),
    ]);
    // 5 节点
    expect(tree.byId.size).toBe(5);
    expect(tree.roots.length).toBe(1);
    expect(tree.roots[0].subclaim.id).toBe("root");
    // 子节点
    expect(tree.roots[0].children.length).toBe(2);
    // 孙节点：只有 a 有 a1/a2
    const a = tree.byId.get("a")!;
    expect(a.children.length).toBe(2);
    expect(a.children[0].subclaim.id).toBe("a1");
    // depth
    expect(a.depth).toBe(1);
    expect(a.children[0].depth).toBe(2);
    // edge 数 = 总节点 - 根数 = 4
    let edges = 0;
    for (const _ of iterateSubclaimTree(tree.roots)) edges++;
    expect(edges).toBe(5);
  });

  it("orphan（parentId 指向不存在 id）应被检测并归入 roots", () => {
    const tree = buildSubclaimTree([sc("a"), sc("b", "ghost")]);
    expect(tree.orphans).toContain("b");
    // orphan 被当作 root（不挂在 ghost 下，因为 ghost 不存在）
    expect(tree.roots.map((n) => n.subclaim.id).sort()).toEqual(["a", "b"]);
  });

  it("cycle（A→B→A）应被检测并归入 roots", () => {
    const tree = buildSubclaimTree([
      { ...sc("a"), parentId: "b" },
      { ...sc("b"), parentId: "a" },
    ]);
    expect(tree.cycles.length).toBeGreaterThan(0);
    expect(tree.roots.length).toBe(2);
  });

  it("order 字段控制兄弟节点排序", () => {
    const tree = buildSubclaimTree([
      sc("root"),
      { ...sc("a", "root"), order: 3 },
      { ...sc("b", "root"), order: 1 },
      { ...sc("c", "root"), order: 2 },
    ]);
    const root = tree.roots[0];
    expect(root.children.map((n) => n.subclaim.id)).toEqual(["b", "c", "a"]);
  });

  it("countStances 应正确统计 3 种 stance + unstated", () => {
    const tree = buildSubclaimTree([
      sc("root", undefined, "context"),
      sc("a", "root", "support"),
      sc("b", "root", "oppose"),
      sc("c", "root", "support"),
      sc("d"), // unstated
    ]);
    const counts = countStances(tree.roots);
    expect(counts.context).toBe(1);
    expect(counts.support).toBe(2);
    expect(counts.oppose).toBe(1);
    expect(counts.unstated).toBe(1);
  });

  it("iterateSubclaimTree 应 DFS 遍历", () => {
    const tree = buildSubclaimTree([
      sc("root"),
      sc("a", "root"),
      sc("a1", "a"),
      sc("b", "root"),
    ]);
    const ids = Array.from(iterateSubclaimTree(tree.roots)).map((n) => n.subclaim.id);
    expect(ids[0]).toBe("root");
    // DFS: root → a → a1 → b
    expect(ids.slice(1, 4).sort()).toEqual(["a", "a1", "b"]);
  });

  it("向后兼容：旧 Subclaim[]（无 parentId/stance/order）应仍能构建", () => {
    const legacy: Subclaim[] = [
      { id: "1", text: "A", type: "事件事实", roleInArgument: "前提" },
      { id: "2", text: "B", type: "事件事实", roleInArgument: "前提" },
    ];
    const tree = buildSubclaimTree(legacy);
    expect(tree.roots.length).toBe(2);
    expect(tree.orphans).toEqual([]);
    expect(tree.cycles).toEqual([]);
  });
});
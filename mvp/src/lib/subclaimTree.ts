/**
 * subclaimTree.ts — Plan P1-2 · Kialo 风格子命题树构建器
 *
 * 输入：扁平 Subclaim[]（含可选 parentId/stance/order）
 * 输出：树形结构 + 渲染辅助
 *
 * 借鉴 Kialo（kialo.com）：父论点 → pro/con 子论点，递归嵌套。
 * 我们的差异：每个节点带 type（事实/概念/因果/价值/策略）+ stance。
 *
 * 重要不变量：
 *   - 拖动（用户编辑）不得伪装成模型结论
 *   - 运行时锁定版本：旧 SSE 事件不得覆盖新树
 *   - 无 parentId 的节点为根；多个根 → forest
 */

import type { Subclaim } from "./schemas";

export interface SubclaimTreeNode {
  subclaim: Subclaim;
  children: SubclaimTreeNode[];
  depth: number;
}

export interface SubclaimTree {
  roots: SubclaimTreeNode[];
  /** 节点索引：id → node，方便 O(1) 查找 */
  byId: Map<string, SubclaimTreeNode>;
  /** 检测到的循环引用节点 id 列表（用于告警） */
  cycles: string[];
  /** 孤儿节点（parentId 指向不存在的 id） */
  orphans: string[];
}

export function buildSubclaimTree(subclaims: ReadonlyArray<Subclaim>): SubclaimTree {
  const byId = new Map<string, SubclaimTreeNode>();
  const subclaimById = new Map<string, Subclaim>();
  for (const s of subclaims) subclaimById.set(s.id, s);

  // 检测 orphan（parentId 指向不存在的 subclaim）
  const orphans: string[] = [];
  for (const s of subclaims) {
    if (s.parentId && !subclaimById.has(s.parentId)) {
      orphans.push(s.id);
    }
  }

  // 第一遍：建空节点
  for (const s of subclaims) {
    byId.set(s.id, { subclaim: s, children: [], depth: 0 });
  }

  // 第二遍：挂父子关系 + 检测循环
  const cycles = new Set<string>();
  const roots: SubclaimTreeNode[] = [];
  for (const s of subclaims) {
    const node = byId.get(s.id)!;
    if (s.parentId && subclaimById.has(s.parentId)) {
      // 沿 parent 链向上找，看是否回到自己（cycle 检测）
      let cursor: string | undefined = s.parentId;
      const seen = new Set<string>();
      let isCycle = false;
      while (cursor) {
        if (seen.has(cursor)) {
          isCycle = true;
          break;
        }
        seen.add(cursor);
        if (cursor === s.id) {
          isCycle = true;
          break;
        }
        cursor = subclaimById.get(cursor)?.parentId;
      }
      if (isCycle) {
        cycles.add(s.id);
        roots.push(node);
      } else {
        const parent = byId.get(s.parentId)!;
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // 第三遍：按 order 排序每层 children；根按 order 排序
  const sorter = (a: SubclaimTreeNode, b: SubclaimTreeNode) => {
    const ao = a.subclaim.order ?? 0;
    const bo = b.subclaim.order ?? 0;
    if (ao !== bo) return ao - bo;
    return a.subclaim.id.localeCompare(b.subclaim.id);
  };
  for (const node of byId.values()) {
    node.children.sort(sorter);
  }
  roots.sort(sorter);

  // 计算 depth（根=0）
  function setDepth(node: SubclaimTreeNode, d: number) {
    node.depth = d;
    for (const c of node.children) setDepth(c, d + 1);
  }
  for (const r of roots) setDepth(r, 0);

  return { roots, byId, cycles: Array.from(cycles), orphans };
}

/** 扁平遍历（DFS）— 用于在 DOM 中渲染 */
export function* iterateSubclaimTree(
  roots: ReadonlyArray<SubclaimTreeNode>,
): Generator<SubclaimTreeNode> {
  for (const r of roots) {
    yield r;
    if (r.children.length > 0) yield* iterateSubclaimTree(r.children);
  }
}

/** 统计立场分布（用于盲点视图 P1-6） */
export interface StanceCounts {
  support: number;
  oppose: number;
  context: number;
  unstated: number;
}

export function countStances(roots: ReadonlyArray<SubclaimTreeNode>): StanceCounts {
  const out: StanceCounts = { support: 0, oppose: 0, context: 0, unstated: 0 };
  for (const node of iterateSubclaimTree(roots)) {
    const s = node.subclaim.stance;
    if (s === "support") out.support++;
    else if (s === "oppose") out.oppose++;
    else if (s === "context") out.context++;
    else out.unstated++;
  }
  return out;
}
/**
 * ClaimDecompositionFlow — 只读「原句 → 2–6 条可核查命题」分支图（Issue #13）。
 *
 * 数据来自前端 state（MissionShellModel.understanding 形状），不依赖 SSE 事件。
 * @xyflow/react 仅作只读布局层：不可拖拽、不可连线、无 Controls/MiniMap/工具栏。
 * 命题节点位置为确定性计算（根节点垂直居中于命题列旁），不引入自动布局依赖。
 * 窄屏（<720px）切换为纵向堆叠，无横向滚动。
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { humanizeClaimType } from "../../../../lib/missionShell/labels";
import styles from "./ClaimDecompositionFlow.module.css";

export type ClaimDecompositionStatus =
  | "idle"
  | "searching"
  | "completed"
  | "failed"
  | "unverifiable";

export type ClaimDecompositionNode = {
  id: string;
  text: string;
  verifiable: boolean;
  type?: string;
  status: ClaimDecompositionStatus;
};

export type ClaimDecompositionFlowProps = {
  claim: string;
  atoms: ClaimDecompositionNode[];
  selectedAtomId?: string;
  onSelectAtom?: (atomId: string) => void;
};

/** 窄屏断点：stack 布局与 graph 布局的切换条件（测试用同一常量）。 */
export const NARROW_QUERY = "(max-width: 719px)";

const ROOT_ID = "claim-root";
const PAD = 24;
const ROW = 140; // 命题行距：节点最高 ~112px + 28px 间距，2–6 条不重叠
const ATOM_X = 384; // 命题列 x：根节点(240 宽) + 分支间距

const STATUS_LABEL: Record<ClaimDecompositionStatus, string> = {
  idle: "待核查",
  searching: "核查中",
  completed: "已核查",
  failed: "核查失败",
  unverifiable: "无法核查",
};

/** 不可核查的命题永远不显示「核查中」：展示态强制为 unverifiable。 */
function displayStatus(atom: ClaimDecompositionNode): ClaimDecompositionStatus {
  return atom.verifiable ? atom.status : "unverifiable";
}

type AtomCardData = {
  atom: ClaimDecompositionNode;
  index: number;
  selected: boolean;
  onSelect?: (atomId: string) => void;
};

function ClaimCard({
  atom,
  index,
  claim,
  selected,
  onSelect,
}: {
  atom?: ClaimDecompositionNode;
  index?: number;
  claim?: string;
  selected: boolean;
  onSelect?: (atomId: string) => void;
}) {
  if (!atom) {
    return (
      <div className={`${styles.card} ${styles.cardRoot}`} data-testid="claim-root-card">
        <span className={styles.kicker}>原句</span>
        <p className={styles.text}>{claim}</p>
      </div>
    );
  }
  const st = displayStatus(atom);
  const label = STATUS_LABEL[st];
  const typeLabel = humanizeClaimType(atom.type);
  const select = () => onSelect?.(atom.id);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`命题 ${index! + 1}：${atom.text}，${label}`}
      className={`${styles.card} ${styles.cardAtom}`}
      data-testid={`atom-card-${atom.id}`}
      data-atom-id={atom.id}
      data-selected={selected ? "true" : "false"}
      data-status={st}
      style={{ "--i": String(index) } as CSSProperties}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      }}
    >
      <span className={styles.kicker}>命题 {index! + 1}</span>
      <p className={styles.text}>{atom.text}</p>
      <span className={styles.meta}>
        <span className={styles.chip}>{atom.verifiable ? "可核查" : "不可核查"}</span>
        {typeLabel ? <span className={styles.chip}>{typeLabel}</span> : null}
        <span className={styles.pill} data-status={st}>
          {label}
        </span>
      </span>
    </div>
  );
}

function ClaimRootFlowNode(props: NodeProps) {
  const data = props.data as { claim: string };
  return (
    <>
      <ClaimCard claim={data.claim} selected={false} />
      <Handle type="source" position={Position.Right} />
    </>
  );
}

function ClaimAtomFlowNode(props: NodeProps) {
  const { atom, index, selected, onSelect } = props.data as AtomCardData;
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <ClaimCard atom={atom} index={index} selected={selected} onSelect={onSelect} />
    </>
  );
}

const nodeTypes = { claimRoot: ClaimRootFlowNode, claimAtom: ClaimAtomFlowNode };

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && "matchMedia" in window && window.matchMedia(NARROW_QUERY).matches
  );
  useEffect(() => {
    if (!("matchMedia" in window)) return undefined;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return narrow;
}

export function ClaimDecompositionFlow({
  claim,
  atoms,
  selectedAtomId,
  onSelectAtom,
}: ClaimDecompositionFlowProps) {
  const narrow = useNarrow();

  // 确定性布局：命题按序纵向排列（y = PAD + i*ROW），根节点垂直居中于命题列旁。
  const nodes = useMemo<Node[]>(
    () => [
      {
        id: ROOT_ID,
        type: "claimRoot",
        position: { x: PAD, y: atoms.length ? PAD + ((atoms.length - 1) * ROW) / 2 : PAD },
        data: { claim },
        draggable: false,
        selectable: false,
      },
      ...atoms.map((atom, i) => ({
        id: atom.id,
        type: "claimAtom",
        position: { x: ATOM_X, y: PAD + i * ROW },
        data: { atom, index: i, selected: atom.id === selectedAtomId, onSelect: onSelectAtom },
        draggable: false,
        selectable: false,
      })),
    ],
    [claim, atoms, selectedAtomId, onSelectAtom]
  );

  const edges = useMemo<Edge[]>(
    () =>
      atoms.map((atom) => ({
        id: `edge-${atom.id}`,
        source: ROOT_ID,
        target: atom.id,
        type: "smoothstep",
        style: { stroke: "#c8ccd4" },
        selectable: false,
      })),
    [atoms]
  );

  const height = atoms.length ? PAD * 2 + (atoms.length - 1) * ROW + 112 : 160;

  if (narrow) {
    return (
      <section
        className={styles.wrap}
        aria-label="原句命题拆解"
        data-testid="claim-decomposition"
        data-layout="stack"
      >
        <ol className={styles.stack}>
          <li className={styles.stackItem}>
            <ClaimCard claim={claim} selected={false} />
          </li>
          {atoms.map((atom, i) => (
            <li key={atom.id} className={styles.stackItem}>
              <ClaimCard
                atom={atom}
                index={i}
                selected={atom.id === selectedAtomId}
                onSelect={onSelectAtom}
              />
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section
      className={styles.wrap}
      aria-label="原句命题拆解"
      data-testid="claim-decomposition"
      data-layout="graph"
    >
      <div className={styles.canvas} style={{ height }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </section>
  );
}

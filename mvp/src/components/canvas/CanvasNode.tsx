import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import type { CanvasNode as CanvasNodeData } from "../../data/reasoningCanvas";
import type { LayeredNode } from "./layeredLayout";

interface CanvasNodeProps {
  node: CanvasNodeData | LayeredNode;
  selected: boolean;
  highlighted: boolean;
  onSelect: (nodeId: string) => void;
  onMove: (nodeId: string, position: { x: number; y: number }) => void;
}

interface DragState {
  startX: number;
  startY: number;
  dragging: boolean;
  board: HTMLElement;
}

export function CanvasNode({ node, selected, highlighted, onSelect, onMove }: CanvasNodeProps) {
  const left = "layerX" in node ? node.layerX : node.x;
  const top = "layerY" in node ? node.layerY : node.y;
  const layerClass = "layer" in node ? `layer-${node.layer}` : "";
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupDragListenersRef = useRef<() => void>(() => {});

  useEffect(() => () => cleanupDragListenersRef.current(), []);

  function handleMouseDown(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const board = event.currentTarget.closest(".canvas-board");
    if (!(board instanceof HTMLElement)) return;

    beginDrag(event.clientX, event.clientY, board);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    cleanupDragListenersRef.current = () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLButtonElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    const board = event.currentTarget.closest(".canvas-board");
    if (!(board instanceof HTMLElement)) return;

    beginDrag(touch.clientX, touch.clientY, board);
    window.addEventListener("touchmove", handleWindowTouchMove, { passive: false });
    window.addEventListener("touchend", handleWindowTouchEnd);
    window.addEventListener("touchcancel", handleWindowTouchEnd);
    cleanupDragListenersRef.current = () => {
      window.removeEventListener("touchmove", handleWindowTouchMove);
      window.removeEventListener("touchend", handleWindowTouchEnd);
      window.removeEventListener("touchcancel", handleWindowTouchEnd);
    };
  }

  function beginDrag(clientX: number, clientY: number, board: HTMLElement) {
    cleanupDragListenersRef.current();
    dragRef.current = { startX: clientX, startY: clientY, dragging: false, board };
  }

  function handleWindowMouseMove(event: MouseEvent) {
    event.preventDefault();
    moveDrag(event.clientX, event.clientY);
  }

  function handleWindowTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;

    event.preventDefault();
    moveDrag(touch.clientX, touch.clientY);
  }

  function handleWindowMouseUp() {
    endDrag();
  }

  function handleWindowTouchEnd() {
    endDrag();
  }

  function moveDrag(clientX: number, clientY: number) {
    const drag = dragRef.current;
    if (!drag) return;

    const moved = Math.abs(clientX - drag.startX) + Math.abs(clientY - drag.startY);
    if (moved < 4 && !drag.dragging) return;

    drag.dragging = true;
    suppressClickRef.current = true;

    const rect = drag.board.getBoundingClientRect();
    const x = clamp(((clientX - rect.left) / rect.width) * 100);
    const y = clamp(((clientY - rect.top) / rect.height) * 100);
    onMove(node.id, { x, y });
  }

  function endDrag() {
    cleanupDragListenersRef.current();
    cleanupDragListenersRef.current = () => {};
    dragRef.current = null;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  return (
    <button
      className={[
        "canvas-node",
        `node-${node.type}`,
        node.status ? `status-${node.status}` : "",
        layerClass,
        selected ? "selected" : "",
        highlighted ? "highlighted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ left: `${left}%`, top: `${top}%` }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onClick={() => {
        if (!suppressClickRef.current) onSelect(node.id);
      }}
      title={node.subtitle ?? node.title}
      type="button"
    >
      <span className="node-type">{labelForType(node.type)}</span>
      <strong>{node.title}</strong>
      {node.subtitle ? <small>{node.subtitle}</small> : null}
    </button>
  );
}

function clamp(value: number) {
  return Math.max(6, Math.min(94, value));
}

function labelForType(type: CanvasNodeData["type"]) {
  const labels: Record<CanvasNodeData["type"], string> = {
    claim: "Claim",
    judgment: "Judgment",
    subclaim: "Subclaim",
    evidence_need: "Need",
    candidate_evidence: "Evidence",
    agent_task: "Agent",
    inference_license: "License",
    rewrite: "Rewrite",
  };

  return labels[type];
}

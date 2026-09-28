/**
 * ThinkingDisclosure — 只报调查里真的在发生的事。
 * 命题出来之前：展开的主工作面，阶段句 + 可读说明 + 灰槽，秒数在旁边。
 * 命题出来之后：不再渲染，问题只在下方命题列出现一次。
 * 阶段切换只认快照，不按 0.5s/1.2s 假装解锁，不装 01/02/03。
 */
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InvestigationSnapshotV1 } from "../lib/investigation";

type ThinkingDisclosureProps = {
  snapshot: InvestigationSnapshotV1;
  live: boolean;
};

export const COPY_SPLITTING = "正在把这句话拆成可以单独核对的问题";
export const COPY_CHECKING = "正在核对刚拆出的说法站不站得住";
const COPY_SPLITTING_BODY =
  "会按条拆开：哪一句能单独查、哪一句还缠在一起。比喻、没法核对的，不会进待查清单。";
const COPY_CHECKING_BODY =
  "刚拆出的句子正在过一遍。站不住单独成条的，不会当作待查问题。";

function waitStage(snapshot: InvestigationSnapshotV1): "split" | "checking" | "splitting" {
  const splitOut =
    snapshot.claims.length > 0 ||
    snapshot.phase === "decomposed" ||
    snapshot.phase === "investigating" ||
    snapshot.phase === "judging" ||
    snapshot.phase === "complete";
  if (splitOut) return "split";
  if (snapshot.preClaimWork === "checking") return "checking";
  return "splitting";
}

export function ThinkingDisclosure({ snapshot, live }: ThinkingDisclosureProps) {
  const stage = waitStage(snapshot);
  const [open, setOpen] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    if (stage === "split") return;
    const interval = window.setInterval(() => {
      setElapsed((Date.now() - startTimeRef.current) / 1000);
    }, 250);
    return () => window.clearInterval(interval);
  }, [stage]);

  if (!live || stage === "split") return null;

  const waitSeconds = Math.floor(elapsed);
  const waitCopy = stage === "checking" ? COPY_CHECKING : COPY_SPLITTING;

  return (
    <section
      className={`gp-thinking-box ${open ? "is-open" : "is-closed"}`}
      aria-label="思考过程"
      data-gp-thinking-state="active"
      data-gp-thinking-mode="working"
      data-gp-thinking-wait={stage}
    >
      <div
        className="gp-thinking-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
      >
        <div className="gp-thinking-meta">
          <span className="gp-thinking-sparkle is-spinning" aria-hidden="true">
            ✦
          </span>
          <strong className="gp-thinking-title">{waitCopy}</strong>
          <span className="gp-thinking-timer">已等 {waitSeconds} 秒</span>
        </div>
        <span className="gp-thinking-toggle" aria-hidden="true">
          {open ? "收起 ▴" : "展开思考 ▾"}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            className="gp-thinking-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <p className="gp-thinking-copy">
              {stage === "checking" ? COPY_CHECKING_BODY : COPY_SPLITTING_BODY}
            </p>
            <div className="gp-thinking-slots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

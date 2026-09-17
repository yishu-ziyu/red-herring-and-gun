/**
 * ThinkingDisclosure — 只报调查里真的在发生的事。
 * 命题出来之前：展开的主工作面，阶段句 + 可读说明 + 灰槽，秒数在旁边。
 * 命题出来之后：默认折叠，问题只在下方命题列出现一次。
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
const COPY_ARCHIVE = "拆开的问题在下方按条核对，这里不再重复列出。";

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
  const splitOut = stage === "split";

  const [open, setOpen] = useState(!splitOut);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());
  const finalTimeRef = useRef<string | null>(null);
  const wasSplitRef = useRef(splitOut);

  useEffect(() => {
    if (splitOut && !wasSplitRef.current) setOpen(false);
    wasSplitRef.current = splitOut;
  }, [splitOut]);

  useEffect(() => {
    if (splitOut) return;
    const interval = window.setInterval(() => {
      setElapsed((Date.now() - startTimeRef.current) / 1000);
    }, 250);
    return () => window.clearInterval(interval);
  }, [splitOut]);

  useEffect(() => {
    if (splitOut && !finalTimeRef.current) {
      finalTimeRef.current = `${Math.max(elapsed, 0.1).toFixed(1)}s`;
    }
  }, [splitOut, elapsed]);

  if (!live || splitOut) return null;

  const displayTime = finalTimeRef.current || `${elapsed.toFixed(1)}s`;
  const waitSeconds = Math.floor(elapsed);
  const claimCount = snapshot.claims.length;
  const waitCopy = stage === "checking" ? COPY_CHECKING : COPY_SPLITTING;

  return (
    <section
      className={`gp-thinking-box ${open ? "is-open" : "is-closed"}`}
      aria-label="思考过程"
      data-gp-thinking-state={splitOut ? "done" : "active"}
      data-gp-thinking-mode={splitOut ? "split" : "working"}
      data-gp-thinking-wait={splitOut ? undefined : stage}
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
          <span className={`gp-thinking-sparkle ${splitOut ? "is-done" : "is-spinning"}`} aria-hidden="true">
            {splitOut ? "✓" : "✦"}
          </span>
          <strong className="gp-thinking-title">
            {splitOut
              ? claimCount > 0
                ? `已拆出 ${claimCount} 个待查问题`
                : "已拆出待查问题"
              : waitCopy}
          </strong>
          <span className="gp-thinking-timer">
            {splitOut ? `· ${displayTime}` : `已等 ${waitSeconds} 秒`}
          </span>
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
            {splitOut ? (
              <p className="gp-thinking-copy">{COPY_ARCHIVE}</p>
            ) : (
              <>
                <p className="gp-thinking-copy">
                  {stage === "checking" ? COPY_CHECKING_BODY : COPY_SPLITTING_BODY}
                </p>
                <div className="gp-thinking-slots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

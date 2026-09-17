import { useState } from "react";
import type { InvestigationSnapshotV1 } from "../lib/investigation";
import { useUiLang } from "../lib/useUiLang";

export function InvestigationScope({ snapshot, onAsk, onAdjustFocus, adjusting = false }: {
  snapshot: InvestigationSnapshotV1;
  onAsk?: (question: string) => void;
  onAdjustFocus?: (question: string) => void;
  adjusting?: boolean;
}) {
  const { lang } = useUiLang();
  const en = lang === "en";
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState("");
  const settled = snapshot.phase === "complete" || snapshot.phase === "interrupted";
  const scoped = snapshot.scope;
  const included = scoped
    ? snapshot.claims.filter((claim) => scoped.includedClaimIds.includes(claim.id))
    : snapshot.claims.filter((claim) => claim.checkability === "checkable");
  const deferred = scoped ? snapshot.claims.filter((claim) => scoped.deferredClaimIds.includes(claim.id)) : [];
  const notApplicable = snapshot.claims.filter((claim) => claim.checkability !== "checkable");
  const title = !scoped ? (en ? "Questions identified" : "识别到的核查问题") : (en ? "Scope of this round" : "本轮核查范围");

  return (
    <section className="gp-investigation-scope" aria-label={en ? "Investigation scope" : "核查范围"} data-gp-scope>
      <div className="gp-scope-heading">
        <h2>{title}</h2>
        {onAdjustFocus ? <button type="button" className="gp-link-btn" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {en ? "Adjust focus" : "调整核查重点"}
        </button> : null}
      </div>
      {included.length ? <details open={!settled}>
        <summary>{en ? `${included.length} questions ${scoped ? "included in this round" : "identified"}` : `${scoped ? "本轮纳入" : "已识别"} ${included.length} 条问题`}</summary>
        <ol>{included.map((claim) => <li key={claim.id}>
          <span>{claim.text}</span>
          <small>{settled
            ? claim.judgment === "unresolved" || claim.judgment === null ? (en ? "Unresolved" : "尚未查清") : (en ? "See judgment and evidence" : "见判断与依据")
            : claim.progress === "pending" ? (en ? "Pending" : "待核查") : (en ? "Under investigation" : "核查中")}</small>
        </li>)}</ol>
      </details> : <p>{settled ? (en ? "No checkable claim was identified. Add the text or a screenshot to continue." : "未识别到可核查的说法，请补充正文或截图。") : (en ? "Identifying the claims to check. No confirmation is needed." : "正在识别需要核查的说法，无需确认即可开始。")}</p>}
      {deferred.length ? <div className="gp-scope-deferred" data-gp-scope-deferred>
        <h3>{en ? "Not covered in this round" : "本轮未覆盖"}</h3>
        <ul>{deferred.map((claim) => <li key={claim.id}>
          <span>{claim.text}</span>
          {settled && onAsk ? <button type="button" className="gp-link-btn" onClick={() => onAsk(en ? `Please investigate: ${claim.text}` : `请继续核查：${claim.text}`)}>{en ? "Prepare follow-up" : "补查这一条"}</button> : null}
        </li>)}</ul>
      </div> : null}
      {notApplicable.length ? <p>{en ? "Not a true/false question: " : "不适用真假判断："}{notApplicable.map((claim) => claim.text).join("；")}</p> : null}
      <p className="gp-scope-boundary">{en ? "The answer applies to these claims, not to every statement in the original material. Evidence may still be insufficient." : "回答只覆盖这些问题，不代表整份材料已获证实；纳入核查也不等于已有定论。"}</p>
      {editing && onAdjustFocus ? <form className="gp-scope-editor" onSubmit={(event) => { event.preventDefault(); if (focus.trim() && !adjusting) onAdjustFocus(focus.trim()); }}>
        <label>{en ? "What should this investigation focus on?" : "你更想确认什么？"}
          <textarea value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={1500} rows={2} required />
        </label>
        <p>{settled ? (en ? "Starts a follow-up while keeping this result." : "将新增一轮补查，保留本轮结果。") : (en ? "Stops this round before investigating the revised focus. Existing material is kept." : "先停止本轮，再按新重点核查；已经获得的材料会保留。")}</p>
        <button type="submit" className="gp-ghost-btn" disabled={!focus.trim() || adjusting}>{adjusting ? (en ? "Stopping…" : "正在停止本轮…") : settled ? (en ? "Investigate this focus" : "按这个重点补查") : (en ? "Stop and adjust" : "停止本轮并调整")}</button>
      </form> : null}
    </section>
  );
}

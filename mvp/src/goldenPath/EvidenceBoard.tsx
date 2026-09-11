/**
 * EvidenceBoard — 一个命题下证据行的稳定父容器（Issue #63）。
 * 行始终是本节点的 keyed children；分组标题用 CSS order 穿插，不把行搬到新父节点。
 */
import { useEffect, useRef } from "react";
import { LayoutGroup, useReducedMotion } from "framer-motion";
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSource } from "../lib/investigation";
import { EvidenceItem } from "./EvidenceItem";
import {
  ROLE_LABEL,
  ROLE_LAYOUT_ORDER,
  ROLE_ORDER,
  groupEvidence,
  identifyEvidenceLinks,
  roleGlyph,
  type EvidenceRole,
} from "./snapshotUi";

/** 同时变角色的行过多时停掉 layout，优先可读。 */
const LAYOUT_CHANGE_CAP = 6;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type EvidenceBoardProps = {
  claim: InvestigationClaim;
  sources: InvestigationSource[];
  asResult?: boolean;
  onSelect: (link: InvestigationEvidenceLink, source: InvestigationSource, trigger: HTMLElement) => void;
};

export function EvidenceBoard({ claim, sources, asResult = false, onSelect }: EvidenceBoardProps) {
  const reduce = useReducedMotion() === true || prefersReducedMotion();
  const groups = groupEvidence(claim.evidence);
  const identified = identifyEvidenceLinks(claim.id, claim.evidence);
  const prevRoles = useRef<Map<string, EvidenceRole>>(new Map());
  const roleChanges = identified.filter((row) => {
    const previous = prevRoles.current.get(row.key);
    return previous !== undefined && previous !== row.link.role;
  }).length;
  // layout 需在角色变化前就开着，Framer 才有上一帧几何；变化过多时关掉以免全体飞。
  const layoutEnabled = !reduce && roleChanges <= LAYOUT_CHANGE_CAP;

  useEffect(() => {
    prevRoles.current = new Map(identified.map((row) => [row.key, row.link.role]));
  });

  const sourceFor = (link: InvestigationEvidenceLink) => sources.find((s) => s.id === link.sourceId);
  const supportFinding = groups.find((g) => g.role === "support")?.links.find((l) => l.finding)?.finding;

  return (
    <LayoutGroup id={`gp-ev-${claim.id}`}>
      <div
        className="gp-evidence-board"
        data-gp-layout-motion={layoutEnabled ? "on" : "off"}
      >
        {ROLE_ORDER.map((role) => {
          const group = groups.find((g) => g.role === role);
          if (!group) return null;
          return (
            <div
              key={`head-${role}`}
              className={`gp-evidence-group-head is-${role}`}
              data-gp-group-role={role}
              style={{ order: ROLE_LAYOUT_ORDER[role] }}
            >
              <span className={`gp-role-glyph is-${role}`} aria-hidden="true">
                {roleGlyph(role)}
              </span>
              <h4 className="gp-evidence-group-label" id={`gp-eg-${claim.id}-${role}`}>
                {ROLE_LABEL[role]}
              </h4>
              <span className="gp-evidence-group-count">· {group.links.length}</span>
            </div>
          );
        })}
        {identified.map(({ link, key, identity }) => (
          <EvidenceItem
            key={key}
            claimId={claim.id}
            evidenceKey={key}
            identity={identity}
            link={link}
            source={sourceFor(link)}
            order={ROLE_LAYOUT_ORDER[link.role] + 1}
            layoutEnabled={layoutEnabled && identity === "stable"}
            groupLabelId={`gp-eg-${claim.id}-${link.role}`}
            asResult={asResult}
            onSelect={onSelect}
          />
        ))}
        {supportFinding && !asResult ? (
          <p className="gp-finding" style={{ order: ROLE_LAYOUT_ORDER.support + 2 }}>
            {supportFinding}
          </p>
        ) : null}
      </div>
    </LayoutGroup>
  );
}

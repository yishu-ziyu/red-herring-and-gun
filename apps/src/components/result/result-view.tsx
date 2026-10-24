// 结果页。结构照抄 shadcn/ui Card（https://ui.shadcn.com/docs/components/card：CardHeader / CardTitle / CardAction / CardContent），
// 用到的材料列表照抄 AI Elements Sources（https://ai-sdk.dev/elements/components/sources）。
// 文字口径全部来自 apps/shared/investigation/presentation.ts（结果页和分享页同一份）。
import { useMemo, useState } from "react";
import { BookIcon, ChevronDownIcon, ImageIcon, ListChecksIcon } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Sources, SourcesContent, SourcesTrigger, Source } from "@/components/ai-elements/sources";
import { LabelBadge, TONE_TEXT } from "@/components/label-badge";
import { Favicon, domainOf } from "@/components/source-chip";
import { EvidenceRow } from "./evidence-row";
import { CitedSentence, type Cite } from "./citations";
import { SharePanel } from "./share-panel";
import { cn } from "@/lib/utils";
import { clean } from "@/lib/scrub";
import { derivationSentence, displayClaim, imageReading, ROLE_TEXT, roleOf, verdictParts } from "@/lib/derive";
import type { RunData } from "@/lib/types";
import { LABEL_TONE, labelText } from "@shared/domain/labels";
import {
  presentClaim,
  presentConclusion,
  publishedDay,
  resultWording,
  shownClaims,
  type PresentedEvidence,
} from "@shared/investigation/presentation";
import type { InvestigationClaim, InvestigationSnapshotV1 } from "@shared/investigation/schema";

const w = resultWording();

function rawReason(claim: InvestigationClaim, ev: PresentedEvidence): string {
  return claim.evidence.find((link) => link.sourceId === ev.sourceId && link.role === ev.role)?.relationReason ?? "";
}

function citeNumbers(snapshot: InvestigationSnapshotV1, claims: InvestigationClaim[]) {
  const numbers = new Map<string, number>();
  for (const claim of claims) {
    for (const link of claim.evidence) {
      if ((link.role === "support" || link.role === "contradict") && !numbers.has(link.sourceId) && snapshot.sources.some((s) => s.id === link.sourceId)) {
        numbers.set(link.sourceId, numbers.size + 1);
      }
    }
  }
  return numbers;
}

function PointCard({
  claim,
  index,
  run,
  numbers,
}: {
  claim: InvestigationClaim;
  index: number;
  run: RunData;
  numbers: Map<string, number>;
}) {
  const snapshot = run.snapshot!;
  const p = presentClaim(claim, snapshot.sources);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const role = roleOf(run, claim.text);
  const urlOf = (id: string) => snapshot.sources.find((s) => s.id === id)?.url ?? "";
  const cites: Cite[] = p.decisive
    .filter((ev, i, list) => list.findIndex((x) => x.sourceId === ev.sourceId) === i)
    .map((ev) => ({
      n: numbers.get(ev.sourceId) ?? 0,
      title: clean(ev.linkText),
      url: urlOf(ev.sourceId),
      quote: ev.quote ? clean(ev.quote.text) : "",
      roleText: ev.roleText,
    }))
    .filter((cite) => cite.url);
  return (
    <article data-gp-claim-id={claim.id}>
      <Card className="gap-4">
        <CardHeader>
          <CardDescription className="flex items-center gap-2">
            <span>第 {index + 1} 点</span>
            {role ? <Badge variant="outline">{ROLE_TEXT[role]}</Badge> : null}
          </CardDescription>
          <CardTitle className="text-base leading-snug">{clean(p.text)}</CardTitle>
          {p.label ? (
            <CardAction>
              <LabelBadge label={p.label} data-gp-claim-label="" className="h-6 text-sm" />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {p.reason ? (
            <p className="text-sm leading-relaxed">
              <CitedSentence text={clean(p.reason)} cites={cites} textProps={{ "data-gp-claim-reason": "" }} />
            </p>
          ) : null}
          {p.boundary ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium">仍不能推出：</span>
              {clean(p.boundary)}
            </p>
          ) : null}
          {p.decisive.length ? (
            <ul className="flex flex-col gap-2">
              {p.decisive.map((ev) => (
                <EvidenceRow key={`${ev.sourceId}-${ev.role}`} ev={ev} url={urlOf(ev.sourceId)} reason={rawReason(claim, ev)} index={numbers.get(ev.sourceId)} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{w.noDecisive}</p>
          )}
          {p.related.length ? (
            <Collapsible open={relatedOpen} onOpenChange={setRelatedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 text-xs text-muted-foreground">
                  {w.related(p.related.length)}
                  <ChevronDownIcon className={cn("transition-transform", relatedOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-2 flex flex-col gap-2">
                  {p.related.map((ev) => (
                    <EvidenceRow key={`${ev.sourceId}-rel`} ev={ev} url={urlOf(ev.sourceId)} reason={rawReason(claim, ev)} />
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </CardContent>
      </Card>
    </article>
  );
}

export function ResultView({ run, mode = "owner" }: { run: RunData; mode?: "owner" | "public" }) {
  const snapshot = run.snapshot;
  const conclusion = useMemo(() => (snapshot ? presentConclusion(snapshot) : null), [snapshot]);
  if (!snapshot) return null;
  const claims = shownClaims(snapshot);
  const numbers = citeNumbers(snapshot, claims);
  const claimText = displayClaim(snapshot.originalClaim);
  const reading = imageReading(snapshot, run.events);
  const decided = verdictParts(run);
  const derivation = conclusion && decided && snapshot.phase === "complete" ? derivationSentence(decided.rule, decided.parts, conclusion.label) : "";
  const tone = conclusion ? LABEL_TONE[conclusion.label] : "muted";
  const sources = snapshot.sources.filter((s) => /^https?:\/\//.test(s.url));
  const publicAttr = mode === "public" ? { "data-share-conclusion": "" } : {};

  return (
    <div data-gp-result className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardDescription>核查的说法</CardDescription>
          <CardTitle className="text-lg leading-relaxed font-medium">
            {claimText.fromImage ? (
              <span className="inline-flex items-center gap-2">
                <ImageIcon className="size-5 text-muted-foreground" />
                {claimText.text}
              </span>
            ) : (
              `「${claimText.text}」`
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {reading ? (
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ImageIcon className="size-3.5" />
                从图片里读出的文字
              </p>
              {reading.ocrTexts.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {reading.ocrTexts.map((line, i) => (
                    <li key={i}>{clean(line)}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">图片里没读出文字。</p>
              )}
            </div>
          ) : null}
          {conclusion ? (
            <>
              <div data-gp-direct-answer {...publicAttr} className="flex flex-col gap-2">
                <span data-gp-conclusion-label className={cn("text-3xl font-bold tracking-tight", TONE_TEXT[tone])}>
                  {labelText(conclusion.label)}
                </span>
                <p data-gp-conclusion-reason className="text-base leading-relaxed">
                  {clean(conclusion.lead)}
                </p>
              </div>
              {derivation ? (
                <div className="flex gap-2 rounded-lg border border-dashed p-3 text-sm">
                  <ListChecksIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p>
                    <span className="font-medium">怎么推出来的：</span>
                    {derivation}
                  </p>
                </div>
              ) : null}
              {conclusion.rationale ? <p className="text-sm text-muted-foreground">{clean(conclusion.rationale)}</p> : null}
              {conclusion.boundaries.length ? (
                <div className="text-sm text-muted-foreground">
                  <p className="text-xs font-medium">{w.boundaries}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {conclusion.boundaries.map((b, i) => (
                      <li key={i}>{clean(b)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {conclusion.notCovered ? <p className="text-sm text-muted-foreground">{clean(conclusion.notCovered)}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {conclusion.checkedDay ? <p className="text-xs text-muted-foreground">{w.checkedAt(conclusion.checkedDay)}</p> : <span />}
                {mode === "owner" && snapshot.phase === "complete" ? <SharePanel runId={run.runId} /> : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">还没有整句结论。</p>
          )}
        </CardContent>
      </Card>

      {claims.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">拆成 {claims.length} 点逐一核对</h2>
          {claims.map((claim, i) => (
            <PointCard key={claim.id} claim={claim} index={i} run={run} numbers={numbers} />
          ))}
        </section>
      ) : null}

      {sources.length ? (
        <Card className="py-4">
          <CardContent>
            <Sources className="mb-0 text-sm text-foreground">
              <SourcesTrigger count={sources.length}>
                <BookIcon className="size-4" />
                <span className="font-medium">本次共用到 {sources.length} 份材料</span>
                <ChevronDownIcon className="size-4" />
              </SourcesTrigger>
              <SourcesContent className="w-full">
                {sources.map((s) => (
                  <Source key={s.id} href={s.url} title={s.title}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Favicon url={s.url} />
                      <span className="min-w-0 truncate">{clean(s.title) || domainOf(s.url)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{publishedDay(s) ?? w.publishedUnknown}</span>
                    </span>
                  </Source>
                ))}
              </SourcesContent>
            </Sources>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

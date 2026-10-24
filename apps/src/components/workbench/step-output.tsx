// 右侧「当前 agent 的实际产出」。思考折叠照抄 AI Elements Reasoning（https://ai-sdk.dev/elements/components/reasoning），
// 检索 / 审核的子任务照抄 AI Elements Task（https://ai-sdk.dev/elements/components/task），
// 长段文字用 AI Elements MessageResponse（https://ai-sdk.dev/elements/components/message，原 Response）渲染。
import { CheckIcon, FileSearchIcon, ImageIcon, ListTreeIcon, ScaleIcon, XIcon } from "lucide-react";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Task, TaskContent, TaskItem, TaskItemFile, TaskTrigger } from "@/components/ai-elements/task";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { LabelBadge } from "@/components/label-badge";
import { Favicon, domainOf } from "@/components/source-chip";
import { clean, scrubList } from "@/lib/scrub";
import { STEP_META, type Step, type TimelineLine } from "@/lib/workbench";
import type { InvestigationSnapshotV1 } from "@shared/investigation/schema";
import { isLabelKey, labelForVerdict } from "@shared/domain/labels";

const ROLE_TEXT: Record<string, string> = { main: "主要说法", premise: "前提", background: "背景" };
const RELATION_TEXT: Record<string, string> = { support: "支持", contradict: "反驳", "context-only": "只作背景" };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function Thinking({ step, now }: { step: Step; now: number }) {
  const thoughts = clean(step.thoughts);
  if (!thoughts) return null;
  const streaming = step.status === "active" && !step.thinkingEndedAt;
  const duration = ((step.thinkingEndedAt ?? now) - step.startedAt) / 1000;
  return (
    <Reasoning key={step.id} isStreaming={streaming} duration={streaming ? undefined : duration} defaultOpen={false}>
      <ReasoningTrigger
        getThinkingMessage={(isStreaming, d) =>
          isStreaming ? <Shimmer duration={1}>思考中</Shimmer> : <p>思考已完成{d !== undefined ? ` · ${d.toFixed(1)}s` : ""}</p>
        }
      />
      <ReasoningContent className="max-h-72 overflow-y-auto rounded-md bg-muted/40 p-3 text-xs">{thoughts}</ReasoningContent>
    </Reasoning>
  );
}

function VisionOutput({ output }: { output: Rec }) {
  const ocr = scrubList(output.ocrTexts);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium">从图片里读出的文字</h4>
      {ocr.length ? (
        <ul className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
          {ocr.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">图片里没读出文字。</p>
      )}
      {str(output.visualSummary) ? <p className="text-sm text-muted-foreground">{clean(str(output.visualSummary))}</p> : null}
    </div>
  );
}

function SplitOutput({ output }: { output: Rec }) {
  const typed = arr(output.claimAtomTypes).map(rec).filter((a) => str(a.text));
  const atoms = typed.length ? typed : arr(output.claimAtoms).map((text) => ({ text }));
  const analysis = clean(str(output.analysis));
  return (
    <div className="flex flex-col gap-4">
      <Task>
        <TaskTrigger title={`拆成 ${atoms.length} 点`}>
          <div className="flex w-full cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ListTreeIcon className="size-4" />
            <p>拆成 {atoms.length} 点</p>
          </div>
        </TaskTrigger>
        <TaskContent>
          {atoms.map((atom, i) => (
            <TaskItem key={i} className="flex items-start gap-2 text-foreground">
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs">{i + 1}</span>
              <span className="flex-1">{clean(str((atom as Rec).text))}</span>
              {ROLE_TEXT[str((atom as Rec).role)] ? (
                <Badge variant="outline" className="shrink-0">
                  {ROLE_TEXT[str((atom as Rec).role)]}
                </Badge>
              ) : null}
            </TaskItem>
          ))}
        </TaskContent>
      </Task>
      {analysis ? (
        <div className="rounded-md border p-3 text-sm">
          <MessageResponse>{analysis}</MessageResponse>
        </div>
      ) : null}
    </div>
  );
}

function SearchOutput({ step }: { step: Step }) {
  return (
    <div className="flex flex-col gap-4">
      {step.searches.map((task, i) => (
        <Task key={`${task.query}-${i}`} defaultOpen={i === step.searches.length - 1 || step.searches.length <= 2}>
          <TaskTrigger title={task.query}>
            <div className="flex w-full cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <FileSearchIcon className="size-4 shrink-0" />
              <p className="min-w-0 flex-1 truncate">找材料：「{clean(task.query)}」</p>
              <span className="shrink-0 text-xs">{task.endedAt ? `${task.sources.length} 条` : <Shimmer as="span">检索中</Shimmer>}</span>
            </div>
          </TaskTrigger>
          <TaskContent>
            {task.sources.length === 0 ? <TaskItem>还没有材料</TaskItem> : null}
            {task.sources.slice(0, 8).map((source, j) => (
              <TaskItem key={`${source.url}-${j}`} className="flex min-w-0 items-center gap-2">
                <TaskItemFile className="shrink-0">
                  <Favicon url={source.url} />
                  <span>{domainOf(source.url)}</span>
                </TaskItemFile>
                <span className="min-w-0 truncate">{source.title}</span>
              </TaskItem>
            ))}
            {task.sources.length > 8 ? <TaskItem>另有 {task.sources.length - 8} 条</TaskItem> : null}
          </TaskContent>
        </Task>
      ))}
    </div>
  );
}

function CheckOutput({ output }: { output: Rec }) {
  const verdicts = arr(output.subclaimVerdicts).map(rec);
  const findings = scrubList(output.keyFindings);
  return (
    <div className="flex flex-col gap-4">
      {verdicts.map((v, i) => {
        const label = isLabelKey(v.label) ? v.label : labelForVerdict(str(v.verdict));
        return (
          <Task key={i}>
            <TaskTrigger title={str(v.claimAtom)}>
              <div className="flex w-full cursor-pointer items-start gap-2 text-sm hover:text-foreground">
                <ScaleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1">{clean(str(v.claimAtom))}</p>
                <LabelBadge label={label} />
              </div>
            </TaskTrigger>
            <TaskContent>
              {str(v.reason) ? <TaskItem className="text-foreground">{clean(str(v.reason))}</TaskItem> : null}
              {str(v.boundary) ? <TaskItem>仍不能推出：{clean(str(v.boundary))}</TaskItem> : null}
            </TaskContent>
          </Task>
        );
      })}
      {findings.length ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">关键发现</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {findings.map((f, i) => (
              <li key={i}>{clean(f)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AuditOutput({ output }: { output: Rec }) {
  const relations = arr(output.claimSourceRelations).map(rec).filter((r) => str(r.url));
  const groups = new Map<string, Rec[]>();
  for (const r of relations) groups.set(str(r.claimAtom), [...(groups.get(str(r.claimAtom)) ?? []), r]);
  const notes = clean(str(output.verificationNotes));
  return (
    <div className="flex flex-col gap-4">
      {[...groups].map(([atom, list]) => (
        <Task key={atom}>
          <TaskTrigger title={atom}>
            <div className="flex w-full cursor-pointer items-start gap-2 text-sm hover:text-foreground">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1">{clean(atom)}</p>
              <span className="shrink-0 text-xs text-muted-foreground">{list.length} 条来源</span>
            </div>
          </TaskTrigger>
          <TaskContent>
            {list.map((r, i) => (
              <TaskItem key={i} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      r.relation === "support"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : r.relation === "contradict"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : ""
                    }
                  >
                    {RELATION_TEXT[str(r.relation)] ?? "相关"}
                  </Badge>
                  <TaskItemFile>
                    <Favicon url={str(r.url)} />
                    {domainOf(str(r.url))}
                  </TaskItemFile>
                </span>
                {clean(str(r.reason)) ? <span className="text-foreground/80">{clean(str(r.reason))}</span> : null}
              </TaskItem>
            ))}
          </TaskContent>
        </Task>
      ))}
      {notes ? (
        <div className="rounded-md border p-3 text-sm">
          <MessageResponse>{notes}</MessageResponse>
        </div>
      ) : null}
    </div>
  );
}

function WriteOutput({ step, snapshot }: { step: Step; snapshot: InvestigationSnapshotV1 | null }) {
  const conclusion = snapshot?.phase === "complete" ? snapshot.conclusion : undefined;
  const passed = rec(step.output).passed;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {passed !== undefined ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          {passed ? <CheckIcon className="size-4 text-emerald-600" /> : <XIcon className="size-4 text-amber-600" />}
          {passed ? "复核通过" : "复核提出了修改，已按材料改写"}
        </p>
      ) : null}
      {conclusion ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          {conclusion.label ? <LabelBadge label={conclusion.label} className="h-6 text-sm" /> : null}
          <p>{clean(conclusion.verdictLead || conclusion.directAnswer)}</p>
        </div>
      ) : null}
    </div>
  );
}

function StepLines({ lines }: { lines: TimelineLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {lines.map((line) => (
        <li key={line.index} className="text-muted-foreground">
          {line.text}
        </li>
      ))}
    </ul>
  );
}

export function StepOutput({ step, snapshot, now, lines }: { step: Step; snapshot: InvestigationSnapshotV1 | null; now: number; lines: TimelineLine[] }) {
  const output = step.output ? rec(step.output) : null;
  const body = (() => {
    if (step.kind === "search" && !step.approx) return <SearchOutput step={step} />;
    if (step.kind === "write" && (output || snapshot?.phase === "complete")) return <WriteOutput step={step} snapshot={snapshot} />;
    if (!output) return null;
    if (step.kind === "vision") return <VisionOutput output={output} />;
    if (step.kind === "split") return <SplitOutput output={output} />;
    if (step.kind === "check") return <CheckOutput output={output} />;
    if (step.kind === "audit") return <AuditOutput output={output} />;
    return null;
  })();
  const ownLines = lines.filter((line) => line.stepId === step.id);
  return (
    <div className="flex flex-col gap-4">
      <Thinking step={step} now={now} />
      {step.status === "active" && !body ? (
        <div className="flex items-center gap-2 text-sm">
          {step.kind === "vision" ? <ImageIcon className="size-4 text-muted-foreground" /> : null}
          <Shimmer>{STEP_META[step.kind].doing}</Shimmer>
        </div>
      ) : null}
      {body}
      {(!body || step.approx) && step.status !== "active" ? <StepLines lines={ownLines} /> : null}
      {step.status === "error" ? <p className="text-sm text-amber-700">这一步没能完成，核查按现有材料继续。</p> : null}
    </div>
  );
}


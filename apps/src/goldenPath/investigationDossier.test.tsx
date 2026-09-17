import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { InvestigationDossier } from "./InvestigationDossier";
import { conflictKnownReason, refutedComplete, unresolvedComplete } from "./fixtures";
import type { PublicActivity } from "../lib/investigation";

function activity(seq: number): PublicActivity {
  return {
    version: 1,
    id: `run:${seq}`,
    runId: "run",
    seq,
    occurredAt: "2026-09-11T10:00:00.000Z",
    kind: "search_started",
    role: "source",
    claimIds: [],
    sourceIds: [],
    snapshotRevision: 1,
    payload: { query: "查询" },
  } as PublicActivity;
}

const FORBIDDEN = /疾控|1\.4s|15\.2s|23\.4s|永久保留|权威材料|思考全链条|5 拍慢动作/;

afterEach(cleanup);

describe("InvestigationDossier", () => {
  it("默认展示材料、分歧、缺口；不编调查经历", () => {
    const fixture = refutedComplete();
    render(<InvestigationDossier snapshot={fixture} />);

    expect(screen.getByText("调查案卷")).toBeTruthy();
    expect(screen.getByText("收集到的来源")).toBeTruthy();
    expect(screen.getByText("分歧")).toBeTruthy();
    expect(screen.getByText("缺口")).toBeTruthy();
    expect(screen.getByText("世卫组织辟谣平台：无此结论")).toBeTruthy();
    expect(screen.queryByText("调查经历")).toBeNull();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it("健康无关输入也不出现疾控、固定秒数、永久保留", () => {
    render(<InvestigationDossier snapshot={conflictKnownReason()} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).toContain("收集到的来源");
    expect(text).toContain("某地试点通知");
    expect(text).toContain("全国性新规查证");
    expect(text).toMatch(/支持.*反驳/);
  });

  it("有缺口时展示缺口原文，不编调查经历", () => {
    render(<InvestigationDossier snapshot={unresolvedComplete()} />);
    expect(screen.getByText("该原子定向检索无结果，待补证")).toBeTruthy();
    expect(screen.queryByText("调查经历")).toBeNull();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it("只有本次公共活动记录才生成调查经历", () => {
    render(<InvestigationDossier snapshot={refutedComplete()} activities={[activity(1)]} />);
    expect(screen.getByText("调查经历")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    expect(document.body.textContent).not.toContain("思考全链条");
  });
});

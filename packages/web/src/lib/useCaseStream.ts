import { reduce, type Case, type CaseEvent } from '@rhg/core/casefile';
import { useCallback, useEffect, useRef, useState } from "react";
import { abortTurn, getCase, openStream, postTurn, type PostTurnResult } from "./api.js";
import { TURN_BUSY } from "./copy.js";

export type StreamStatus = "loading" | "live" | "reconnecting" | "error";

export type StreamApi = {
  getCase: typeof getCase;
  openStream: typeof openStream;
  postTurn: typeof postTurn;
  abortTurn: typeof abortTurn;
};

const defaultApi: StreamApi = { getCase, openStream, postTurn, abortTurn };

export function useCaseStream(caseId: string, api: StreamApi = defaultApi) {
  const [current, setCurrent] = useState<Case | null>(null);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [running, setRunning] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caseRef = useRef<Case | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const generation = useRef(0);

  const apply = useCallback((next: Case, nextRunning?: boolean) => {
    caseRef.current = next;
    setCurrent(next);
    if (nextRunning !== undefined) setRunning(nextRunning);
  }, []);

  const detach = useCallback(() => {
    const source = sourceRef.current;
    sourceRef.current = null;
    source?.close();
  }, []);

  const attach = useCallback(
    (id: string, since: number, gen: number) => {
      detach();
      const source = api.openStream(id, since);
      sourceRef.current = source;
      const onFrame = (raw: Event) => {
        if (generation.current !== gen) return;
        const message = raw as MessageEvent<string>;
        let event: CaseEvent;
        try {
          event = JSON.parse(String(message.data)) as CaseEvent;
        } catch {
          return;
        }
        const snap = caseRef.current;
        if (!snap) return;
        if (event.seq <= snap.seq) return;
        if (event.seq > snap.seq + 1) {
          detach();
          void refill(id, gen);
          return;
        }
        const next = reduce(snap, event);
        apply(next, event.type === "turn.started" ? true : event.type === "turn.finished" ? false : undefined);
        if (event.type === "turn.started") setAborted(false);
        if (event.type === "turn.finished" && event.reason === "aborted") setAborted(true);
        setStatus("live");
      };
      source.addEventListener("case.event", onFrame);
      source.onerror = () => {
        if (generation.current !== gen) return;
        if (source.readyState === source.CLOSED) return;
        setStatus("reconnecting");
      };
    },
    [api, apply, detach],
  );

  const refill = useCallback(
    async (id: string, gen: number) => {
      setStatus("reconnecting");
      const loaded = await api.getCase(id);
      if (generation.current !== gen) return;
      apply(loaded.case, loaded.running);
      const last = loaded.case.turns.at(-1);
      setAborted(last?.reason === "aborted");
      setStatus("live");
      attach(id, loaded.case.seq, gen);
    },
    [api, apply, attach],
  );

  useEffect(() => {
    if (!caseId) return;
    const gen = generation.current + 1;
    generation.current = gen;
    let cancelled = false;
    setStatus("loading");
    setError(null);
    void api
      .getCase(caseId)
      .then((loaded) => {
        if (cancelled || generation.current !== gen) return;
        apply(loaded.case, loaded.running);
        const last = loaded.case.turns.at(-1);
        setAborted(last?.reason === "aborted");
        setStatus("live");
        attach(caseId, loaded.case.seq, gen);
      })
      .catch((err: unknown) => {
        if (cancelled || generation.current !== gen) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "读不到这案");
      });
    return () => {
      cancelled = true;
      detach();
    };
  }, [api, apply, attach, caseId, detach]);

  const sendTurn = useCallback(
    async (text: string, pivotId?: string) => {
      if (!caseId) return;
      const result: PostTurnResult = await api.postTurn(caseId, text, pivotId);
      if (!result.ok && result.status === 409) {
        setStatus("error");
        setError(result.error || TURN_BUSY);
        return;
      }
      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        return;
      }
      setAborted(false);
      setRunning(true);
    },
    [api, caseId],
  );

  const abort = useCallback(async () => {
    if (!caseId) return;
    setAborted(true);
    setRunning(false);
    await api.abortTurn(caseId);
  }, [api, caseId]);

  return { case: current, status, running, aborted, error, sendTurn, abort };
}

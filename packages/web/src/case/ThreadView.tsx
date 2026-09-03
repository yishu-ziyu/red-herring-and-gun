import type { Case, Message } from '@rhg/core/casefile';
import { useEffect, useState } from "react";
import { ATTACH_ALT, MEMO_FOLLOW, MEMO_USER, errorLine } from "../lib/copy.js";
import { userMessageIndex } from "../lib/select.js";
import type { StreamStatus } from "../lib/useCaseStream.js";
import { Composer } from "./Composer.js";
import { ReportCard } from "./ReportCard.js";

export function ThreadView(props: {
  current: Case;
  running: boolean;
  aborted?: boolean;
  status: StreamStatus;
  error: string | null;
  flashClaim?: string | null;
  onSend: (text: string, pivotId?: string) => Promise<void>;
  onAbort: () => Promise<void>;
}) {
  const [pursuingId, setPursuingId] = useState<string | null>(null);
  const assistants = props.current.messages.filter((message) => message.role === "assistant");
  const lastAssistant = assistants.at(-1);
  const last = props.current.messages.at(-1);
  const needLiveCard = props.running && last?.role !== "assistant";

  useEffect(() => {
    if (!props.running) setPursuingId(null);
  }, [props.running]);

  function onPursue(pivotId: string) {
    setPursuingId(pivotId);
    void props.onSend("", pivotId);
  }

  return (
    <div className="thread">
      <div className="thread-body">
        {props.current.messages.map((message) =>
          message.role === "user" ? (
            <UserMemo
              key={message.id}
              message={message}
              followup={userMessageIndex(props.current.messages, message.id) > 0}
            />
          ) : (
            <ReportCard
              key={message.id}
              current={props.current}
              running={message.id === lastAssistant?.id && props.running}
              aborted={message.id === lastAssistant?.id ? props.aborted : false}
              historical={message.id === lastAssistant?.id ? undefined : message.text}
              pursuingId={message.id === lastAssistant?.id ? pursuingId : null}
              flashClaim={message.id === lastAssistant?.id ? props.flashClaim : null}
              onPursue={message.id === lastAssistant?.id ? onPursue : undefined}
            />
          ),
        )}
        {needLiveCard ? (
          <ReportCard
            current={props.current}
            running
            aborted={props.aborted}
            pursuingId={pursuingId}
            flashClaim={props.flashClaim}
            onPursue={onPursue}
          />
        ) : null}
        {props.error ? <p className="err">{errorLine(props.error)}</p> : null}
      </div>
      <Composer running={props.running} onSend={(text) => props.onSend(text)} onAbort={props.onAbort} />
    </div>
  );
}

function UserMemo(props: { message: Message; followup: boolean }) {
  const images = props.message.attachments?.filter((item) => item.kind === "image") ?? [];
  return (
    <article className={props.followup ? "memo-user follow font-serif" : "memo-user font-serif"}>
      <p className="bubble-meta">{props.followup ? MEMO_FOLLOW : MEMO_USER}</p>
      {props.message.text ? <p>{props.message.text}</p> : null}
      {images.map((item) => (
        <img key={item.value} src={item.value} alt={ATTACH_ALT} className="memo-thumb" />
      ))}
    </article>
  );
}

import { scrubPublicText, validateEvent, type CaseEvent } from "@rhg/core";

export function toPublicEvent(event: CaseEvent): CaseEvent {
  if (event.type === "llm.called") {
    const { error: _error, attempts: _attempts, ...rest } = event;
    return validateEvent({ ...rest, model: "" });
  }
  if (event.type === "error") {
    return validateEvent({ ...event, message: scrubPublicText(event.message) });
  }
  if (event.type === "evidence.added") {
    const provenance = event.evidence.provenance;
    if (provenance.kind === "search") {
      const { provider: _provider, ...rest } = provenance;
      return validateEvent({
        ...event,
        evidence: { ...event.evidence, provenance: rest },
      });
    }
  }
  if (event.type === "evidence.updated") {
    return event;
  }
  return event;
}

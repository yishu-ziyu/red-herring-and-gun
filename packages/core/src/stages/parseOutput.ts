import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export type ParseJobOk<T extends TSchema> = { ok: true; value: Static<T> };
export type ParseJobFail = { ok: false; reason: string };
export type ParseJobResult<T extends TSchema> = ParseJobOk<T> | ParseJobFail;

export function parseJobOutput<T extends TSchema>(schema: T, output: unknown): ParseJobResult<T> {
  const cleaned = Value.Clean(schema, output);
  const converted = Value.Convert(schema, cleaned);
  if (Value.Check(schema, converted)) {
    return { ok: true, value: converted };
  }
  const first = Value.Errors(schema, converted)[0];
  const path = first?.instancePath || "/";
  const message = first?.message ?? "invalid";
  let dump = "";
  try {
    dump = JSON.stringify(output).slice(0, 400);
  } catch {
    dump = String(output).slice(0, 400);
  }
  return { ok: false, reason: `${path} ${message} ${dump}` };
}

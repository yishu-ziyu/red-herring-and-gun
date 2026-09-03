import { validateCase, type Case } from "./schema.js";

export function serialize(c: Case): string {
  return JSON.stringify(c);
}

export function deserialize(raw: string): Case {
  return validateCase(JSON.parse(raw) as unknown);
}

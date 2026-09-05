const KEY = "rhg.opening";

type Opening = { caseId: string; text: string };

export function saveOpening(caseId: string, text: string): void {
  const payload: Opening = { caseId, text };
  sessionStorage.setItem(KEY, JSON.stringify(payload));
}

export function readOpening(caseId: string): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Opening>;
    if (data.caseId !== caseId || typeof data.text !== "string" || !data.text.trim()) return null;
    return data.text;
  } catch {
    return null;
  }
}

export function clearOpening(): void {
  sessionStorage.removeItem(KEY);
}

export function urlsInText(text: string): string[] {
  return [...(text.match(/https?:\/\/[^\s<>"']+/gi) ?? [])].map((url) => url.replace(/[.,;:!?)]+$/, ""));
}

export function firstUrlInText(text: string): string | undefined {
  return urlsInText(text)[0];
}

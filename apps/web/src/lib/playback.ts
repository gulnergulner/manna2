export type Resume = { id: string; position: number; updatedAt: number };
export function resumePosition(saved: number, duration: number) {
  return Number.isFinite(saved) && saved >= 0
    ? Math.min(saved, Math.max(0, duration - 0.1))
    : 0;
}
export function readResume(): Resume | undefined {
  try {
    const s = JSON.parse(localStorage.getItem("manna:last") || "null");
    return s &&
      typeof s.id === "string" &&
      Number.isFinite(s.position) &&
      s.position >= 0
      ? s
      : undefined;
  } catch {
    return undefined;
  }
}
export function saveResume(id: string, position: number) {
  try {
    localStorage.setItem(`manna:position:${id}`, String(position));
    localStorage.setItem(
      "manna:last",
      JSON.stringify({ id, position, updatedAt: Date.now() }),
    );
  } catch {
    /* Private browsing/storage limits must not interrupt playback. */
  }
}
export function savedPosition(id: string) {
  try {
    const n = Number(localStorage.getItem(`manna:position:${id}`));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

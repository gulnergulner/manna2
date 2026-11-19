import { mockMode, readJson } from "@/lib/storage";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const raw = mockMode()
      ? {
          serviceDate: "2026-10-27",
          state: "ready",
          lastCheckedAt: "2026-10-27T07:02:00+09:00",
          lastPublishedAt: "2026-10-27T07:02:00+09:00",
        }
      : await readJson("metadata/collector-status.json");
    const s = raw as Record<string, unknown>;
    if (
      !["ready", "waiting", "empty", "failed"].includes(String(s.state)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(s.serviceDate))
    )
      throw new Error("Invalid status");
    return Response.json(
      {
        serviceDate: s.serviceDate,
        state: s.state,
        lastCheckedAt: s.lastCheckedAt,
        lastPublishedAt: s.lastPublishedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "수집 상태를 확인할 수 없습니다." },
      { status: 503 },
    );
  }
}

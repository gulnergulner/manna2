import { catalog, mockMode } from "@/lib/storage";
import { publicItem } from "@/lib/catalog";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const c = await catalog();
    return Response.json(
      {
        updatedAt: c.updatedAt,
        mock: mockMode(),
        items: c.items
          .filter((i) => i.availability === "available")
          .sort((a, b) =>
            b.broadcastStartedAt.localeCompare(a.broadcastStartedAt),
          )
          .map(publicItem),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "목록을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}

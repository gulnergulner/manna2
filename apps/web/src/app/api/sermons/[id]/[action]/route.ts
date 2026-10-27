import { authenticated } from "@/lib/auth";
import { catalog, audioUrl } from "@/lib/storage";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  if (!(await authenticated()))
    return Response.json(
      { error: "로그인이 필요합니다." },
      { status: 401, headers },
    );
  const { id, action } = await params;
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
    !["play-url", "download"].includes(action)
  )
    return new Response(null, { status: 404, headers });
  try {
    const item = (await catalog()).items.find(
      (i) => i.id === id && i.availability === "available",
    );
    if (!item)
      return Response.json(
        { error: "음원이 없습니다." },
        { status: 404, headers },
      );
    const signed = await audioUrl(item, action === "download");
    return action === "download"
      ? new Response(null, {
          status: 302,
          headers: { ...headers, Location: signed.url },
        })
      : Response.json(signed, { headers });
  } catch {
    return Response.json(
      { error: "음원을 준비할 수 없습니다." },
      { status: 503, headers },
    );
  }
}

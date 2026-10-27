import { authenticated } from "@/lib/auth";
import { catalog, mockMode } from "@/lib/storage";
import { readFile } from "node:fs/promises";
import path from "node:path";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!(await authenticated())) return new Response(null, { status: 401 });
  if (!mockMode()) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  if (!(await catalog()).items.some((i) => i.id === url.searchParams.get("id")))
    return new Response(null, { status: 404 });
  const bytes = await readFile(path.join(process.cwd(), "fixtures/sample.mp3"));
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  if (url.searchParams.has("download"))
    headers["Content-Disposition"] = 'attachment; filename="sample.mp3"';
  const range = request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${bytes.length}` },
      });
    const start = m[1]
      ? Number(m[1])
      : Math.max(0, bytes.length - Number(m[2]));
    const end = m[1]
      ? m[2]
        ? Math.min(Number(m[2]), bytes.length - 1)
        : bytes.length - 1
      : bytes.length - 1;
    if (start > end || start >= bytes.length)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${bytes.length}` },
      });
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(bytes, {
    headers: { ...headers, "Content-Length": String(bytes.length) },
  });
}

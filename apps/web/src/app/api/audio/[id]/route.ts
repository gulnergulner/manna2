import { authenticated } from "@/lib/auth";
import { catalog, disposition } from "@/lib/storage";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authenticated())) return new Response(null, { status: 401 });
  if (process.env.STORAGE_MODE !== "nas" || !process.env.NAS_LIBRARY_DIR) return new Response(null, { status: 404 });
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response(null, { status: 404 });
  try {
    const item = (await catalog()).items.find(i => i.id === id && i.availability === "available");
    if (!item) return new Response(null, { status: 404 });
    const file = await open(path.join(process.env.NAS_LIBRARY_DIR, item.objectKey), "r");
    const size = (await file.stat()).size;
    const range = request.headers.get("range");
    let start = 0, end = size - 1;
    const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Content-Disposition": disposition(item, new URL(request.url).searchParams.has("download")) };
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) { await file.close(); return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } }); }
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { await file.close(); return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } }); }
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    if (size === 0) { await file.close(); return new Response(null, { status: 404 }); }
    headers["Content-Length"] = String(end - start + 1);
    const stream = file.createReadStream({ start, end, autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
  } catch { return new Response(null, { status: 503 }); }
}

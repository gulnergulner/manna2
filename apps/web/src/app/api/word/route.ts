import postgres from "postgres";
let db: ReturnType<typeof postgres> | undefined;
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response(null, { status: 400 });
  const url = process.env.MANNA_DATABASE_URL;
  if (!url) return new Response(null, {status: 503});
  try {
    db ??= postgres(url, { max: 2, prepare: false, connect_timeout: 5, idle_timeout: 20 });
    const [word] = await db`select "koreanText", "englishText", "scriptureReference" from "StudyEntry"
      where date = ${date} and published = true limit 1`;
    return Response.json(word ?? null, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return new Response(null, { status: 503 }); }
}

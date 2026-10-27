import { NextResponse } from "next/server";
import {
  authenticated,
  checkPassword,
  COOKIE,
  makeSession,
  sameOrigin,
} from "@/lib/auth";
export const dynamic = "force-dynamic";
// Supplement with Vercel WAF rate limiting for shared/distributed production instances.
const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  const ip = process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for") || "unknown"
    : "local";
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  const entry = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
  if (entry.count >= 10)
    return NextResponse.json(
      { error: "잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  try {
    const body = await request.text();
    if (body.length > 2048) return new Response(null, { status: 413 });
    const password = JSON.parse(body).password;
    if (typeof password !== "string")
      return new Response(null, { status: 400 });
    entry.count++;
    attempts.set(ip, entry);
    if (!checkPassword(password))
      return NextResponse.json(
        { error: "비밀번호를 확인해 주세요." },
        { status: 401 },
      );
    attempts.delete(ip);
    const res = NextResponse.json({ ok: true });
    res.headers.set("Cache-Control", "no-store");
    res.cookies.set(COOKIE, makeSession(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
    });
    return res;
  } catch {
    return NextResponse.json(
      { error: "로그인 설정 또는 요청을 확인해 주세요." },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request) || !(await authenticated()))
    return new Response(null, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

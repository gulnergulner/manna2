import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
export const COOKIE = "manna_session";
function secret() {
  const s = process.env.AUTH_SESSION_SECRET;
  if (!s || s.length < 32)
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters");
  return s;
}
export function checkPassword(value: string) {
  const expected = process.env.AUTH_PASSWORD;
  if (!expected || expected.length < 16)
    throw new Error("AUTH_PASSWORD must contain at least 16 characters");
  return timingSafeEqual(
    createHash("sha256").update(value).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
export function makeSession(now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(now / 1000) + 86400 }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function verifySession(token: string | undefined, now = Date.now()) {
  if (!token) return false;
  try {
    const [p, s, ...rest] = token.split(".");
    if (rest.length || !p || !s) return false;
    const wanted = createHmac("sha256", secret()).update(p).digest();
    const got = Buffer.from(s, "base64url");
    if (got.length !== wanted.length || !timingSafeEqual(got, wanted))
      return false;
    const { exp } = JSON.parse(Buffer.from(p, "base64url").toString());
    return (
      Number.isInteger(exp) && exp > now / 1000 && exp <= now / 1000 + 86401
    );
  } catch {
    return false;
  }
}
export async function authenticated() {
  return verifySession((await cookies()).get(COOKIE)?.value);
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  const protocol = process.env.VERCEL ? "https:" : url.protocol;
  return origin === `${protocol}//${host}`;
}

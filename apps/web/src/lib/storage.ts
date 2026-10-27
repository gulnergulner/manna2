import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fixture from "../../../../fixtures/catalog.json";
import { parseCatalog, type Catalog, type Sermon } from "./catalog";
export function mockMode() {
  if (process.env.MOCK_MODE === "true") {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL)
      throw new Error("Mock mode is restricted to local development");
    return true;
  }
  return false;
}
function config() {
  const names = [
    "R2_ACCOUNT_ID",
    "R2_BUCKET_NAME",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ] as const;
  for (const name of names)
    if (!process.env[name]) throw new Error(`Missing ${name}`);
  return {
    bucket: process.env.R2_BUCKET_NAME!,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    }),
  };
}
let cache: { value: Catalog; until: number } | undefined;
export function boundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
export async function readJson(key: string): Promise<unknown> {
  const { client, bucket } = config();
  const r = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  return JSON.parse(await r.Body!.transformToString());
}
export async function catalog() {
  if (mockMode()) return parseCatalog(fixture);
  if (cache && cache.until > Date.now()) return cache.value;
  const value = parseCatalog(await readJson("metadata/catalog.json"));
  cache = {
    value,
    until:
      Date.now() +
      boundedInt(process.env.CATALOG_CACHE_TTL_SECONDS, 30, 0, 300) * 1000,
  };
  return value;
}
export function disposition(item: Sermon, download: boolean) {
  const name =
    `${item.serviceDate} ${item.title}`
      .replace(/[\r\n/\\"<>:|?*]/g, "")
      .slice(0, 140) + ".mp3";
  return `${download ? "attachment" : "inline"}; filename="${item.id}.mp3"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`;
}
export async function audioUrl(item: Sermon, download = false) {
  const ttl = boundedInt(process.env.SIGNED_URL_TTL_SECONDS, 14400, 60, 86400);
  if (mockMode())
    return {
      url: `/api/mock-audio?id=${encodeURIComponent(item.id)}${download ? "&download=1" : ""}`,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  const { client, bucket } = config();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: item.objectKey,
      ResponseContentType: "audio/mpeg",
      ResponseContentDisposition: disposition(item, download),
    }),
    { expiresIn: ttl },
  );
  return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
}

import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "../../../../schemas/catalog.schema.json";
export type Sermon = {
  id: string;
  title: string;
  sourceUrl: string;
  broadcastStartedAt: string;
  serviceKind?: "dawn" | "evening" | "sunday";
  serviceDate: string;
  durationSeconds: number;
  sizeBytes: number;
  bitrateKbps: number;
  objectKey: string;
  publishedAt: string;
  audioScope: "full_service";
  availability: "available" | "unavailable";
};
export type Catalog = { schemaVersion: 1; updatedAt: string; items: Sermon[] };
const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);
export function parseCatalog(value: unknown): Catalog {
  if (!validate(value)) throw new Error("Invalid catalog");
  const catalog = value as Catalog;
  if (
    new Set(catalog.items.map((i) => i.id)).size !== catalog.items.length ||
    catalog.items.some(
      (i) =>
        i.objectKey !==
          `audio/${i.serviceDate.slice(0, 4)}/${i.serviceDate.slice(5, 7)}/${i.id}.mp3` ||
        i.sourceUrl !== `https://www.youtube.com/watch?v=${i.id}`,
    )
  )
    throw new Error("Inconsistent catalog");
  return catalog;
}
export function publicItem({ objectKey: _, ...item }: Sermon) {
  return { ...item, serviceKind: item.serviceKind ?? "dawn" };
}

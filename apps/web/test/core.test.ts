import test from "node:test";
import assert from "node:assert/strict";
import { parseCatalog, publicItem } from "../src/lib/catalog";
import { disposition, mockMode } from "../src/lib/storage";
import { resumePosition } from "../src/lib/playback";
import fixture from "../../../fixtures/catalog.json";
test("catalog rejects arbitrary keys, duplicate ids and corrupt records", () => {
  assert.equal(parseCatalog(fixture).items.length, 2);
  const bad = structuredClone(fixture);
  bad.items[0].objectKey = "secret.env";
  assert.throws(() => parseCatalog(bad));
  bad.items[0] = bad.items[1];
  assert.throws(() => parseCatalog(bad));
  assert.throws(() => parseCatalog({ items: [] }));
  assert.equal(
    "objectKey" in publicItem(parseCatalog(fixture).items[0]),
    false,
  );
});
test("download filenames cannot inject headers", () => {
  const item = {
    ...parseCatalog(fixture).items[0],
    title: '말씀\r\nInjected: header/"',
  };
  const header = disposition(item, true);
  assert.equal(/[\r\n]/.test(header), false);
  assert.match(header, /^attachment;/);
  assert.match(header, /filename\*=UTF-8/);
});
test("URL renewal retains position within audio boundaries", () => {
  assert.equal(resumePosition(147, 2400), 147);
  assert.equal(resumePosition(9999, 2400), 2399.9);
  assert.equal(resumePosition(NaN, 2400), 0);
});
test("mock is never enabled by production configuration", () => {
  const previous = process.env.NODE_ENV;
  process.env.MOCK_MODE = "true";
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.throws(() => mockMode());
  Object.assign(process.env, { NODE_ENV: previous });
  delete process.env.MOCK_MODE;
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  makeSession,
  verifySession,
  checkPassword,
  sameOrigin,
} from "../src/lib/auth";
import { parseCatalog, publicItem } from "../src/lib/catalog";
import { disposition, mockMode } from "../src/lib/storage";
import { resumePosition } from "../src/lib/playback";
import fixture from "../../../fixtures/catalog.json";
process.env.AUTH_SESSION_SECRET = "test-only-session-secret-longer-than-32";
process.env.AUTH_PASSWORD = "test-only-password-for-core-tests";
test("sessions reject tampering, expiration and missing cookies", () => {
  const now = Date.now();
  const session = makeSession(now);
  assert.equal(verifySession(session, now), true);
  assert.equal(verifySession(session + "x", now), false);
  assert.equal(verifySession(session, now + 86401000), false);
  assert.equal(verifySession(undefined), false);
  assert.equal(checkPassword(process.env.AUTH_PASSWORD!), true);
  assert.equal(checkPassword("wrong"), false);
});
test("mutations require same origin", () => {
  assert.equal(
    sameOrigin(
      new Request("http://localhost/api/auth", {
        headers: { Origin: "http://evil.test" },
      }),
    ),
    false,
  );
  assert.equal(
    sameOrigin(
      new Request("http://localhost/api/auth", {
        headers: { Origin: "http://localhost" },
      }),
    ),
    true,
  );
});
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

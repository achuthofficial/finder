import assert from "node:assert/strict";
import test from "node:test";
import { buildPitch, whatsappLink } from "../lib/pitch";
import { isProxyableUrl } from "../lib/photoProxy";
import { targetsToCsv } from "../lib/csv";
import type { Business, Target } from "../lib/types";

function business(overrides: Partial<Business> = {}): Business {
  return {
    id: "osm:node/1",
    source: "osm",
    name: "Padaria Central",
    category: "Bakery",
    group: "food",
    lat: 38.7,
    lon: -9.1,
    address: "12 Rua Augusta, Lisboa",
    phone: "+351 213 000 001",
    socials: [],
    presence: "none",
    leadScore: 81,
    sourceUrl: "https://www.openstreetmap.org/node/1",
    hasDetails: false,
    ...overrides,
  };
}

test("the pitch names the business and its trade", () => {
  const text = buildPitch(business(), { senderName: "Ana" });
  assert.match(text, /Hi Padaria Central,/);
  assert.match(text, /bakery/i);
  assert.match(text, /— Ana$/);
});

test("a social-only business gets a different opening from one with no presence", () => {
  const none = buildPitch(business());
  const social = buildPitch(
    business({
      presence: "social-only",
      socials: [{ label: "Instagram", url: "https://instagram.com/padaria" }],
    }),
  );
  assert.notEqual(none.split("\n")[2], social.split("\n")[2]);
  assert.match(social, /Instagram/);
  assert.match(social, /don't have a site of your own/);
});

test("the close asks to confirm the number when there is one", () => {
  assert.match(buildPitch(business()), /\+351 213 000 001/);
  assert.doesNotMatch(buildPitch(business({ phone: undefined })), /best number/);
});

test("an unsigned pitch leaves an obvious placeholder", () => {
  assert.match(buildPitch(business()), /\[your name\]/);
});

test("the WhatsApp link carries the message and strips phone formatting", () => {
  const link = whatsappLink(business(), "Hello there");
  assert.equal(link?.startsWith("https://wa.me/351213000001?text="), true);
  assert.match(link ?? "", /Hello%20there/);
});

test("there is no WhatsApp link without a usable number", () => {
  assert.equal(whatsappLink(business({ phone: undefined }), "hi"), null);
  assert.equal(whatsappLink(business({ phone: "12" }), "hi"), null);
});

test("the photo proxy only accepts the hosts our own data comes from", () => {
  assert.ok(isProxyableUrl("https://upload.wikimedia.org/wikipedia/commons/a/b/Shop.jpg"));
  assert.ok(isProxyableUrl("https://lh3.googleusercontent.com/places/abc"));
  // An open proxy would let anyone probe arbitrary hosts through this deployment.
  assert.equal(isProxyableUrl("https://evil.example.com/x.jpg"), false);
  assert.equal(isProxyableUrl("http://upload.wikimedia.org/x.jpg"), false, "http is refused");
  assert.equal(isProxyableUrl("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(isProxyableUrl("file:///etc/passwd"), false);
  assert.equal(isProxyableUrl("https://upload.wikimedia.org.evil.com/x.jpg"), false);
});

const target: Target = {
  business: business(),
  status: "contacted",
  notes: 'Called Tuesday, ask for "Ana"',
  addedAt: Date.parse("2026-09-18T10:00:00Z"),
};

test("the target sheet exports the columns the freelancer filled in", () => {
  const csv = targetsToCsv([target]);
  const [header, row] = csv.trim().split("\r\n");
  assert.ok(header.includes("status"));
  assert.ok(header.includes("notes"));
  assert.ok(row.includes("contacted"));
  assert.ok(row.includes('Called Tuesday, ask for ""Ana"""'));
  assert.ok(row.includes("2026-09-18T10:00:00.000Z"));
});

test("phone numbers and longitudes survive the formula guard intact", () => {
  const csv = targetsToCsv([target]);
  const row = csv.trim().split("\r\n")[1];
  assert.ok(row.includes('"+351 213 000 001"'), "phone keeps its leading +");
  assert.ok(row.includes('"-9.100000"'), "a western longitude keeps its minus sign");
  assert.ok(!row.includes("'+351"), "no stray apostrophe on the phone");
});

test("actual formulas are still defused", () => {
  const nasty = targetsToCsv([
    { ...target, notes: "=cmd|' /C calc'!A0" },
    { ...target, notes: "@SUM(1:1)" },
    { ...target, notes: "+cmd|' /C calc'!A0" },
  ]);
  assert.ok(nasty.includes(`"'=cmd`));
  assert.ok(nasty.includes(`"'@SUM(1:1)"`));
  assert.ok(nasty.includes(`"'+cmd`));
});

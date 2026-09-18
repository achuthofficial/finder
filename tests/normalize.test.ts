import assert from "node:assert/strict";
import test from "node:test";
import { detectPresence, scoreLead, toBusiness } from "../lib/normalize";

test("a plain website tag counts as a real site", () => {
  const result = detectPresence({ website: "https://cafe-azul.pt" });
  assert.equal(result.presence, "site");
  assert.equal(result.website, "https://cafe-azul.pt/");
  assert.deepEqual(result.socials, []);
});

test("a bare domain is upgraded to https", () => {
  const result = detectPresence({ website: "cafe-azul.pt" });
  assert.equal(result.presence, "site");
  assert.ok(result.website?.startsWith("https://"));
});

test("a Facebook page in the website tag is social-only, not a website", () => {
  const result = detectPresence({ website: "https://www.facebook.com/PadariaCentral" });
  assert.equal(result.presence, "social-only");
  assert.equal(result.website, undefined);
  assert.deepEqual(result.socials.map((s) => s.label), ["Facebook"]);
});

test("a social handle is expanded into a profile URL", () => {
  const result = detectPresence({ "contact:instagram": "@barbearia.lx" });
  assert.equal(result.presence, "social-only");
  assert.equal(result.socials[0].url, "https://instagram.com/barbearia.lx");
});

test("no contact tags at all means no presence", () => {
  assert.equal(detectPresence({}).presence, "none");
});

test("junk in the website tag does not count as a site", () => {
  assert.equal(detectPresence({ website: "n/a" }).presence, "none");
});

test("semicolon-separated tags are all considered", () => {
  const result = detectPresence({
    website: "https://instagram.com/loja;https://loja.pt",
  });
  assert.equal(result.presence, "site");
  assert.equal(result.socials.length, 1);
});

test("lead score ranks no-website above social-only above having a site", () => {
  const base = {
    hasPhone: true,
    hasEmail: false,
    hasAddress: true,
    hasHours: true,
    isChain: false,
  };
  const none = scoreLead({ ...base, presence: "none" });
  const social = scoreLead({ ...base, presence: "social-only" });
  const site = scoreLead({ ...base, presence: "site" });
  assert.ok(none > social, `${none} > ${social}`);
  assert.ok(social > site, `${social} > ${site}`);
});

test("chain outlets are pushed down the list", () => {
  const signals = {
    presence: "none" as const,
    hasPhone: true,
    hasEmail: false,
    hasAddress: true,
    hasHours: true,
  };
  assert.ok(
    scoreLead({ ...signals, isChain: true }) < scoreLead({ ...signals, isChain: false }),
  );
});

test("lead score stays inside 0-100", () => {
  const max = scoreLead({
    presence: "none",
    hasPhone: true,
    hasEmail: true,
    hasAddress: true,
    hasHours: true,
    isChain: false,
  });
  assert.ok(max >= 0 && max <= 100, String(max));
});

test("an unclassifiable feature is not a business", () => {
  assert.equal(toBusiness("node", 1, 0, 0, { name: "Riverside Park", leisure: "park" }), null);
});

test("a shop node becomes a business with the right group and category", () => {
  const business = toBusiness("node", 42, 38.7, -9.1, {
    name: "Padaria Central",
    shop: "bakery",
    phone: "+351 21 000 0000",
    "addr:street": "Rua Augusta",
    "addr:housenumber": "12",
    opening_hours: "Mo-Sa 07:00-19:00",
  });

  assert.ok(business);
  assert.equal(business.id, "osm:node/42");
  assert.equal(business.group, "food");
  assert.equal(business.category, "Bakery");
  assert.equal(business.presence, "none");
  assert.equal(business.address, "12 Rua Augusta");
  assert.equal(business.sourceUrl, "https://www.openstreetmap.org/node/42");
  assert.ok(business.leadScore > 70);
});

test("cuisine enriches the category label", () => {
  const business = toBusiness("way", 7, 1, 1, {
    name: "Trattoria",
    amenity: "restaurant",
    cuisine: "italian;pizza",
  });
  assert.equal(business?.category, "Italian restaurant");
});

test("an unknown shop value still lands in the retail group", () => {
  const business = toBusiness("node", 9, 1, 1, { name: "Odd Bits", shop: "curiosity" });
  assert.equal(business?.group, "retail");
  assert.equal(business?.category, "Curiosity");
});

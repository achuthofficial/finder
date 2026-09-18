import assert from "node:assert/strict";
import test from "node:test";
import { buildQuery, overpassTimeout, selectorsFor } from "../lib/osm";
import { parseGroups, GROUP_IDS } from "../lib/categories";
import { toCsv } from "../lib/csv";
import type { Business } from "../lib/types";

test("the query targets the requested point and radius", () => {
  const query = buildQuery(38.7223, -9.1393, 1200, []);
  assert.match(query, /\(around:1200,38\.722300,-9\.139300\)/);
  assert.match(query, /out tags center 800;/);
});

test("values of one key collapse into a single spatial scan", () => {
  // Written one statement per key=value, a full search was 44 separate
  // `around` scans, which timed out over a dense city at a wide radius.
  const statements = buildQuery(0, 0, 10_000, [])
    .split("\n")
    .filter((line) => line.trim().startsWith("nwr"));

  assert.ok(statements.length <= 10, `expected <= 10 scans, got ${statements.length}`);
  assert.ok(
    statements.some((line) => /\["amenity"~"\^\(.*\|.*\)\$"\]/.test(line)),
    "amenity values should be one alternation",
  );
});

test("a key with a single value stays an equality match", () => {
  assert.ok(selectorsFor(["lodging"]).every((s) => s.includes("tourism")));
  assert.deepEqual(selectorsFor(["professional"]), [
    '["office"]["office"!~"^(no|vacant|disused|abandoned|closed)$"]',
  ]);
});

test("every selector is distinct, so no area is scanned twice", () => {
  const selectors = selectorsFor([]);
  assert.equal(new Set(selectors).size, selectors.length);
});

test("Overpass is told to give up before we do", () => {
  // If its self-declared timeout outlived ours it would keep grinding after
  // we had already abandoned the request.
  assert.ok(overpassTimeout(25_000) < 25);
  assert.equal(overpassTimeout(25_000), 23);
  // And it stays inside Overpass's own sane bounds at the extremes.
  assert.equal(overpassTimeout(4_000), 10);
  assert.equal(overpassTimeout(600_000), 50);
});

test("the declared timeout tracks the budget it is given", () => {
  assert.match(buildQuery(0, 0, 500, [], 30_000), /\[timeout:28\]/);
  assert.match(buildQuery(0, 0, 500, [], 12_000), /\[timeout:10\]/);
});

test("every selector requires a name so unnamed features are skipped", () => {
  const lines = buildQuery(0, 0, 500, []).split("\n").filter((l) => l.startsWith("  nwr"));
  // One scan per tag key, not per value; the count is asserted separately.
  assert.ok(lines.length >= 5, `expected the keys to be covered, got ${lines.length}`);
  assert.ok(lines.every((line) => line.includes('["name"]')));
});

test("a bare-key selector replaces the redundant key=value ones", () => {
  const query = buildQuery(0, 0, 500, ["retail", "food"]);
  // "retail" contributes the bare `shop` selector, which already covers
  // `shop=bakery` and friends from the "food" group.
  assert.ok(query.includes('["shop"]["shop"!~'));
  assert.ok(!query.includes('["shop"="bakery"]'));
  assert.ok(!query.includes('["shop"~'));
  // Non-shop food selectors must survive.
  assert.match(query, /\["amenity"~"\^\([^"]*cafe[^"]*\)\$"\]/);
});

test("filtering to one group shrinks the query", () => {
  assert.ok(buildQuery(0, 0, 500, ["lodging"]).length < buildQuery(0, 0, 500, []).length);
});

test("selecting every group is treated as no filter", () => {
  assert.deepEqual(parseGroups(GROUP_IDS.join(",")), []);
});

test("unknown group names are dropped", () => {
  assert.deepEqual(parseGroups("food,not-a-group"), ["food"]);
});

const sample: Business = {
  id: "osm:node/1",
  source: "osm",
  name: 'The "Corner" Shop',
  category: "Bakery",
  group: "food",
  lat: 1.5,
  lon: -2.25,
  address: "1 High St",
  phone: "+1 555",
  socials: [],
  presence: "none",
  leadScore: 88,
  sourceUrl: "https://www.openstreetmap.org/node/1",
  hasDetails: false,
};

test("CSV quotes embedded quotes and keeps a header row", () => {
  const csv = toCsv([sample]);
  const [header, row] = csv.trim().split("\r\n");
  assert.ok(header.startsWith("name,category,web_presence"));
  assert.ok(row.includes('"The ""Corner"" Shop"'));
});

test("CSV defuses spreadsheet formulas coming from map data", () => {
  const csv = toCsv([{ ...sample, name: "=HYPERLINK(1)" }]);
  assert.ok(csv.includes(`"'=HYPERLINK(1)"`));
});

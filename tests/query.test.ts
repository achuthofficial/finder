import assert from "node:assert/strict";
import test from "node:test";
import { buildQuery } from "../lib/osm";
import { parseGroups, GROUP_IDS } from "../lib/categories";
import { toCsv } from "../lib/csv";
import type { Business } from "../lib/types";

test("the query targets the requested point and radius", () => {
  const query = buildQuery(38.7223, -9.1393, 1200, []);
  assert.match(query, /\[out:json\]\[timeout:45\];/);
  assert.match(query, /\(around:1200,38\.722300,-9\.139300\)/);
  assert.match(query, /out tags center 800;/);
});

test("every selector requires a name so unnamed features are skipped", () => {
  const lines = buildQuery(0, 0, 500, []).split("\n").filter((l) => l.startsWith("  nwr"));
  assert.ok(lines.length > 10);
  assert.ok(lines.every((line) => line.includes('["name"]')));
});

test("a bare-key selector replaces the redundant key=value ones", () => {
  const query = buildQuery(0, 0, 500, ["retail", "food"]);
  // "retail" contributes the bare `shop` selector, which already covers
  // `shop=bakery` and friends from the "food" group.
  assert.ok(query.includes('["shop"]["shop"!~'));
  assert.ok(!query.includes('["shop"="bakery"]'));
  // Non-shop food selectors must survive.
  assert.ok(query.includes('["amenity"="cafe"]'));
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

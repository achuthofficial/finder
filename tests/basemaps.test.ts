import assert from "node:assert/strict";
import test from "node:test";
import { buildBasemaps, needsApiKey } from "../lib/basemaps";

test("no default basemap needs an API key", () => {
  // The whole point: CARTO started answering anonymous requests with an
  // "API key required" tile, and the deployed map went blank.
  for (const basemap of buildBasemaps()) {
    assert.equal(
      needsApiKey(basemap.url),
      false,
      `${basemap.id} points at a keyed provider: ${basemap.url}`,
    );
  }
});

test("the keyed-host check matches subdomains but not lookalikes", () => {
  assert.ok(needsApiKey("https://a.basemaps.cartocdn.com/dark_all/1/1/1.png"));
  assert.ok(needsApiKey("https://api.maptiler.com/maps/streets/1/1/1.png"));
  assert.equal(needsApiKey("https://tile.openstreetmap.org/1/1/1.png"), false);
  assert.equal(needsApiKey("https://cartocdn.com.example.net/1/1/1.png"), false);
  assert.equal(needsApiKey("not a url"), false);
});

test("the three styles are distinct and all carry attribution", () => {
  const basemaps = buildBasemaps();
  assert.deepEqual(
    basemaps.map((b) => b.id),
    ["streets", "satellite", "dark"],
  );
  assert.ok(basemaps.every((b) => b.attribution.trim().length > 0));
});

test("dark reuses the street tiles instead of fetching a second set", () => {
  const [streets, satellite, dark] = buildBasemaps();
  assert.equal(dark.url, streets.url);
  assert.equal(dark.darken, true);
  // Satellite must not be inverted — a negative of aerial imagery is useless.
  assert.notEqual(satellite.url, streets.url);
  assert.ok(!satellite.darken);
});

test("an override redirects the street and dark styles but not satellite", () => {
  const custom = "https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=abc";
  const [streets, satellite, dark] = buildBasemaps({
    tileUrl: custom,
    tileAttribution: "© MapTiler",
  });

  assert.equal(streets.url, custom);
  assert.equal(dark.url, custom);
  assert.equal(streets.attribution, "© MapTiler");
  // Overriding is opting in to a keyed provider deliberately, and that is fine.
  assert.ok(needsApiKey(streets.url));
  assert.ok(!needsApiKey(satellite.url));
});

test("an empty override falls back rather than producing a blank map", () => {
  const blank = buildBasemaps({ tileUrl: "", tileAttribution: "", cartoApiKey: "  " });
  assert.equal(blank.length, 3);
  assert.ok(blank[0].url.includes("tile.openstreetmap.org"));
  assert.ok(blank[0].attribution.includes("OpenStreetMap"));
});

test("a CARTO key switches the street and dark styles to CARTO", () => {
  const [streets, satellite, dark] = buildBasemaps({ cartoApiKey: "test-key-123" });

  assert.ok(streets.url.startsWith("https://basemaps.cartocdn.com/rastertiles/voyager/"));
  assert.ok(streets.url.endsWith("?key=test-key-123"));

  // With CARTO available, dark is a real dark basemap, not inverted tiles.
  assert.ok(dark.url.includes("/dark_all/"));
  assert.ok(!dark.darken, "CARTO dark should not also be CSS-inverted");

  // Satellite stays on Esri; CARTO has no imagery layer here.
  assert.ok(satellite.url.includes("arcgisonline.com"));
});

test("CARTO's attribution requirement is honoured", () => {
  // Their terms require the CARTO and OpenStreetMap credits stay visible.
  const [streets] = buildBasemaps({ cartoApiKey: "test-key-123" });
  assert.match(streets.attribution, /OpenStreetMap/);
  assert.match(streets.attribution, /CARTO/);
});

test("a key with URL-unsafe characters is encoded, not pasted raw", () => {
  const [streets] = buildBasemaps({ cartoApiKey: "a b&c=d" });
  assert.ok(streets.url.endsWith("?key=a%20b%26c%3Dd"));
});

test("an explicit tile URL still beats a CARTO key", () => {
  const custom = "https://tiles.example.com/{z}/{x}/{y}.png";
  const [streets, , dark] = buildBasemaps({ tileUrl: custom, cartoApiKey: "test-key-123" });
  assert.equal(streets.url, custom);
  assert.equal(dark.url, custom);
  assert.equal(dark.darken, true);
});

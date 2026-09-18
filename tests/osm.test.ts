import assert from "node:assert/strict";
import test from "node:test";
import { searchOsm } from "../lib/osm";

/** A trimmed but structurally faithful Overpass response. */
const FIXTURE = {
  elements: [
    {
      type: "node",
      id: 1,
      lat: 38.7101,
      lon: -9.1401,
      tags: {
        name: "Padaria da Esquina",
        shop: "bakery",
        phone: "+351 213 000 001",
        "addr:street": "Rua da Prata",
        "addr:housenumber": "5",
        opening_hours: "Mo-Sa 07:00-20:00",
      },
    },
    {
      type: "way",
      id: 2,
      center: { lat: 38.7105, lon: -9.1409 },
      tags: {
        name: "Barbearia Lisboa",
        shop: "hairdresser",
        "contact:instagram": "barbearia.lisboa",
      },
    },
    {
      type: "node",
      id: 3,
      lat: 38.711,
      lon: -9.141,
      tags: {
        name: "Hotel Baixa",
        tourism: "hotel",
        website: "https://hotelbaixa.example",
      },
    },
    // Same business mapped twice: once as a node, once as the building.
    {
      type: "way",
      id: 4,
      center: { lat: 38.71011, lon: -9.14012 },
      tags: { name: "Padaria da Esquina", shop: "bakery" },
    },
    // No name: not a business we can act on.
    { type: "node", id: 5, lat: 38.712, lon: -9.142, tags: { shop: "kiosk" } },
    // Not a business at all.
    { type: "node", id: 6, lat: 38.713, lon: -9.143, tags: { name: "Bus stop", highway: "bus_stop" } },
    // Missing geometry entirely.
    { type: "relation", id: 7, tags: { name: "Ghost", shop: "books" } },
  ],
};

function stubFetch(payload: unknown, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("an Overpass payload is normalised, deduplicated and ranked", async () => {
  const restore = stubFetch(FIXTURE);
  try {
    // Coordinates are part of the cache key, so each test uses its own point.
    const { businesses } = await searchOsm(38.71, -9.14, 800, []);

    const names = businesses.map((b) => b.name);
    assert.deepEqual(new Set(names), new Set(["Padaria da Esquina", "Barbearia Lisboa", "Hotel Baixa"]));

    // The bakery has no web presence but a phone, address and hours: best lead.
    assert.equal(businesses[0].name, "Padaria da Esquina");
    assert.equal(businesses[0].presence, "none");

    const barber = businesses.find((b) => b.name === "Barbearia Lisboa");
    assert.equal(barber?.presence, "social-only");
    assert.equal(barber?.group, "beauty");
    assert.equal(barber?.lat, 38.7105, "way centres are used as the position");

    const hotel = businesses.find((b) => b.name === "Hotel Baixa");
    assert.equal(hotel?.presence, "site");
    assert.equal(hotel?.group, "lodging");

    // The site-having hotel must rank below both opportunities.
    assert.equal(businesses.at(-1)?.name, "Hotel Baixa");
  } finally {
    restore();
  }
});

test("a busy mirror is retried against the next one before giving up", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({ elements: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const { businesses } = await searchOsm(1.23, 4.56, 500, []);
    assert.equal(calls, 2);
    assert.deepEqual(businesses, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("results are cached so panning back does not re-query", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify(FIXTURE), { status: 200 });
  }) as typeof fetch;

  try {
    await searchOsm(50.1, 8.68, 600, []);
    await searchOsm(50.1, 8.68, 600, []);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("every mirror failing surfaces a readable error", async () => {
  const restore = stubFetch({ error: "boom" }, 503);
  try {
    await assert.rejects(
      () => searchOsm(-33.86, 151.2, 700, []),
      /unavailable/i,
    );
  } finally {
    restore();
  }
});

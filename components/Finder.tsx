"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GROUPS } from "@/lib/categories";
import { downloadCsv } from "@/lib/csv";
import { distanceMetres, formatRadius } from "@/lib/geo";
import type {
  Business,
  CategoryGroup,
  GeocodeResult,
  SearchResponse,
  WebPresence,
} from "@/lib/types";
import ResultCard from "./ResultCard";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="map-pane" />,
});

type PresenceFilter = "all" | WebPresence;
type SortKey = "score" | "distance" | "name";

interface Area {
  lat: number;
  lon: number;
  radius: number;
  label: string;
}

/** Spread across five continents, to make the "anywhere on Earth" claim concrete. */
const EXAMPLES: Area[] = [
  { label: "Lisbon", lat: 38.7223, lon: -9.1393, radius: 1200 },
  { label: "Bengaluru", lat: 12.9716, lon: 77.5946, radius: 1200 },
  { label: "Lagos", lat: 6.4541, lon: 3.3947, radius: 1500 },
  { label: "Mexico City", lat: 19.4326, lon: -99.1332, radius: 1200 },
  { label: "Tokyo", lat: 35.6762, lon: 139.6503, radius: 1000 },
  { label: "Nairobi", lat: -1.2864, lon: 36.8172, radius: 1500 },
];

const DEFAULT_AREA: Area = EXAMPLES[0];

export default function Finder({ googleAvailable }: { googleAvailable: boolean }) {
  const [area, setArea] = useState<Area>(DEFAULT_AREA);
  const [radiusDraft, setRadiusDraft] = useState(DEFAULT_AREA.radius);
  const [source, setSource] = useState<"osm" | "google">("osm");

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  const [activeGroups, setActiveGroups] = useState<Set<CategoryGroup>>(new Set());
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  /** Blocks the first fetch until a shared link (if any) has been restored. */
  const [ready, setReady] = useState(false);

  const requestRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // ------------------------------------------------------------- searching --

  // Restore a shared link before anything is fetched. Doing this in an effect
  // rather than in the initial state keeps the server and client markup
  // identical, so there is nothing for hydration to disagree about.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon) && params.has("lat")) {
      const radius = Number(params.get("r")) || DEFAULT_AREA.radius;
      setArea({ lat, lon, radius, label: "Shared link" });
      setRadiusDraft(radius);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      lat: String(area.lat),
      lon: String(area.lon),
      radius: String(area.radius),
      source,
    });

    fetch(`/api/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Search failed.");
        return payload as SearchResponse;
      })
      .then((payload) => {
        setData(payload);
        setSelectedId(null);
        resultsRef.current?.scrollTo({ top: 0 });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setData(null);
        setError(err instanceof Error ? err.message : "Search failed.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [ready, area.lat, area.lon, area.radius, source]);

  // Keep the URL shareable without pushing history entries on every pan.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams({
      lat: area.lat.toFixed(5),
      lon: area.lon.toFixed(5),
      r: String(area.radius),
    });
    window.history.replaceState(null, "", `?${params}`);
  }, [ready, area]);

  // Commit the radius slider once the user settles on a value.
  useEffect(() => {
    if (radiusDraft === area.radius) return;
    const timer = setTimeout(() => {
      setArea((current) => ({ ...current, radius: radiusDraft }));
    }, 450);
    return () => clearTimeout(timer);
  }, [radiusDraft, area.radius]);

  // --------------------------------------------------------------- geocode --

  useEffect(() => {
    const term = query.trim();
    if (term.length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((payload: { results?: GeocodeResult[] }) => {
          setSuggestions(payload.results ?? []);
          setSuggestionsOpen(true);
        })
        .catch(() => undefined);
    }, 320);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const pickPlace = useCallback((place: GeocodeResult) => {
    setArea({
      lat: place.lat,
      lon: place.lon,
      radius: place.suggestedRadius,
      label: place.label.split(",")[0],
    });
    setRadiusDraft(place.suggestedRadius);
    setQuery(place.label.split(",").slice(0, 2).join(", "));
    setSuggestionsOpen(false);
    setMobileView("list");
  }, []);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("This browser will not share a location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const next = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          radius: 1200,
          label: "Around you",
        };
        setArea(next);
        setRadiusDraft(next.radius);
        setQuery("");
        fetch(`/api/reverse?lat=${next.lat}&lon=${next.lon}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((payload: { label?: string } | null) => {
            if (payload?.label) setQuery(payload.label.split(",").slice(0, 3).join(", "));
          })
          .catch(() => undefined);
      },
      () => {
        setLocating(false);
        setError("Location permission was declined — search for a place instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  const searchArea = useCallback(
    (center: { lat: number; lon: number }, radius: number) => {
      setArea({ ...center, radius, label: "Map area" });
      setRadiusDraft(radius);
    },
    [],
  );

  // -------------------------------------------------------------- filtering --

  const visible = useMemo(() => {
    const all = data?.businesses ?? [];
    const filtered = all.filter((business) => {
      if (activeGroups.size && !activeGroups.has(business.group)) return false;
      if (presenceFilter !== "all" && business.presence !== presenceFilter) return false;
      return true;
    });

    const withDistance = filtered.map((business) => ({
      business,
      distance: distanceMetres(area, business),
    }));

    withDistance.sort((a, b) => {
      if (sortKey === "distance") return a.distance - b.distance;
      if (sortKey === "name") return a.business.name.localeCompare(b.business.name);
      return (
        b.business.leadScore - a.business.leadScore ||
        a.business.name.localeCompare(b.business.name)
      );
    });

    return withDistance;
  }, [data, activeGroups, presenceFilter, sortKey, area]);

  const visibleBusinesses = useMemo(
    () => visible.map((entry) => entry.business),
    [visible],
  );

  const groupCounts = useMemo(() => {
    const counts = new Map<CategoryGroup, number>();
    for (const business of data?.businesses ?? []) {
      counts.set(business.group, (counts.get(business.group) ?? 0) + 1);
    }
    return counts;
  }, [data]);

  const toggleGroup = (id: CategoryGroup) => {
    setActiveGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePresence = (value: PresenceFilter) => {
    setPresenceFilter((current) => (current === value ? "all" : value));
  };

  const stats = data?.stats;

  return (
    <div className="shell">
      <header className="masthead">
        <div className="wordmark">
          <span className="pin" aria-hidden>
            ◎
          </span>
          Finder
        </div>
        <span className="tagline">
          Local businesses anywhere on Earth — flagged by who has no website
        </span>
        <span className="spacer" />
        <div className="source-switch" role="group" aria-label="Data source">
          <button
            type="button"
            aria-pressed={source === "osm"}
            onClick={() => setSource("osm")}
          >
            OpenStreetMap
          </button>
          <button
            type="button"
            aria-pressed={source === "google"}
            disabled={!googleAvailable}
            title={
              googleAvailable
                ? "Use Google Places as the data source"
                : "Set GOOGLE_MAPS_API_KEY on the deployment to enable this"
            }
            onClick={() => setSource("google")}
          >
            Google
          </button>
        </div>
      </header>

      <div className="layout" data-view={mobileView}>
        <aside className="panel">
          <div className="panel-head">
            <div className="search-field">
              <input
                value={query}
                placeholder="Search any town, district or street…"
                aria-label="Search for a place"
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => suggestions.length && setSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && suggestions[0]) pickPlace(suggestions[0]);
                  if (event.key === "Escape") setSuggestionsOpen(false);
                }}
              />
              <button
                type="button"
                className="icon-button"
                onClick={useMyLocation}
                disabled={locating}
                title="Use my location"
                aria-label="Use my location"
              >
                {locating ? "…" : "◉"}
              </button>

              {suggestionsOpen && suggestions.length > 0 && (
                <div className="suggestions">
                  {suggestions.map((place) => (
                    <button
                      key={`${place.lat},${place.lon},${place.label}`}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pickPlace(place)}
                    >
                      {place.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="control-row">
              <label htmlFor="radius">Radius</label>
              <input
                id="radius"
                type="range"
                min={200}
                max={5000}
                step={100}
                value={radiusDraft}
                onChange={(event) => setRadiusDraft(Number(event.target.value))}
              />
              <span style={{ width: 52, textAlign: "right" }}>
                {formatRadius(radiusDraft)}
              </span>
            </div>

            <div className="chips">
              {GROUPS.map((group) => {
                const count = groupCounts.get(group.id) ?? 0;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className="chip"
                    aria-pressed={activeGroups.has(group.id)}
                    disabled={!count}
                    style={{ opacity: count ? 1 : 0.35 }}
                    onClick={() => toggleGroup(group.id)}
                  >
                    {group.emoji} {group.label}
                    {count > 0 && ` ${count}`}
                  </button>
                );
              })}
              {activeGroups.size > 0 && (
                <button
                  type="button"
                  className="chip ghost"
                  onClick={() => setActiveGroups(new Set())}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="stats">
            <button
              type="button"
              className="stat none"
              aria-pressed={presenceFilter === "none"}
              onClick={() => togglePresence("none")}
              style={{ textAlign: "left", background: "transparent", border: 0, borderRight: "1px solid var(--border)" }}
            >
              <div className="value">{stats?.noWebsite ?? "—"}</div>
              <div className="label">No website</div>
            </button>
            <button
              type="button"
              className="stat social"
              aria-pressed={presenceFilter === "social-only"}
              onClick={() => togglePresence("social-only")}
              style={{ textAlign: "left", background: "transparent", border: 0, borderRight: "1px solid var(--border)" }}
            >
              <div className="value">{stats?.socialOnly ?? "—"}</div>
              <div className="label">Social only</div>
            </button>
            <button
              type="button"
              className="stat site"
              aria-pressed={presenceFilter === "site"}
              onClick={() => togglePresence("site")}
              style={{ textAlign: "left", background: "transparent", border: 0 }}
            >
              <div className="value">{stats?.withWebsite ?? "—"}</div>
              <div className="label">Has a site</div>
            </button>
          </div>

          <div className="list-toolbar">
            <span>
              {loading
                ? "Searching…"
                : `${visible.length} shown${
                    presenceFilter !== "all" || activeGroups.size
                      ? ` of ${stats?.total ?? 0}`
                      : ""
                  }`}
            </span>
            <span style={{ flex: 1 }} />
            <select
              value={sortKey}
              aria-label="Sort results"
              onChange={(event) => setSortKey(event.target.value as SortKey)}
            >
              <option value="score">Best leads</option>
              <option value="distance">Nearest</option>
              <option value="name">A–Z</option>
            </select>
            <button
              type="button"
              className="link-button"
              disabled={!visible.length}
              onClick={() =>
                downloadCsv(
                  visibleBusinesses,
                  `finder-${area.label.toLowerCase().replace(/\W+/g, "-")}.csv`,
                )
              }
            >
              Export CSV
            </button>
          </div>

          <div className="results" ref={resultsRef}>
            {error && <div className="notice error">{error}</div>}

            {!error && data?.truncated && (
              <div className="notice">
                Only the first slice of this area is shown. Zoom in or shrink the radius
                for a complete picture.
              </div>
            )}

            {loading &&
              !data &&
              Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="skeleton" />
              ))}

            {!loading && !error && visible.length === 0 && (
              <div className="empty">
                <strong>Nothing here yet</strong>
                {data?.stats.total
                  ? "No business matches these filters. Try clearing a category."
                  : "This area has no mapped businesses. Try a wider radius, or one of these:"}
                {!data?.stats.total && (
                  <div
                    className="chips"
                    style={{ justifyContent: "center", marginTop: 14 }}
                  >
                    {EXAMPLES.map((example) => (
                      <button
                        key={example.label}
                        type="button"
                        className="chip"
                        onClick={() => {
                          setArea(example);
                          setRadiusDraft(example.radius);
                          setQuery(example.label);
                        }}
                      >
                        {example.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {visible.map(({ business, distance }) => (
              <ResultCard
                key={business.id}
                business={business}
                distance={distance}
                selected={business.id === selectedId}
                onSelect={setSelectedId}
              />
            ))}

            {!loading && visible.length > 0 && (
              <div className="empty" style={{ padding: "18px 24px" }}>
                Data from{" "}
                {data?.source === "google" ? "Google Places" : "OpenStreetMap contributors"}
                . A missing website here means nobody has recorded one — always confirm
                before you pitch.
              </div>
            )}
          </div>
        </aside>

        <MapView
          center={{ lat: area.lat, lon: area.lon }}
          radius={area.radius}
          businesses={visibleBusinesses}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setMobileView("list");
          }}
          onSearchArea={searchArea}
        />
      </div>

      <nav className="mobile-tabs">
        <button
          type="button"
          aria-pressed={mobileView === "list"}
          onClick={() => setMobileView("list")}
        >
          List{stats ? ` (${visible.length})` : ""}
        </button>
        <button
          type="button"
          aria-pressed={mobileView === "map"}
          onClick={() => setMobileView("map")}
        >
          Map
        </button>
      </nav>
    </div>
  );
}

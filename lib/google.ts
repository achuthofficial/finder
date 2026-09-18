import { GROUPS } from "./categories";
import { TtlCache, UpstreamError, fetchWithTimeout } from "./http";
import { detectPresence, scoreLead } from "./normalize";
import type { Business, CategoryGroup } from "./types";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
  "places.googleMapsUri",
  "places.regularOpeningHours.weekdayDescriptions",
].join(",");

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

const cache = new TtlCache<Business[]>(10 * 60_000);

async function searchGroup(
  apiKey: string,
  group: (typeof GROUPS)[number],
  lat: number,
  lon: number,
  radius: number,
): Promise<Business[]> {
  const res = await fetchWithTimeout(ENDPOINT, {
    method: "POST",
    timeoutMs: 15_000,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: group.google,
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      locationRestriction: {
        // Nearby Search caps the radius at 50 km.
        circle: {
          center: { latitude: lat, longitude: lon },
          radius: Math.min(radius, 50_000),
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new UpstreamError(
      `Google Places rejected the request (${res.status}). ${detail.slice(0, 200)}`,
      res.status,
    );
  }

  const data = (await res.json()) as { places?: GooglePlace[] };
  const places = data.places ?? [];

  return places.flatMap((place) => toBusiness(place, group.id));
}

function toBusiness(place: GooglePlace, group: CategoryGroup): Business[] {
  const name = place.displayName?.text?.trim();
  if (!name || !place.location) return [];
  if (place.businessStatus === "CLOSED_PERMANENTLY") return [];

  const { presence, website, socials } = detectPresence(
    place.websiteUri ? { website: place.websiteUri } : {},
  );
  const phone = place.nationalPhoneNumber || place.internationalPhoneNumber;

  return [
    {
      id: `google:${place.id}`,
      source: "google",
      name,
      category: place.primaryTypeDisplayName?.text ?? "Business",
      group,
      lat: place.location.latitude,
      lon: place.location.longitude,
      address: place.formattedAddress,
      phone,
      website,
      socials,
      presence,
      openingHours: place.regularOpeningHours?.weekdayDescriptions?.join("; "),
      rating: place.rating,
      reviewCount: place.userRatingCount,
      leadScore: scoreLead({
        presence,
        hasPhone: Boolean(phone),
        hasEmail: false,
        hasAddress: Boolean(place.formattedAddress),
        hasHours: Boolean(place.regularOpeningHours),
        isChain: false,
      }),
      sourceUrl:
        place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${place.id}`,
    },
  ];
}

export async function searchGoogle(
  lat: number,
  lon: number,
  radius: number,
  groups: CategoryGroup[],
): Promise<{ businesses: Business[]; truncated: boolean; notice?: string }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new UpstreamError(
      "Google Places is not configured on this deployment. Set GOOGLE_MAPS_API_KEY, or use the OpenStreetMap source, which needs no key.",
      501,
    );
  }

  const key = [lat.toFixed(3), lon.toFixed(3), Math.round(radius / 100), [...groups].sort().join("|")].join(":");
  const cached = cache.get(key);
  if (cached) return { businesses: cached, truncated: false };

  const wanted = groups.length ? GROUPS.filter((g) => groups.includes(g.id)) : GROUPS;
  const settled = await Promise.allSettled(
    wanted.map((group) => searchGroup(apiKey, group, lat, lon, radius)),
  );

  const failures = settled.filter((r) => r.status === "rejected");
  if (failures.length === settled.length) {
    const first = failures[0] as PromiseRejectedResult;
    throw first.reason;
  }

  const byId = new Map<string, Business>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const business of result.value) {
      // Places can appear under several type groups; keep the first.
      if (!byId.has(business.id)) byId.set(business.id, business);
    }
  }

  const businesses = [...byId.values()].sort(
    (a, b) => b.leadScore - a.leadScore || a.name.localeCompare(b.name),
  );
  cache.set(key, businesses);

  // Nearby Search hard-caps at 20 per type group, so a full bucket means
  // there is almost certainly more out there than we are showing.
  const truncated = settled.some(
    (r) => r.status === "fulfilled" && r.value.length >= 20,
  );
  const notice = failures.length
    ? `${failures.length} of ${settled.length} category queries failed; results are partial.`
    : undefined;

  return { businesses, truncated, notice };
}

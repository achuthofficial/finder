import { GROUPS } from "./categories";
import type { Business, CategoryGroup, WebPresence } from "./types";

/**
 * Hosts that people routinely put in the `website` tag but which are not a
 * website the business controls. Spotting these is the whole point of the app:
 * "they have a Facebook page" is a *stronger* lead than no presence at all.
 */
const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "Facebook",
  "fb.com": "Facebook",
  "fb.me": "Facebook",
  "m.facebook.com": "Facebook",
  "instagram.com": "Instagram",
  "twitter.com": "X",
  "x.com": "X",
  "tiktok.com": "TikTok",
  "linkedin.com": "LinkedIn",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "wa.me": "WhatsApp",
  "api.whatsapp.com": "WhatsApp",
  "t.me": "Telegram",
  "vk.com": "VK",
  "linktr.ee": "Linktree",
  "yelp.com": "Yelp",
  "tripadvisor.com": "Tripadvisor",
};

const SITE_KEYS = [
  "website",
  "contact:website",
  "website:official",
  "url",
  "contact:url",
  "operator:website",
  "brand:website",
];

const SOCIAL_KEYS: { key: string; label: string; base: string }[] = [
  { key: "contact:facebook", label: "Facebook", base: "https://facebook.com/" },
  { key: "facebook", label: "Facebook", base: "https://facebook.com/" },
  { key: "contact:instagram", label: "Instagram", base: "https://instagram.com/" },
  { key: "instagram", label: "Instagram", base: "https://instagram.com/" },
  { key: "contact:twitter", label: "X", base: "https://x.com/" },
  { key: "twitter", label: "X", base: "https://x.com/" },
  { key: "contact:tiktok", label: "TikTok", base: "https://tiktok.com/@" },
  { key: "contact:linkedin", label: "LinkedIn", base: "https://linkedin.com/company/" },
  { key: "contact:youtube", label: "YouTube", base: "https://youtube.com/" },
  { key: "contact:whatsapp", label: "WhatsApp", base: "https://wa.me/" },
  { key: "contact:telegram", label: "Telegram", base: "https://t.me/" },
];

const PHONE_KEYS = ["phone", "contact:phone", "contact:mobile", "mobile", "phone:mobile"];

/** Tag keys that identify the kind of business, in order of specificity. */
const CLASSIFY_KEYS = [
  "shop",
  "craft",
  "healthcare",
  "amenity",
  "office",
  "tourism",
  "leisure",
];

const EXACT_GROUPS = new Map<string, CategoryGroup>();
const BARE_GROUPS = new Map<string, CategoryGroup>();
for (const group of GROUPS) {
  for (const filter of group.osm) {
    if (filter.includes("=")) {
      if (!EXACT_GROUPS.has(filter)) EXACT_GROUPS.set(filter, group.id);
    } else if (!BARE_GROUPS.has(filter)) {
      BARE_GROUPS.set(filter, group.id);
    }
  }
}

export function humanize(value: string): string {
  const cleaned = value.replace(/[_;]+/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 300) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function socialLabelFor(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return SOCIAL_HOSTS[host] ?? null;
  } catch {
    return null;
  }
}

export interface PresenceResult {
  presence: WebPresence;
  website?: string;
  socials: { label: string; url: string }[];
}

/** Split whatever contact tags exist into "a real site" vs "social only". */
export function detectPresence(tags: Record<string, string>): PresenceResult {
  let website: string | undefined;
  const socials: { label: string; url: string }[] = [];
  const seen = new Set<string>();

  const push = (label: string, url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    socials.push({ label, url });
  };

  for (const key of SITE_KEYS) {
    const raw = tags[key];
    if (!raw) continue;
    for (const part of raw.split(";")) {
      const url = normalizeUrl(part);
      if (!url) continue;
      const social = socialLabelFor(url);
      if (social) push(social, url);
      else if (!website) website = url;
    }
  }

  for (const { key, label, base } of SOCIAL_KEYS) {
    const raw = tags[key];
    if (!raw) continue;
    const value = raw.split(";")[0].trim();
    if (!value) continue;
    const url = /^https?:\/\//i.test(value)
      ? normalizeUrl(value)
      : normalizeUrl(base + value.replace(/^@/, ""));
    if (url) push(label, url);
  }

  return {
    presence: website ? "site" : socials.length ? "social-only" : "none",
    website,
    socials,
  };
}

export interface LeadSignals {
  presence: WebPresence;
  hasPhone: boolean;
  hasEmail: boolean;
  hasAddress: boolean;
  hasHours: boolean;
  isChain: boolean;
}

/**
 * A lead score, not a quality score: it answers "how worth contacting is this
 * about building them a site?". No website is the dominant term; being
 * reachable by phone is the next most useful thing, and a chain outlet is
 * worthless as a lead no matter what its own record says.
 */
export function scoreLead(signals: LeadSignals): number {
  let score =
    signals.presence === "none" ? 55 : signals.presence === "social-only" ? 42 : 5;

  if (signals.hasPhone) score += 18;
  if (signals.hasEmail && signals.presence !== "site") score += 6;
  if (signals.hasAddress) score += 8;
  if (signals.hasHours) score += 7;
  if (signals.isChain) score -= 30;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function classify(
  tags: Record<string, string>,
): { group: CategoryGroup; category: string } | null {
  for (const key of CLASSIFY_KEYS) {
    const value = tags[key];
    if (!value) continue;
    const group = EXACT_GROUPS.get(`${key}=${value}`);
    if (group) return { group, category: humanize(value) };
  }
  for (const key of CLASSIFY_KEYS) {
    const value = tags[key];
    if (!value) continue;
    const group = BARE_GROUPS.get(key);
    if (group) return { group, category: humanize(value) };
  }
  return null;
}

function formatAddress(tags: Record<string, string>): string | undefined {
  if (tags["addr:full"]) return tags["addr:full"];
  const street = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const locality = [tags["addr:postcode"], tags["addr:city"] || tags["addr:suburb"]]
    .filter(Boolean)
    .join(" ");
  const parts = [street, locality, tags["addr:country"]].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function firstOf(tags: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = tags[key]?.split(";")[0].trim();
    if (value) return value;
  }
  return undefined;
}

export function toBusiness(
  type: "node" | "way" | "relation",
  id: number,
  lat: number,
  lon: number,
  tags: Record<string, string>,
): Business | null {
  const classified = classify(tags);
  if (!classified) return null;

  const { presence, website, socials } = detectPresence(tags);
  const phone = firstOf(tags, PHONE_KEYS);
  const email = firstOf(tags, ["email", "contact:email"]);
  const address = formatAddress(tags);
  const isChain = Boolean(tags.brand || tags["brand:wikidata"]);
  // OSM has no reviews, and photos only exist when the record links out to
  // Wikimedia — so only offer the details view when there is something to show.
  const hasDetails = Boolean(
    tags.image || tags.wikimedia_commons || tags.wikidata || tags["brand:wikidata"],
  );

  let category = classified.category;
  const cuisine = tags.cuisine?.split(";")[0];
  if (cuisine && ["Restaurant", "Fast food", "Cafe"].includes(category)) {
    category = `${humanize(cuisine)} ${category.toLowerCase()}`;
  }

  return {
    id: `osm:${type}/${id}`,
    source: "osm",
    name: tags.name.trim(),
    category,
    group: classified.group,
    lat,
    lon,
    address,
    phone,
    website,
    socials,
    presence,
    openingHours: tags.opening_hours,
    leadScore: scoreLead({
      presence,
      hasPhone: Boolean(phone),
      hasEmail: Boolean(email),
      hasAddress: Boolean(address),
      hasHours: Boolean(tags.opening_hours),
      isChain,
    }),
    sourceUrl: `https://www.openstreetmap.org/${type}/${id}`,
    hasDetails,
  };
}

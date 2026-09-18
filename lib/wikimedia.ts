import { TtlCache, fetchWithTimeout } from "./http";
import type { Photo } from "./types";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

interface ImageInfo {
  thumburl?: string;
  url?: string;
  thumbwidth?: number;
  thumbheight?: number;
  extmetadata?: Record<string, { value?: string }>;
}

const cache = new TtlCache<Photo[]>(60 * 60_000, 200);

function proxied(url: string): string {
  return `/api/photo?src=${encodeURIComponent(url)}`;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

/** `image=...` tags hold anything from a direct URL to a Commons file page. */
function fileTitleFrom(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const pageMatch = /(?:commons\.wikimedia\.org|commons\.m\.wikimedia\.org)\/wiki\/(File:[^?#]+)/i.exec(
    value,
  );
  if (pageMatch) return decodeURIComponent(pageMatch[1]);

  if (/^file:/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return null;
  return null;
}

async function commonsPhotos(titles: string[]): Promise<Photo[]> {
  if (!titles.length) return [];

  const url = `${COMMONS_API}?${new URLSearchParams({
    action: "query",
    titles: titles.join("|"),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1200",
    format: "json",
    formatversion: "2",
    origin: "*",
  })}`;

  const res = await fetchWithTimeout(url, { timeoutMs: 12_000 });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    query?: { pages?: { title?: string; imageinfo?: ImageInfo[] }[] };
  };

  const photos: Photo[] = [];
  for (const page of data.query?.pages ?? []) {
    const info = page.imageinfo?.[0];
    const src = info?.thumburl ?? info?.url;
    if (!src) continue;

    const meta = info?.extmetadata ?? {};
    photos.push({
      url: src,
      proxyUrl: proxied(src),
      width: info?.thumbwidth,
      height: info?.thumbheight,
      attribution: stripHtml(meta.Artist?.value ?? "Wikimedia Commons"),
      licence: stripHtml(meta.LicenseShortName?.value ?? "See Commons"),
    });
  }
  return photos;
}

/** Wikidata P18 ("image") points at a Commons file for a lot of named places. */
async function wikidataImageTitles(entities: string[]): Promise<string[]> {
  if (!entities.length) return [];

  const url = `${WIKIDATA_API}?${new URLSearchParams({
    action: "wbgetentities",
    ids: entities.join("|"),
    props: "claims",
    format: "json",
    formatversion: "2",
    origin: "*",
  })}`;

  const res = await fetchWithTimeout(url, { timeoutMs: 12_000 });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    entities?: Record<
      string,
      { claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] } }
    >;
  };

  const titles: string[] = [];
  for (const entity of Object.values(data.entities ?? {})) {
    for (const claim of entity.claims?.P18 ?? []) {
      const file = claim.mainsnak?.datavalue?.value;
      if (typeof file === "string") titles.push(`File:${file}`);
    }
  }
  return titles;
}

/**
 * Resolve whatever image references an OSM record carries into displayable
 * photos. Coverage is thin for small businesses — that is a property of the
 * data, not a bug, and the caller says so in the UI.
 */
export async function photosForTags(tags: Record<string, string>): Promise<Photo[]> {
  const key = ["image", "wikimedia_commons", "wikidata", "brand:wikidata"]
    .map((k) => tags[k] ?? "")
    .join("|");
  if (!key.replace(/\|/g, "")) return [];

  const cached = cache.get(key);
  if (cached) return cached;

  const titles = new Set<string>();
  const direct: Photo[] = [];

  for (const raw of [tags.image, tags.wikimedia_commons]) {
    if (!raw) continue;
    for (const part of raw.split(";")) {
      const title = fileTitleFrom(part);
      if (title) {
        titles.add(title);
      } else if (/^https?:\/\//i.test(part.trim())) {
        const url = part.trim();
        direct.push({ url, proxyUrl: proxied(url), attribution: "From the OpenStreetMap record" });
      }
    }
  }

  const entities = [tags.wikidata, tags["brand:wikidata"]]
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => v.split(";").map((s) => s.trim()))
    .filter((v) => /^Q\d+$/.test(v));

  for (const title of await wikidataImageTitles(entities)) titles.add(title);

  const photos = [...direct, ...(await commonsPhotos([...titles].slice(0, 8)))];
  cache.set(key, photos);
  return photos;
}

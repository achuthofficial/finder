const CONTACT = process.env.OSM_CONTACT || "https://github.com/achuthofficial/finder";

/**
 * OSM's usage policy asks for an identifying User-Agent with a way to reach the
 * operator. Every outbound call goes through here so that stays true.
 */
export const USER_AGENT = `finder/0.1 (+${CONTACT})`;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en",
        ...(rest.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface Entry<T> {
  value: T;
  expires: number;
}

/**
 * Tiny in-process TTL cache. It only lives for the life of one serverless
 * instance, which is exactly what we want: it absorbs the repeated
 * "pan the map back and forth" queries without pretending to be a datastore
 * (and without storing provider data long-term, which Google's terms forbid).
 */
export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries = 60,
  ) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency for the LRU eviction below.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Per-instance token bucket. It is not a distributed rate limiter and does not
 * try to be — its job is to stop one open tab from hammering the free
 * OpenStreetMap infrastructure that this deployment depends on.
 */
export function allow(key: string, capacity = 12, refillPerSecond = 0.5): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, updated: now };

  const elapsed = (now - bucket.updated) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSecond);
  bucket.updated = now;

  if (buckets.size > 5000) buckets.clear();

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() || "anonymous";
}

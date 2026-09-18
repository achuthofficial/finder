import { fetchWithTimeout } from "@/lib/http";
import { MAX_PHOTO_BYTES, isProxyableUrl } from "@/lib/photoProxy";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

function fail(message: string, status: number) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain" } });
}

/**
 * Streams a photo through our own origin. Two reasons this exists rather than
 * pointing <img> straight at the source: Google's photo media endpoint needs
 * the API key (which must never reach the browser), and same-origin bytes are
 * what makes the images embeddable in the generated PDF without tainting a
 * canvas.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const googlePhoto = params.get("g");
  const src = params.get("src");

  if (!allow(`photo:${clientKey(request)}`, 60, 6)) {
    return fail("Too many image requests.", 429);
  }

  let target: string;

  if (googlePhoto) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return fail("Google Places is not configured.", 501);
    // Only ever a photo resource name returned by our own details call.
    if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(googlePhoto)) {
      return fail("Not a valid photo reference.", 400);
    }
    target = `https://places.googleapis.com/v1/${googlePhoto}/media?maxHeightPx=1200&key=${apiKey}`;
  } else if (src && isProxyableUrl(src)) {
    target = src;
  } else {
    return fail("That image host is not allowed.", 400);
  }

  const upstream = await fetchWithTimeout(target, { timeoutMs: 20_000 });
  if (!upstream.ok || !upstream.body) {
    return fail("Could not fetch that image.", 502);
  }

  const type = upstream.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return fail("That URL is not an image.", 415);

  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > MAX_PHOTO_BYTES) return fail("That image is too large.", 413);

  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

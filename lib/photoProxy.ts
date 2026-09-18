/**
 * Hosts the image proxy is allowed to fetch from.
 *
 * An open proxy would let anyone use this deployment to probe arbitrary hosts,
 * so the allowlist — rather than blocklisting private ranges — is the security
 * boundary. It covers the two places our photos actually come from.
 */
const ALLOWED_HOSTS = [
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "maps.wikimedia.org",
];

const ALLOWED_SUFFIXES = [".googleusercontent.com", ".ggpht.com"];

export function isProxyableUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      ALLOWED_HOSTS.includes(host) ||
      ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

/** 8 MB is far above any thumbnail we request and far below a memory problem. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

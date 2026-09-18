import type { Business } from "./types";

function firstName(business: Business): string {
  // "Padaria Central, Lda." → "Padaria Central"
  return business.name.replace(/,.*$/, "").trim();
}

function locality(business: Business): string {
  if (!business.address) return "the area";
  const parts = business.address.split(",").map((p) => p.trim());
  return parts.length > 1 ? parts[parts.length - 1].replace(/^\d+\s*/, "") : "the area";
}

export interface PitchOptions {
  /** How the freelancer signs off. */
  senderName?: string;
}

/**
 * A first-contact message, tailored to what we actually know about the
 * business. The two cases differ in kind: a shop with a Facebook page needs a
 * different opening line from one with no presence at all, and pretending
 * otherwise is what makes outreach read as spam.
 */
export function buildPitch(business: Business, options: PitchOptions = {}): string {
  const name = firstName(business);
  const sign = options.senderName?.trim() || "[your name]";
  const type = business.category.toLowerCase();

  const opening =
    business.presence === "social-only"
      ? `I came across ${name} on ${business.socials[0]?.label ?? "social media"} and noticed you're reaching customers there, but don't have a site of your own yet.`
      : `I was looking at ${type}s in ${locality(business)} and noticed ${name} doesn't seem to have a website yet.`;

  const middle =
    business.presence === "social-only"
      ? `A simple site would give you somewhere you own — one that shows up in search, keeps your opening hours and contact details in one place, and doesn't disappear if an account gets locked.`
      : `A simple site would mean people searching for "${type} near me" can find your hours, your address and a way to get in touch, instead of scrolling past you.`;

  const close = business.phone
    ? `If it's useful, I can put together a one-page mock-up showing what it could look like — no cost, no obligation. Is ${business.phone} the best number to reach you?`
    : `If it's useful, I can put together a one-page mock-up showing what it could look like — no cost, no obligation. Just reply here and I'll send it over.`;

  return [`Hi ${name},`, "", opening, "", middle, "", close, "", `— ${sign}`].join("\n");
}

/** A WhatsApp deep link, since that is how most small businesses actually reply. */
export function whatsappLink(business: Business, message: string): string | null {
  if (!business.phone) return null;
  const digits = business.phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.length < 7) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

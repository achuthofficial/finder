"use client";

import { useCallback, useEffect, useState } from "react";
import { downloadBlob } from "@/lib/pdf";
import { buildPitch, whatsappLink } from "@/lib/pitch";
import type { Business, PlaceDetails } from "@/lib/types";

const PRESENCE_BADGE: Record<Business["presence"], { className: string; label: string }> = {
  none: { className: "badge none", label: "No website" },
  "social-only": { className: "badge social", label: "Social only" },
  site: { className: "badge site", label: "Has a website" },
};

export interface StoreDetailProps {
  business: Business;
  isTarget: boolean;
  senderName: string;
  onSenderName: (value: string) => void;
  onToggleTarget: (business: Business) => void;
  onClose: () => void;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "store";
}

export default function StoreDetail({
  business,
  isTarget,
  senderName,
  onSenderName,
  onToggleTarget,
  onClose,
}: StoreDetailProps) {
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pitch, setPitch] = useState(() => buildPitch(business, { senderName }));
  const [copied, setCopied] = useState(false);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    setPitch(buildPitch(business, { senderName }));
  }, [business, senderName]);

  useEffect(() => {
    setDetails(null);
    setError(null);

    if (!business.hasDetails) return;

    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/place?id=${encodeURIComponent(business.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load details.");
        return payload as PlaceDetails;
      })
      .then(setDetails)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load details.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [business]);

  const copyPitch = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pitch);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [pitch]);

  const downloadPhoto = useCallback(
    async (url: string, index: number) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const blob = await response.blob();
        const extension = (blob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
        downloadBlob(blob, `${slug(business.name)}-${index + 1}.${extension}`);
      } catch {
        // Nothing useful to say: the image simply stays where it is.
      }
    },
    [business.name],
  );

  const downloadBrief = useCallback(async () => {
    setBuilding(true);
    try {
      const { buildProspectPdf } = await import("@/lib/pdf");
      const blob = await buildProspectPdf([
        { business, status: "new", notes: "", addedAt: Date.now() },
      ]);
      downloadBlob(blob, `${slug(business.name)}-brief.pdf`);
    } finally {
      setBuilding(false);
    }
  }, [business]);

  const badge = PRESENCE_BADGE[business.presence];
  const whatsapp = whatsappLink(business, pitch);

  return (
    <aside className="drawer" aria-label={`Details for ${business.name}`}>
      <header className="drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="drawer-title">{business.name}</div>
          <div className="drawer-sub">
            {business.category}
            {details?.rating != null &&
              ` · ★ ${details.rating.toFixed(1)} (${details.reviewCount ?? 0})`}
          </div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="drawer-body">
        <div className="badges" style={{ marginTop: 0 }}>
          <span className={badge.className}>{badge.label}</span>
          <span className="badge plain">Lead score {business.leadScore}</span>
          {business.socials.map((social) => (
            <a
              key={social.url}
              className="badge plain"
              href={social.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {social.label} ↗
            </a>
          ))}
        </div>

        <div className="drawer-actions">
          <button
            type="button"
            className={isTarget ? "button-primary" : "button-ghost"}
            onClick={() => onToggleTarget(business)}
          >
            {isTarget ? "✓ In target list" : "+ Add to targets"}
          </button>
          {business.phone && <a className="button-ghost" href={`tel:${business.phone.replace(/\s+/g, "")}`}>Call</a>}
          {whatsapp && (
            <a className="button-ghost" href={whatsapp} target="_blank" rel="noreferrer noopener">
              WhatsApp
            </a>
          )}
          <button type="button" className="button-ghost" onClick={downloadBrief} disabled={building}>
            {building ? "Building PDF…" : "Download PDF brief"}
          </button>
        </div>

        <section className="drawer-section">
          <h3>Contact</h3>
          <dl className="facts">
            {business.phone && (
              <>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:${business.phone.replace(/\s+/g, "")}`}>{business.phone}</a>
                </dd>
              </>
            )}
            {business.address && (
              <>
                <dt>Address</dt>
                <dd>{business.address}</dd>
              </>
            )}
            {business.openingHours && (
              <>
                <dt>Hours</dt>
                <dd>{business.openingHours}</dd>
              </>
            )}
            {business.website && (
              <>
                <dt>Website</dt>
                <dd>
                  <a href={business.website} target="_blank" rel="noreferrer noopener">
                    {business.website.replace(/^https?:\/\//, "")}
                  </a>
                </dd>
              </>
            )}
            <dt>Source</dt>
            <dd>
              <a href={business.sourceUrl} target="_blank" rel="noreferrer noopener">
                {business.source === "osm" ? "OpenStreetMap record" : "Google Maps listing"}
              </a>
            </dd>
          </dl>
        </section>

        <section className="drawer-section">
          <h3>Photos</h3>
          {loading && <div className="muted-note">Loading photos…</div>}
          {error && <div className="notice error">{error}</div>}
          {!loading && !error && (details?.photos.length ? (
            <>
              <div className="photo-grid">
                {details.photos.map((photo, index) => (
                  <figure key={photo.proxyUrl} className="photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.proxyUrl} alt={`${business.name} ${index + 1}`} loading="lazy" />
                    <figcaption>
                      <span>{photo.attribution}</span>
                      <button type="button" onClick={() => downloadPhoto(photo.proxyUrl, index)}>
                        Download
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
              <p className="muted-note">
                Photos stay with their original licence — {details.photos[0]?.licence ?? "check the source"}. Check before reusing them in a pitch.
              </p>
            </>
          ) : (
            <div className="muted-note">
              {details?.notes.photos ??
                (business.hasDetails
                  ? "No photos found for this business."
                  : "No photo is linked from this record. OpenStreetMap only carries photos for businesses someone has linked to Wikimedia, which is rare for small shops.")}
            </div>
          ))}
        </section>

        <section className="drawer-section">
          <h3>Reviews</h3>
          {loading && <div className="muted-note">Loading reviews…</div>}
          {!loading && (details?.reviews.length ? (
            <ul className="reviews">
              {details.reviews.map((review, index) => (
                <li key={`${review.author}-${index}`}>
                  <div className="review-head">
                    <span className="stars" aria-label={`${review.rating} out of 5`}>
                      {"★".repeat(Math.round(review.rating)).padEnd(5, "☆")}
                    </span>
                    <span className="review-author">{review.author}</span>
                    {review.relativeTime && <span className="muted-note">{review.relativeTime}</span>}
                  </div>
                  <p>{review.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted-note">
              {details?.notes.reviews ??
                "OpenStreetMap does not hold ratings or reviews — nobody writes them there. Add a Google Places key to this deployment to see them."}
            </div>
          ))}
        </section>

        <section className="drawer-section">
          <h3>First message</h3>
          <label className="field-row">
            <span>Sign off as</span>
            <input
              value={senderName}
              placeholder="your name"
              onChange={(event) => onSenderName(event.target.value)}
            />
          </label>
          <textarea
            className="pitch"
            value={pitch}
            rows={12}
            onChange={(event) => setPitch(event.target.value)}
          />
          <div className="drawer-actions">
            <button type="button" className="button-ghost" onClick={copyPitch}>
              {copied ? "Copied" : "Copy message"}
            </button>
            {whatsapp && (
              <a className="button-ghost" href={whatsapp} target="_blank" rel="noreferrer noopener">
                Send on WhatsApp
              </a>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

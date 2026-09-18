"use client";

import { useState } from "react";
import { groupEmoji } from "@/lib/categories";
import { formatDistance } from "@/lib/geo";
import type { Business } from "@/lib/types";

const PRESENCE_BADGE: Record<Business["presence"], { className: string; label: string }> = {
  none: { className: "badge none", label: "No website" },
  "social-only": { className: "badge social", label: "Social only" },
  site: { className: "badge site", label: "Has a website" },
};

export interface ResultCardProps {
  business: Business;
  selected: boolean;
  distance?: number;
  onSelect: (id: string | null) => void;
}

export default function ResultCard({
  business,
  selected,
  distance,
  onSelect,
}: ResultCardProps) {
  const [copied, setCopied] = useState(false);
  const badge = PRESENCE_BADGE[business.presence];

  const copyDetails = async () => {
    const lines = [
      business.name,
      business.category,
      business.address,
      business.phone,
      business.website ?? business.socials[0]?.url,
      business.sourceUrl,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="result"
      data-selected={selected}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(selected ? null : business.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(selected ? null : business.id);
        }
      }}
    >
      <div className="result-top">
        <span className="result-name">{business.name}</span>
        <span className="score" title="Lead score: how worth contacting this business is">
          {business.leadScore}
        </span>
      </div>

      <div className="result-meta">
        {groupEmoji(business.group)} {business.category}
        {distance != null && ` · ${formatDistance(distance)} away`}
        {business.rating != null && ` · ★ ${business.rating.toFixed(1)}`}
      </div>

      <div className="badges">
        <span className={badge.className}>{badge.label}</span>
        {business.phone && <span className="badge plain">📞 Phone</span>}
        {business.socials.map((social) => (
          <span key={social.url} className="badge plain">
            {social.label}
          </span>
        ))}
      </div>

      {selected && (
        <div className="detail" onClick={(event) => event.stopPropagation()}>
          {business.address && (
            <div className="row">
              <span className="key">Address</span>
              <span className="val">{business.address}</span>
            </div>
          )}
          {business.phone && (
            <div className="row">
              <span className="key">Phone</span>
              <span className="val">
                <a href={`tel:${business.phone.replace(/\s+/g, "")}`}>{business.phone}</a>
              </span>
            </div>
          )}
          {business.openingHours && (
            <div className="row">
              <span className="key">Hours</span>
              <span className="val">{business.openingHours}</span>
            </div>
          )}
          {business.website && (
            <div className="row">
              <span className="key">Website</span>
              <span className="val">
                <a href={business.website} target="_blank" rel="noreferrer noopener">
                  {business.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              </span>
            </div>
          )}
          {business.socials.length > 0 && (
            <div className="row">
              <span className="key">Social</span>
              <span className="val">
                {business.socials.map((social, index) => (
                  <span key={social.url}>
                    {index > 0 && " · "}
                    <a href={social.url} target="_blank" rel="noreferrer noopener">
                      {social.label}
                    </a>
                  </span>
                ))}
              </span>
            </div>
          )}

          <div className="actions">
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(
                `${business.name} ${business.address ?? ""}`.trim(),
              )}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Double-check on Google
            </a>
            <a href={business.sourceUrl} target="_blank" rel="noreferrer noopener">
              {business.source === "osm" ? "OpenStreetMap record" : "Google Maps"}
            </a>
            <button type="button" onClick={copyDetails}>
              {copied ? "Copied" : "Copy details"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

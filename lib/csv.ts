import type { Business, Target } from "./types";

const COLUMNS: { header: string; value: (b: Business) => string }[] = [
  { header: "name", value: (b) => b.name },
  { header: "category", value: (b) => b.category },
  { header: "web_presence", value: (b) => b.presence },
  { header: "website", value: (b) => b.website ?? "" },
  { header: "socials", value: (b) => b.socials.map((s) => s.url).join(" | ") },
  { header: "phone", value: (b) => b.phone ?? "" },
  { header: "address", value: (b) => b.address ?? "" },
  { header: "opening_hours", value: (b) => b.openingHours ?? "" },
  { header: "rating", value: (b) => (b.rating != null ? String(b.rating) : "") },
  { header: "reviews", value: (b) => (b.reviewCount != null ? String(b.reviewCount) : "") },
  { header: "lead_score", value: (b) => String(b.leadScore) },
  { header: "latitude", value: (b) => b.lat.toFixed(6) },
  { header: "longitude", value: (b) => b.lon.toFixed(6) },
  { header: "source", value: (b) => b.source },
  { header: "source_url", value: (b) => b.sourceUrl },
];

/** `+351 21 000` and `-9.144` start with formula characters but are just data. */
const NUMERIC_OR_PHONE = /^[+-][\d\s().\-]*$/;

function isFormula(value: string): boolean {
  if (/^[=@\t\r]/.test(value)) return true;
  return /^[+-]/.test(value) && !NUMERIC_OR_PHONE.test(value);
}

function escapeCell(value: string): string {
  // Guard against spreadsheet formula injection from user-generated map data,
  // without mangling the phone numbers and longitudes that are the point of
  // the export.
  const safe = isFormula(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(businesses: Business[]): string {
  const rows = [
    COLUMNS.map((c) => c.header).join(","),
    ...businesses.map((b) => COLUMNS.map((c) => escapeCell(c.value(b))).join(",")),
  ];
  return `${rows.join("\r\n")}\r\n`;
}

export function downloadCsv(businesses: Business[], filename: string): void {
  const blob = new Blob([toCsv(businesses)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const TARGET_COLUMNS: { header: string; value: (t: Target) => string }[] = [
  { header: "name", value: (t) => t.business.name },
  { header: "category", value: (t) => t.business.category },
  { header: "web_presence", value: (t) => t.business.presence },
  { header: "phone", value: (t) => t.business.phone ?? "" },
  { header: "address", value: (t) => t.business.address ?? "" },
  { header: "status", value: (t) => t.status },
  { header: "notes", value: (t) => t.notes },
  { header: "lead_score", value: (t) => String(t.business.leadScore) },
  { header: "website", value: (t) => t.business.website ?? "" },
  { header: "socials", value: (t) => t.business.socials.map((s) => s.url).join(" | ") },
  { header: "opening_hours", value: (t) => t.business.openingHours ?? "" },
  { header: "latitude", value: (t) => t.business.lat.toFixed(6) },
  { header: "longitude", value: (t) => t.business.lon.toFixed(6) },
  { header: "added_at", value: (t) => new Date(t.addedAt).toISOString() },
  { header: "source_url", value: (t) => t.business.sourceUrl },
];

/** The target sheet, including the columns the freelancer filled in themselves. */
export function targetsToCsv(targets: Target[]): string {
  const rows = [
    TARGET_COLUMNS.map((c) => c.header).join(","),
    ...targets.map((t) => TARGET_COLUMNS.map((c) => escapeCell(c.value(t))).join(",")),
  ];
  return `${rows.join("\r\n")}\r\n`;
}

export function downloadTargetsCsv(targets: Target[], filename: string): void {
  const blob = new Blob([targetsToCsv(targets)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

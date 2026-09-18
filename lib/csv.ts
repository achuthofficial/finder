import type { Business } from "./types";

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

function escapeCell(value: string): string {
  // Guard against spreadsheet formula injection from user-generated map data.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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

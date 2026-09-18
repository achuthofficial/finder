import type { Business, PlaceDetails, Target } from "./types";
import { buildPitch } from "./pitch";

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT = PAGE.width - MARGIN * 2;

const INK = { r: 20, g: 26, b: 35 };
const MUTED = { r: 110, g: 122, b: 136 };
const BRAND = { r: 79, g: 140, b: 255 };
const PRESENCE_COLOUR: Record<Business["presence"], [number, number, number]> = {
  none: [224, 53, 43],
  "social-only": [185, 118, 10],
  site: [22, 130, 75],
};
const PRESENCE_LABEL: Record<Business["presence"], string> = {
  none: "NO WEBSITE",
  "social-only": "SOCIAL ONLY",
  site: "HAS A WEBSITE",
};

type Doc = import("jspdf").jsPDF;

const NON_LATIN1 = /[^\x00-\xFF]/;

/** Breathing room inside a canvas-rendered run, so JPEG edges do not clip glyphs. */
const CANVAS_PADDING = 3;

/**
 * jsPDF's built-in fonts are WinAnsi-only, so a shop with a Japanese or Arabic
 * name would come out as mojibake. Rather than ship a multi-megabyte Unicode
 * font, text that falls outside Latin-1 is rendered through a canvas and placed
 * as an image, using the fonts the browser already has.
 */
function isLatin1(text: string): boolean {
  return !NON_LATIN1.test(text);
}

interface TextStyle {
  size?: number;
  bold?: boolean;
  colour?: { r: number; g: number; b: number };
  lineHeight?: number;
}

/**
 * Rendering onto an opaque background and exporting JPEG matters more than it
 * looks: a transparent PNG makes jsPDF emit a full RGB bitmap *plus* a
 * greyscale soft mask, and a page of text that way runs to megabytes.
 */
function fontFor(style: Required<TextStyle>): string {
  return `${style.bold ? "600 " : ""}${style.size}px ui-sans-serif, system-ui, sans-serif`;
}

interface Layout {
  lines: string[];
  /** Width actually occupied, so short runs are not stored full-column-wide. */
  used: number;
  height: number;
}

function layoutOnCanvas(
  text: string,
  width: number,
  style: Required<TextStyle>,
): Layout | null {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = fontFor(style);

  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure.measureText(candidate).width > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }

  const used = Math.min(
    width,
    Math.max(8, ...lines.map((line) => measure.measureText(line).width)) + CANVAS_PADDING * 2,
  );

  return { lines, used, height: lines.length * style.size * style.lineHeight };
}

function canvasParagraph(
  text: string,
  width: number,
  style: Required<TextStyle>,
  background: [number, number, number],
): { dataUrl: string; width: number; height: number } | null {
  const scale = 2;
  const layout = layoutOnCanvas(text, width, style);
  if (!layout) return null;

  const { lines, used, height } = layout;
  const lineHeight = style.size * style.lineHeight;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(used * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.fillStyle = `rgb(${background[0]},${background[1]},${background[2]})`;
  ctx.fillRect(0, 0, used, height);
  ctx.font = fontFor(style);
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgb(${style.colour.r},${style.colour.g},${style.colour.b})`;
  lines.forEach((line, index) =>
    ctx.fillText(line, CANVAS_PADDING, index * lineHeight),
  );

  // PNG rather than JPEG: text on a flat background compresses well under
  // Flate and, unlike JPEG, leaves no ringing along the image edges.
  return { dataUrl: canvas.toDataURL("image/png"), width: used, height };
}

function resolveStyle(style: TextStyle): Required<TextStyle> {
  return {
    size: style.size ?? 10,
    bold: style.bold ?? false,
    colour: style.colour ?? INK,
    lineHeight: style.lineHeight ?? 1.35,
  };
}

/** The height `drawText` will occupy, without drawing anything. */
function measureText(doc: Doc, text: string, width: number, style: TextStyle = {}): number {
  if (!text.trim()) return 0;
  const resolved = resolveStyle(style);
  const lineHeight = resolved.size * resolved.lineHeight;

  if (isLatin1(text)) {
    doc.setFont("helvetica", resolved.bold ? "bold" : "normal");
    doc.setFontSize(resolved.size);
    return (doc.splitTextToSize(text, width) as string[]).length * lineHeight;
  }
  return layoutOnCanvas(text, width, resolved)?.height ?? 0;
}

const PAGE_BACKGROUND: [number, number, number] = [255, 255, 255];
const PITCH_BACKGROUND: [number, number, number] = [244, 246, 249];

/** Draw a run of text and return the y position just below it. */
function drawText(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  style: TextStyle = {},
  background: [number, number, number] = PAGE_BACKGROUND,
): number {
  if (!text.trim()) return y;
  const resolved = resolveStyle(style);

  if (isLatin1(text)) {
    doc.setFont("helvetica", resolved.bold ? "bold" : "normal");
    doc.setFontSize(resolved.size);
    doc.setTextColor(resolved.colour.r, resolved.colour.g, resolved.colour.b);
    const lines = doc.splitTextToSize(text, width) as string[];
    const lineHeight = resolved.size * resolved.lineHeight;
    lines.forEach((line, index) =>
      doc.text(line, x, y + resolved.size + index * lineHeight),
    );
    return y + lines.length * lineHeight;
  }

  const rendered = canvasParagraph(text, width, resolved, background);
  if (!rendered) return y;
  doc.addImage(rendered.dataUrl, "PNG", x, y, rendered.width, rendered.height);
  return y + rendered.height;
}

/**
 * Fetch an image through our proxy and normalise it to JPEG via a canvas, so
 * that WebP and PNG sources both end up in a format jsPDF can embed.
 */
async function loadImage(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const maxSide = 1000;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.82),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
}

function drawRule(doc: Doc, y: number): number {
  doc.setDrawColor(226, 231, 238);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, y, PAGE.width - MARGIN, y);
  return y + 14;
}

function drawHeader(doc: Doc, subtitle: string): number {
  doc.setFillColor(BRAND.r, BRAND.g, BRAND.b);
  doc.rect(0, 0, PAGE.width, 4, "F");

  let y = MARGIN - 14;
  y = drawText(doc, "FINDER - PROSPECT BRIEF", MARGIN, y, CONTENT, {
    size: 8,
    bold: true,
    colour: MUTED,
  });
  y = drawText(doc, subtitle, MARGIN, y + 2, CONTENT, { size: 8, colour: MUTED });
  return y + 10;
}

function drawBadge(doc: Doc, business: Business, x: number, y: number): number {
  const [r, g, b] = PRESENCE_COLOUR[business.presence];
  const label = PRESENCE_LABEL[business.presence];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const width = doc.getTextWidth(label) + 14;

  doc.setFillColor(r, g, b);
  doc.roundedRect(x, y, width, 16, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(label, x + 7, y + 11);

  return width;
}

function field(doc: Doc, label: string, value: string, y: number): number {
  drawText(doc, label, MARGIN, y, 70, { size: 8, bold: true, colour: MUTED });
  return drawText(doc, value, MARGIN + 78, y, CONTENT - 78, { size: 9.5 }) + 5;
}

function stars(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return `${"*".repeat(filled)}${"-".repeat(5 - filled)} ${rating.toFixed(1)}`;
}

async function drawBusinessPage(
  doc: Doc,
  target: Target,
  details: PlaceDetails | null,
  generatedAt: string,
  senderName?: string,
): Promise<void> {
  const { business } = target;
  let y = drawHeader(doc, generatedAt);

  y = drawText(doc, business.name, MARGIN, y, CONTENT, { size: 20, bold: true });
  y = drawText(doc, business.category, MARGIN, y + 2, CONTENT, {
    size: 10,
    colour: MUTED,
  });

  y += 10;
  const badgeWidth = drawBadge(doc, business, MARGIN, y);
  drawText(
    doc,
    `Lead score ${business.leadScore}/100  -  Status: ${target.status}`,
    MARGIN + badgeWidth + 10,
    y + 1,
    CONTENT - badgeWidth - 10,
    { size: 9, colour: MUTED },
  );
  y = drawRule(doc, y + 26);

  if (business.phone) y = field(doc, "Phone", business.phone, y);
  if (business.address) y = field(doc, "Address", business.address, y);
  if (business.openingHours) y = field(doc, "Hours", business.openingHours, y);
  if (business.website) y = field(doc, "Website", business.website, y);
  if (business.socials.length) {
    y = field(
      doc,
      "Social",
      business.socials.map((s) => `${s.label}: ${s.url}`).join("\n"),
      y,
    );
  }
  if (details?.rating) {
    y = field(
      doc,
      "Rating",
      `${details.rating.toFixed(1)} from ${details.reviewCount ?? 0} reviews`,
      y,
    );
  }
  y = field(doc, "Coordinates", `${business.lat.toFixed(5)}, ${business.lon.toFixed(5)}`, y);
  y = field(doc, "Source", business.sourceUrl, y);

  if (target.notes.trim()) {
    y = drawRule(doc, y + 6);
    y = drawText(doc, "YOUR NOTES", MARGIN, y, CONTENT, {
      size: 8,
      bold: true,
      colour: MUTED,
    });
    y = drawText(doc, target.notes, MARGIN, y + 4, CONTENT, { size: 9.5 }) + 6;
  }

  const reviews = details?.reviews.slice(0, 3) ?? [];
  if (reviews.length) {
    y = drawRule(doc, y + 6);
    y = drawText(doc, "WHAT CUSTOMERS SAY", MARGIN, y, CONTENT, {
      size: 8,
      bold: true,
      colour: MUTED,
    });
    y += 6;

    for (const review of reviews) {
      if (y > PAGE.height - 160) break;
      const byline = `${stars(review.rating)}  ${review.author}${
        review.relativeTime ? ` - ${review.relativeTime}` : ""
      }`;
      y = drawText(doc, byline, MARGIN, y, CONTENT, {
        size: 8.5,
        bold: true,
        colour: MUTED,
      });
      const quote =
        review.text.length > 320 ? `${review.text.slice(0, 317)}...` : review.text;
      y = drawText(doc, `"${quote}"`, MARGIN, y + 2, CONTENT, { size: 9.5 }) + 10;
    }
  }

  const photos = details?.photos.slice(0, 4) ?? [];
  if (photos.length) {
    if (y > PAGE.height - 220) {
      doc.addPage();
      y = drawHeader(doc, `${business.name} - photos`);
    }
    y = drawRule(doc, y + 2);
    y = drawText(doc, "PHOTOS", MARGIN, y, CONTENT, {
      size: 8,
      bold: true,
      colour: MUTED,
    });
    y += 8;

    const cellWidth = (CONTENT - 12) / 2;
    const cellHeight = 110;
    let column = 0;
    let rowTop = y;

    for (const photo of photos) {
      const image = await loadImage(photo.proxyUrl);
      if (!image) continue;

      const x = MARGIN + column * (cellWidth + 12);
      const ratio = Math.min(cellWidth / image.width, cellHeight / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;

      doc.addImage(image.dataUrl, "JPEG", x, rowTop, width, height);
      if (photo.attribution) {
        drawText(doc, `(c) ${photo.attribution}`, x, rowTop + height + 2, cellWidth, {
          size: 6.5,
          colour: MUTED,
        });
      }

      column += 1;
      if (column === 2) {
        column = 0;
        rowTop += cellHeight + 22;
      }
    }
    y = rowTop + (column ? cellHeight + 22 : 0);
  } else if (details?.notes.photos) {
    y = drawText(doc, details.notes.photos, MARGIN, y + 6, CONTENT, {
      size: 8.5,
      colour: MUTED,
    });
  }

  // The pitch is the point of the document, so it always gets its own space.
  if (y > PAGE.height - 200) {
    doc.addPage();
    y = drawHeader(doc, `${business.name} - outreach`);
  } else {
    y = drawRule(doc, y + 8);
  }

  const pitch = buildPitch(business, { senderName });
  const pitchStyle = { size: 9.5, lineHeight: 1.35 };
  // Measure first: the wrapped height is what decides the panel, not a guess
  // from the newline count, which is wrong the moment a line wraps.
  const boxHeight = Math.min(
    measureText(doc, pitch, CONTENT - 28, pitchStyle) + 40,
    PAGE.height - y - MARGIN,
  );
  doc.setFillColor(244, 246, 249);
  doc.roundedRect(MARGIN, y, CONTENT, boxHeight, 5, 5, "F");

  drawText(
    doc,
    "SUGGESTED FIRST MESSAGE",
    MARGIN + 14,
    y + 12,
    CONTENT - 28,
    { size: 7.5, bold: true, colour: MUTED },
    PITCH_BACKGROUND,
  );
  drawText(
    doc,
    pitch,
    MARGIN + 14,
    y + 26,
    CONTENT - 28,
    pitchStyle,
    PITCH_BACKGROUND,
  );
}

function drawCoverPage(doc: Doc, targets: Target[], generatedAt: string): void {
  let y = drawHeader(doc, generatedAt);

  y = drawText(doc, "Target list", MARGIN, y + 6, CONTENT, { size: 26, bold: true });

  const noWebsite = targets.filter((t) => t.business.presence === "none").length;
  const socialOnly = targets.filter((t) => t.business.presence === "social-only").length;
  const withPhone = targets.filter((t) => t.business.phone).length;

  y = drawText(
    doc,
    `${targets.length} businesses - ${noWebsite} with no website - ${socialOnly} on social media only - ${withPhone} reachable by phone`,
    MARGIN,
    y + 6,
    CONTENT,
    { size: 10, colour: MUTED },
  );
  y = drawRule(doc, y + 16);

  const COLUMNS = { name: 0, phone: 224, presence: 340, status: 434 };
  const header = { size: 7.5, bold: true, colour: MUTED };
  drawText(doc, "BUSINESS", MARGIN, y, 215, header);
  drawText(doc, "PHONE", MARGIN + COLUMNS.phone, y, 110, header);
  drawText(doc, "PRESENCE", MARGIN + COLUMNS.presence, y, 90, header);
  drawText(doc, "STATUS", MARGIN + COLUMNS.status, y, 65, header);
  y += 16;

  for (const target of targets) {
    if (y > PAGE.height - MARGIN - 34) {
      doc.addPage();
      y = drawHeader(doc, `${generatedAt} - continued`);
    }

    const nameBottom = drawText(doc, target.business.name, MARGIN, y, 215, {
      size: 9.5,
      bold: true,
    });
    let bottom = drawText(doc, target.business.category, MARGIN, nameBottom, 215, {
      size: 8,
      colour: MUTED,
    });

    drawText(doc, target.business.phone ?? "-", MARGIN + COLUMNS.phone, y, 110, {
      size: 9,
    });

    const [r, g, b] = PRESENCE_COLOUR[target.business.presence];
    drawText(doc, PRESENCE_LABEL[target.business.presence], MARGIN + COLUMNS.presence, y, 90, {
      size: 8,
      bold: true,
      colour: { r, g, b },
    });

    drawText(doc, target.status.toUpperCase(), MARGIN + COLUMNS.status, y, 65, {
      size: 8,
      bold: true,
      colour: MUTED,
    });

    // The notes are the freelancer's own working state — worth carrying onto
    // the summary page, not just the per-business ones.
    if (target.notes.trim()) {
      bottom = drawText(doc, target.notes.trim(), MARGIN, bottom + 2, CONTENT, {
        size: 8,
        colour: MUTED,
      });
    }

    y = bottom + 12;
  }
}

export interface PdfOptions {
  senderName?: string;
  /** Called with 0-1 as pages are built, for the progress label. */
  onProgress?: (fraction: number) => void;
}

/**
 * Build the brief. Details (photos, reviews) are fetched here rather than
 * passed in, so the caller does not have to pre-load anything.
 */
export async function buildProspectPdf(
  targets: Target[],
  options: PdfOptions = {},
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const generatedAt = `Generated ${new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;

  if (targets.length > 1) {
    drawCoverPage(doc, targets, generatedAt);
  }

  for (const [index, target] of targets.entries()) {
    if (index > 0 || targets.length > 1) doc.addPage();

    let details: PlaceDetails | null = null;
    if (target.business.hasDetails) {
      try {
        const response = await fetch(
          `/api/place?id=${encodeURIComponent(target.business.id)}`,
        );
        if (response.ok) details = (await response.json()) as PlaceDetails;
      } catch {
        // A brief without photos is still a useful brief.
      }
    }

    await drawBusinessPage(doc, target, details, generatedAt, options.senderName);
    options.onProgress?.((index + 1) / targets.length);
  }

  return doc.output("blob");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const title = "Finder — local businesses with no website";
const description =
  "Map the local businesses around any point on Earth and instantly see which ones have no website of their own. Free, global, no API key required.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "Finder",
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0e13" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

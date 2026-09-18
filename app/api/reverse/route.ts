import { NextResponse } from "next/server";
import { reverseGeocode } from "@/lib/geocode";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "`lat` and `lon` are required." }, { status: 400 });
  }
  if (!allow(`reverse:${clientKey(request)}`, 20, 2)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  try {
    return NextResponse.json({ label: await reverseGeocode(lat, lon) });
  } catch {
    return NextResponse.json({ label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` });
  }
}

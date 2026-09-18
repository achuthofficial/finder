import { NextResponse } from "next/server";
import { geocode } from "@/lib/geocode";
import { UpstreamError } from "@/lib/http";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });

  if (!allow(`geocode:${clientKey(request)}`, 20, 2)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  try {
    return NextResponse.json({ results: await geocode(query) });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 502;
    return NextResponse.json(
      { error: "Place lookup is unavailable right now." },
      { status },
    );
  }
}

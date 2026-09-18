import { NextResponse } from "next/server";
import { placeDetails } from "@/lib/details";
import { UpstreamError } from "@/lib/http";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "`id` is required." }, { status: 400 });
  }

  if (!allow(`place:${clientKey(request)}`, 30, 2)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  try {
    return NextResponse.json(await placeDetails(id), {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 502;
    const message =
      error instanceof UpstreamError
        ? error.message
        : "Could not load details for this business.";
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";

const BACKEND = "https://web-production-6a8df.up.railway.app";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${BACKEND}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

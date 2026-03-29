import { NextRequest, NextResponse } from "next/server";

const BACKEND = "https://web-production-6a8df.up.railway.app";

async function proxy(req: NextRequest, path: string[]) {
  const url = `${BACKEND}/rooms/${path.join("/")}`;

  let body: string | undefined;
  if (req.method !== "GET") {
    body = await req.text();
  }

  const res = await fetch(url, {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxy(req, (await params).path);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxy(req, (await params).path);
}

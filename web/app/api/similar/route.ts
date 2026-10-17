/**
 * 図番 → 仕様の近い過去部品。
 *
 * ここは LLM を一切通さない。返すのは similar.ts が決定的に出した事実だけで、
 * 単価も作らない。文面の整形を挟む余地がないので、アダプタも呼んでいない。
 */

import { findSimilarParts } from "@/lib/similar";

interface SimilarBody {
  part?: unknown;
}

export async function POST(request: Request) {
  let body: SimilarBody;
  try {
    body = (await request.json()) as SimilarBody;
  } catch {
    return Response.json({ error: "JSON を解析できませんでした。" }, { status: 400 });
  }

  const part = typeof body.part === "string" ? body.part.trim() : "";
  if (!part) {
    return Response.json({ error: "part（図番）が空です。" }, { status: 400 });
  }

  return Response.json(findSimilarParts(part));
}

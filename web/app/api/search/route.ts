/** 書類チャンクの BM25 検索。LLM は通らない。 */

import { getChunk, getChunkIndex } from "@/lib/data";

interface SearchBody {
  q?: unknown;
  limit?: unknown;
}

export async function POST(request: Request) {
  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return Response.json({ error: "JSON を解析できませんでした。" }, { status: 400 });
  }

  const query = typeof body.q === "string" ? body.q.trim() : "";
  if (!query) {
    return Response.json({ error: "q（検索語）が空です。" }, { status: 400 });
  }

  const limit =
    typeof body.limit === "number" && body.limit > 0
      ? Math.min(Math.floor(body.limit), 20)
      : 5;

  const hits = getChunkIndex()
    .search(query, limit)
    .flatMap((hit) => {
      const chunk = getChunk(hit.id);
      if (!chunk) return [];
      return [
        {
          chunkId: chunk.chunk_id,
          docId: chunk.doc_id,
          docTitle: chunk.doc_title,
          docType: chunk.doc_type,
          pdf: chunk.pdf,
          page: chunk.page,
          section: chunk.section,
          text: chunk.text,
          score: Math.round(hit.score * 1000) / 1000,
        },
      ];
    });

  return Response.json({ query, hits });
}

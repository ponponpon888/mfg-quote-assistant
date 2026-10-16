/**
 * 問い合わせ文 → 抽出 → 類似過去見積 → 見積下書き。
 *
 * 金額は quote.ts が決定的に計算する。LLM が触れるのは申し送りの文面だけで、
 * 失敗しても金額には影響しない（だから LLM が落ちても下書きは返す）。
 */

import { parseInquiry } from "@/lib/inquiry";
import { getLLM, getProviderName } from "@/lib/llm";
import { buildQuoteDraft } from "@/lib/quote";

interface QuoteBody {
  text?: unknown;
}

export async function POST(request: Request) {
  let body: QuoteBody;
  try {
    body = (await request.json()) as QuoteBody;
  } catch {
    return Response.json({ error: "JSON を解析できませんでした。" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "text（問い合わせ文）が空です。" }, { status: 400 });
  }

  const parsed = parseInquiry(text);
  const draft = buildQuoteDraft(parsed.items);
  const reviewPoints = [...parsed.issues, ...draft.reviewPoints];

  let note = "";
  let provider = getProviderName();
  let noteError: string | null = null;

  try {
    const llm = await getLLM();
    provider = llm.name;
    note = await llm.composeQuoteNote({ ...draft, reviewPoints });
  } catch (error) {
    // 文面の整形に失敗しても、計算結果は返す。金額は LLM に依存していない。
    noteError = error instanceof Error ? error.message : String(error);
  }

  return Response.json({
    parsed: parsed.items,
    items: draft.items,
    subtotal: draft.subtotal,
    hasUnquotedItems: draft.hasUnquotedItems,
    unquotedDrawingNumbers: draft.unquotedDrawingNumbers,
    quoteValidityDays: draft.quoteValidityDays,
    reviewPoints,
    note,
    noteError,
    provider,
  });
}

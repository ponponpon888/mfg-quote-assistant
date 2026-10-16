/**
 * 既定の LLM アダプタ。外部 API を呼ばず、決定的に文章を組み立てる。
 *
 * 「それらしい文章」を作るためのものではない。answer.ts が組み立てた事実を
 * つなぐだけで、事実が無ければ無いと言う。デモの売りがそこにあるので、
 * 推測で埋める処理はここに一切置かない。
 */

import type { AnswerContext } from "../answer";
import type { QuoteDraft } from "../quote";
import type { AnswerResult, Llm } from "./index";

const NOT_FOUND =
  "書類からは見つかりませんでした。推測で答えると見積の根拠にならないため、ここでは答えを作りません。";

export function composeMockAnswer(context: AnswerContext): AnswerResult {
  if (context.notFound) {
    const detail = context.facts.length > 0 ? `\n${context.facts.join("")}` : "";
    return { answer: `${NOT_FOUND}${detail}`, notFound: true };
  }
  return { answer: context.facts.join("\n"), notFound: false };
}

export function composeMockQuoteNote(draft: QuoteDraft): string {
  const quotable = draft.items.filter((item) => item.quotable);
  const skipped = draft.items.filter((item) => !item.quotable);

  const lines: string[] = [];
  if (quotable.length > 0) {
    const label = draft.hasUnquotedItems ? "小計（単価確定分のみ）" : "合計";
    lines.push(
      `${quotable.map((item) => item.drawingNo).join("、")} について、過去見積と社内見積基準から下書きを作成しました。${label} ${draft.subtotal.toLocaleString()} 円（消費税別）、見積有効期限は発行日から ${draft.quoteValidityDays} 日です。`,
    );
  }
  if (skipped.length > 0) {
    lines.push(
      `${skipped.map((item) => item.drawingNo).join("、")} は過去見積が書類の中にないため単価を出していません。合計金額は未確定です。`,
    );
  }
  if (draft.reviewPoints.length > 0) {
    lines.push(
      `提出前に確認すべき点が ${draft.reviewPoints.length} 件あります。下の一覧を確認してください。`,
    );
  }
  return lines.join("\n");
}

export function createMockLlm(): Llm {
  return {
    name: "mock",
    async composeAnswer(context) {
      return composeMockAnswer(context);
    },
    async composeQuoteNote(draft) {
      return composeMockQuoteNote(draft);
    },
  };
}

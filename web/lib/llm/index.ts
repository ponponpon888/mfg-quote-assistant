/**
 * LLM アダプタの切り替え。
 *
 * 既定は mock。LLM_PROVIDER が未設定でも、空でも、知らない値でも mock になる。
 * 「設定を書き忘れたら課金された」が起きない向きに倒してある。
 *
 * claude.ts は動的 import にしてある。provider が mock のあいだは
 * Anthropic SDK がそもそも読み込まれないので、実 API が呼ばれる経路が存在しない。
 */

import type { AnswerContext } from "../answer";
import type { QuoteDraft } from "../quote";
import { createMockLlm } from "./mock";

export type ProviderName = "mock" | "claude";

export interface AnswerResult {
  answer: string;
  notFound: boolean;
}

export interface Llm {
  readonly name: ProviderName;
  /** 決定的に組み立てた事実を、日本語の回答文に整える。事実を足してはいけない。 */
  composeAnswer(context: AnswerContext): Promise<AnswerResult>;
  /** 計算済みの見積下書きに、申し送りの一文を付ける。金額には触れない。 */
  composeQuoteNote(draft: QuoteDraft): Promise<string>;
}

export function getProviderName(): ProviderName {
  const raw = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
  return raw === "claude" ? "claude" : "mock";
}

export async function getLLM(): Promise<Llm> {
  if (getProviderName() === "claude") {
    const { createClaudeLlm } = await import("./claude");
    return createClaudeLlm();
  }
  return createMockLlm();
}

/**
 * Anthropic API を使うアダプタ。既定では読み込まれない。
 *
 * LLM_PROVIDER=claude のときだけ llm/index.ts が動的 import する。
 * mock のままなら、このファイルも @anthropic-ai/sdk も評価されない。
 *
 * 役割は「整形」だけに限ってある。金額・納期・割増率はすでに quote.ts と
 * answer.ts が決めていて、ここには文字列として渡ってくる。プロンプトでも
 * 「渡された事実の外に出るな」「足りなければ無いと言え」を明示している。
 * 数字を考えさせないので、モデルを替えても見積額は 1 円も動かない。
 */

import Anthropic from "@anthropic-ai/sdk";

import type { AnswerContext } from "../answer";
import type { QuoteDraft } from "../quote";
import { composeMockAnswer, composeMockQuoteNote } from "./mock";
import type { AnswerResult, Llm } from "./index";

/** 既定モデル。ANTHROPIC_MODEL で上書きできる。 */
const DEFAULT_MODEL = "claude-opus-5-5";

const ANSWER_SYSTEM = [
  "あなたは日本の町工場の見積担当を補助するアシスタントです。",
  "与えられた「事実」だけを使って、日本語で 2〜4 文の回答を書いてください。",
  "事実に無い数値・日付・図番・固有名詞を足してはいけません。言い換えも、数字は原文のまま使ってください。",
  "事実が与えられていない場合は、書類からは見つからなかった旨だけを述べ、推測で補わないでください。",
  "箇条書きや見出しは使わず、続けて読める文章にしてください。",
].join("\n");

const QUOTE_SYSTEM = [
  "あなたは日本の町工場の見積担当を補助するアシスタントです。",
  "すでに計算済みの見積下書きについて、送付前の申し送りを日本語で 2〜3 文にまとめてください。",
  "金額・数量・納期・割増率を自分で計算してはいけません。与えられた数値をそのまま引用してください。",
  "未見積の明細がある場合、小計を合計額と呼んではいけません。合計金額が未確定であることを必ず書いてください。",
  "確認事項がある場合は、件数に触れ、人が確認する前提であることを明記してください。",
].join("\n");

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function describe(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Anthropic API の認証に失敗しました。ANTHROPIC_API_KEY を確認してください。";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Anthropic API のレート上限に達しました。時間をおいて再試行してください。";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API エラー (${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function createClaudeLlm(): Llm {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "LLM_PROVIDER=claude ですが ANTHROPIC_API_KEY が設定されていません。" +
        "web/.env.local に設定するか、LLM_PROVIDER=mock に戻してください。",
    );
  }

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;

  return {
    name: "claude",

    async composeAnswer(context: AnswerContext): Promise<AnswerResult> {
      const facts =
        context.facts.length > 0
          ? context.facts.map((fact) => `- ${fact}`).join("\n")
          : "(事実なし)";

      try {
        const message = await client.messages.create({
          model,
          max_tokens: 1024,
          system: ANSWER_SYSTEM,
          output_config: { effort: "low" },
          messages: [
            {
              role: "user",
              content: [
                `質問: ${context.question}`,
                "",
                "事実:",
                facts,
              ].join("\n"),
            },
          ],
        });

        if (message.stop_reason === "refusal") {
          return composeMockAnswer(context);
        }

        const answer = textOf(message);
        return answer
          ? { answer, notFound: context.notFound }
          : composeMockAnswer(context);
      } catch (error) {
        throw new Error(describe(error));
      }
    },

    async composeQuoteNote(draft: QuoteDraft): Promise<string> {
      const summary = [
        draft.hasUnquotedItems
          ? `小計（単価確定分のみ）: ${draft.subtotal.toLocaleString()} 円（消費税別）。` +
            `${draft.unquotedDrawingNumbers.join("、")} が未見積のため、合計金額は未確定。`
          : `合計: ${draft.subtotal.toLocaleString()} 円（消費税別）`,
        `見積有効期限: 発行日から ${draft.quoteValidityDays} 日`,
        `確認事項: ${draft.reviewPoints.length} 件`,
        "",
        "明細:",
        ...draft.items.map((item) =>
          item.quotable
            ? `- ${item.drawingNo} ${item.name} 数量 ${item.quantity.toLocaleString()} / 単価 ${item.unitPrice?.toLocaleString()} 円 / 納期 ${item.leadTimeDays} 営業日`
            : `- ${item.drawingNo} 未見積（${item.note}）`,
        ),
      ].join("\n");

      try {
        const message = await client.messages.create({
          model,
          max_tokens: 1024,
          system: QUOTE_SYSTEM,
          output_config: { effort: "low" },
          messages: [{ role: "user", content: summary }],
        });

        if (message.stop_reason === "refusal") {
          return composeMockQuoteNote(draft);
        }

        return textOf(message) || composeMockQuoteNote(draft);
      } catch (error) {
        throw new Error(describe(error));
      }
    },
  };
}

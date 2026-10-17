/**
 * 見積の下書きの「次の一手」を組み立てる。
 *
 * 下書きを出して終わりにすると、結局そのあとの仕事（ベテランへの確認、客先への
 * 一次回答）が人の頭の中に残る。そこを文面まで持っていくのがこのファイル。
 *
 * 文面は決定的なテンプレートで作る。LLM を通していないので、
 *
 *   - 未確定の合計を確定値として書いてしまう
 *   - 確認事項が文面から抜け落ちる
 *
 * といった事故が起きない。金額は quote.ts が計算したものをそのまま差し込むだけで、
 * ここで計算し直さない。
 */

import type { QuoteDraft, QuoteLineResult } from "./quote";

/** 未見積の明細について、客先に単価を回答するまでの日数。社内の運用値。 */
export const UNQUOTED_REPLY_DAYS = 3;

export interface FollowUp {
  /** ベテラン宛ての社内確認依頼。 */
  internalRequest: string;
  /** 客先への一次回答メールの下書き。 */
  customerReply: string;
}

const yen = (value: number) => `${value.toLocaleString()} 円`;

function subjectTail(draft: QuoteDraft): string {
  const numbers = draft.items.map((item) => item.drawingNo);
  return numbers.length > 0 ? `（${numbers.join("、")}）` : "";
}

function leadTimeOf(item: QuoteLineResult): string {
  return item.leadTimeDays === null ? "納期未定" : `納期 ${item.leadTimeDays} 営業日`;
}

/** 社内確認依頼に載せる、下書きそのものの要約。 */
function draftSummary(draft: QuoteDraft): string[] {
  const lines = draft.items.map((item) => {
    const quantity = `数量 ${item.quantity.toLocaleString()}`;
    if (!item.quotable || item.unitPrice === null || item.amount === null) {
      return `・${item.drawingNo}  ${quantity}  未見積（過去見積なし）  ${leadTimeOf(item)}`;
    }
    return (
      `・${item.drawingNo}  ${quantity}  単価 ${yen(item.unitPrice)}  ` +
      `金額 ${yen(item.amount)}  ${leadTimeOf(item)}`
    );
  });

  if (draft.hasUnquotedItems) {
    lines.push(
      `小計（単価確定分のみ・消費税別） ${yen(draft.subtotal)} ／ 合計（消費税別） 未確定`,
    );
  } else {
    lines.push(`合計（消費税別） ${yen(draft.subtotal)}`);
  }

  return lines;
}

export function buildInternalRequest(draft: QuoteDraft): string {
  const blocks: string[] = [];

  blocks.push(`件名: 見積単価の確認のお願い${subjectTail(draft)}`);
  blocks.push(
    "お手すきのときに、下記の見積下書きを確認していただけますでしょうか。" +
      "単価は過去見積と社内見積基準から機械的に組み立てたもので、まだ提出していません。",
  );

  blocks.push(["■ 下書きの内容", ...draftSummary(draft)].join("\n"));

  if (draft.reviewPoints.length > 0) {
    const questions = draft.reviewPoints.map(
      (point, index) =>
        `${index + 1}. ${point}\n   → この点の判断をお願いできますでしょうか。`,
    );
    blocks.push(
      [`■ 確認したいこと（${draft.reviewPoints.length} 件）`, ...questions].join("\n"),
    );
  }

  if (draft.hasUnquotedItems) {
    const unquoted = draft.unquotedDrawingNumbers.map(
      (drawingNo) =>
        `・${drawingNo}: 過去見積が書類の中にありません。` +
        `仕様の近い部品の実績を /similar?part=${drawingNo} にまとめています。`,
    );
    blocks.push(["■ 単価を出せていない図番", ...unquoted].join("\n"));
    blocks.push(
      "上記の図番は、類似品の実績を見たうえで工程から積み上げる必要があります。" +
        "進め方を指示いただければ、そのまま作業します。",
    );
  }

  return blocks.join("\n\n");
}

export function buildCustomerReply(draft: QuoteDraft): string {
  const blocks: string[] = [];

  blocks.push(`件名: お見積のご回答${subjectTail(draft)}`);
  blocks.push(
    "お世話になっております。\nお問い合わせいただいた件について、下記のとおりご回答します。",
  );

  const lines = draft.items.map((item) => {
    const quantity = `数量 ${item.quantity.toLocaleString()}`;
    if (!item.quotable || item.unitPrice === null || item.amount === null) {
      // 未見積の明細に金額を書かない。確定していない数字を客先に出すと戻せない。
      return (
        `・${item.drawingNo}  ${quantity}  ` +
        `単価は確認のうえ、${UNQUOTED_REPLY_DAYS} 営業日以内にご回答します  ${leadTimeOf(item)}`
      );
    }
    return (
      `・${item.drawingNo}  ${quantity}  単価 ${yen(item.unitPrice)}  ` +
      `金額 ${yen(item.amount)}  ${leadTimeOf(item)}`
    );
  });
  blocks.push(lines.join("\n"));

  if (draft.hasUnquotedItems) {
    blocks.push(
      `単価をお示しした分の小計は ${yen(draft.subtotal)}（消費税別）です。\n` +
        `${draft.unquotedDrawingNumbers.join("、")} の単価が未確定のため、` +
        "全体の合計金額は現時点では確定していません。",
    );
  } else {
    blocks.push(`合計 ${yen(draft.subtotal)}（消費税別）です。`);
  }

  blocks.push(
    `お見積の有効期限は発行日から ${draft.quoteValidityDays} 日です。\n` +
      "ご不明な点がありましたら、お気軽にお知らせください。",
  );

  blocks.push("※ この文面は下書きです。社内確認のうえ送信してください。");

  return blocks.join("\n\n");
}

export function buildFollowUp(draft: QuoteDraft): FollowUp {
  return {
    internalRequest: buildInternalRequest(draft),
    customerReply: buildCustomerReply(draft),
  };
}

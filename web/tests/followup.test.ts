import { describe, expect, it } from "vitest";

import {
  UNQUOTED_REPLY_DAYS,
  buildCustomerReply,
  buildFollowUp,
  buildInternalRequest,
} from "@/lib/followup";
import { parseInquiry } from "@/lib/inquiry";
import { quoteData } from "@/lib/data";
import { buildQuoteDraft } from "@/lib/quote";

/** 画面と同じ順で組み立てる。確認事項は抽出漏れ（issues）も含める。 */
function draftOfSample(id: string) {
  const inquiry = quoteData.inquiries.find((item) => item.id === id);
  if (!inquiry) throw new Error(`${id} のサンプルがありません`);
  const parsed = parseInquiry(inquiry.text);
  const draft = buildQuoteDraft(parsed.items);
  return { ...draft, reviewPoints: [...parsed.issues, ...draft.reviewPoints] };
}

describe("サンプル①（SS-1023 を 150 個・10 営業日）", () => {
  const draft = draftOfSample("inquiry-01");

  it("確認依頼に材料費改定の件が含まれる", () => {
    const request = buildInternalRequest(draft);
    expect(request).toContain("材料費改定日 2026-07-01");
    expect(request).toContain("Q-2026-0325");
  });

  it("確認事項を質問の形にする", () => {
    const request = buildInternalRequest(draft);
    expect(request).toContain("■ 確認したいこと（1 件）");
    expect(request).toContain("→ この点の判断をお願いできますでしょうか。");
  });

  it("確認依頼に下書きの金額をそのまま載せる", () => {
    const request = buildInternalRequest(draft);
    expect(request).toContain("単価 2,497 円");
    expect(request).toContain("金額 374,550 円");
    expect(request).toContain("合計（消費税別） 374,550 円");
  });

  it("全明細が確定しているので、回答メールには合計を書く", () => {
    const reply = buildCustomerReply(draft);
    expect(reply).toContain("合計 374,550 円（消費税別）");
    expect(reply).not.toContain("確定していません");
  });

  it("未見積が無いので、類似品の案内は入れない", () => {
    expect(buildInternalRequest(draft)).not.toContain("/similar?part=");
  });

  it("有効期限を社内ルールから引く", () => {
    expect(buildCustomerReply(draft)).toContain("発行日から 30 日");
  });
});

describe("サンプル②（SF-2040 を 60 本・CV-3015 を 30 個）", () => {
  const draft = draftOfSample("inquiry-02");

  it("回答メール下書きに合計金額が出ない", () => {
    const reply = buildCustomerReply(draft);
    expect(reply).not.toMatch(/合計\s*[\d,]+\s*円/);
    expect(reply).toContain("全体の合計金額は現時点では確定していません");
  });

  it("確定分の小計は、小計と呼んで出す", () => {
    const reply = buildCustomerReply(draft);
    expect(reply).toContain("小計は 336,000 円（消費税別）");
  });

  it("未見積の明細には単価を書かず、回答期限だけを伝える", () => {
    const reply = buildCustomerReply(draft);
    expect(reply).toContain(
      `単価は確認のうえ、${UNQUOTED_REPLY_DAYS} 営業日以内にご回答します`,
    );
    // 未見積の行に金額を書いていないこと。
    const line = reply
      .split("\n")
      .find((row) => row.startsWith("・CV-3015"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/[\d,]+\s*円/);
  });

  it("確認依頼に未見積の図番と類似品のリンクを添える", () => {
    const request = buildInternalRequest(draft);
    expect(request).toContain("■ 単価を出せていない図番");
    expect(request).toContain("/similar?part=CV-3015");
  });

  it("確認依頼でも小計を合計として出さない", () => {
    const request = buildInternalRequest(draft);
    expect(request).toContain("小計（単価確定分のみ・消費税別） 336,000 円");
    expect(request).toContain("合計（消費税別） 未確定");
  });

  it("確認事項の件数が下書きと一致する", () => {
    expect(buildInternalRequest(draft)).toContain(
      `■ 確認したいこと（${draft.reviewPoints.length} 件）`,
    );
  });
});

describe("buildFollowUp", () => {
  it("2 つの文面をまとめて返す", () => {
    const draft = draftOfSample("inquiry-02");
    const followUp = buildFollowUp(draft);
    expect(followUp.internalRequest).toBe(buildInternalRequest(draft));
    expect(followUp.customerReply).toBe(buildCustomerReply(draft));
  });

  it("同じ下書きなら毎回同じ文面になる", () => {
    const draft = draftOfSample("inquiry-01");
    expect(buildFollowUp(draft)).toEqual(buildFollowUp(draft));
  });

  it("客先に出す文面には、下書きである断り書きを必ず入れる", () => {
    for (const id of ["inquiry-01", "inquiry-02"]) {
      expect(buildCustomerReply(draftOfSample(id))).toContain(
        "この文面は下書きです",
      );
    }
  });
});

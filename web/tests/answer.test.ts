import { describe, expect, it } from "vitest";

import { buildAnswerContext, detectIntent } from "@/lib/answer";
import { composeMockAnswer } from "@/lib/llm/mock";

describe("detectIntent", () => {
  it("価格を聞く質問", () => {
    expect(detectIntent("SS-1023 を前回いくらで出した？")).toBe("price");
  });

  it("社内ルールを聞く質問", () => {
    expect(detectIntent("短納期の割増は何％？")).toBe("rule");
  });

  it("仕様を聞く質問", () => {
    expect(detectIntent("SF-2040 の材質と表面処理は？")).toBe("spec");
  });
});

describe("buildAnswerContext: 過去見積がある図番", () => {
  const context = buildAnswerContext("SS-1023 を前回いくらで出した？");

  it("直近の見積番号・数量・単価を事実として持つ", () => {
    const facts = context.facts.join("");
    expect(facts).toContain("Q-2026-0806");
    expect(facts).toContain("100");
    expect(facts).toContain("2,310");
  });

  it("見つからなかった扱いにしない", () => {
    expect(context.notFound).toBe(false);
  });

  it("根拠カードの 1 枚目が、その見積書のページを指す", () => {
    expect(context.citations[0].docId).toBe("QUOTE-2026-0806");
    expect(context.citations[0].page).toBe(1);
  });
});

describe("buildAnswerContext: 過去見積が無い図番", () => {
  const context = buildAnswerContext("CV-3015 を前回いくらで出した？");

  it("見つからなかったと判定する", () => {
    expect(context.notFound).toBe(true);
  });

  it("単価を作らない", () => {
    expect(context.facts.join("")).not.toMatch(/[0-9],[0-9]{3}\s*円/);
  });

  it("仕様書はあることを添える", () => {
    expect(context.facts.join("")).toContain("部品仕様書はあります");
  });

  it("mock アダプタも『見つかりませんでした』で返す", () => {
    const result = composeMockAnswer(context);
    expect(result.notFound).toBe(true);
    expect(result.answer).toContain("書類からは見つかりませんでした");
  });
});

describe("buildAnswerContext: 社内ルール", () => {
  const context = buildAnswerContext("短納期の割増は何％？");

  it("3 つの区分をすべて事実にする", () => {
    const facts = context.facts.join("");
    expect(facts).toContain("20%");
    expect(facts).toContain("35%");
    expect(facts).toContain("50%");
  });

  it("値引のあとに割増を掛ける、という順序にも触れる", () => {
    expect(context.facts.join("")).toContain("数量値引");
  });

  it("根拠が社内見積基準を指す", () => {
    expect(context.citations[0].docId).toBe("RULE-001");
  });
});

describe("buildAnswerContext: 部品仕様", () => {
  const context = buildAnswerContext("SF-2040 の材質と表面処理は？");

  it("材質と表面処理を事実にする", () => {
    const facts = context.facts.join("");
    expect(facts).toContain("S45C");
    expect(facts).toContain("硬質クロムメッキ");
  });

  it("根拠が部品仕様書を指す", () => {
    expect(context.citations[0].docId).toBe("SPEC-SF-2040");
  });
});

describe("buildAnswerContext: 書類に無い話題", () => {
  const context = buildAnswerContext("本日の東京の天気を教えてください");

  it("見つからなかったと判定する", () => {
    expect(context.notFound).toBe(true);
  });

  it("根拠カードも出さない", () => {
    expect(context.citations).toEqual([]);
  });

  it("mock アダプタが作り話をしない", () => {
    const result = composeMockAnswer(context);
    expect(result.answer).toContain("書類からは見つかりませんでした");
    expect(result.answer).not.toContain("天気");
  });
});

describe("回答の決定性", () => {
  it("同じ質問なら毎回同じ事実と根拠になる", () => {
    const a = buildAnswerContext("SS-1023 を前回いくらで出した？");
    const b = buildAnswerContext("SS-1023 を前回いくらで出した？");
    expect(a.facts).toEqual(b.facts);
    expect(a.citations).toEqual(b.citations);
  });
});

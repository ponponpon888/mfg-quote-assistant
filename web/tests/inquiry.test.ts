import { describe, expect, it } from "vitest";

import { quoteData } from "@/lib/data";
import { findDrawingNumbers, parseInquiry } from "@/lib/inquiry";

const inquiry = (id: string) => {
  const found = quoteData.inquiries.find((item) => item.id === id);
  if (!found) throw new Error(`サンプル ${id} が quotes.json にありません`);
  return found.text;
};

describe("findDrawingNumbers", () => {
  it("書類にある図番を拾う", () => {
    expect(findDrawingNumbers("図番 SS-1023 の件")).toEqual(["SS-1023"]);
  });

  it("ハイフン無しでも書類の表記に直す", () => {
    expect(findDrawingNumbers("SS1023 について")).toEqual(["SS-1023"]);
  });

  it("全角で書かれていても拾う", () => {
    expect(findDrawingNumbers("ＳＳ－１０２３")).toEqual(["SS-1023"]);
  });

  it("書類に無い図番も落とさない", () => {
    expect(findDrawingNumbers("ZZ-9999 をお願いします")).toEqual(["ZZ-9999"]);
  });

  it("同じ図番は 1 度だけ返す", () => {
    expect(findDrawingNumbers("SS-1023 と SS-1023")).toEqual(["SS-1023"]);
  });
});

describe("parseInquiry: サンプル①（SS-1023 を 150 個・短納期）", () => {
  const parsed = parseInquiry(inquiry("inquiry-01"));

  it("図番・数量・希望納期を取り出す", () => {
    expect(parsed.items).toEqual([
      { drawingNo: "SS-1023", quantity: 150, leadTimeDays: 10 },
    ]);
  });

  it("読み取れなかった点は無い", () => {
    expect(parsed.issues).toEqual([]);
  });
});

describe("parseInquiry: サンプル②（2 件・通常納期）", () => {
  const parsed = parseInquiry(inquiry("inquiry-02"));

  it("2 件を別の行として取り出す", () => {
    expect(parsed.items).toEqual([
      { drawingNo: "SF-2040", quantity: 60, leadTimeDays: null },
      { drawingNo: "CV-3015", quantity: 30, leadTimeDays: null },
    ]);
  });

  it("通常納期は希望納期なしとして扱う", () => {
    expect(parsed.items.every((item) => item.leadTimeDays === null)).toBe(true);
  });
});

describe("parseInquiry: 読み取れない場合", () => {
  it("図番が無ければその旨を返す", () => {
    const parsed = parseInquiry("お世話になっております。先日の件、よろしくお願いします。");
    expect(parsed.items).toEqual([]);
    expect(parsed.issues.join("")).toContain("図番");
  });

  it("数量が無ければ行を作らず、理由を残す", () => {
    const parsed = parseInquiry("図番 SS-1023 のお見積をお願いします。");
    expect(parsed.items).toEqual([]);
    expect(parsed.issues.join("")).toContain("数量");
  });

  it("書類に無い図番は、その旨を添えて行を作る", () => {
    const parsed = parseInquiry("図番 ZZ-9999 を 50 個、通常納期でお願いします。");
    expect(parsed.items).toEqual([
      { drawingNo: "ZZ-9999", quantity: 50, leadTimeDays: null },
    ]);
    expect(parsed.issues.join("")).toContain("書類の中に見つかりません");
  });

  it("納期の書き方が無ければ標準納期として扱い、理由を残す", () => {
    const parsed = parseInquiry("図番 SS-1023 を 150 個でお願いします。");
    expect(parsed.items[0].leadTimeDays).toBeNull();
    expect(parsed.issues.join("")).toContain("希望納期");
  });
});

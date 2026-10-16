import { describe, expect, it } from "vitest";

import { bigrams, normalize, tokenize } from "@/lib/tokenize";

describe("normalize", () => {
  it("全角の英数字を半角に揃える", () => {
    expect(normalize("ＳＳ－１０２３")).toBe("ss-1023");
  });

  it("大文字小文字を揃える", () => {
    expect(normalize("SPCC t3.2")).toBe("spcc t3.2");
  });
});

describe("bigrams", () => {
  it("隣り合う 2 文字を並べる", () => {
    expect(bigrams("短納期割増")).toEqual(["短納", "納期", "期割", "割増"]);
  });

  it("1 文字ならその文字を返す", () => {
    expect(bigrams("鋼")).toEqual(["鋼"]);
  });

  it("空文字は何も返さない", () => {
    expect(bigrams("")).toEqual([]);
  });
});

describe("tokenize", () => {
  it("図番を丸ごとと、分解した形の両方で出す", () => {
    const tokens = tokenize("SS-1023");
    expect(tokens).toContain("ss-1023");
    expect(tokens).toContain("ss");
    expect(tokens).toContain("1023");
  });

  it("材質記号の小数点を割らない", () => {
    expect(tokenize("SPCC t3.2")).toContain("t3.2");
  });

  it("日本語は bi-gram にする", () => {
    expect(tokenize("短納期割増")).toEqual(["短納", "納期", "期割", "割増"]);
  });

  it("日本語と英数字が混ざった文を両方の方式で割る", () => {
    const tokens = tokenize("SS-1023 の材質");
    expect(tokens).toContain("ss-1023");
    expect(tokens).toContain("材質");
  });

  it("記号だけの入力は空になる", () => {
    expect(tokenize("…！？ 〜")).toEqual([]);
  });

  it("全角で書いた図番でも半角と同じトークンになる", () => {
    expect(tokenize("ＳＳ－１０２３")).toEqual(tokenize("SS-1023"));
  });
});

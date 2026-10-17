import { describe, expect, it } from "vitest";

import { getPart } from "@/lib/data";
import {
  SIMILARITY_FLOOR,
  findSimilarParts,
  generalTolerance,
  machinability,
  materialFamily,
  outlineSize,
  primarySize,
  priceDirections,
  ratioScore,
} from "@/lib/similar";

/** テストの前提。崩れたら data/source を直したときに気づけるようにしておく。 */
const part = (drawingNo: string) => {
  const found = getPart(drawingNo);
  if (!found) throw new Error(`${drawingNo} の仕様書が書類の中にありません`);
  return found;
};

describe("materialFamily", () => {
  it("ステンレスを鋼材より高い側に置く", () => {
    const sus = materialFamily("SUS304 t1.5");
    const spcc = materialFamily("SPCC t3.2");
    expect(sus.family).toBe("ステンレス");
    expect(spcc.family).toBe("鋼材");
    expect(sus.rank).toBeGreaterThan(spcc.rank);
  });

  it("炭素鋼も鋼材として扱う", () => {
    expect(materialFamily("S45C").family).toBe("鋼材");
  });

  it("黄銅を別の系統として扱う", () => {
    expect(materialFamily("C3604").family).toBe("黄銅");
  });

  it("知らない材質は不明にする（推測で序列を付けない）", () => {
    const unknown = materialFamily("謎の新素材");
    expect(unknown.family).toBe("不明");
    expect(unknown.rank).toBe(0);
  });
});

describe("machinability", () => {
  it("切削では黄銅がいちばん削りやすく、ステンレスがいちばん削りにくい", () => {
    const brass = machinability("切削", "C3604");
    const steel = machinability("切削", "S45C");
    const stainless = machinability("切削", "SUS304 t1.5");
    expect(brass!.rank).toBeLessThan(steel!.rank);
    expect(steel!.rank).toBeLessThan(stainless!.rank);
  });

  it("板金では鋼材がいちばん素直で、ステンレスがいちばん手間がかかる", () => {
    const steel = machinability("板金", "SPCC t3.2");
    const aluminium = machinability("板金", "A5052");
    const stainless = machinability("板金", "SUS304 t1.5");
    expect(steel!.rank).toBeLessThan(aluminium!.rank);
    expect(aluminium!.rank).toBeLessThan(stainless!.rank);
  });

  it("工法によって順位が入れ替わる（黄銅は切削では最も楽、板金ではそうでない）", () => {
    const brassTurning = machinability("切削", "C3604")!;
    const steelTurning = machinability("切削", "S45C")!;
    const brassSheet = machinability("板金", "C3604")!;
    const steelSheet = machinability("板金", "SPCC t1.6")!;
    expect(brassTurning.rank).toBeLessThan(steelTurning.rank);
    expect(brassSheet.rank).toBeGreaterThan(steelSheet.rank);
  });

  it("表に無い工法・材質は null（推測で順位を作らない）", () => {
    expect(machinability("鋳造", "SUS304")).toBeNull();
    expect(machinability("切削", "謎の新素材")).toBeNull();
  });
});

describe("primarySize", () => {
  it("板金は板厚を代表値にする", () => {
    expect(primarySize(part("CV-3015"))).toEqual({ kind: "thickness", value: 1.5 });
  });

  it("切削は外径を代表値にする", () => {
    expect(primarySize(part("SF-2040"))).toEqual({ kind: "diameter", value: 20 });
  });
});

describe("outlineSize / generalTolerance", () => {
  it("外形は寸法表記の最大値を取る", () => {
    expect(outlineSize("300 x 150 x t1.5 mm")).toBe(300);
  });

  it("寸法が読めなければ null", () => {
    expect(outlineSize("要図面確認")).toBeNull();
  });

  it("一般公差は ±n の形のときだけ数値にする", () => {
    expect(generalTolerance("±0.3 mm")).toBe(0.3);
    expect(generalTolerance("φ20 h7 (0 / -0.021)")).toBeNull();
  });
});

describe("ratioScore", () => {
  it("等しければ 1", () => {
    expect(ratioScore(10, 10)).toBe(1);
  });

  it("倍まで離れたら 0（それ以上離しても 0 のまま）", () => {
    expect(ratioScore(10, 20)).toBe(0);
    expect(ratioScore(10, 100)).toBe(0);
  });

  it("間は線形に落ちる", () => {
    expect(ratioScore(8, 10)).toBeCloseTo(0.6, 5);
  });
});

describe("findSimilarParts: CV-3015（過去見積が無い図番）", () => {
  const result = findSimilarParts("CV-3015");

  it("対象の仕様を根拠つきで返す", () => {
    expect(result.found).toBe(true);
    expect(result.target?.material).toBe("SUS304 t1.5");
    expect(result.targetBasis?.docId).toBe("SPEC-CV-3015");
  });

  it("対象図番に過去見積が無いことを持つ", () => {
    expect(result.hasOwnQuoteHistory).toBe(false);
  });

  it("近い候補が上位、遠い候補が下位に来る", () => {
    expect(result.candidates.map((candidate) => candidate.drawingNo)).toEqual([
      "CV-2980",
      "PL-1150",
    ]);
    expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score);
  });

  it("下限を下回る候補は出さない", () => {
    // SS-1023 は同じ板金だが、材質・板厚・寸法が離れていて下限未満になる。
    const listed = result.candidates.map((candidate) => candidate.drawingNo);
    expect(listed).not.toContain("SS-1023");
    expect(listed).not.toContain("SF-2040");
    expect(listed).not.toContain("BS-4070");
    for (const candidate of result.candidates) {
      expect(candidate.score).toBeGreaterThanOrEqual(SIMILARITY_FLOOR);
    }
  });

  it("単価を確定させない", () => {
    expect(result.unitPriceSettled).toBe(false);
  });

  it("候補の単価は参考値だと確認事項に書く", () => {
    expect(result.reviewPoints.join("")).toContain("候補の単価は参考値です");
  });

  it("対象図番の単価ではないことを確認事項の先頭で言う", () => {
    expect(result.reviewPoints[0]).toContain("過去見積が書類の中に 1 件もありません");
    expect(result.reviewPoints[0]).toContain("CV-3015 の単価ではありません");
  });

  it("候補の見積を、見積番号つきの参考値として持つ", () => {
    const [nearest] = result.candidates;
    expect(nearest.quotes).toHaveLength(1);
    expect(nearest.quotes[0].quoteNo).toBe("Q-2026-0612");
    expect(nearest.quotes[0].quantity).toBe(50);
    expect(nearest.quotes[0].unitPrice).toBe(2740);
    expect(nearest.quotes[0].basis.docId).toBe("QUOTE-2026-0612");
  });

  it("材料費改定前の候補見積を確認事項に出す", () => {
    const points = result.reviewPoints.join("");
    expect(points).toContain("Q-2026-0612");
    expect(points).toContain("材料費改定日 2026-07-01 より前");
  });

  it("材質が異なる候補について注意を出す", () => {
    expect(result.reviewPoints.join("")).toContain("PL-1150 は材質が異なります");
  });

  it("工法が一致する候補があるときは「工法が異なる候補しか無い」と言わない", () => {
    expect(result.reviewPoints.join("")).not.toContain("工法が異なる候補しか");
  });
});

describe("findSimilarParts: 近い部品が無い図番", () => {
  // SF-2040（切削）に対する候補は BS-4070 だけで、材質も寸法も離れている。
  const result = findSimilarParts("SF-2040");

  it("候補を出さない", () => {
    expect(result.candidates).toEqual([]);
  });

  it("近い部品が無いと言う", () => {
    expect(result.note).toContain("近い部品が書類の中にありません");
    expect(result.reviewPoints.join("")).toContain("近い部品が書類の中にありません");
  });

  it("対象の仕様自体は返す", () => {
    expect(result.found).toBe(true);
    expect(result.target?.drawing_no).toBe("SF-2040");
  });
});

describe("findSimilarParts: 下限を上げれば候補は消える", () => {
  it("下限未満しか無ければ候補を出さない", () => {
    const result = findSimilarParts("CV-3015", { floor: 0.95 });
    expect(result.candidates).toEqual([]);
    expect(result.note).toContain("近い部品が書類の中にありません");
  });
});

describe("findSimilarParts: 書類に無い図番", () => {
  const result = findSimilarParts("ZZ-9999");

  it("仕様が分からないので探さない", () => {
    expect(result.found).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.reviewPoints.join("")).toContain("部品仕様書が書類の中にありません");
  });
});

describe("findSimilarParts: 過去見積がある図番", () => {
  const result = findSimilarParts("SS-1023");

  it("自身の実績を先に見るよう促す", () => {
    expect(result.hasOwnQuoteHistory).toBe(true);
    expect(result.reviewPoints[0]).toContain("過去見積が 3 件あります");
  });

  it("候補からは自分自身を外す", () => {
    expect(result.candidates.map((candidate) => candidate.drawingNo)).not.toContain(
      "SS-1023",
    );
  });
});

describe("priceDirections: 判定表どおりに振れる", () => {
  it("材質が鋼材からステンレスに変われば、材料費は上がる方向", () => {
    const directions = priceDirections(part("CV-2980"), part("PL-1150"));
    const material = directions.find((item) => item.item === "材質（材料費）");
    expect(material?.direction).toBe("up");
    expect(material?.change).toBe("SPCC t1.6 → SUS304 t1.2");
    expect(material?.effect).toContain("材料費は上がる方向");
  });

  it("材質がステンレスから鋼材に変われば、材料費は下がる方向", () => {
    const directions = priceDirections(part("PL-1150"), part("CV-2980"));
    expect(
      directions.find((item) => item.item === "材質（材料費）")?.direction,
    ).toBe("down");
  });

  it("材質は材料費と加工性を別の行に分ける", () => {
    const items = priceDirections(part("CV-2980"), part("PL-1150")).map(
      (item) => item.item,
    );
    expect(items).toContain("材質（材料費）");
    expect(items).toContain("材質（加工性）");
    expect(items).not.toContain("材質");
  });

  it("板金でステンレスに変われば、材料費も加工費も上がる方向（同じ向き）", () => {
    const directions = priceDirections(part("CV-2980"), part("PL-1150"));
    expect(
      directions.find((item) => item.item === "材質（材料費）")?.direction,
    ).toBe("up");
    const work = directions.find((item) => item.item === "材質（加工性）");
    expect(work?.direction).toBe("up");
    expect(work?.effect).toContain("板金では");
    expect(work?.effect).toContain("加工硬化とスプリングバック");
    expect(work?.effect).toContain("加工費は上がる方向");
  });

  it("切削で黄銅から鋼材に変われば、材料費と加工費が逆を向く", () => {
    // 快削黄銅は材料こそ高いが削るのは楽。1 本の序列にまとめると、
    // この打ち消し合いが見えなくなる。
    const directions = priceDirections(part("SF-2040"), part("BS-4070"));

    const cost = directions.find((item) => item.item === "材質（材料費）");
    expect(cost?.direction).toBe("down");
    expect(cost?.effect).toContain("材料費は下がる方向");

    const work = directions.find((item) => item.item === "材質（加工性）");
    expect(work?.direction).toBe("up");
    expect(work?.effect).toContain("切削では");
    expect(work?.effect).toContain("快削材で削りやすい");
    expect(work?.effect).toContain("加工費は上がる方向");

    expect(cost?.direction).not.toBe(work?.direction);
  });

  it("切削で鋼材から黄銅に変われば、向きがどちらも入れ替わる", () => {
    const directions = priceDirections(part("BS-4070"), part("SF-2040"));
    expect(
      directions.find((item) => item.item === "材質（材料費）")?.direction,
    ).toBe("up");
    expect(
      directions.find((item) => item.item === "材質（加工性）")?.direction,
    ).toBe("down");
  });

  it("工法が違う候補には、加工性の行を出さない", () => {
    // 加工のしやすさは工法で効き方が変わる。工法が違えば比べる意味がなく、
    // 「工法」の行が比較そのものを使えないと言っている。
    const items = priceDirections(part("CV-3015"), part("BS-4070")).map(
      (item) => item.item,
    );
    expect(items).toContain("材質（材料費）");
    expect(items).not.toContain("材質（加工性）");
    expect(items).toContain("工法");
  });

  it("板厚が厚くなれば、材料費は上がる方向", () => {
    const directions = priceDirections(part("CV-3015"), part("CV-2980"));
    const thickness = directions.find((item) => item.item === "板厚");
    expect(thickness?.direction).toBe("up");
    expect(thickness?.change).toBe("1.2 → 1.5");
    expect(thickness?.effect).toContain("板厚が厚いため");
  });

  it("板厚が薄くなれば、材料費は下がる方向", () => {
    const directions = priceDirections(part("CV-2980"), part("CV-3015"));
    const thickness = directions.find((item) => item.item === "板厚");
    expect(thickness?.direction).toBe("down");
    expect(thickness?.effect).toContain("板厚が薄いため");
  });

  it("工法が違えば、方向を判断できないと言う", () => {
    const directions = priceDirections(part("CV-3015"), part("SF-2040"));
    const process = directions.find((item) => item.item === "工法");
    expect(process?.direction).toBe("unknown");
    expect(process?.effect).toContain("目安に使えません");
  });

  it("公差が厳しくなれば、加工費は上がる方向", () => {
    const directions = priceDirections(part("SS-1023"), part("PL-1150"));
    const tolerance = directions.find((item) => item.item === "公差");
    expect(tolerance?.direction).toBe("up");
    expect(tolerance?.change).toBe("±0.3 mm → ±0.2 mm");
    expect(tolerance?.effect).toContain("加工費は上がる方向");
  });

  it("表面処理が違えば、要確認とだけ言う", () => {
    const directions = priceDirections(part("CV-3015"), part("PL-1150"));
    const surface = directions.find((item) => item.item === "表面処理");
    expect(surface?.direction).toBe("unknown");
    expect(surface?.effect).toContain("表面処理費は要確認");
  });

  it("同じ項目については何も言わない", () => {
    // CV-3015 と CV-2980 は工法・材質系統・表面処理・公差が一致する。
    const items = priceDirections(part("CV-3015"), part("CV-2980")).map(
      (item) => item.item,
    );
    expect(items).not.toContain("工法");
    expect(items).not.toContain("表面処理");
    expect(items).not.toContain("公差");
    // 材質が同じ系統なら、材料費の行も加工性の行も出さない。
    expect(items.filter((item) => item.startsWith("材質"))).toEqual([]);
  });

  it("率や金額は文面に出さない", () => {
    for (const target of ["CV-3015", "SS-1023", "SF-2040"]) {
      for (const candidate of ["CV-2980", "PL-1150", "BS-4070"]) {
        if (target === candidate) continue;
        for (const direction of priceDirections(part(target), part(candidate))) {
          expect(direction.effect).not.toMatch(/%|％|円/);
        }
      }
    }
  });
});

describe("類似品の決定性", () => {
  it("同じ図番なら毎回同じ候補と同じ順になる", () => {
    const a = findSimilarParts("CV-3015");
    const b = findSimilarParts("CV-3015");
    expect(a).toEqual(b);
  });
});

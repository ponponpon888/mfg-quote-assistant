import { describe, expect, it } from "vitest";

import { quoteData } from "@/lib/data";
import { buildQuoteDraft, buildQuoteLine, interpolateUnitPrice } from "@/lib/quote";

const REVISION = quoteData.rules.values.material_revision.effective_from;

function fakeHistory(points: [number, number, string][]) {
  return points.map(([quantity, unitPrice, issuedOn]) => ({
    quote: {
      doc_id: `Q-${issuedOn}`,
      title: "",
      pdf: "",
      page: 1,
      quote_no: `Q-${issuedOn}`,
      issued_on: issuedOn,
      valid_until: "",
      customer: "",
      issuer: "",
      payment_terms: "",
      delivery_place: "",
      total_amount: quantity * unitPrice,
      lines: [],
    },
    line: {
      drawing_no: "XX-0000",
      name: "",
      material: "SPCC",
      surface_treatment: "",
      quantity,
      unit_price: unitPrice,
      amount: quantity * unitPrice,
      material_cost: 0,
      processing_cost: 0,
      surface_cost: 0,
      lead_time_days: 14,
    },
  }));
}

describe("interpolateUnitPrice", () => {
  it("実績が無ければ null", () => {
    expect(interpolateUnitPrice([], 100)).toBeNull();
  });

  it("2 点の間は線形に内挿する", () => {
    const result = interpolateUnitPrice(
      fakeHistory([
        [100, 2000, "2026-01-01"],
        [200, 1000, "2026-02-01"],
      ]),
      150,
    );
    expect(result?.price).toBe(1500);
  });

  it("実績の範囲より下では外挿せず、最小数量の単価を使う", () => {
    const result = interpolateUnitPrice(
      fakeHistory([
        [100, 2000, "2026-01-01"],
        [200, 1000, "2026-02-01"],
      ]),
      10,
    );
    expect(result?.price).toBe(2000);
    expect(result?.reviewPoints.join("")).toContain("下回");
  });

  it("実績の範囲より上でも外挿しない", () => {
    const result = interpolateUnitPrice(
      fakeHistory([
        [100, 2000, "2026-01-01"],
        [200, 1000, "2026-02-01"],
      ]),
      5000,
    );
    expect(result?.price).toBe(1000);
    expect(result?.reviewPoints.join("")).toContain("上回");
  });

  it("同じ数量の実績が並んだら、新しいほうだけを使う", () => {
    const result = interpolateUnitPrice(
      fakeHistory([
        [100, 9999, "2026-01-01"],
        [100, 2000, "2026-06-01"],
        [200, 1000, "2026-02-01"],
      ]),
      150,
    );
    expect(result?.price).toBe(1500);
  });

  it("実績が 1 件なら内挿できない旨を返す", () => {
    const result = interpolateUnitPrice(fakeHistory([[30, 5600, "2026-05-21"]]), 60);
    expect(result?.price).toBe(5600);
    expect(result?.reviewPoints.join("")).toContain("1 件のみ");
  });
});

describe("buildQuoteLine: SS-1023 を 150 個・10 営業日", () => {
  const line = buildQuoteLine({
    drawingNo: "SS-1023",
    quantity: 150,
    leadTimeDays: 10,
  });

  it("数量 100 個と 200 個の実績から内挿する", () => {
    // 100 個 = 2,310 円 / 200 個 = 1,980 円 の中点
    expect(line.basePrice).toBe(2145);
  });

  it("数量値引 3% と短納期割増 20% を、この順で適用する", () => {
    expect(line.steps.map((step) => step.label)).toEqual([
      "過去見積から基準単価",
      "数量値引",
      "短納期割増",
    ]);
    expect(line.steps[1].after).toBe(2081); // 2145 * 0.97
    expect(line.steps[2].after).toBe(2497); // 2081 * 1.20
  });

  it("割増は値引のあとの単価にかかる", () => {
    const discount = line.steps[1];
    const rush = line.steps[2];
    expect(rush.before).toBe(discount.after);
  });

  it("単価と金額が計算結果と一致する", () => {
    expect(line.unitPrice).toBe(2497);
    expect(line.amount).toBe(2497 * 150);
  });

  it("各ステップに根拠が付く", () => {
    expect(line.steps[1].basis.docId).toBe("RULE-001");
    expect(line.steps[1].basis.section).toBe("4. 数量値引基準");
    expect(line.steps[2].basis.section).toBe("5. 短納期割増率");
  });

  it("材料費改定前の見積を参照したことを確認事項に出す", () => {
    expect(line.reviewPoints.join("")).toContain(REVISION);
  });
});

describe("buildQuoteLine: 短納期の区分", () => {
  const price = (leadTimeDays: number | null) =>
    buildQuoteLine({ drawingNo: "SS-1023", quantity: 150, leadTimeDays }).unitPrice;

  it("通常納期なら割増は付かない", () => {
    expect(price(null)).toBe(2081);
  });

  it("7 営業日は 35% 増し", () => {
    expect(price(7)).toBe(Math.round(2081 * 1.35));
  });

  it("5 営業日は 50% 増し", () => {
    expect(price(5)).toBe(Math.round(2081 * 1.5));
  });

  it("標準納期より短くても区分外なら割増せず、確認事項にする", () => {
    const line = buildQuoteLine({
      drawingNo: "SS-1023",
      quantity: 150,
      leadTimeDays: 12,
    });
    expect(line.unitPrice).toBe(2081);
    expect(line.reviewPoints.join("")).toContain("割増区分");
  });

  it("標準納期より長い希望納期では割増しない", () => {
    expect(price(20)).toBe(2081);
  });
});

describe("buildQuoteLine: 最小ロット", () => {
  const line = buildQuoteLine({ drawingNo: "SS-1023", quantity: 5, leadTimeDays: null });

  it("最小ロットまで数量を引き上げる", () => {
    expect(line.requestedQuantity).toBe(5);
    expect(line.quantity).toBe(20);
  });

  it("引き上げたことを確認事項に出す", () => {
    expect(line.reviewPoints.join("")).toContain("最小ロット");
  });
});

describe("buildQuoteLine: 実績が無い図番", () => {
  const line = buildQuoteLine({ drawingNo: "CV-3015", quantity: 30, leadTimeDays: null });

  it("金額を作らない", () => {
    expect(line.quotable).toBe(false);
    expect(line.unitPrice).toBeNull();
    expect(line.amount).toBeNull();
  });

  it("作れない理由を言う", () => {
    expect(line.note).toContain("過去見積");
  });

  it("仕様書は見つかっているので材質は埋まる", () => {
    expect(line.material).toBe("SUS304 t1.5");
  });
});

describe("buildQuoteLine: 書類に無い図番", () => {
  const line = buildQuoteLine({ drawingNo: "ZZ-9999", quantity: 10, leadTimeDays: null });

  it("仕様書が無いことを確認事項に出す", () => {
    expect(line.quotable).toBe(false);
    expect(line.reviewPoints.join("")).toContain("部品仕様書");
  });
});

describe("buildQuoteDraft", () => {
  const draft = buildQuoteDraft([
    { drawingNo: "SF-2040", quantity: 60, leadTimeDays: null },
    { drawingNo: "CV-3015", quantity: 30, leadTimeDays: null },
  ]);

  it("見積できた行だけを合計に入れる", () => {
    expect(draft.total).toBe(5600 * 60);
  });

  it("確認事項に図番を付けて並べる", () => {
    expect(draft.reviewPoints.every((point) => /^[A-Z]{2}-\d{4}: /.test(point))).toBe(
      true,
    );
  });

  it("実績 1 件しか無い図番について注意を出す", () => {
    expect(draft.reviewPoints.join("")).toContain("1 件のみ");
  });

  it("有効期限の日数を社内ルールから引く", () => {
    expect(draft.quoteValidityDays).toBe(30);
  });
});

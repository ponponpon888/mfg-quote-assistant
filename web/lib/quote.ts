/**
 * 見積下書きの計算。ここは決定的で、LLM を一切通さない。
 *
 * 金額を LLM に出させると、桁や適用区分を静かに間違えたときに誰も気づけない。
 * だから「いくらになるか」はこのファイルの純粋関数だけで決め、LLM には
 * 出来上がった数字を日本語の文面に整えてもらうだけにしている。
 *
 * 計算のたびに「どの見積・どの社内ルールを使ったか」を step として残す。
 * 画面にはこの step をそのまま並べるので、出てきた単価は必ず根拠まで辿れる。
 */

import {
  getPart,
  getQuoteHistory,
  quoteData,
  type PastQuote,
  type PastQuoteLine,
  type RuleKey,
  type Rules,
} from "./data";

export interface QuoteRequestItem {
  drawingNo: string;
  quantity: number;
  /** 希望納期（営業日）。null なら通常納期。 */
  leadTimeDays: number | null;
}

export interface Basis {
  kind: "quote" | "rule" | "spec";
  label: string;
  docId: string;
  pdf: string;
  page: number;
  section?: string;
}

export interface QuoteStep {
  label: string;
  detail: string;
  before: number;
  after: number;
  basis: Basis;
}

export interface QuoteLineResult {
  drawingNo: string;
  name: string;
  material: string;
  surfaceTreatment: string;
  processCategory: string;
  requestedQuantity: number;
  quantity: number;
  basePrice: number | null;
  unitPrice: number | null;
  amount: number | null;
  leadTimeDays: number | null;
  standardLeadTimeDays: number | null;
  steps: QuoteStep[];
  references: Basis[];
  reviewPoints: string[];
  quotable: boolean;
  note: string;
}

export interface QuoteDraft {
  items: QuoteLineResult[];
  /**
   * 単価が確定した明細だけの合計。未見積の明細があるときは見積の合計額ではない。
   * 「合計」と呼ばないのは、確定額として読まれると事故になるため。
   */
  subtotal: number;
  /** 単価を出せなかった明細があるか。true のとき subtotal は確定額ではない。 */
  hasUnquotedItems: boolean;
  /** 単価を出せなかった図番。 */
  unquotedDrawingNumbers: string[];
  reviewPoints: string[];
  quoteValidityDays: number;
}

function ruleBasis(rules: Rules, key: RuleKey): Basis {
  const ref = rules.refs[key];
  return {
    kind: "rule",
    label: `${rules.title} ${ref.section}`,
    docId: rules.doc_id,
    pdf: rules.pdf,
    page: ref.page,
    section: ref.section,
  };
}

function quoteBasis(quote: PastQuote): Basis {
  return {
    kind: "quote",
    label: `${quote.quote_no}（${quote.issued_on}）`,
    docId: quote.doc_id,
    pdf: quote.pdf,
    page: quote.page,
  };
}

/**
 * 同じ数量の見積が複数あるときは、発行日が新しいほうだけを残す。
 * 古い単価と新しい単価が同じ数量で並ぶと、内挿の傾きが意味を失うため。
 */
function latestPerQuantity(
  history: { quote: PastQuote; line: PastQuoteLine }[],
): { quote: PastQuote; line: PastQuoteLine }[] {
  const byQuantity = new Map<number, { quote: PastQuote; line: PastQuoteLine }>();
  for (const entry of history) {
    const existing = byQuantity.get(entry.line.quantity);
    if (!existing || existing.quote.issued_on < entry.quote.issued_on) {
      byQuantity.set(entry.line.quantity, entry);
    }
  }
  return [...byQuantity.values()].sort(
    (a, b) => a.line.quantity - b.line.quantity,
  );
}

interface BasePriceResult {
  price: number;
  used: { quote: PastQuote; line: PastQuoteLine }[];
  detail: string;
  reviewPoints: string[];
}

/** 過去見積から、要求数量にあたる単価を決める。 */
export function interpolateUnitPrice(
  history: { quote: PastQuote; line: PastQuoteLine }[],
  quantity: number,
): BasePriceResult | null {
  const points = latestPerQuantity(history);
  if (points.length === 0) return null;

  if (points.length === 1) {
    const only = points[0];
    return {
      price: only.line.unit_price,
      used: [only],
      detail: `過去見積 1 件（数量 ${only.line.quantity.toLocaleString()} の単価 ${only.line.unit_price.toLocaleString()} 円）をそのまま使用`,
      reviewPoints: [
        `参照できる過去見積が ${only.quote.quote_no} の 1 件のみです。数量差による単価の内挿ができていないため、数量 ${quantity.toLocaleString()} での単価は人が確認してください。`,
      ],
    };
  }

  const lowest = points[0];
  const highest = points[points.length - 1];

  if (quantity <= lowest.line.quantity) {
    return {
      price: lowest.line.unit_price,
      used: [lowest],
      detail: `過去見積の最小数量 ${lowest.line.quantity.toLocaleString()} 個の単価を使用（外挿はしない）`,
      reviewPoints:
        quantity < lowest.line.quantity
          ? [
              `要求数量 ${quantity.toLocaleString()} は過去見積の最小数量 ${lowest.line.quantity.toLocaleString()} を下回ります。小ロットの段取り費が単価に乗るため、実際にはこれより高くなる可能性があります。`,
            ]
          : [],
    };
  }

  if (quantity >= highest.line.quantity) {
    return {
      price: highest.line.unit_price,
      used: [highest],
      detail: `過去見積の最大数量 ${highest.line.quantity.toLocaleString()} 個の単価を使用（外挿はしない）`,
      reviewPoints:
        quantity > highest.line.quantity
          ? [
              `要求数量 ${quantity.toLocaleString()} は過去見積の最大数量 ${highest.line.quantity.toLocaleString()} を上回ります。単価を据え置いているため、量産効果を見込める場合は下げる余地があります。`,
            ]
          : [],
    };
  }

  // 要求数量を挟む 2 点を探して線形内挿する。
  let lower = points[0];
  let upper = points[points.length - 1];
  for (let i = 0; i + 1 < points.length; i += 1) {
    if (
      points[i].line.quantity <= quantity &&
      quantity <= points[i + 1].line.quantity
    ) {
      lower = points[i];
      upper = points[i + 1];
      break;
    }
  }

  const span = upper.line.quantity - lower.line.quantity;
  const ratio = span === 0 ? 0 : (quantity - lower.line.quantity) / span;
  const price =
    lower.line.unit_price + (upper.line.unit_price - lower.line.unit_price) * ratio;

  return {
    price,
    used: [lower, upper],
    detail:
      `数量 ${lower.line.quantity.toLocaleString()} 個 → ${lower.line.unit_price.toLocaleString()} 円 と ` +
      `数量 ${upper.line.quantity.toLocaleString()} 個 → ${upper.line.unit_price.toLocaleString()} 円 の間を内挿`,
    reviewPoints: [],
  };
}

/** 材質から、社内ルールの材料費改定区分を引く。 */
function materialCategory(material: string): string {
  return /SUS|ステンレス/i.test(material) ? "ステンレス" : "鋼材";
}

export function buildQuoteLine(item: QuoteRequestItem): QuoteLineResult {
  const rules = quoteData.rules;
  const values = rules.values;
  const part = getPart(item.drawingNo);
  const history = getQuoteHistory(item.drawingNo);

  const reviewPoints: string[] = [];
  const references: Basis[] = [];
  const steps: QuoteStep[] = [];

  const processCategory = part?.process_category ?? "";
  const standardLeadTimeDays =
    part?.standard_lead_time_days ??
    values.standard_lead_time_days[processCategory] ??
    null;

  if (part) {
    references.push({
      kind: "spec",
      label: part.title,
      docId: part.doc_id,
      pdf: part.pdf,
      page: part.page,
    });
  } else {
    reviewPoints.push(
      `図番 ${item.drawingNo} の部品仕様書が書類の中にありません。材質・最小ロット・標準納期を確認してください。`,
    );
  }

  // 最小ロットを下回る数量は、最小ロットに引き上げて見積もる（社内ルール 6）。
  const minLot = part?.min_lot ?? values.min_lots[processCategory];
  let quantity = item.quantity;
  if (minLot && quantity < minLot) {
    quantity = minLot;
    reviewPoints.push(
      `要求数量 ${item.quantity.toLocaleString()} は最小ロット ${minLot.toLocaleString()} を下回るため、${minLot.toLocaleString()} 個で見積もっています。`,
    );
    references.push(ruleBasis(rules, "min_lots"));
  }

  const base = interpolateUnitPrice(history, quantity);

  if (!base) {
    return {
      drawingNo: item.drawingNo,
      name: part?.name ?? "",
      material: part?.material ?? "",
      surfaceTreatment: part?.surface_treatment ?? "",
      processCategory,
      requestedQuantity: item.quantity,
      quantity,
      basePrice: null,
      unitPrice: null,
      amount: null,
      leadTimeDays: item.leadTimeDays ?? standardLeadTimeDays,
      standardLeadTimeDays,
      steps,
      references,
      reviewPoints: [
        ...reviewPoints,
        `図番 ${item.drawingNo} の過去見積が書類の中に 1 件もありません。実績単価がないため、工程から積み上げて単価を決める必要があります。`,
      ],
      quotable: false,
      note: `図番 ${item.drawingNo} の過去見積が書類の中にありません。単価の根拠がないため、下書きを作成していません。`,
    };
  }

  reviewPoints.push(...base.reviewPoints);
  for (const entry of base.used) {
    references.push(quoteBasis(entry.quote));
  }

  const basePrice = Math.round(base.price);
  let current = basePrice;

  steps.push({
    label: "過去見積から基準単価",
    detail: base.detail,
    before: basePrice,
    after: basePrice,
    basis: quoteBasis(base.used[base.used.length - 1].quote),
  });

  // 数量値引（社内ルール 4）。区分は重複適用しない。
  const discount = [...values.volume_discounts]
    .filter((tier) => quantity >= tier.min_quantity)
    .sort((a, b) => b.min_quantity - a.min_quantity)[0];
  if (discount) {
    const after = Math.round(current * (1 - discount.rate));
    steps.push({
      label: "数量値引",
      detail: `${discount.min_quantity.toLocaleString()} 個以上のため ${(discount.rate * 100).toFixed(0)}% 引き`,
      before: current,
      after,
      basis: ruleBasis(rules, "volume_discounts"),
    });
    current = after;
  }

  // 短納期割増（社内ルール 5）。数量値引の適用後の単価に対して計算する。
  if (item.leadTimeDays !== null && standardLeadTimeDays !== null) {
    if (item.leadTimeDays < standardLeadTimeDays) {
      const surcharge = [...values.rush_surcharges]
        .sort((a, b) => a.max_lead_time_days - b.max_lead_time_days)
        .find((tier) => item.leadTimeDays! <= tier.max_lead_time_days);
      if (surcharge) {
        const after = Math.round(current * (1 + surcharge.rate));
        steps.push({
          label: "短納期割増",
          detail: `希望納期 ${item.leadTimeDays} 営業日は標準納期 ${standardLeadTimeDays} 営業日より短く、${surcharge.max_lead_time_days} 営業日以内の区分にあたるため ${(surcharge.rate * 100).toFixed(0)}% 増し`,
          before: current,
          after,
          basis: ruleBasis(rules, "rush_surcharges"),
        });
        current = after;
      } else {
        reviewPoints.push(
          `希望納期 ${item.leadTimeDays} 営業日は標準納期 ${standardLeadTimeDays} 営業日より短いものの、社内ルールの割増区分（10 営業日以内）には該当しません。生産枠が空いているかを確認してください。`,
        );
      }
    }
  }

  const unitPrice = current;
  const amount = unitPrice * quantity;

  // 材料費改定日より前の見積を参照していたら、必ず人の目を通す。
  const revision = values.material_revision;
  const category = materialCategory(part?.material ?? base.used[0].line.material);
  const increase = revision.increases[category];
  for (const entry of base.used) {
    if (entry.quote.issued_on < revision.effective_from) {
      reviewPoints.push(
        `参照した見積 ${entry.quote.quote_no}（${entry.quote.issued_on}）は材料費改定日 ${revision.effective_from} より前のものです。` +
          (increase !== undefined
            ? `${category}は ${(increase * 100).toFixed(0)}% 引き上げられているため、反映の要否を確認してください。`
            : "改定の反映要否を確認してください。"),
      );
      references.push(ruleBasis(rules, "material_revision"));
      break;
    }
  }

  if (amount < values.min_order_amount) {
    reviewPoints.push(
      `合計 ${amount.toLocaleString()} 円は最低受注金額 ${values.min_order_amount.toLocaleString()} 円を下回ります。段取り費の計上か、受注の見送りを検討してください。`,
    );
    references.push(ruleBasis(rules, "min_order_amount"));
  }

  return {
    drawingNo: item.drawingNo,
    name: part?.name ?? base.used[0].line.name,
    material: part?.material ?? base.used[0].line.material,
    surfaceTreatment: part?.surface_treatment ?? base.used[0].line.surface_treatment,
    processCategory,
    requestedQuantity: item.quantity,
    quantity,
    basePrice,
    unitPrice,
    amount,
    leadTimeDays: item.leadTimeDays ?? standardLeadTimeDays,
    standardLeadTimeDays,
    steps,
    references,
    reviewPoints,
    quotable: true,
    note: "",
  };
}

export function buildQuoteDraft(items: QuoteRequestItem[]): QuoteDraft {
  const results = items.map(buildQuoteLine);
  const subtotal = results.reduce((sum, item) => sum + (item.amount ?? 0), 0);

  const unquotedDrawingNumbers = results
    .filter((item) => !item.quotable)
    .map((item) => item.drawingNo);
  const hasUnquotedItems = unquotedDrawingNumbers.length > 0;

  const reviewPoints: string[] = [];

  // 未見積の明細があることは真っ先に伝える。小計を合計額と読み違えると、
  // 足りない金額のまま客先に出てしまう。
  if (hasUnquotedItems) {
    reviewPoints.push(
      `${unquotedDrawingNumbers.join("、")} の単価が確定していません。` +
        `小計 ${subtotal.toLocaleString()} 円は単価が確定した明細だけの金額で、見積の合計額ではありません。`,
    );
  }

  // 行ごとの確認事項をまとめる。同じ文言は 1 回だけ出す。
  const seen = new Set<string>();
  for (const result of results) {
    for (const point of result.reviewPoints) {
      const key = `${result.drawingNo}:${point}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reviewPoints.push(`${result.drawingNo}: ${point}`);
    }
  }

  return {
    items: results,
    subtotal,
    hasUnquotedItems,
    unquotedDrawingNumbers,
    reviewPoints,
    quoteValidityDays: quoteData.rules.values.quote_validity_days,
  };
}

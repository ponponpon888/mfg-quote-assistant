/**
 * 仕様の近い過去部品を探し、「どこが違うから、どちらに振れそうか」を示す。
 *
 * ここは単価を作らない。過去見積が無い図番に数字を与えてしまうと、根拠の無い
 * 金額が独り歩きするため、出すのは次の 3 つだけにしている。
 *
 *   1. 項目ごとの一致・相違（工法・材質・板厚・寸法・表面処理・公差・最小ロット）
 *   2. 候補の過去見積（見積番号・日付・数量・単価）。あくまで参考値として示す
 *   3. 相違点ごとの「振れる方向」。上がる / 下がる / 判断できない の 3 値だけで、
 *      率も金額も出さない
 *
 * 類似度は項目ごとの重み付き和。下限を下回る候補は出さない。かすっただけの候補を
 * 並べると「近い部品がある」と誤読されるため、answer.ts の下限スコアと同じ考え方で切る。
 */

import {
  getPart,
  getQuoteHistory,
  quoteData,
  type PartSpec,
  type PastQuote,
  type PastQuoteLine,
} from "./data";
import type { Basis } from "./quote";

/** 類似度がこれを下回る候補は出さない。 */
export const SIMILARITY_FLOOR = 0.45;

/** 画面に出す候補の上限。 */
export const MAX_CANDIDATES = 3;

/**
 * 項目ごとの重み。合計 1.0。
 *
 * 工法に最大の重みを置いている。板金と切削では使う設備も段取りも違い、
 * 工法が違う実績は単価の目安としてほとんど使えないため。
 */
export const FIELD_WEIGHTS = {
  process: 0.35,
  material: 0.2,
  primarySize: 0.15,
  outline: 0.1,
  surface: 0.1,
  tolerance: 0.05,
  minLot: 0.05,
} as const;

export type FieldKey = keyof typeof FIELD_WEIGHTS;

export type MatchLevel = "same" | "close" | "different" | "unknown";

/** 単価が振れる方向。率や金額は出さない。 */
export type Direction = "up" | "down" | "flat" | "unknown";

export interface FieldComparison {
  key: FieldKey;
  label: string;
  /** 対象図番の値。 */
  target: string;
  /** 候補の値。 */
  candidate: string;
  match: MatchLevel;
  /** この項目が類似度に寄与した分（0 〜 重み）。 */
  score: number;
  weight: number;
}

export interface PriceDirection {
  /** 「材質」「板厚」など、振れの原因になっている項目。 */
  item: string;
  /** 「SPCC t1.6 → SUS304 t1.5」のように、候補 → 対象で書く。 */
  change: string;
  direction: Direction;
  /** どの費目がどちらに振れるか。金額は書かない。 */
  effect: string;
}

export interface CandidateQuote {
  quoteNo: string;
  issuedOn: string;
  quantity: number;
  /** 参考値。この図番の単価ではない。 */
  unitPrice: number;
  leadTimeDays: number;
  basis: Basis;
  /** 材料費改定日より前の見積か。 */
  beforeMaterialRevision: boolean;
}

export interface SimilarCandidate {
  drawingNo: string;
  name: string;
  /** 0 〜 1。項目ごとの重み付き和。 */
  score: number;
  spec: Basis;
  comparisons: FieldComparison[];
  quotes: CandidateQuote[];
  directions: PriceDirection[];
  reviewPoints: string[];
}

export interface SimilarResult {
  drawingNo: string;
  /** 対象図番の部品仕様書が書類の中にあるか。 */
  found: boolean;
  target: PartSpec | null;
  targetBasis: Basis | null;
  /** 対象図番そのものに過去見積があるか。 */
  hasOwnQuoteHistory: boolean;
  candidates: SimilarCandidate[];
  reviewPoints: string[];
  /**
   * 単価を確定させたか。このモジュールは常に false を返す。
   * 画面の「未確定」表示が、計算結果と必ず一致するようにしている。
   */
  unitPriceSettled: false;
  /** 候補が無いときに画面へ出す理由。候補があれば空。 */
  note: string;
}

const MATERIAL_REVISION = quoteData.rules.values.material_revision.effective_from;

/**
 * 材質の系統と、材料費の高い順の序列。
 *
 * 「SUS は SPCC より高い」程度の粗い序列しか持たせていない。相場で前後するため、
 * これ以上細かくしても当たらない。順に試すので、具体的な系統を先に置く。
 */
const MATERIAL_FAMILIES: { pattern: RegExp; family: string; rank: number }[] = [
  { pattern: /SUS|ステンレス/i, family: "ステンレス", rank: 3 },
  { pattern: /C\d{4}|黄銅|真鍮/i, family: "黄銅", rank: 4 },
  { pattern: /A\d{4}|アルミ/i, family: "アルミ", rank: 2 },
  { pattern: /SPCC|SPHC|SS400|S\d{2}C|鋼/i, family: "鋼材", rank: 1 },
];

export interface MaterialFamily {
  family: string;
  rank: number;
}

export function materialFamily(material: string): MaterialFamily {
  for (const entry of MATERIAL_FAMILIES) {
    if (entry.pattern.test(material)) {
      return { family: entry.family, rank: entry.rank };
    }
  }
  return { family: "不明", rank: 0 };
}

export interface Machinability {
  /** 加工のしにくさ。大きいほど加工費が上がる側。 */
  rank: number;
  /** なぜその順になるか。画面にそのまま出す。 */
  note: string;
}

/**
 * 工法ごとの、材質の加工しにくさ。
 *
 * 材料費の序列（MATERIAL_FAMILIES）と分けているのは、2 つが逆を向くことがあるため。
 * たとえば快削黄銅は材料こそ高いが削るのは楽で、切削では加工費が下がる側に出る。
 * 1 本の序列にまとめると、この打ち消し合いが見えなくなる。
 *
 * 工法で表を分けているのは、効き方が違うため。切削では被削性（削りやすさ）が、
 * 板金では曲げのスプリングバックや溶接後の歪みが効く。黄銅は切削では最も楽な部類だが、
 * 板金では打痕の気づかいが要り、順位が入れ替わる。
 */
const MACHINABILITY: Record<string, Record<string, Machinability>> = {
  切削: {
    黄銅: { rank: 1, note: "快削材で削りやすい" },
    アルミ: { rank: 2, note: "軟らかく削りやすい" },
    鋼材: { rank: 3, note: "標準的な被削性" },
    ステンレス: { rank: 4, note: "加工硬化しやすく、工具が持たない" },
  },
  板金: {
    鋼材: { rank: 1, note: "曲げも溶接も素直" },
    黄銅: { rank: 2, note: "軟らかいが打痕が付きやすい" },
    アルミ: { rank: 3, note: "スプリングバックが大きく、傷が付きやすい" },
    ステンレス: {
      rank: 4,
      note: "加工硬化とスプリングバックが大きく、溶接後の歪み取りも要る",
    },
  },
};

/** その工法でのその材質の加工しにくさ。表に無ければ null（方向を言わない）。 */
export function machinability(
  processCategory: string,
  material: string,
): Machinability | null {
  const table = MACHINABILITY[processCategory];
  if (!table) return null;
  return table[materialFamily(material).family] ?? null;
}

export type SizeKind = "thickness" | "diameter";

export interface PrimarySize {
  kind: SizeKind;
  value: number;
}

/**
 * その部品の寸法を代表する 1 つの値。板金なら板厚、切削なら外径。
 * 板厚と外径は比べても意味がないので、種類が違えば一致なしとして扱う。
 */
export function primarySize(part: PartSpec): PrimarySize | null {
  const thickness = /t\s*([\d.]+)/i.exec(part.dimensions) ?? /t\s*([\d.]+)/i.exec(part.material);
  if (thickness) return { kind: "thickness", value: Number(thickness[1]) };

  const diameter = /[φΦ]\s*([\d.]+)/.exec(part.dimensions);
  if (diameter) return { kind: "diameter", value: Number(diameter[1]) };

  return null;
}

/** 外形の代表値。寸法表記に出てくる数値の最大。 */
export function outlineSize(dimensions: string): number | null {
  const numbers = [...dimensions.matchAll(/[\d.]+/g)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

/** 一般公差（±n mm）。この形で書かれていないときは null。 */
export function generalTolerance(tolerance: string): number | null {
  const match = /±\s*([\d.]+)/.exec(tolerance);
  return match ? Number(match[1]) : null;
}

/**
 * 2 つの数値の近さ。等しければ 1、片方が倍（または半分）以上離れたら 0。
 * 「倍まで離れたら似ていない」という線を 1 本引いているだけで、精度は求めていない。
 */
export function ratioScore(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return 0;
  const ratio = Math.min(a, b) / Math.max(a, b);
  return Math.max(0, (ratio - 0.5) / 0.5);
}

/** 近いと見なす差の上限（2%）。これ以内なら「振れる方向」は出さない。 */
const FLAT_RATIO = 0.02;

function compareNumbers(target: number, candidate: number): Direction {
  const base = Math.max(Math.abs(target), Math.abs(candidate));
  if (base === 0) return "flat";
  if (Math.abs(target - candidate) / base <= FLAT_RATIO) return "flat";
  return target > candidate ? "up" : "down";
}

function levelOf(score: number, weight: number): MatchLevel {
  if (weight === 0) return "unknown";
  if (score >= weight) return "same";
  if (score > 0) return "close";
  return "different";
}

function comparison(
  key: FieldKey,
  label: string,
  target: string,
  candidate: string,
  raw: number,
): FieldComparison {
  const weight = FIELD_WEIGHTS[key];
  const score = Math.round(raw * weight * 1000) / 1000;
  return {
    key,
    label,
    target: target || "—",
    candidate: candidate || "—",
    match: levelOf(score, weight),
    score,
    weight,
  };
}

function compareParts(target: PartSpec, candidate: PartSpec): FieldComparison[] {
  const out: FieldComparison[] = [];

  out.push(
    comparison(
      "process",
      "工法",
      target.process_category,
      candidate.process_category,
      target.process_category === candidate.process_category ? 1 : 0,
    ),
  );

  const targetMaterial = materialFamily(target.material);
  const candidateMaterial = materialFamily(candidate.material);
  out.push(
    comparison(
      "material",
      "材質",
      target.material,
      candidate.material,
      targetMaterial.family !== "不明" && targetMaterial.family === candidateMaterial.family
        ? 1
        : 0,
    ),
  );

  const targetSize = primarySize(target);
  const candidateSize = primarySize(candidate);
  const sizeLabel = targetSize?.kind === "diameter" ? "外径" : "板厚";
  out.push(
    comparison(
      "primarySize",
      sizeLabel,
      targetSize ? String(targetSize.value) : "",
      candidateSize ? String(candidateSize.value) : "",
      targetSize && candidateSize && targetSize.kind === candidateSize.kind
        ? ratioScore(targetSize.value, candidateSize.value)
        : 0,
    ),
  );

  const targetOutline = outlineSize(target.dimensions);
  const candidateOutline = outlineSize(candidate.dimensions);
  out.push(
    comparison(
      "outline",
      "外形寸法",
      target.dimensions,
      candidate.dimensions,
      targetOutline !== null && candidateOutline !== null
        ? ratioScore(targetOutline, candidateOutline)
        : 0,
    ),
  );

  out.push(
    comparison(
      "surface",
      "表面処理",
      target.surface_treatment,
      candidate.surface_treatment,
      target.surface_treatment === candidate.surface_treatment ? 1 : 0,
    ),
  );

  out.push(
    comparison(
      "tolerance",
      "公差",
      target.tolerance,
      candidate.tolerance,
      target.tolerance === candidate.tolerance ? 1 : 0,
    ),
  );

  out.push(
    comparison(
      "minLot",
      "最小ロット",
      `${target.min_lot} 個`,
      `${candidate.min_lot} 個`,
      target.min_lot === candidate.min_lot ? 1 : 0,
    ),
  );

  return out;
}

/**
 * 相違点ごとに、単価が振れる方向を決める。候補 → 対象の向きで書く。
 *
 * 判定はここの表だけで決まる。率や金額を出さないのは、根拠のある係数を
 * 持っていないため。方向だけなら仕様の差から言い切れる。
 */
export function priceDirections(target: PartSpec, candidate: PartSpec): PriceDirection[] {
  const out: PriceDirection[] = [];

  if (target.process_category !== candidate.process_category) {
    out.push({
      item: "工法",
      change: `${candidate.process_category} → ${target.process_category}`,
      direction: "unknown",
      effect: "工法が違うため、この候補の単価は目安に使えません",
    });
  }

  const targetMaterial = materialFamily(target.material);
  const candidateMaterial = materialFamily(candidate.material);
  if (targetMaterial.family !== candidateMaterial.family) {
    // 材質は材料費と加工費で逆を向くことがあるので、1 行にまとめない。
    const costDirection =
      targetMaterial.rank === 0 || candidateMaterial.rank === 0
        ? "unknown"
        : targetMaterial.rank > candidateMaterial.rank
          ? "up"
          : "down";
    out.push({
      item: "材質（材料費）",
      change: `${candidate.material} → ${target.material}`,
      direction: costDirection,
      effect:
        costDirection === "unknown"
          ? "材質の系統が判断できないため、材料費は要確認です"
          : `${candidateMaterial.family}から${targetMaterial.family}に変わるため、材料費は${
              costDirection === "up" ? "上がる" : "下がる"
            }方向です`,
    });

    // 加工のしやすさは工法で効き方が変わる。工法が違う候補では比べない
    // （そのときは「工法」の行が、比較そのものが使えないと言っている）。
    if (target.process_category === candidate.process_category) {
      const targetWork = machinability(target.process_category, target.material);
      const candidateWork = machinability(
        candidate.process_category,
        candidate.material,
      );

      if (!targetWork || !candidateWork) {
        out.push({
          item: "材質（加工性）",
          change: `${candidate.material} → ${target.material}`,
          direction: "unknown",
          effect: `${target.process_category}でのこの材質の加工しやすさを判定表に持っていないため、加工費は要確認です`,
        });
      } else if (targetWork.rank !== candidateWork.rank) {
        const workDirection = targetWork.rank > candidateWork.rank ? "up" : "down";
        out.push({
          item: "材質（加工性）",
          change: `${candidate.material} → ${target.material}`,
          direction: workDirection,
          effect:
            `${target.process_category}では` +
            `${candidateMaterial.family}（${candidateWork.note}）より` +
            `${targetMaterial.family}（${targetWork.note}）のほうが加工し${
              workDirection === "up" ? "にくい" : "やすい"
            }ため、加工費は${workDirection === "up" ? "上がる" : "下がる"}方向です`,
        });
      }
    }
  }

  const targetSize = primarySize(target);
  const candidateSize = primarySize(candidate);
  if (targetSize && candidateSize && targetSize.kind === candidateSize.kind) {
    const direction = compareNumbers(targetSize.value, candidateSize.value);
    if (direction !== "flat") {
      const label = targetSize.kind === "diameter" ? "外径" : "板厚";
      const shape =
        targetSize.kind === "diameter"
          ? direction === "up"
            ? "大きい"
            : "小さい"
          : direction === "up"
            ? "厚い"
            : "薄い";
      out.push({
        item: label,
        change: `${candidateSize.value} → ${targetSize.value}`,
        direction,
        effect: `${label}が${shape}ため、材料費は${
          direction === "up" ? "上がる" : "下がる"
        }方向です`,
      });
    }
  }

  const targetOutline = outlineSize(target.dimensions);
  const candidateOutline = outlineSize(candidate.dimensions);
  if (targetOutline !== null && candidateOutline !== null) {
    const direction = compareNumbers(targetOutline, candidateOutline);
    if (direction !== "flat") {
      out.push({
        item: "外形寸法",
        change: `${candidate.dimensions} → ${target.dimensions}`,
        direction,
        effect: `外形が${direction === "up" ? "大きい" : "小さい"}ため、材料費は${
          direction === "up" ? "上がる" : "下がる"
        }方向です`,
      });
    }
  }

  const targetTolerance = generalTolerance(target.tolerance);
  const candidateTolerance = generalTolerance(candidate.tolerance);
  if (targetTolerance !== null && candidateTolerance !== null) {
    // 公差は値が小さいほど厳しい。厳しいほど加工費は上がる。
    const direction = compareNumbers(candidateTolerance, targetTolerance);
    if (direction !== "flat") {
      out.push({
        item: "公差",
        change: `${candidate.tolerance} → ${target.tolerance}`,
        direction,
        effect: `公差が${direction === "up" ? "厳しい" : "緩い"}ため、加工費は${
          direction === "up" ? "上がる" : "下がる"
        }方向です`,
      });
    }
  }

  if (target.surface_treatment !== candidate.surface_treatment) {
    out.push({
      item: "表面処理",
      change: `${candidate.surface_treatment} → ${target.surface_treatment}`,
      direction: "unknown",
      effect: "表面処理が違うため、表面処理費は要確認です",
    });
  }

  return out;
}

function specBasis(part: PartSpec): Basis {
  return {
    kind: "spec",
    label: part.title,
    docId: part.doc_id,
    pdf: part.pdf,
    page: part.page,
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

function candidateQuotes(drawingNo: string): CandidateQuote[] {
  return getQuoteHistory(drawingNo).map(
    ({ quote, line }: { quote: PastQuote; line: PastQuoteLine }) => ({
      quoteNo: quote.quote_no,
      issuedOn: quote.issued_on,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      leadTimeDays: line.lead_time_days,
      basis: quoteBasis(quote),
      beforeMaterialRevision: quote.issued_on < MATERIAL_REVISION,
    }),
  );
}

export interface SimilarOptions {
  /** 類似度の下限。既定は SIMILARITY_FLOOR。 */
  floor?: number;
  /** 返す候補の上限。既定は MAX_CANDIDATES。 */
  limit?: number;
}

/**
 * 図番に対する類似候補を返す。過去見積が 1 件も無い図番は候補にしない
 * （示せる実績が無く、相談の材料にならないため）。
 */
export function findSimilarParts(
  drawingNo: string,
  options: SimilarOptions = {},
): SimilarResult {
  const floor = options.floor ?? SIMILARITY_FLOOR;
  const limit = options.limit ?? MAX_CANDIDATES;

  const target = getPart(drawingNo);
  const normalized = drawingNo.trim().toUpperCase();

  if (!target) {
    return {
      drawingNo: normalized,
      found: false,
      target: null,
      targetBasis: null,
      hasOwnQuoteHistory: false,
      candidates: [],
      reviewPoints: [
        `図番 ${normalized} の部品仕様書が書類の中にありません。仕様が分からないため、似ている部品を探せません。`,
      ],
      unitPriceSettled: false,
      note: `図番 ${normalized} の部品仕様書が書類の中にありません。`,
    };
  }

  const ownHistory = getQuoteHistory(target.drawing_no);

  const scored = quoteData.parts
    .filter((part) => part.drawing_no !== target.drawing_no)
    .filter((part) => getQuoteHistory(part.drawing_no).length > 0)
    .map((part) => {
      const comparisons = compareParts(target, part);
      const score = comparisons.reduce((sum, item) => sum + item.score, 0);
      return { part, comparisons, score: Math.round(score * 1000) / 1000 };
    })
    .filter((entry) => entry.score >= floor)
    // 同点のときは図番順。並びが実行ごとに変わらないようにする。
    .sort((a, b) => b.score - a.score || a.part.drawing_no.localeCompare(b.part.drawing_no))
    .slice(0, limit);

  const candidates: SimilarCandidate[] = scored.map((entry) => {
    const quotes = candidateQuotes(entry.part.drawing_no);
    const reviewPoints: string[] = [];

    for (const quote of quotes) {
      if (quote.beforeMaterialRevision) {
        reviewPoints.push(
          `候補 ${entry.part.drawing_no} の見積 ${quote.quoteNo}（${quote.issuedOn}）は材料費改定日 ${MATERIAL_REVISION} より前のものです。改定の反映要否を確認してください。`,
        );
      }
    }

    const differentMaterial = entry.comparisons.find(
      (item) => item.key === "material" && item.match === "different",
    );
    if (differentMaterial) {
      reviewPoints.push(
        `候補 ${entry.part.drawing_no} は材質が異なります（${differentMaterial.candidate} / ${differentMaterial.target}）。材料費の差を単価に反映する必要があります。`,
      );
    }

    const differentProcess = entry.comparisons.find(
      (item) => item.key === "process" && item.match === "different",
    );
    if (differentProcess) {
      reviewPoints.push(
        `候補 ${entry.part.drawing_no} は工法が異なります（${differentProcess.candidate} / ${differentProcess.target}）。単価の構成が変わるため、目安としては使えません。`,
      );
    }

    return {
      drawingNo: entry.part.drawing_no,
      name: entry.part.name,
      score: entry.score,
      spec: specBasis(entry.part),
      comparisons: entry.comparisons,
      quotes,
      directions: priceDirections(target, entry.part),
      reviewPoints,
    };
  });

  const reviewPoints: string[] = [];

  if (ownHistory.length === 0) {
    reviewPoints.push(
      `図番 ${target.drawing_no} の過去見積が書類の中に 1 件もありません。下の候補は仕様が近い別の図番の実績で、${target.drawing_no} の単価ではありません。`,
    );
  } else {
    reviewPoints.push(
      `図番 ${target.drawing_no} には過去見積が ${ownHistory.length} 件あります。類似品より自身の実績を先に確認してください。`,
    );
  }

  if (candidates.length > 0) {
    reviewPoints.push(
      "候補の単価は参考値です。材質・板厚・寸法の違いを単価に反映する作業は、人が行う必要があります。",
    );

    if (candidates.every((candidate) => candidate.comparisons.some(
      (item) => item.key === "process" && item.match === "different",
    ))) {
      reviewPoints.push(
        "工法が異なる候補しか見つかりませんでした。過去見積からの類推は避け、工程から積み上げてください。",
      );
    }

    for (const candidate of candidates) {
      reviewPoints.push(...candidate.reviewPoints);
    }
  }

  const note =
    candidates.length > 0
      ? ""
      : `図番 ${target.drawing_no} に近い部品が書類の中にありません。仕様の近い実績が無いため、工程から積み上げて単価を決める必要があります。`;

  if (candidates.length === 0) {
    reviewPoints.push(note);
  }

  return {
    drawingNo: target.drawing_no,
    found: true,
    target,
    targetBasis: specBasis(target),
    hasOwnQuoteHistory: ownHistory.length > 0,
    candidates,
    reviewPoints,
    unitPriceSettled: false,
    note,
  };
}

/**
 * 質問から「回答に使ってよい事実」と「根拠カード」を決定的に組み立てる。
 *
 * ここが本デモの肝。LLM に書類を読ませて答えさせるのではなく、
 *
 *   1. BM25 でチャンクを引く（根拠カード）
 *   2. 質問の種類を判定し、構造化データから事実を文として組み立てる
 *   3. その事実だけを LLM に渡して日本語に整えてもらう
 *
 * という順にしている。2 までが決定的なので、LLM を mock から Claude に替えても
 * 数字は変わらない。書類に無いことは facts が空になり、notFound として正直に返す。
 */

import {
  chunks,
  getChunk,
  getChunkIndex,
  getPart,
  getQuoteHistory,
  quoteData,
  type RuleKey,
} from "./data";
import { findDrawingNumbers } from "./inquiry";

export type Intent = "price" | "spec" | "rule" | "general";

export interface Citation {
  chunkId: string;
  docId: string;
  docTitle: string;
  pdf: string;
  page: number;
  section: string;
  excerpt: string;
  score: number;
}

export interface AnswerContext {
  question: string;
  intent: Intent;
  drawingNo: string | null;
  facts: string[];
  citations: Citation[];
  notFound: boolean;
}

const EXCERPT_LENGTH = 180;

/** BM25 の最高スコアがこれを下回ったら、関連する記述は無いとみなす。 */
const RELEVANCE_FLOOR = 0.8;

const INTENT_KEYWORDS: Record<Exclude<Intent, "general">, RegExp[]> = {
  price: [/いくら/, /単価/, /価格/, /金額/, /見積/, /前回/, /実績/],
  rule: [
    /割増/,
    /値引/,
    /短納期/,
    /最低受注/,
    /最小ロット/,
    /改定/,
    /有効期限/,
    /社内ルール/,
    /基準/,
    /標準納期/,
  ],
  spec: [
    /材質/,
    /表面処理/,
    /寸法/,
    /公差/,
    /仕様/,
    /加工/,
    /めっき/,
    /メッキ/,
    /膜厚/,
    /板厚/,
    /検査/,
  ],
};

const RULE_KEYWORDS: [RegExp, RuleKey][] = [
  [/短納期|割増/, "rush_surcharges"],
  [/値引/, "volume_discounts"],
  [/最低受注/, "min_order_amount"],
  [/最小ロット|ロット/, "min_lots"],
  [/材料費|改定/, "material_revision"],
  [/有効期限/, "quote_validity_days"],
  [/標準納期/, "standard_lead_time_days"],
];

function excerpt(text: string): string {
  const flat = text.replace(/\n/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH
    ? flat
    : `${flat.slice(0, EXCERPT_LENGTH)}…`;
}

export function detectIntent(question: string): Intent {
  let best: Intent = "general";
  let bestScore = 0;
  for (const [intent, patterns] of Object.entries(INTENT_KEYWORDS)) {
    const score = patterns.filter((pattern) => pattern.test(question)).length;
    if (score > bestScore) {
      bestScore = score;
      best = intent as Intent;
    }
  }
  return best;
}

function searchCitations(question: string, limit: number): Citation[] {
  return getChunkIndex()
    .search(question, limit)
    .flatMap((hit) => {
      const chunk = getChunk(hit.id);
      if (!chunk) return [];
      return [
        {
          chunkId: chunk.chunk_id,
          docId: chunk.doc_id,
          docTitle: chunk.doc_title,
          pdf: chunk.pdf,
          page: chunk.page,
          section: chunk.section,
          excerpt: excerpt(chunk.text),
          score: Math.round(hit.score * 1000) / 1000,
        },
      ];
    });
}

/**
 * 事実の出どころになった書類・ページを、根拠カードの先頭に置く。
 * BM25 が上位に出していなくても必ず 1 枚目に来るようにする。
 * 答えの根拠と、画面に出る根拠がずれていると、デモとして意味がないため。
 */
function promote(citations: Citation[], docId: string, page: number): Citation[] {
  const index = citations.findIndex(
    (citation) => citation.docId === docId && citation.page === page,
  );
  if (index === 0) return citations;
  if (index > 0) {
    const rest = citations.slice();
    const [found] = rest.splice(index, 1);
    return [found, ...rest];
  }

  // 検索結果に入っていなかった場合は、そのページのチャンクから根拠カードを作って足す。
  const chunk = chunks.find((item) => item.doc_id === docId && item.page === page);
  if (!chunk) return citations;
  return [
    {
      chunkId: chunk.chunk_id,
      docId: chunk.doc_id,
      docTitle: chunk.doc_title,
      pdf: chunk.pdf,
      page: chunk.page,
      section: chunk.section,
      excerpt: excerpt(chunk.text),
      score: 0,
    },
    ...citations,
  ];
}

function priceFacts(drawingNo: string): {
  facts: string[];
  notFound: boolean;
  docId?: string;
  page?: number;
} {
  const history = getQuoteHistory(drawingNo);
  if (history.length === 0) {
    const part = getPart(drawingNo);
    const facts = part
      ? [
          `図番 ${drawingNo}（${part.name}）の部品仕様書はありますが、過去見積は書類の中に 1 件もありません。`,
        ]
      : [`図番 ${drawingNo} に関する書類が見つかりません。`];
    return { facts, notFound: true, docId: part?.doc_id, page: part?.page };
  }

  const latest = history[history.length - 1];
  const facts = [
    `図番 ${drawingNo}（${latest.line.name}）の直近の見積は ${latest.quote.quote_no}、発行日 ${latest.quote.issued_on} です。`,
    `数量 ${latest.line.quantity.toLocaleString()} 個、単価 ${latest.line.unit_price.toLocaleString()} 円、金額 ${latest.line.amount.toLocaleString()} 円、納期 ${latest.line.lead_time_days} 営業日でした。`,
  ];

  if (history.length > 1) {
    const past = history
      .slice(0, -1)
      .map(
        (entry) =>
          `${entry.quote.quote_no}（${entry.quote.issued_on}）が数量 ${entry.line.quantity.toLocaleString()} 個で単価 ${entry.line.unit_price.toLocaleString()} 円`,
      )
      .join("、");
    facts.push(`これ以前の実績は ${past} です。`);
  }

  const revision = quoteData.rules.values.material_revision.effective_from;
  if (latest.quote.issued_on < revision) {
    facts.push(
      `この見積は材料費改定日 ${revision} より前のものです。そのまま使えるかは確認が必要です。`,
    );
  }

  return {
    facts,
    notFound: false,
    docId: latest.quote.doc_id,
    page: latest.quote.page,
  };
}

function specFacts(drawingNo: string): {
  facts: string[];
  notFound: boolean;
  docId?: string;
  page?: number;
} {
  const part = getPart(drawingNo);
  if (!part) {
    return {
      facts: [`図番 ${drawingNo} の部品仕様書は書類の中にありません。`],
      notFound: true,
    };
  }
  return {
    facts: [
      `図番 ${part.drawing_no}（${part.name}）の材質は ${part.material}、表面処理は ${part.surface_treatment} です。`,
      `外形寸法は ${part.dimensions}、公差は ${part.tolerance}、加工区分は ${part.process_category} です。`,
      `最小ロットは ${part.min_lot} 個、標準納期は ${part.standard_lead_time_days} 営業日です（${part.revision}、発行日 ${part.issued_on}）。`,
    ],
    notFound: false,
    docId: part.doc_id,
    page: part.page,
  };
}

function ruleFacts(question: string): {
  facts: string[];
  notFound: boolean;
  docId?: string;
  page?: number;
} {
  const rules = quoteData.rules;
  const values = rules.values;
  const matched = RULE_KEYWORDS.find(([pattern]) => pattern.test(question));
  if (!matched) return { facts: [], notFound: true };

  const key = matched[1];
  const ref = rules.refs[key];
  const facts: string[] = [];

  switch (key) {
    case "rush_surcharges":
      facts.push(
        `社内見積基準の短納期割増は、${values.rush_surcharges
          .slice()
          .sort((a, b) => b.max_lead_time_days - a.max_lead_time_days)
          .map(
            (tier) =>
              `${tier.max_lead_time_days} 営業日以内で ${(tier.rate * 100).toFixed(0)}%`,
          )
          .join("、")} です。`,
        "割増は数量値引を適用したあとの単価に対して計算します。",
      );
      break;
    case "volume_discounts":
      facts.push(
        `数量値引は、${values.volume_discounts
          .map(
            (tier) =>
              `${tier.min_quantity.toLocaleString()} 個以上で ${(tier.rate * 100).toFixed(0)}%`,
          )
          .join("、")} です。区分は重複適用しません。`,
      );
      break;
    case "min_order_amount":
      facts.push(
        `最低受注金額は 1 件あたり ${values.min_order_amount.toLocaleString()} 円です。下回る場合は段取り費を計上するか、受注を見送ります。`,
      );
      break;
    case "min_lots":
      facts.push(
        `最小ロットは、${Object.entries(values.min_lots)
          .map(([category, lot]) => `${category}部品が ${lot} 個`)
          .join("、")} です。`,
      );
      break;
    case "material_revision":
      facts.push(
        `材料費の改定日は ${values.material_revision.effective_from} です。`,
        `${Object.entries(values.material_revision.increases)
          .map(([material, rate]) => `${material}が ${(rate * 100).toFixed(0)}% 引き上げ`)
          .join("、")} になっています。`,
      );
      break;
    case "quote_validity_days":
      facts.push(`見積の有効期限は発行日から ${values.quote_validity_days} 日です。`);
      break;
    case "standard_lead_time_days":
      facts.push(
        `標準納期は、${Object.entries(values.standard_lead_time_days)
          .map(([category, days]) => `${category}部品が ${days} 営業日`)
          .join("、")} です。外注工程を含む場合は 3 営業日を加算します。`,
      );
      break;
  }

  return { facts, notFound: false, docId: rules.doc_id, page: ref.page };
}

export function buildAnswerContext(question: string): AnswerContext {
  const trimmed = question.trim();
  const citations = searchCitations(trimmed, 4);
  const drawingNumbers = findDrawingNumbers(trimmed);
  const drawingNo = drawingNumbers[0] ?? null;
  const intent = detectIntent(trimmed);

  let facts: string[] = [];
  let notFound = false;
  let docId: string | undefined;
  let page: number | undefined;

  if (intent === "price" && drawingNo) {
    ({ facts, notFound, docId, page } = priceFacts(drawingNo));
  } else if (intent === "spec" && drawingNo) {
    ({ facts, notFound, docId, page } = specFacts(drawingNo));
  } else if (intent === "rule") {
    ({ facts, notFound, docId, page } = ruleFacts(trimmed));
  }

  // 構造化データで答えられない質問は、検索結果そのものを根拠として返す。
  if (facts.length === 0) {
    const top = citations[0];
    if (!top || top.score < RELEVANCE_FLOOR) {
      notFound = true;
    } else {
      facts = [
        `${top.docTitle} の「${top.section}」に次の記載があります。`,
        top.excerpt,
      ];
    }
  }

  const ordered =
    docId !== undefined && page !== undefined
      ? promote(citations, docId, page)
      : citations;

  return {
    question: trimmed,
    intent,
    drawingNo,
    facts,
    citations: ordered,
    notFound,
  };
}

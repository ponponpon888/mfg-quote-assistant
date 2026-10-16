/**
 * 問い合わせメールの本文から、図番・数量・希望納期を取り出す。
 *
 * ここも LLM を使わない。抽出が外れたときに、文面を見れば理由が分かる形にしておきたいため。
 * 正規表現で候補を拾い、書類に実在する図番の辞書で正規化する、という二段構え。
 *
 * 辞書に無い図番も捨てずに通す。「書類に無い図番です」と画面で言えたほうが、
 * 黙って落とすより正しいふるまいだから。
 */

import { knownDrawingNumbers } from "./data";
import type { QuoteRequestItem } from "./quote";

/** 「SS-1023」「SS1023」「ss-1023」を拾う。 */
const DRAWING_CANDIDATE = /[A-Za-z]{2,3}-?\d{3,5}/g;

const QUANTITY_PATTERNS = [
  /数量[^0-9]{0,8}([\d,]+)\s*(?:個|本|枚|台|ヶ|pcs)/i,
  /([\d,]+)\s*(?:個|本|枚|台|ヶ)/,
];

const LEAD_TIME_PATTERNS = [
  /([\d]+)\s*営業日/,
  /([\d]+)\s*日以内/,
  /納期[^0-9]{0,10}([\d]+)\s*日/,
];

const STANDARD_LEAD_TIME = /通常納期|標準納期|通常の納期/;

export interface ParsedInquiry {
  items: QuoteRequestItem[];
  /** 抽出しきれなかった点。画面で «人が確認すべき点» として出す。 */
  issues: string[];
}

function toNumber(raw: string): number {
  return Number.parseInt(raw.replace(/,/g, ""), 10);
}

/**
 * 文中の図番を、書類に実在する表記へ正規化して返す。
 * 辞書に無いものも返す（「書類に無い図番です」と言うため）。
 */
export function findDrawingNumbers(text: string): string[] {
  const normalized = text.normalize("NFKC");
  const canonical = new Map(
    knownDrawingNumbers().map((value) => [
      value.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      value,
    ]),
  );
  const found: string[] = [];
  for (const match of normalized.matchAll(DRAWING_CANDIDATE)) {
    const key = match[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const drawingNo = canonical.get(key) ?? match[0].toUpperCase();
    if (!found.includes(drawingNo)) found.push(drawingNo);
  }
  return found;
}

function findQuantity(segment: string): number | null {
  for (const pattern of QUANTITY_PATTERNS) {
    const match = segment.match(pattern);
    if (match) {
      const value = toNumber(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

/** 希望納期（営業日）。通常納期と書かれていれば null、読み取れなければ undefined。 */
function findLeadTime(segment: string): number | null | undefined {
  for (const pattern of LEAD_TIME_PATTERNS) {
    const match = segment.match(pattern);
    if (match) {
      const value = toNumber(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  if (STANDARD_LEAD_TIME.test(segment)) return null;
  return undefined;
}

export function parseInquiry(text: string): ParsedInquiry {
  const normalized = text.normalize("NFKC");

  const known = knownDrawingNumbers();
  const canonical = new Map(
    known.map((value) => [value.replace(/[^A-Za-z0-9]/g, "").toUpperCase(), value]),
  );

  const matches = [...normalized.matchAll(DRAWING_CANDIDATE)];
  const items: QuoteRequestItem[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end = matches[i + 1]?.index ?? normalized.length;
    // 図番が出てきた位置から次の図番の直前までを、その 1 件ぶんの記述とみなす。
    const segment = normalized.slice(start, end);

    const key = match[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const drawingNo = canonical.get(key) ?? match[0].toUpperCase();
    if (seen.has(drawingNo)) continue;

    const quantity = findQuantity(segment);
    if (quantity === null) {
      issues.push(
        `図番 ${drawingNo} は見つかりましたが、数量を読み取れませんでした。文面を確認してください。`,
      );
      continue;
    }

    const leadTime = findLeadTime(segment);
    if (leadTime === undefined) {
      issues.push(
        `図番 ${drawingNo} の希望納期を読み取れなかったため、標準納期で計算しています。`,
      );
    }
    if (!canonical.has(key)) {
      issues.push(
        `図番 ${drawingNo} は書類の中に見つかりません。図番の表記を確認してください。`,
      );
    }

    seen.add(drawingNo);
    items.push({
      drawingNo,
      quantity,
      leadTimeDays: leadTime ?? null,
    });
  }

  if (items.length === 0 && issues.length === 0) {
    issues.push(
      "文面から図番を見つけられませんでした。「図番 SS-1023 を 150 個」のような書き方だと読み取れます。",
    );
  }

  return { items, issues };
}

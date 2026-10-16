/**
 * ingest が書き出した 2 つの JSON を読み、型を付けて配る。
 *
 * fs ではなく import で取り込んでいる。Vercel の関数バンドルに public/ の中身が
 * 必ず含まれる保証がないため、ビルド時にバンドルへ同梱されるこの形のほうが安全。
 */

import indexJson from "@/public/index.json";
import quotesJson from "@/public/quotes.json";
import { Bm25Index } from "./bm25";

export type DocType = "part_spec" | "quote" | "internal_rule";

export interface DocPage {
  page: number;
  text: string;
}

export interface DocSection {
  section: string;
  page: number;
}

export interface IndexedDoc {
  doc_id: string;
  title: string;
  doc_type: DocType;
  pdf: string;
  issued_on: string;
  page_count: number;
  sections: DocSection[];
  pages: DocPage[];
}

export interface Chunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  doc_type: DocType;
  pdf: string;
  page: number;
  section: string;
  text: string;
}

export interface SearchIndex {
  generated_at: string;
  company: string;
  notice: string;
  docs: IndexedDoc[];
  chunks: Chunk[];
}

export interface PastQuoteLine {
  drawing_no: string;
  name: string;
  material: string;
  surface_treatment: string;
  quantity: number;
  unit_price: number;
  amount: number;
  material_cost: number;
  processing_cost: number;
  surface_cost: number;
  lead_time_days: number;
}

export interface PastQuote {
  doc_id: string;
  title: string;
  pdf: string;
  page: number;
  quote_no: string;
  issued_on: string;
  valid_until: string;
  customer: string;
  issuer: string;
  payment_terms: string;
  delivery_place: string;
  total_amount: number;
  lines: PastQuoteLine[];
}

export interface PartSpec {
  doc_id: string;
  title: string;
  pdf: string;
  drawing_no: string;
  name: string;
  material: string;
  surface_treatment: string;
  dimensions: string;
  tolerance: string;
  process_category: string;
  min_lot: number;
  standard_lead_time_days: number;
  issued_on: string;
  revision: string;
  issuer: string;
  page: number;
}

export interface VolumeDiscount {
  min_quantity: number;
  rate: number;
}

export interface RushSurcharge {
  max_lead_time_days: number;
  rate: number;
}

export interface RuleValues {
  quote_validity_days: number;
  min_order_amount: number;
  volume_discounts: VolumeDiscount[];
  rush_surcharges: RushSurcharge[];
  min_lots: Record<string, number>;
  standard_lead_time_days: Record<string, number>;
  material_revision: {
    effective_from: string;
    increases: Record<string, number>;
  };
}

export type RuleKey = keyof RuleValues;

export interface RuleRef {
  section: string;
  page: number;
}

export interface Rules {
  doc_id: string;
  title: string;
  pdf: string;
  issued_on: string;
  values: RuleValues;
  refs: Record<RuleKey, RuleRef>;
}

/** 画面のサンプル入力に使う問い合わせメール。data/source の .md が元。 */
export interface Inquiry {
  id: string;
  label: string;
  text: string;
}

export interface QuoteData {
  generated_at: string;
  company: string;
  quotes: PastQuote[];
  parts: PartSpec[];
  rules: Rules;
  inquiries: Inquiry[];
}

export const searchIndex = indexJson as unknown as SearchIndex;
export const quoteData = quotesJson as unknown as QuoteData;

export const chunks: Chunk[] = searchIndex.chunks;
export const docs: IndexedDoc[] = searchIndex.docs;

let cachedIndex: Bm25Index | null = null;

/** チャンク全体の BM25 索引。プロセス内で一度だけ作る。 */
export function getChunkIndex(): Bm25Index {
  if (!cachedIndex) {
    cachedIndex = new Bm25Index(
      chunks.map((chunk) => ({
        id: chunk.chunk_id,
        // 見出しと書類名も検索対象に入れる。「見積書」「社内見積基準」で引けるように。
        text: `${chunk.doc_title}\n${chunk.section}\n${chunk.text}`,
      })),
    );
  }
  return cachedIndex;
}

export function getChunk(chunkId: string): Chunk | undefined {
  return chunks.find((chunk) => chunk.chunk_id === chunkId);
}

export function getDoc(docId: string): IndexedDoc | undefined {
  return docs.find((doc) => doc.doc_id === docId);
}

export function getPart(drawingNo: string): PartSpec | undefined {
  const needle = drawingNo.toUpperCase();
  return quoteData.parts.find((part) => part.drawing_no.toUpperCase() === needle);
}

/** 指定図番を含む過去見積の明細を、発行日の古い順で返す。 */
export function getQuoteHistory(
  drawingNo: string,
): { quote: PastQuote; line: PastQuoteLine }[] {
  const needle = drawingNo.toUpperCase();
  const history: { quote: PastQuote; line: PastQuoteLine }[] = [];
  for (const quote of quoteData.quotes) {
    for (const line of quote.lines) {
      if (line.drawing_no.toUpperCase() === needle) {
        history.push({ quote, line });
      }
    }
  }
  history.sort((a, b) => a.quote.issued_on.localeCompare(b.quote.issued_on));
  return history;
}

/** 書類に出てくる図番の一覧。問い合わせ文から図番を拾うときの辞書に使う。 */
export function knownDrawingNumbers(): string[] {
  const set = new Set<string>();
  for (const part of quoteData.parts) set.add(part.drawing_no.toUpperCase());
  for (const quote of quoteData.quotes) {
    for (const line of quote.lines) set.add(line.drawing_no.toUpperCase());
  }
  return [...set].sort();
}

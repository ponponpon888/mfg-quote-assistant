/**
 * BM25 の最小実装。
 *
 * 書類が 8 本・チャンクが 50 件という規模なので、検索エンジンを持ち込まずに
 * その場で索引を作る。ベクトル検索を使わないのは、図番や「3%」のような
 * 短くて正確さが要る語を取りこぼさないため。埋め込みは外部 API を呼ぶ必要も出る。
 *
 * スコアは入力が同じなら必ず同じ。同点のときは id の昇順で並べ、
 * 実行のたびに根拠カードの順序が入れ替わらないようにしている。
 */

import { tokenize } from "./tokenize";

export interface Bm25Input {
  id: string;
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

export interface Bm25Options {
  /** 語の出現回数の効きを抑える係数。 */
  k1?: number;
  /** 文書長による正規化の強さ。 */
  b?: number;
}

interface IndexedDocument {
  id: string;
  length: number;
  frequencies: Map<string, number>;
}

export class Bm25Index {
  private readonly documents: IndexedDocument[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(inputs: Bm25Input[], options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;

    for (const input of inputs) {
      const tokens = tokenize(input.text);
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      for (const token of frequencies.keys()) {
        this.documentFrequency.set(
          token,
          (this.documentFrequency.get(token) ?? 0) + 1,
        );
      }
      this.documents.push({
        id: input.id,
        length: tokens.length,
        frequencies,
      });
    }

    const total = this.documents.reduce((sum, doc) => sum + doc.length, 0);
    this.averageLength = this.documents.length ? total / this.documents.length : 0;
  }

  get size(): number {
    return this.documents.length;
  }

  /** 語の逆文書頻度。どの文書にも出る語ほど 0 に近づく。 */
  private idf(token: string): number {
    const df = this.documentFrequency.get(token) ?? 0;
    if (df === 0) return 0;
    const n = this.documents.length;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  scoreDocument(queryTokens: string[], doc: IndexedDocument): number {
    if (this.averageLength === 0) return 0;
    let score = 0;
    for (const token of queryTokens) {
      const frequency = doc.frequencies.get(token);
      if (!frequency) continue;
      const numerator = frequency * (this.k1 + 1);
      const denominator =
        frequency +
        this.k1 * (1 - this.b + (this.b * doc.length) / this.averageLength);
      score += this.idf(token) * (numerator / denominator);
    }
    return score;
  }

  search(query: string, limit = 5): Bm25Hit[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const hits: Bm25Hit[] = [];
    for (const doc of this.documents) {
      const score = this.scoreDocument(queryTokens, doc);
      if (score > 0) hits.push({ id: doc.id, score });
    }

    // 同点のときに順序が揺れないよう、id で決着をつける。
    hits.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
    return hits.slice(0, limit);
  }
}

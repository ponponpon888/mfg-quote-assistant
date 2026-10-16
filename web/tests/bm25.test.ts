import { describe, expect, it } from "vitest";

import { Bm25Index } from "@/lib/bm25";
import { getChunk, getChunkIndex } from "@/lib/data";

const SAMPLE = [
  { id: "a", text: "短納期の割増は 10 営業日以内で 20% です" },
  { id: "b", text: "数量値引は 100 個以上で 3% です" },
  { id: "c", text: "図番 SS-1023 はブラケット、材質は SPCC t3.2 です" },
];

describe("Bm25Index", () => {
  it("語を含む文書だけを返す", () => {
    const index = new Bm25Index(SAMPLE);
    const hits = index.search("割増");
    expect(hits.map((hit) => hit.id)).toEqual(["a"]);
  });

  it("共通する語が無ければ何も返さない", () => {
    const index = new Bm25Index(SAMPLE);
    expect(index.search("為替相場")).toEqual([]);
  });

  it("bi-gram がかすっただけでも低いスコアが付く（だから閾値で切る）", () => {
    // 「ロボット」と「ブラケット」は "ット" を共有する。この取りこぼしの無さが
    // bi-gram の利点である一方、無関係な文書も拾う。answer.ts 側で下限スコアを
    // 設けて「見つかりませんでした」に倒しているのはこのため。
    const index = new Bm25Index(SAMPLE);
    const hits = index.search("溶接ロボット導入計画");
    expect(hits.map((hit) => hit.id)).toEqual(["c"]);
    expect(hits[0].score).toBeLessThan(index.search("SS-1023")[0].score);
  });

  it("空の問い合わせでは何も返さない", () => {
    const index = new Bm25Index(SAMPLE);
    expect(index.search("")).toEqual([]);
    expect(index.search("   ")).toEqual([]);
  });

  it("figure number で該当文書が 1 位になる", () => {
    const index = new Bm25Index(SAMPLE);
    expect(index.search("SS-1023")[0].id).toBe("c");
  });

  it("limit を超えて返さない", () => {
    const index = new Bm25Index(SAMPLE);
    expect(index.search("です", 2).length).toBeLessThanOrEqual(2);
  });

  it("同じ問い合わせなら毎回同じ順序になる", () => {
    const index = new Bm25Index(SAMPLE);
    const first = index.search("です", 3);
    const second = index.search("です", 3);
    expect(first).toEqual(second);
  });
});

describe("書類チャンクの検索", () => {
  it("短納期割増の質問で社内見積基準の第 5 章が 1 位になる", () => {
    const top = getChunkIndex().search("短納期の割増は何％？", 3)[0];
    const chunk = getChunk(top.id);
    expect(chunk?.doc_id).toBe("RULE-001");
    expect(chunk?.section).toBe("5. 短納期割増率");
  });

  it("図番で引くとその図番の書類が上位に来る", () => {
    const hits = getChunkIndex().search("SF-2040 の材質と表面処理は？", 3);
    const docIds = hits.map((hit) => getChunk(hit.id)?.doc_id);
    expect(docIds).toContain("SPEC-SF-2040");
  });

  it("書類に無い話題ではスコアが付かない", () => {
    expect(getChunkIndex().search("本日の東京の天気", 3)).toEqual([]);
  });
});

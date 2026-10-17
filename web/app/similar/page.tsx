import type { Metadata } from "next";

import { getQuoteHistory, quoteData } from "@/lib/data";

import { SimilarClient, type PartChoice } from "./similar-client";

export const metadata: Metadata = {
  title: "類似品から相談する | 町工場の見積アシスタント（デモ）",
};

export default function SimilarPage() {
  const parts: PartChoice[] = quoteData.parts.map((part) => ({
    drawingNo: part.drawing_no,
    name: part.name,
    processCategory: part.process_category,
    hasQuoteHistory: getQuoteHistory(part.drawing_no).length > 0,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          類似品から相談する
        </h1>
        <p className="text-muted max-w-2xl text-sm">
          過去見積が無い図番でも、仕様の近い部品の実績なら示せます。
          項目ごとの一致・相違と、その違いで単価がどちらに振れるかを並べます。
          <span className="text-warning">
            {" "}
            この画面は単価を作りません。
          </span>
          出すのは候補の実績（参考値）と、振れる方向だけです。
        </p>
      </header>

      <SimilarClient parts={parts} />
    </div>
  );
}

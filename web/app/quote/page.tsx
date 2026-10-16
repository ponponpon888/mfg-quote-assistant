import type { Metadata } from "next";

import { quoteData } from "@/lib/data";

import { QuoteClient } from "./quote-client";

export const metadata: Metadata = {
  title: "見積の下書き | 町工場の見積アシスタント（デモ）",
};

export default function QuotePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          問い合わせ文から見積の下書きを作る
        </h1>
        <p className="text-muted max-w-2xl text-sm">
          図番・数量・希望納期を読み取り、過去見積から数量に応じた単価を内挿し、
          社内ルールの数量値引と短納期割増を順に適用します。
          金額は決定的に計算していて、LLM が触れるのは申し送りの文面だけです。
        </p>
      </header>

      <QuoteClient samples={quoteData.inquiries} />
    </div>
  );
}

import type { Metadata } from "next";

import { AskClient } from "./ask-client";

export const metadata: Metadata = {
  title: "書類に質問する | 町工場の見積アシスタント（デモ）",
};

export default function AskPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          書類に質問する
        </h1>
        <p className="text-muted max-w-2xl text-sm">
          架空の部品仕様書・過去見積・社内ルールから探して答えます。
          書類に書かれていないことは、作らずに「見つかりませんでした」と返します。
          4 つめのサンプルがその例です（仕様書はあるが、過去見積が無い図番）。
        </p>
      </header>

      <AskClient />
    </div>
  );
}

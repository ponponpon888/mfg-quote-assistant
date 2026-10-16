import Link from "next/link";

import { quoteData, searchIndex } from "@/lib/data";

const DOC_TYPE_LABEL: Record<string, string> = {
  part_spec: "部品仕様書",
  quote: "過去見積",
  internal_rule: "社内ルール",
};

export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          製造業の書類から、根拠つきで答える
        </h1>
        <p className="text-muted max-w-2xl text-sm sm:text-base">
          架空の町工場「{quoteData.company}」の書類 {searchIndex.docs.length} 件を
          PDF から取り込み、質問への回答と見積の下書きを作ります。
          出てきた数字は、どの書類の何ページから来たのかを必ず辿れます。
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/ask"
          className="border-line bg-surface hover:border-accent group flex flex-col gap-2 rounded-lg border p-5 transition-colors"
        >
          <h2 className="group-hover:text-accent text-lg font-semibold transition-colors">
            書類に質問する →
          </h2>
          <p className="text-muted text-sm">
            「SS-1023 を前回いくらで出した？」のように聞くと、回答と根拠カード
            （書類名・ページ・抜粋）が出ます。書類に無いことは「見つかりませんでした」と答えます。
          </p>
        </Link>

        <Link
          href="/quote"
          className="border-line bg-surface hover:border-accent group flex flex-col gap-2 rounded-lg border p-5 transition-colors"
        >
          <h2 className="group-hover:text-accent text-lg font-semibold transition-colors">
            見積の下書きを作る →
          </h2>
          <p className="text-muted text-sm">
            問い合わせメールを貼ると、図番・数量・希望納期を読み取り、
            過去見積と社内ルールから単価を組み立てます。「人が確認すべき点」も一緒に出します。
          </p>
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">仕組み</h2>
        <ol className="border-line bg-surface flex flex-col gap-3 rounded-lg border p-5 text-sm">
          <li>
            <span className="font-semibold">1. 取り込み（Python）</span>
            <span className="text-muted">
              {" "}
              — PDF を pdfplumber でページ単位に読み、罫線表からセルを復元して
              金額・納期・材質を構造化します。表からセルを取るので、値に空白を含む
              「SPCC t3.2」でも列がずれません。
            </span>
          </li>
          <li>
            <span className="font-semibold">2. 検索（BM25）</span>
            <span className="text-muted">
              {" "}
              — 日本語は文字 bi-gram、図番は丸ごと 1 語として索引します。
              埋め込みを使わないので外部 API が要らず、図番や「3%」のような
              短い語を取りこぼしません。
            </span>
          </li>
          <li>
            <span className="font-semibold">3. 計算は決定的、LLM は整形のみ</span>
            <span className="text-muted">
              {" "}
              — 単価・値引・割増は TypeScript の純粋関数で計算します。LLM に渡すのは
              計算済みの数字だけなので、モデルを替えても見積額は変わりません。
            </span>
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">収録している書類</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {searchIndex.docs.map((doc) => (
            <li key={doc.doc_id}>
              <Link
                href={`/docs/${doc.doc_id}`}
                className="border-line bg-surface hover:border-accent flex items-baseline justify-between gap-3 rounded-md border px-4 py-3 text-sm transition-colors"
              >
                <span>
                  <span className="text-muted mr-2 text-xs">
                    {DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}
                  </span>
                  {doc.title}
                </span>
                <span className="text-muted shrink-0 text-xs">
                  {doc.page_count} ページ
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

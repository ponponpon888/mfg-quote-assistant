import type { Metadata } from "next";
import Link from "next/link";
import { Geist_Mono } from "next/font/google";

import { quoteData, searchIndex } from "@/lib/data";
import { getProviderName } from "@/lib/llm";

import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "町工場の見積アシスタント（デモ）",
  description:
    "架空の製造業書類から、根拠つきで答える・問い合わせ文から見積の下書きを作る、を試せるデモです。",
};

const NAV = [
  { href: "/", label: "概要" },
  { href: "/ask", label: "書類に質問する" },
  { href: "/quote", label: "見積の下書き" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  const provider = getProviderName();

  return (
    <html lang="ja" className={`${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* 架空書類であることは、どの画面でも常に見えている必要がある。 */}
        <div className="bg-warning-soft text-warning border-line border-b px-4 py-1.5 text-center text-xs">
          デモ：架空の会社・書類です。実在の企業・取引とは関係ありません。
        </div>

        <header className="border-line bg-surface border-b">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-base font-semibold tracking-tight">
              町工場の見積アシスタント
            </Link>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-muted hover:text-accent transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>

        <footer className="border-line text-muted border-t px-4 py-6 text-xs">
          <div className="mx-auto flex max-w-5xl flex-col gap-1">
            <p>
              LLM_PROVIDER:{" "}
              <code className="font-mono text-foreground">{provider}</code>
              {provider === "mock"
                ? "（外部 API を呼びません）"
                : "（Anthropic API を呼びます）"}
            </p>
            <p>
              書類 {searchIndex.docs.length} 件 / チャンク{" "}
              {searchIndex.chunks.length} 件 / 過去見積{" "}
              {quoteData.quotes.length} 件 ・ インデックス生成{" "}
              {searchIndex.generated_at}
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

"use client";

import { useEffect, useState } from "react";

import type { Chunk, IndexedDoc } from "@/lib/data";

/**
 * 根拠カードから `/docs/<id>#<chunkId>` で飛んでくる。
 * ハッシュに入っているチャンク id を見て、該当ページまでスクロールし、
 * その抜粋だけを強調する。チャンク本文はページ本文の連続した一部なので、
 * 単純な indexOf で位置が決まる。
 */
export function DocViewer({
  doc,
  chunks,
}: {
  doc: IndexedDoc;
  chunks: Chunk[];
}) {
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      setActiveChunkId(hash ? decodeURIComponent(hash) : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const activeChunk = chunks.find((chunk) => chunk.chunk_id === activeChunkId);

  useEffect(() => {
    if (!activeChunk) return;
    document
      .getElementById(`page-${activeChunk.page}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeChunk]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {doc.title}
        </h1>
        <p className="text-muted text-xs">
          発行日 {doc.issued_on} ・ {doc.page_count} ページ ・ 原本{" "}
          <code className="font-mono">data/pdf/{doc.pdf}</code>
        </p>
        {activeChunk && (
          <p className="border-accent/40 bg-accent-soft rounded-md border px-3 py-2 text-xs">
            {activeChunk.page} ページ「{activeChunk.section}」を強調表示しています。
          </p>
        )}
      </header>

      {doc.page_count > 1 && (
        <nav className="flex flex-wrap gap-2 text-xs">
          {doc.pages.map((page) => (
            <a
              key={page.page}
              href={`#page-${page.page}`}
              className="border-line bg-surface hover:border-accent rounded-full border px-3 py-1 transition-colors"
            >
              {page.page} ページ
            </a>
          ))}
        </nav>
      )}

      {doc.pages.map((page) => {
        const highlight =
          activeChunk && activeChunk.page === page.page ? activeChunk.text : null;
        const at = highlight ? page.text.indexOf(highlight) : -1;

        return (
          <section
            key={page.page}
            id={`page-${page.page}`}
            className="border-line bg-surface scroll-mt-20 rounded-lg border"
          >
            <div className="border-line text-muted border-b px-4 py-2 text-xs">
              {page.page} / {doc.page_count} ページ
            </div>
            <p className="px-4 py-4 text-sm leading-relaxed whitespace-pre-wrap">
              {at >= 0 && highlight ? (
                <>
                  {page.text.slice(0, at)}
                  <mark>{highlight}</mark>
                  {page.text.slice(at + highlight.length)}
                </>
              ) : (
                page.text
              )}
            </p>
          </section>
        );
      })}

      <p className="text-muted text-xs">
        ここに出ているのは PDF から pdfplumber で抽出したテキストです。
        各ページの全ページ共通の注記行は、検索の邪魔になるため取り除いてあります。
      </p>
    </div>
  );
}

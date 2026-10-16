import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { chunks, docs, getDoc } from "@/lib/data";

import { DocViewer } from "./doc-viewer";

/** 書類は 8 件で固定なので、全ページをビルド時に作る。 */
export function generateStaticParams() {
  return docs.map((doc) => ({ id: doc.doc_id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/docs/[id]">): Promise<Metadata> {
  const { id } = await params;
  const doc = getDoc(decodeURIComponent(id));
  return {
    title: doc
      ? `${doc.title} | 町工場の見積アシスタント（デモ）`
      : "書類が見つかりません",
  };
}

export default async function DocPage({ params }: PageProps<"/docs/[id]">) {
  const { id } = await params;
  const doc = getDoc(decodeURIComponent(id));
  if (!doc) notFound();

  const docChunks = chunks.filter((chunk) => chunk.doc_id === doc.doc_id);
  return <DocViewer doc={doc} chunks={docChunks} />;
}

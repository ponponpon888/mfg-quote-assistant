"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Citation {
  chunkId: string;
  docId: string;
  docTitle: string;
  pdf: string;
  page: number;
  section: string;
  excerpt: string;
  score: number;
}

interface AnswerResponse {
  question: string;
  intent: string;
  drawingNo: string | null;
  answer: string;
  notFound: boolean;
  facts: string[];
  citations: Citation[];
  provider: string;
  error?: string;
}

const SAMPLES = [
  "SS-1023 を前回いくらで出した？",
  "短納期の割増は何％？",
  "SF-2040 の材質と表面処理は？",
  "CV-3015 を前回いくらで出した？",
];

/** 状態を持たない通信部分。イベントからも URL からも同じものを使う。 */
async function fetchAnswer(question: string): Promise<AnswerResponse> {
  const response = await fetch("/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: question }),
  });
  const data = (await response.json()) as AnswerResponse;
  if (!response.ok) {
    throw new Error(data.error ?? "回答の取得に失敗しました。");
  }
  return data;
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function AskClient() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchAnswer(trimmed));
    } catch (cause) {
      setResult(null);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  // `/ask?q=...` で質問を共有できるようにする。
  // useSearchParams を使わず location から読むのは、このページを静的なまま
  // （Suspense 境界なしで）保つため。状態更新は通信の完了後に行う。
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!initial) return;

    let cancelled = false;
    void fetchAnswer(initial).then(
      (data) => {
        if (cancelled) return;
        setQuestion(initial);
        setResult(data);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setQuestion(initial);
        setError(messageOf(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例：SS-1023 を前回いくらで出した？"
            className="border-line bg-surface focus:border-accent w-full rounded-md border px-3 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={loading || question.trim() === ""}
            className="bg-accent shrink-0 rounded-md px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {loading ? "検索中…" : "質問する"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => void ask(sample)}
              disabled={loading}
              className="border-line bg-surface hover:border-accent rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40"
            >
              {sample}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <p className="border-warning/40 bg-warning-soft text-warning rounded-md border px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          <section
            className={`rounded-lg border p-5 ${
              result.notFound
                ? "border-warning/40 bg-warning-soft"
                : "border-line bg-surface"
            }`}
          >
            <h2 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
              回答
            </h2>
            <p className="text-sm whitespace-pre-wrap">{result.answer}</p>
          </section>

          {result.citations.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
                根拠（押すと書類の該当ページへ）
              </h2>
              <ul className="flex flex-col gap-2">
                {result.citations.map((citation) => (
                  <li key={citation.chunkId}>
                    <Link
                      href={`/docs/${citation.docId}#${citation.chunkId}`}
                      className="border-line bg-surface hover:border-accent block rounded-md border p-4 transition-colors"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {citation.docTitle}
                        </span>
                        <span className="text-muted font-mono text-xs">
                          {citation.page} ページ ・ {citation.section}
                        </span>
                      </div>
                      <p className="text-muted mt-2 text-xs">{citation.excerpt}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="border-line bg-surface rounded-lg border p-4 text-xs">
            <summary className="cursor-pointer font-semibold">
              この回答の組み立て方（LLM に渡した事実）
            </summary>
            <div className="text-muted mt-3 flex flex-col gap-2">
              <p>
                判定した質問の種類: <code className="font-mono">{result.intent}</code>
                {result.drawingNo && (
                  <>
                    {" "}
                    / 図番: <code className="font-mono">{result.drawingNo}</code>
                  </>
                )}{" "}
                / LLM: <code className="font-mono">{result.provider}</code>
              </p>
              {result.facts.length > 0 ? (
                <ul className="list-disc pl-5">
                  {result.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  事実を 1 つも組み立てられなかったため、LLM には「書類に無い」とだけ伝えています。
                </p>
              )}
              <p>
                これらの事実は検索結果と構造化データから決定的に作っています。LLM
                はこの外側の数値を書けません。
              </p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

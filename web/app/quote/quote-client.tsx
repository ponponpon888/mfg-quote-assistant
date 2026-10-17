"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Basis {
  kind: "quote" | "rule" | "spec";
  label: string;
  docId: string;
  pdf: string;
  page: number;
  section?: string;
}

interface QuoteStep {
  label: string;
  detail: string;
  before: number;
  after: number;
  basis: Basis;
}

interface QuoteItem {
  drawingNo: string;
  name: string;
  material: string;
  surfaceTreatment: string;
  processCategory: string;
  requestedQuantity: number;
  quantity: number;
  basePrice: number | null;
  unitPrice: number | null;
  amount: number | null;
  leadTimeDays: number | null;
  standardLeadTimeDays: number | null;
  steps: QuoteStep[];
  references: Basis[];
  reviewPoints: string[];
  quotable: boolean;
  note: string;
}

/** 下書きのあとにやる仕事の文面。決定的なテンプレートで、LLM を通していない。 */
interface FollowUp {
  internalRequest: string;
  customerReply: string;
}

interface QuoteResponse {
  items: QuoteItem[];
  /** 単価が確定した明細だけの合計。未見積があるときは確定額ではない。 */
  subtotal: number;
  hasUnquotedItems: boolean;
  unquotedDrawingNumbers: string[];
  quoteValidityDays: number;
  reviewPoints: string[];
  followUp: FollowUp;
  note: string;
  noteError: string | null;
  provider: string;
  error?: string;
}

export interface Sample {
  id: string;
  label: string;
  text: string;
}

const yen = (value: number) => `${value.toLocaleString()} 円`;

/** 状態を持たない通信部分。イベントからも URL からも同じものを使う。 */
async function fetchQuote(text: string): Promise<QuoteResponse> {
  const response = await fetch("/api/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = (await response.json()) as QuoteResponse;
  if (!response.ok) {
    throw new Error(data.error ?? "見積の作成に失敗しました。");
  }
  return data;
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

function BasisLink({ basis }: { basis: Basis }) {
  return (
    <Link
      href={`/docs/${basis.docId}`}
      className="text-accent hover:underline"
      title={`${basis.label} / ${basis.page} ページ`}
    >
      {basis.label}
      <span className="text-muted"> （{basis.page} ページ）</span>
    </Link>
  );
}

export function QuoteClient({ samples }: { samples: Sample[] }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      setResult(await fetchQuote(trimmed));
    } catch (cause) {
      setResult(null);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  // `/quote?sample=inquiry-01` でサンプルを開いた状態を共有できるようにする。
  // 状態更新は通信の完了後に行う（効果の本体で同期的に setState しない）。
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("sample");
    if (!wanted) return;
    const sample = samples.find((item) => item.id === wanted);
    if (!sample) return;

    let cancelled = false;
    void fetchQuote(sample.text).then(
      (data) => {
        if (cancelled) return;
        setText(sample.text);
        setResult(data);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setText(sample.text);
        setError(messageOf(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [samples]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {samples.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => {
              setText(sample.text);
              void submit(sample.text);
            }}
            disabled={loading}
            className="border-line bg-surface hover:border-accent rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40"
          >
            {sample.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(text);
        }}
        className="flex flex-col gap-3"
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          placeholder="問い合わせメールの本文を貼り付けてください。&#10;例：図番 SS-1023 を 150 個、納期 10営業日以内でお願いします。"
          className="border-line bg-surface focus:border-accent w-full rounded-md border px-3 py-2 font-mono text-xs leading-relaxed outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={loading || text.trim() === ""}
          className="bg-accent self-start rounded-md px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {loading ? "作成中…" : "見積の下書きを作る"}
        </button>
      </form>

      {error && (
        <p className="border-warning/40 bg-warning-soft text-warning rounded-md border px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-8">
          {result.note && (
            <section className="border-line bg-surface rounded-lg border p-5">
              {/* provider 名は uppercase にしない。フッターの表記と食い違うため。 */}
              <h2 className="text-muted mb-2 text-xs font-semibold tracking-wide">
                申し送り（LLM: {result.provider}）
              </h2>
              <p className="text-sm whitespace-pre-wrap">{result.note}</p>
            </section>
          )}

          {result.noteError && (
            <p className="border-warning/40 bg-warning-soft text-warning rounded-md border px-4 py-3 text-xs">
              文面の整形に失敗しました（{result.noteError}）。
              金額の計算は LLM に依存していないため、下の明細はそのまま使えます。
            </p>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
              見積書プレビュー
            </h2>
            <div className="border-line bg-surface overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="border-line text-muted border-b text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">図番</th>
                    <th className="px-3 py-2 text-left font-medium">品名</th>
                    <th className="px-3 py-2 text-left font-medium">材質</th>
                    <th className="px-3 py-2 text-right font-medium">数量</th>
                    <th className="px-3 py-2 text-right font-medium">単価</th>
                    <th className="px-3 py-2 text-right font-medium">金額</th>
                    <th className="px-3 py-2 text-right font-medium">納期</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.drawingNo} className="border-line border-b last:border-0">
                      <td className="px-3 py-2 font-mono">{item.drawingNo}</td>
                      <td className="px-3 py-2">{item.name || "—"}</td>
                      <td className="px-3 py-2">{item.material || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {item.quantity.toLocaleString()}
                        {item.quantity !== item.requestedQuantity && (
                          <span className="text-warning block text-xs">
                            依頼 {item.requestedQuantity.toLocaleString()}
                          </span>
                        )}
                      </td>
                      {item.quotable ? (
                        <>
                          <td className="px-3 py-2 text-right">
                            {item.unitPrice === null ? "—" : yen(item.unitPrice)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {item.amount === null ? "—" : yen(item.amount)}
                          </td>
                        </>
                      ) : (
                        <td colSpan={2} className="text-warning px-3 py-2 text-right">
                          未見積（過去見積なし）
                        </td>
                      )}
                      <td className="px-3 py-2 text-right">
                        {item.leadTimeDays === null
                          ? "—"
                          : `${item.leadTimeDays} 営業日`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-line border-t">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right text-xs">
                      {result.hasUnquotedItems
                        ? "小計（単価確定分のみ・消費税別）"
                        : "合計（消費税別）"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {yen(result.subtotal)}
                    </td>
                    <td />
                  </tr>
                  {/* 未見積があるときは、小計を合計額と読み違えさせない。 */}
                  {result.hasUnquotedItems && (
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-right text-xs">
                        合計（消費税別）
                      </td>
                      <td className="text-warning px-3 py-2 text-right font-semibold">
                        未確定
                      </td>
                      <td />
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
            <p className="text-muted text-xs">
              見積有効期限は発行日から {result.quoteValidityDays} 日（社内見積基準）。
              {result.hasUnquotedItems && (
                <span className="text-warning">
                  {" "}
                  {result.unquotedDrawingNumbers.join("、")}{" "}
                  の単価が未確定のため、この小計は見積の合計額ではありません。
                </span>
              )}
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
              単価の根拠
            </h2>
            {result.items.map((item) => (
              <div
                key={item.drawingNo}
                className="border-line bg-surface rounded-lg border p-4"
              >
                <h3 className="font-mono text-sm font-semibold">
                  {item.drawingNo}
                  {item.name && (
                    <span className="text-muted ml-2 font-sans text-xs">
                      {item.name}
                    </span>
                  )}
                </h3>

                {item.quotable ? (
                  <ol className="mt-3 flex flex-col gap-2 text-xs">
                    {item.steps.map((step) => (
                      <li
                        key={step.label}
                        className="border-line flex flex-col gap-1 border-l-2 pl-3"
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-semibold">{step.label}</span>
                          <span className="font-mono">
                            {step.before === step.after
                              ? yen(step.after)
                              : `${yen(step.before)} → ${yen(step.after)}`}
                          </span>
                        </div>
                        <p className="text-muted">{step.detail}</p>
                        <p>
                          根拠: <BasisLink basis={step.basis} />
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-warning mt-3 text-xs">{item.note}</p>
                )}
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
              人が確認すべき点（{result.reviewPoints.length} 件）
            </h2>
            {result.reviewPoints.length === 0 ? (
              <p className="text-muted text-sm">ありません。</p>
            ) : (
              <ul className="border-warning/40 bg-warning-soft flex list-disc flex-col gap-2 rounded-lg border py-4 pr-5 pl-9 text-sm">
                {result.reviewPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </section>

          {/* 下書きで終わらせず、次にやる仕事の文面まで出す。
              文面は決定的なテンプレートで、LLM を通していない。 */}
          <section className="flex flex-col gap-3">
            <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
              次の一手
            </h2>

            <details className="border-line bg-surface rounded-lg border p-4 text-xs">
              <summary className="cursor-pointer font-semibold">
                社内の確認依頼（ベテラン宛て）
              </summary>
              <pre className="mt-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {result.followUp.internalRequest}
              </pre>
            </details>

            <details className="border-line bg-surface rounded-lg border p-4 text-xs">
              <summary className="cursor-pointer font-semibold">
                お客さんへの回答メール下書き
                {result.hasUnquotedItems && (
                  <span className="text-warning ml-2 font-normal">
                    未確定の合計は書きません
                  </span>
                )}
              </summary>
              <pre className="mt-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {result.followUp.customerReply}
              </pre>
              {result.hasUnquotedItems && (
                <p className="text-muted mt-3">
                  {result.unquotedDrawingNumbers.join("、")}{" "}
                  は単価を書かず、回答期限だけを伝える文面にしています。
                  類似品の候補は{" "}
                  {result.unquotedDrawingNumbers.map((drawingNo, index) => (
                    <span key={drawingNo}>
                      {index > 0 && "、"}
                      <Link
                        href={`/similar?part=${drawingNo}`}
                        className="text-accent hover:underline"
                      >
                        /similar?part={drawingNo}
                      </Link>
                    </span>
                  ))}{" "}
                  で確認できます。
                </p>
              )}
            </details>
          </section>
        </div>
      )}
    </div>
  );
}

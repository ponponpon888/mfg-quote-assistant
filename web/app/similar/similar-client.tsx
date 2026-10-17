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

interface FieldComparison {
  key: string;
  label: string;
  target: string;
  candidate: string;
  match: "same" | "close" | "different" | "unknown";
  score: number;
  weight: number;
}

interface PriceDirection {
  item: string;
  change: string;
  direction: "up" | "down" | "flat" | "unknown";
  effect: string;
}

interface CandidateQuote {
  quoteNo: string;
  issuedOn: string;
  quantity: number;
  unitPrice: number;
  leadTimeDays: number;
  basis: Basis;
  beforeMaterialRevision: boolean;
}

interface Candidate {
  drawingNo: string;
  name: string;
  score: number;
  spec: Basis;
  comparisons: FieldComparison[];
  quotes: CandidateQuote[];
  directions: PriceDirection[];
  reviewPoints: string[];
}

interface TargetSpec {
  drawing_no: string;
  name: string;
  material: string;
  surface_treatment: string;
  dimensions: string;
  tolerance: string;
  process_category: string;
  min_lot: number;
  standard_lead_time_days: number;
}

interface SimilarResponse {
  drawingNo: string;
  found: boolean;
  target: TargetSpec | null;
  targetBasis: Basis | null;
  hasOwnQuoteHistory: boolean;
  candidates: Candidate[];
  reviewPoints: string[];
  unitPriceSettled: false;
  note: string;
  error?: string;
}

export interface PartChoice {
  drawingNo: string;
  name: string;
  processCategory: string;
  hasQuoteHistory: boolean;
}

const yen = (value: number) => `${value.toLocaleString()} 円`;

/** 状態を持たない通信部分。ボタンからも URL からも同じものを使う。 */
async function fetchSimilar(part: string): Promise<SimilarResponse> {
  const response = await fetch("/api/similar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ part }),
  });
  const data = (await response.json()) as SimilarResponse;
  if (!response.ok) {
    throw new Error(data.error ?? "類似品の検索に失敗しました。");
  }
  return data;
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const MATCH_LABEL: Record<FieldComparison["match"], string> = {
  same: "一致",
  close: "近い",
  different: "相違",
  unknown: "不明",
};

const MATCH_CLASS: Record<FieldComparison["match"], string> = {
  same: "text-accent",
  close: "text-foreground",
  different: "text-warning",
  unknown: "text-muted",
};

const DIRECTION_MARK: Record<PriceDirection["direction"], string> = {
  up: "↑",
  down: "↓",
  flat: "→",
  unknown: "?",
};

const DIRECTION_LABEL: Record<PriceDirection["direction"], string> = {
  up: "上がる方向",
  down: "下がる方向",
  flat: "変わらない",
  unknown: "判断できない",
};

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

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-muted w-24 shrink-0">{label}</dt>
      <dd className="font-mono">{value || "—"}</dd>
    </div>
  );
}

export function SimilarClient({ parts }: { parts: PartChoice[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<SimilarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async (drawingNo: string) => {
    setLoading(true);
    setError(null);
    setSelected(drawingNo);
    try {
      setResult(await fetchSimilar(drawingNo));
    } catch (cause) {
      setResult(null);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  // `/similar?part=CV-3015` で開いた状態を共有できるようにする。
  // 状態更新は通信の完了後に行う（効果の本体で同期的に setState しない）。
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("part");
    if (!wanted) return;
    const normalized = wanted.trim().toUpperCase();

    let cancelled = false;
    void fetchSimilar(normalized).then(
      (data) => {
        if (cancelled) return;
        setSelected(normalized);
        setResult(data);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setSelected(normalized);
        setError(messageOf(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-muted text-xs">図番を選んでください。</p>
        <div className="flex flex-wrap gap-2">
          {parts.map((part) => (
            <button
              key={part.drawingNo}
              type="button"
              onClick={() => void submit(part.drawingNo)}
              disabled={loading}
              className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40 ${
                selected === part.drawingNo
                  ? "border-accent text-accent bg-surface"
                  : "border-line bg-surface hover:border-accent"
              }`}
            >
              <span className="font-mono">{part.drawingNo}</span>
              <span className="text-muted ml-1.5">{part.name}</span>
              {!part.hasQuoteHistory && (
                <span className="text-warning ml-1.5">過去見積なし</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="border-warning/40 bg-warning-soft text-warning rounded-md border px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-8">
          {/* 1. 対象図番の仕様 */}
          {result.target && result.targetBasis ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
                対象の図番
              </h2>
              <div className="border-line bg-surface rounded-lg border p-5">
                <h3 className="font-mono text-sm font-semibold">
                  {result.target.drawing_no}
                  <span className="text-muted ml-2 font-sans text-xs">
                    {result.target.name}
                  </span>
                </h3>
                <dl className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
                  <SpecRow label="工法" value={result.target.process_category} />
                  <SpecRow label="材質" value={result.target.material} />
                  <SpecRow label="外形寸法" value={result.target.dimensions} />
                  <SpecRow label="公差" value={result.target.tolerance} />
                  <SpecRow label="表面処理" value={result.target.surface_treatment} />
                  <SpecRow label="最小ロット" value={`${result.target.min_lot} 個`} />
                </dl>
                <p className="mt-3 text-xs">
                  根拠: <BasisLink basis={result.targetBasis} />
                </p>
              </div>
            </section>
          ) : (
            <p className="border-warning/40 bg-warning-soft text-warning rounded-md border px-4 py-3 text-sm">
              {result.note}
            </p>
          )}

          {/* 2. 単価は作らない、を金額欄として明示する */}
          {result.found && (
            <section className="flex flex-col gap-3">
              <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
                この図番の単価
              </h2>
              <div className="border-warning/40 bg-warning-soft flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border px-5 py-4">
                <span className="text-sm">単価</span>
                <span className="text-warning text-lg font-semibold">未確定</span>
                <span className="text-sm">合計</span>
                <span className="text-warning text-lg font-semibold">未確定</span>
                <span className="text-muted w-full text-xs">
                  この画面は単価を計算しません。下の候補の単価はいずれも参考値です。
                </span>
              </div>
            </section>
          )}

          {/* 3. 類似候補 */}
          {result.candidates.length === 0 ? (
            result.found && (
              <section className="flex flex-col gap-3">
                <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
                  類似候補
                </h2>
                <p className="border-warning/40 bg-warning-soft text-warning rounded-md border px-4 py-3 text-sm">
                  {result.note}
                </p>
              </section>
            )
          ) : (
            <section className="flex flex-col gap-3">
              <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
                類似候補（{result.candidates.length} 件・似ている順）
              </h2>
              {result.candidates.map((candidate, index) => (
                <div
                  key={candidate.drawingNo}
                  className="border-line bg-surface flex flex-col gap-4 rounded-lg border p-5"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-muted text-xs">候補 {index + 1}</span>
                    <h3 className="font-mono text-sm font-semibold">
                      {candidate.drawingNo}
                    </h3>
                    <span className="text-muted text-xs">{candidate.name}</span>
                    <span className="text-muted ml-auto font-mono text-xs">
                      類似度 {candidate.score.toFixed(3)}
                    </span>
                  </div>

                  <p className="text-xs">
                    仕様書: <BasisLink basis={candidate.spec} />
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[32rem] text-xs">
                      <thead className="border-line text-muted border-b">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium">項目</th>
                          <th className="px-2 py-1.5 text-left font-medium">
                            {candidate.drawingNo}（候補）
                          </th>
                          <th className="px-2 py-1.5 text-left font-medium">
                            {result.drawingNo}（対象）
                          </th>
                          <th className="px-2 py-1.5 text-right font-medium">判定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidate.comparisons.map((item) => (
                          <tr
                            key={item.key}
                            className="border-line border-b last:border-0"
                          >
                            <td className="text-muted px-2 py-1.5">{item.label}</td>
                            <td className="px-2 py-1.5 font-mono">{item.candidate}</td>
                            <td className="px-2 py-1.5 font-mono">{item.target}</td>
                            <td
                              className={`px-2 py-1.5 text-right ${MATCH_CLASS[item.match]}`}
                            >
                              {MATCH_LABEL[item.match]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-2">
                    <h4 className="text-muted text-xs font-semibold">
                      この候補の過去見積
                    </h4>
                    <ul className="flex flex-col gap-2 text-xs">
                      {candidate.quotes.map((quote) => (
                        <li
                          key={quote.quoteNo}
                          className="border-line flex flex-col gap-1 border-l-2 pl-3"
                        >
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="font-mono">{quote.quoteNo}</span>
                            <span className="text-muted">{quote.issuedOn}</span>
                            <span>数量 {quote.quantity.toLocaleString()}</span>
                            <span className="font-mono">{yen(quote.unitPrice)}</span>
                            <span className="text-warning">
                              参考値。この図番の単価ではありません
                            </span>
                          </div>
                          <p>
                            根拠: <BasisLink basis={quote.basis} />
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {candidate.directions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <h4 className="text-muted text-xs font-semibold">
                        この候補との違いで、単価が振れる方向
                      </h4>
                      <ul className="flex flex-col gap-1.5 text-xs">
                        {candidate.directions.map((direction) => (
                          <li
                            key={`${direction.item}-${direction.change}`}
                            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                          >
                            <span className="text-muted w-16 shrink-0">
                              {direction.item}
                            </span>
                            <span className="font-mono">{direction.change}</span>
                            <span
                              className={
                                direction.direction === "unknown"
                                  ? "text-muted"
                                  : "text-warning"
                              }
                            >
                              {DIRECTION_MARK[direction.direction]}{" "}
                              {DIRECTION_LABEL[direction.direction]}
                            </span>
                            <span className="text-muted">{direction.effect}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-muted text-xs">
                        方向だけを出しています。率や金額は、根拠のある係数を持っていないため出しません。
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* 4. 人が確認すべき点 */}
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
        </div>
      )}
    </div>
  );
}

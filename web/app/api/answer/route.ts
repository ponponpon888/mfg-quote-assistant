/**
 * 質問 → 検索 → 回答。
 *
 * 事実の組み立て（answer.ts）は決定的で、LLM は文章に整えるだけ。
 * provider が何であれ、根拠カードと数値は同じものが返る。
 */

import { buildAnswerContext } from "@/lib/answer";
import { getLLM, getProviderName } from "@/lib/llm";

interface AnswerBody {
  q?: unknown;
}

export async function POST(request: Request) {
  let body: AnswerBody;
  try {
    body = (await request.json()) as AnswerBody;
  } catch {
    return Response.json({ error: "JSON を解析できませんでした。" }, { status: 400 });
  }

  const question = typeof body.q === "string" ? body.q.trim() : "";
  if (!question) {
    return Response.json({ error: "q（質問）が空です。" }, { status: 400 });
  }

  const context = buildAnswerContext(question);

  try {
    const llm = await getLLM();
    const result = await llm.composeAnswer(context);
    return Response.json({
      question: context.question,
      intent: context.intent,
      drawingNo: context.drawingNo,
      answer: result.answer,
      notFound: result.notFound,
      facts: context.facts,
      citations: context.citations,
      provider: llm.name,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
        provider: getProviderName(),
      },
      { status: 502 },
    );
  }
}

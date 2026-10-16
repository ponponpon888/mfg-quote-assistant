/**
 * 「既定で実 API を呼ばない」ことを守るためのテスト。
 * ここが落ちたら、設定を書き忘れたまま課金される経路ができたということ。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { getLLM, getProviderName } from "@/lib/llm";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LLM プロバイダの既定値", () => {
  it("LLM_PROVIDER が未設定なら mock", async () => {
    vi.stubEnv("LLM_PROVIDER", undefined as unknown as string);
    expect(getProviderName()).toBe("mock");
    expect((await getLLM()).name).toBe("mock");
  });

  it("空文字でも mock", async () => {
    vi.stubEnv("LLM_PROVIDER", "");
    expect(getProviderName()).toBe("mock");
    expect((await getLLM()).name).toBe("mock");
  });

  it("知らない値でも mock に倒す", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    expect(getProviderName()).toBe("mock");
    expect((await getLLM()).name).toBe("mock");
  });

  it("mock と明示したときも当然 mock", async () => {
    vi.stubEnv("LLM_PROVIDER", "mock");
    expect((await getLLM()).name).toBe("mock");
  });

  it("claude と明示したときだけ claude を選ぶ", () => {
    vi.stubEnv("LLM_PROVIDER", "claude");
    expect(getProviderName()).toBe("claude");
  });

  it("大文字や前後の空白を許容する", () => {
    vi.stubEnv("LLM_PROVIDER", " Claude ");
    expect(getProviderName()).toBe("claude");
  });
});

describe("Claude アダプタ", () => {
  it("API キーが無ければ、呼ぶ前に落ちる", async () => {
    vi.stubEnv("LLM_PROVIDER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(getLLM()).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

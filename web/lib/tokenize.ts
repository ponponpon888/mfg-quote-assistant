/**
 * 日本語まじりの文字列をトークンに割る。
 *
 * 形態素解析器は入れていない。辞書を積むと配布が重くなるうえ、図番（SS-1023）や
 * 材質記号（SPCC t3.2）のような語は辞書に載っていないので、かえって分割を誤る。
 * 代わりに次の 2 本立てにしている。
 *
 * - 日本語（漢字・かな）は文字 bi-gram。「短納期割増率」→ 短納/納期/期割/割増/増率。
 *   未知語でも必ず部分一致が効く。
 * - 英数字は区切り（- . _ /）を含めて 1 語として残し、さらに分解した部分語も出す。
 *   「SS-1023」が丸ごと当たり、「1023」だけでも当たる。
 *
 * 比較の前に NFKC 正規化と小文字化をかける。全角の「ＳＳ－１０２３」と半角の
 * 「SS-1023」を同じ語として扱うため。
 */

/** 漢字・ひらがな・カタカナ・々ヶ・長音符。 */
const CJK_RANGES =
  "\\u3005\\u3006\\u3040-\\u309f\\u30a0-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";

/** 英数字の連なり（区切りをまたぐ）か、日本語の連なり。 */
const SCAN = new RegExp(`[0-9a-z]+(?:[-._/][0-9a-z]+)*|[${CJK_RANGES}]+`, "g");

const SEPARATORS = /[-._/]/;
const LATIN_HEAD = /[0-9a-z]/;

export function normalize(input: string): string {
  return input.normalize("NFKC").toLowerCase();
}

/** 日本語の連なりを文字 bi-gram にする。1 文字ならその文字自身を返す。 */
export function bigrams(run: string): string[] {
  if (run.length <= 1) return run ? [run] : [];
  const out: string[] = [];
  for (let i = 0; i + 1 < run.length; i += 1) {
    out.push(run.slice(i, i + 2));
  }
  return out;
}

export function tokenize(input: string): string[] {
  const text = normalize(input);
  const tokens: string[] = [];

  for (const match of text.matchAll(SCAN)) {
    const run = match[0];
    if (LATIN_HEAD.test(run[0])) {
      tokens.push(run);
      if (SEPARATORS.test(run)) {
        // 「ss-1023」→ 「ss」「1023」も引けるようにする。
        for (const part of run.split(/[-._/]+/)) {
          if (part) tokens.push(part);
        }
      }
    } else {
      tokens.push(...bigrams(run));
    }
  }

  return tokens;
}

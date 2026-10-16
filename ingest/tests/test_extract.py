"""テキスト抽出のテスト。

守りたいのは 2 点。
- 根拠として示すページ番号がずれないこと。
- 全ページに入るデモ注記が本文に混ざらないこと（混ざると全チャンクが同じ語を持ち、検索が鈍る）。
"""

from __future__ import annotations

from ingest.extract import normalize_text

DEMO_NOTICE_HEAD = "これはデモ用の架空書類です"


def test_normalize_text_unifies_newlines() -> None:
    assert normalize_text("a\r\nb\rc\n") == "a\nb\nc"


def test_normalize_text_drops_notice_and_page_number() -> None:
    raw = "本文1\n※ これはデモ用の架空書類です。実在の企業・取引とは関係ありません。 - 2 -\n本文2"
    assert normalize_text(raw) == "本文1\n本文2"


def test_normalize_text_handles_none_and_empty() -> None:
    assert normalize_text(None) == ""
    assert normalize_text("   \n\n  ") == ""


def test_notice_is_not_in_body(contents) -> None:
    for name, content in contents.items():
        assert DEMO_NOTICE_HEAD not in content.full_text, name


def test_page_numbers_are_sequential(contents) -> None:
    for name, content in contents.items():
        pages = [page.page for page in content.pages]
        assert pages == list(range(1, content.page_count + 1)), name


def test_quotes_are_single_page(contents) -> None:
    for name, content in contents.items():
        if name.startswith("quote_"):
            assert content.page_count == 1, name


def test_specs_span_two_pages(contents) -> None:
    """根拠のページ送りをデモするため、仕様書は 2 ページある必要がある。"""
    for name, content in contents.items():
        if name.startswith("spec_"):
            assert content.page_count == 2, name


def test_quote_has_three_tables(contents) -> None:
    """ヘッダ・見積明細・単価内訳の 3 つが罫線表として取れていること。"""
    content = contents["quote_2026-0118.pdf"]
    assert len(content.pages[0].tables) == 3


def test_cells_with_inner_space_are_not_split(contents) -> None:
    """「SPCC t3.2」が 2 セルに割れていないこと。割れると列が 1 つずれる。"""
    content = contents["quote_2026-0118.pdf"]
    detail = next(
        table for table in content.pages[0].tables if table[0][0] == "No."
    )
    assert detail[1][3] == "SPCC t3.2"
    assert len(detail[0]) == len(detail[1]) == 8

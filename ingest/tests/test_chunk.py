"""チャンク化のテスト。

チャンクはそのまま根拠カードになる。守りたいのは「抜粋の文字列が、示したページに
実在すること」。ここが崩れると、存在しないページを根拠として提示してしまう。
"""

from __future__ import annotations

from ingest.chunk import DEFAULT_MAX_CHARS, Chunk, chunk_document, is_heading
from ingest.extract import DocumentContent, PageContent


def _chunks(content: DocumentContent, doc_type: str = "part_spec") -> list[Chunk]:
    return chunk_document(
        content, doc_id="DOC-1", doc_title="テスト書類", doc_type=doc_type
    )


def test_is_heading() -> None:
    assert is_heading("1. 適用範囲")
    assert is_heading("10. 付則")
    assert is_heading("見積明細")
    assert is_heading("備考")
    assert not is_heading("材質： SPCC（冷間圧延鋼板）")
    assert not is_heading("")
    assert not is_heading("2026-01-18")


def test_chunk_text_exists_on_the_cited_page(contents) -> None:
    """全チャンクについて、本文の各行がそのページのテキストに含まれること。"""
    for name, content in contents.items():
        pages = {page.page: page.text for page in content.pages}
        for chunk in _chunks(content):
            assert chunk.page in pages, f"{name}: 存在しないページ {chunk.page}"
            for line in chunk.text.split("\n"):
                assert line in pages[chunk.page], f"{name} p{chunk.page}: {line!r}"


def test_chunks_cover_every_page(contents) -> None:
    for name, content in contents.items():
        covered = {chunk.page for chunk in _chunks(content)}
        assert covered == {page.page for page in content.pages}, name


def test_chunk_ids_are_unique(contents) -> None:
    for name, content in contents.items():
        ids = [chunk.chunk_id for chunk in _chunks(content)]
        assert len(ids) == len(set(ids)), name


def test_section_carries_over_to_next_page() -> None:
    """ページ途中で切れた章は、次ページでも同じ章名を持つこと。"""
    content = DocumentContent(
        pdf_name="dummy.pdf",
        page_count=2,
        pages=[
            PageContent(page=1, text="5. 表面処理\n前半の本文"),
            PageContent(page=2, text="後半の本文\nさらに続き"),
        ],
    )
    chunks = _chunks(content)
    assert [c.page for c in chunks] == [1, 2]
    assert chunks[0].section == "5. 表面処理"
    assert chunks[1].section == "5. 表面処理"


def test_heading_starts_a_new_chunk() -> None:
    content = DocumentContent(
        pdf_name="dummy.pdf",
        page_count=1,
        pages=[PageContent(page=1, text="1. 第一章\n本文A\n2. 第二章\n本文B")],
    )
    chunks = _chunks(content)
    assert [c.section for c in chunks] == ["1. 第一章", "2. 第二章"]
    assert chunks[0].text == "1. 第一章\n本文A"
    assert chunks[1].text == "2. 第二章\n本文B"


def test_lead_section_name_depends_on_doc_type() -> None:
    content = DocumentContent(
        pdf_name="dummy.pdf",
        page_count=1,
        pages=[PageContent(page=1, text="見積番号 Q-1\n発行日 2026-01-01")],
    )
    assert _chunks(content, "quote")[0].section == "見積条件"
    assert _chunks(content, "part_spec")[0].section == "書類情報"


def test_long_section_is_split_at_line_boundaries() -> None:
    body = "\n".join(f"{i:03d} " + "あ" * 60 for i in range(40))
    content = DocumentContent(
        pdf_name="dummy.pdf",
        page_count=1,
        pages=[PageContent(page=1, text="1. 長い章\n" + body)],
    )
    chunks = _chunks(content)
    assert len(chunks) > 1
    for chunk in chunks:
        # 1 行で上限を超える場合を除き、上限 + 1 行ぶんには収まる。
        assert len(chunk.text) <= DEFAULT_MAX_CHARS + 70
        assert chunk.section == "1. 長い章"
    # 行を途中で割っていないこと。
    rebuilt = "\n".join(chunk.text for chunk in chunks)
    assert rebuilt == "1. 長い章\n" + body

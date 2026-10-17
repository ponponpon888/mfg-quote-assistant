"""インデックス生成のテスト。

フロントエンドはこの 2 つの JSON しか読まない。ここで守るのは、
画面側が前提にしているデータの形と、デモのシナリオが成立する中身。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ingest.build_index import RULE_SECTIONS, build


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> tuple[dict, dict, dict]:
    out = tmp_path_factory.mktemp("public")
    pdf = tmp_path_factory.mktemp("pdf")

    from ingest.make_pdfs import build_all

    build_all(out_dir=pdf)
    stats = build(pdf_dir=pdf, out_dir=out)

    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    quotes = json.loads((out / "quotes.json").read_text(encoding="utf-8"))
    return stats, index, quotes


def test_counts(built) -> None:
    stats, _, _ = built
    assert stats == {
        **stats,
        "docs": 13,
        "quotes": 6,
        "parts": 6,
        "has_rules": True,
    }
    assert stats["chunks"] > 20


def test_json_files_are_utf8_without_bom_and_lf(tmp_path: Path) -> None:
    from ingest.make_pdfs import build_all

    pdf = tmp_path / "pdf"
    out = tmp_path / "public"
    build_all(out_dir=pdf)
    build(pdf_dir=pdf, out_dir=out)

    for name in ("index.json", "quotes.json"):
        raw = (out / name).read_bytes()
        assert not raw.startswith(b"\xef\xbb\xbf"), f"{name} に BOM が付いている"
        assert b"\r\n" not in raw, f"{name} に CRLF が混ざっている"


def test_every_chunk_points_at_a_real_document_page(built) -> None:
    _, index, _ = built
    pages = {
        (doc["doc_id"], page["page"]) for doc in index["docs"] for page in doc["pages"]
    }
    assert index["chunks"]
    for chunk in index["chunks"]:
        assert (chunk["doc_id"], chunk["page"]) in pages, chunk["chunk_id"]


def test_document_pdfs_are_referenced_by_name(built) -> None:
    _, index, _ = built
    for doc in index["docs"]:
        assert doc["pdf"].endswith(".pdf")
        assert doc["page_count"] == len(doc["pages"])


def test_rules_have_a_page_for_every_key(built) -> None:
    _, _, quotes = built
    refs = quotes["rules"]["refs"]
    assert set(refs) == set(RULE_SECTIONS)
    for key, ref in refs.items():
        assert ref["page"] >= 1, key
        assert ref["section"] == RULE_SECTIONS[key]
    # 材料費の改定だけは 2 ページ目にある。ページ送りのデモに使っている。
    assert refs["material_revision"]["page"] == 2


def test_rule_values_are_json_safe(built) -> None:
    _, _, quotes = built
    values = quotes["rules"]["values"]
    assert values["material_revision"]["effective_from"] == "2026-07-01"
    assert values["volume_discounts"][0] == {"min_quantity": 100, "rate": 0.03}
    assert values["rush_surcharges"][0] == {"max_lead_time_days": 5, "rate": 0.5}


def test_ss1023_has_three_quotes_across_the_material_revision(built) -> None:
    """数量内挿のデモに必要な前提。改定前 2 件・改定後 1 件。"""
    _, _, quotes = built
    history = [
        (q["issued_on"], line["quantity"], line["unit_price"])
        for q in quotes["quotes"]
        for line in q["lines"]
        if line["drawing_no"] == "SS-1023"
    ]
    assert len(history) == 3
    revision = quotes["rules"]["values"]["material_revision"]["effective_from"]
    assert sum(1 for issued, _, _ in history if issued < revision) == 2
    assert sum(1 for issued, _, _ in history if issued >= revision) == 1


def test_cv3015_has_a_spec_but_no_quote_history(built) -> None:
    """「書類に無いことは無いと答える」デモの前提。壊すとデモが成立しない。"""
    _, _, quotes = built
    assert any(part["drawing_no"] == "CV-3015" for part in quotes["parts"])
    assert not [
        line
        for q in quotes["quotes"]
        for line in q["lines"]
        if line["drawing_no"] == "CV-3015"
    ]


def test_sf2040_has_exactly_one_quote(built) -> None:
    """内挿できず「参照見積が 1 件」の注意が出る経路の前提。"""
    _, _, quotes = built
    history = [
        line
        for q in quotes["quotes"]
        for line in q["lines"]
        if line["drawing_no"] == "SF-2040"
    ]
    assert len(history) == 1


def test_quotes_are_sorted_by_issue_date(built) -> None:
    _, _, quotes = built
    issued = [q["issued_on"] for q in quotes["quotes"]]
    assert issued == sorted(issued)


def test_inquiries_are_loaded_without_front_matter(built) -> None:
    """問い合わせメールは PDF にせず、画面のサンプル入力として JSON に入れる。"""
    _, _, quotes = built
    inquiries = quotes["inquiries"]
    assert [item["id"] for item in inquiries] == ["inquiry-01", "inquiry-02"]
    for item in inquiries:
        assert item["label"]
        assert item["text"]
        # 冒頭の `---` ブロックは本文に残さない。
        assert not item["text"].startswith("---")
        assert "label:" not in item["text"]


def test_inquiries_mention_the_expected_parts(built) -> None:
    """/quote のデモが成立する前提。①は短納期、②は実績の無い図番を含む。"""
    _, _, quotes = built
    by_id = {item["id"]: item["text"] for item in quotes["inquiries"]}
    assert "SS-1023" in by_id["inquiry-01"]
    assert "営業日" in by_id["inquiry-01"]
    assert "SF-2040" in by_id["inquiry-02"]
    assert "CV-3015" in by_id["inquiry-02"]

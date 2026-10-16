"""項目抽出のテスト。

PDF から取り出した値を、元データ（data/source の YAML）と 1 項目ずつ突き合わせる。
ここが緩いと、桁違いの単価が静かに通ってしまう。見積のデモとしては致命的なので、
金額まわりは全項目を照合する。
"""

from __future__ import annotations

import pytest

from ingest.fields import extract_part_spec, extract_quote, label_map, locate_sections, to_int


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1,480", 1480),
        ("20 個", 20),
        ("14 営業日", 14),
        ("124,000", 124000),
        (50, 50),
        ("", None),
        (None, None),
        ("該当なし", None),
    ],
)
def test_to_int(raw, expected) -> None:
    assert to_int(raw) == expected


def test_quote_header_matches_source(contents, quote_sources) -> None:
    for source in quote_sources:
        got = extract_quote(contents[source["pdf_name"]])
        assert got["quote_no"] == source["quote_no"], source["pdf_name"]
        assert got["issued_on"] == str(source["issued_on"]), source["pdf_name"]
        assert got["valid_until"] == str(source["valid_until"]), source["pdf_name"]
        assert got["customer"] == source["customer"], source["pdf_name"]
        assert got["issuer"] == source["issuer"], source["pdf_name"]
        assert got["payment_terms"] == source["payment_terms"], source["pdf_name"]
        assert got["delivery_place"] == source["delivery_place"], source["pdf_name"]


def test_quote_customer_has_no_honorific(contents, quote_sources) -> None:
    """宛先は「御中」を落として格納する。名寄せに使うため。"""
    for source in quote_sources:
        got = extract_quote(contents[source["pdf_name"]])
        assert not got["customer"].endswith("御中"), source["pdf_name"]


FIELDS = (
    "drawing_no",
    "name",
    "material",
    "surface_treatment",
    "quantity",
    "unit_price",
    "amount",
    "material_cost",
    "processing_cost",
    "surface_cost",
    "lead_time_days",
)


def test_quote_lines_match_source(contents, quote_sources) -> None:
    for source in quote_sources:
        got = extract_quote(contents[source["pdf_name"]])
        assert len(got["lines"]) == len(source["lines"]), source["pdf_name"]
        for extracted, expected in zip(got["lines"], source["lines"]):
            for key in FIELDS:
                assert extracted[key] == expected[key], (
                    f"{source['pdf_name']} の {key}: "
                    f"抽出={extracted[key]!r} 期待={expected[key]!r}"
                )


def test_quote_total_matches_sum_of_lines(contents, quote_sources) -> None:
    for source in quote_sources:
        got = extract_quote(contents[source["pdf_name"]])
        assert got["total_amount"] == sum(line["amount"] for line in source["lines"])


def test_unit_price_equals_cost_breakdown(contents, quote_sources) -> None:
    """単価 = 材料費 + 加工費 + 表面処理費。元データ側の整合もここで担保する。"""
    for source in quote_sources:
        got = extract_quote(contents[source["pdf_name"]])
        for line in got["lines"]:
            breakdown = (
                line["material_cost"] + line["processing_cost"] + line["surface_cost"]
            )
            assert line["unit_price"] == breakdown, source["pdf_name"]
            assert line["amount"] == line["unit_price"] * line["quantity"]


SPEC_FIELDS = (
    "drawing_no",
    "name",
    "material",
    "surface_treatment",
    "dimensions",
    "tolerance",
    "process_category",
    "min_lot",
    "standard_lead_time_days",
)


def test_part_spec_matches_source(contents, spec_sources) -> None:
    for source in spec_sources:
        got = extract_part_spec(contents[source["pdf_name"]])
        for key in SPEC_FIELDS:
            assert got[key] == source["part"][key], (
                f"{source['pdf_name']} の {key}: "
                f"抽出={got[key]!r} 期待={source['part'][key]!r}"
            )
        assert got["issued_on"] == str(source["issued_on"])
        assert got["revision"] == source["revision"]


def test_part_spec_keeps_sharp_in_surface_treatment(contents) -> None:
    """「バフ研磨 #400」の #400 が落ちないこと。YAML のクォート漏れで一度消えた。"""
    got = extract_part_spec(contents["spec_cv-3015.pdf"])
    assert got["surface_treatment"] == "バフ研磨 #400"


def test_label_map_reads_header_table(contents) -> None:
    mapping = label_map(contents["spec_ss-1023.pdf"])
    assert mapping["図番"] == "SS-1023"
    assert mapping["加工区分"] == "板金"


def test_locate_sections_finds_rule_chapters(contents) -> None:
    sections = {item["section"]: item["page"] for item in locate_sections(contents["rule_internal-001.pdf"])}
    assert sections["4. 数量値引基準"] == 1
    assert sections["8. 材料費の改定"] == 2

"""data/source の YAML から data/pdf の PDF を生成する。

書類はすべて架空である。実在する企業・人物・図番とは関係がない。
日本語は data/fonts/ipaexg.ttf（IPAexゴシック）を埋め込んで描画する。
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import yaml
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from . import DEMO_COMPANY, FONT_NAME, FONT_PATH, PDF_DIR, SOURCE_DIR

DEMO_NOTICE = "※ これはデモ用の架空書類です。実在の企業・取引とは関係ありません。"

_FONT_REGISTERED = False


def register_font() -> str:
    """IPAexゴシックを reportlab に登録する。二重登録はしない。"""
    global _FONT_REGISTERED
    if not _FONT_REGISTERED:
        if not FONT_PATH.exists():
            raise FileNotFoundError(
                f"日本語フォントが見つかりません: {FONT_PATH}\n"
                "data/fonts/ipaexg.ttf を配置してください。"
            )
        pdfmetrics.registerFont(TTFont(FONT_NAME, str(FONT_PATH)))
        # IPAexゴシックに太字・斜体は無い。<b> 等が来ても同じ字形に落とす。
        pdfmetrics.registerFontFamily(
            FONT_NAME,
            normal=FONT_NAME,
            bold=FONT_NAME,
            italic=FONT_NAME,
            boldItalic=FONT_NAME,
        )
        _FONT_REGISTERED = True
    return FONT_NAME


def _styles() -> dict[str, ParagraphStyle]:
    register_font()
    base = ParagraphStyle(
        "base", fontName=FONT_NAME, fontSize=9.5, leading=15, spaceAfter=0
    )
    return {
        "base": base,
        "title": ParagraphStyle(
            "title", parent=base, fontSize=16, leading=22, alignment=TA_CENTER
        ),
        "notice": ParagraphStyle(
            "notice",
            parent=base,
            fontSize=7.5,
            leading=11,
            textColor=colors.HexColor("#6b7280"),
            alignment=TA_CENTER,
        ),
        "heading": ParagraphStyle(
            "heading", parent=base, fontSize=11, leading=17, spaceBefore=8, spaceAfter=2
        ),
        "body": ParagraphStyle("body", parent=base, fontSize=9.5, leading=15),
        "cell": ParagraphStyle("cell", parent=base, fontSize=8.5, leading=12),
        "right": ParagraphStyle("right", parent=base, alignment=TA_RIGHT),
        "total": ParagraphStyle("total", parent=base, fontSize=13, leading=19),
    }


def load_source_docs(source_dir: Path | None = None) -> list[dict[str, Any]]:
    """data/source の YAML を doc_id 順に読み込む。問い合わせメール(.md)は対象外。"""
    source_dir = source_dir or SOURCE_DIR
    docs: list[dict[str, Any]] = []
    for path in sorted(source_dir.glob("*.yaml")):
        with path.open(encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
        doc["source_file"] = path.name
        doc["pdf_name"] = path.stem + ".pdf"
        docs.append(doc)
    return docs


def _yen(value: Any) -> str:
    return f"{int(value):,}" if value is not None else ""


def _grid(data: list[list[Any]], col_widths: list[float], header: bool = True) -> Table:
    table = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    style = [
        ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9ca3af")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5e7eb")),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ]
    table.setStyle(TableStyle(style))
    return table


def _label_table(rows: list[tuple[str, str]], st: dict[str, ParagraphStyle]) -> Table:
    """「ラベル： 値」形式の2列表。抽出側が行単位で読めるように1行1項目にする。"""
    data = [
        [Paragraph(label, st["cell"]), Paragraph(str(value), st["cell"])]
        for label, value in rows
    ]
    table = Table(data, colWidths=[38 * mm, 132 * mm])
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9ca3af")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
            ]
        )
    )
    return table


def _sections_flow(doc: dict[str, Any], st: dict[str, ParagraphStyle]) -> list[Any]:
    flow: list[Any] = []
    for section in doc.get("sections", []) or []:
        heading = Paragraph(section["heading"], st["heading"])
        body_text = str(section.get("body", "")).rstrip("\n")
        body = Paragraph(body_text.replace("\n", "<br/>"), st["body"])
        flow.append(KeepTogether([heading, body]))
        flow.append(Spacer(1, 3 * mm))
    return flow


def _part_spec_flow(doc: dict[str, Any], st: dict[str, ParagraphStyle]) -> list[Any]:
    part = doc["part"]
    rows = [
        ("図番", part["drawing_no"]),
        ("品名", part["name"]),
        ("材質", part["material"]),
        ("表面処理", part["surface_treatment"]),
        ("外形寸法", part["dimensions"]),
        ("公差", part["tolerance"]),
        ("加工区分", part["process_category"]),
        ("最小ロット", f"{part['min_lot']} 個"),
        ("標準納期", f"{part['standard_lead_time_days']} 営業日"),
        ("発行日", doc["issued_on"]),
        ("改訂", doc.get("revision", "")),
        ("発行元", DEMO_COMPANY),
    ]
    return [
        Paragraph(doc["title"], st["title"]),
        Spacer(1, 2 * mm),
        Paragraph(DEMO_NOTICE, st["notice"]),
        Spacer(1, 5 * mm),
        _label_table(rows, st),
        Spacer(1, 6 * mm),
        *_sections_flow(doc, st),
    ]


def _quote_flow(doc: dict[str, Any], st: dict[str, ParagraphStyle]) -> list[Any]:
    lines = doc["lines"]
    total = sum(int(line["amount"]) for line in lines)

    header_rows = [
        ("見積番号", doc["quote_no"]),
        ("発行日", doc["issued_on"]),
        ("有効期限", doc["valid_until"]),
        ("宛先", f"{doc['customer']} 御中"),
        ("発行元", doc.get("issuer", DEMO_COMPANY)),
        ("支払条件", doc.get("payment_terms", "")),
        ("納入場所", doc.get("delivery_place", "")),
    ]

    detail = [["No.", "図番", "品名", "材質", "表面処理", "数量", "単価(円)", "金額(円)"]]
    for i, line in enumerate(lines, start=1):
        detail.append(
            [
                str(i),
                line["drawing_no"],
                line["name"],
                line["material"],
                line.get("surface_treatment", ""),
                f"{int(line['quantity']):,}",
                _yen(line["unit_price"]),
                _yen(line["amount"]),
            ]
        )
    detail_widths = [
        10 * mm,
        24 * mm,
        22 * mm,
        24 * mm,
        30 * mm,
        16 * mm,
        22 * mm,
        22 * mm,
    ]

    breakdown = [
        ["図番", "材料費(円/個)", "加工費(円/個)", "表面処理費(円/個)", "納期(営業日)"]
    ]
    for line in lines:
        breakdown.append(
            [
                line["drawing_no"],
                _yen(line["material_cost"]),
                _yen(line["processing_cost"]),
                _yen(line["surface_cost"]),
                str(int(line["lead_time_days"])),
            ]
        )
    breakdown_widths = [28 * mm, 32 * mm, 32 * mm, 40 * mm, 28 * mm]

    flow: list[Any] = [
        Paragraph("御見積書", st["title"]),
        Spacer(1, 2 * mm),
        Paragraph(DEMO_NOTICE, st["notice"]),
        Spacer(1, 5 * mm),
        _label_table(header_rows, st),
        Spacer(1, 5 * mm),
        Paragraph(f"合計金額： {_yen(total)} 円（消費税別）", st["total"]),
        Spacer(1, 5 * mm),
        Paragraph("見積明細", st["heading"]),
        _grid(detail, detail_widths),
        Spacer(1, 5 * mm),
        Paragraph("単価内訳および納期", st["heading"]),
        _grid(breakdown, breakdown_widths),
        Spacer(1, 5 * mm),
    ]
    notes = str(doc.get("notes", "")).rstrip("\n")
    if notes:
        flow += [
            Paragraph("備考", st["heading"]),
            Paragraph(notes.replace("\n", "<br/>"), st["body"]),
        ]
    return flow


def _internal_rule_flow(doc: dict[str, Any], st: dict[str, ParagraphStyle]) -> list[Any]:
    rows = [
        ("文書番号", doc["doc_id"]),
        ("発行日", doc["issued_on"]),
        ("改訂", doc.get("revision", "")),
        ("発行元", DEMO_COMPANY),
    ]
    return [
        Paragraph(doc["title"], st["title"]),
        Spacer(1, 2 * mm),
        Paragraph(DEMO_NOTICE, st["notice"]),
        Spacer(1, 5 * mm),
        _label_table(rows, st),
        Spacer(1, 6 * mm),
        *_sections_flow(doc, st),
    ]


_BUILDERS = {
    "part_spec": _part_spec_flow,
    "quote": _quote_flow,
    "internal_rule": _internal_rule_flow,
}


def _footer(canvas, doc) -> None:  # noqa: ANN001 - reportlab のコールバック
    canvas.saveState()
    canvas.setFont(FONT_NAME, 7.5)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawString(20 * mm, 12 * mm, DEMO_NOTICE)
    canvas.drawRightString(190 * mm, 12 * mm, f"- {doc.page} -")
    canvas.restoreState()


def build_pdf(doc: dict[str, Any], out_dir: Path | None = None) -> Path:
    """1 件の YAML を 1 本の PDF にする。戻り値は書き出した PDF のパス。"""
    out_dir = out_dir or PDF_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / doc["pdf_name"]

    builder = _BUILDERS.get(doc["doc_type"])
    if builder is None:
        raise ValueError(f"未知の doc_type: {doc['doc_type']} ({doc['source_file']})")

    st = _styles()
    template = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=20 * mm,
        title=doc["title"],
        author=DEMO_COMPANY,
        subject="デモ用の架空書類",
    )
    template.build(builder(doc, st), onFirstPage=_footer, onLaterPages=_footer)
    return out_path


def build_all(source_dir: Path | None = None, out_dir: Path | None = None) -> list[Path]:
    return [build_pdf(doc, out_dir) for doc in load_source_docs(source_dir)]


def main() -> None:
    parser = argparse.ArgumentParser(description="架空書類の PDF を生成する")
    parser.add_argument("--source", type=Path, default=None, help="YAML の入力ディレクトリ")
    parser.add_argument("--out", type=Path, default=None, help="PDF の出力ディレクトリ")
    args = parser.parse_args()

    paths = build_all(args.source, args.out)
    for path in paths:
        print(f"wrote {path}")
    print(f"{len(paths)} 件の PDF を生成しました。")


if __name__ == "__main__":
    main()

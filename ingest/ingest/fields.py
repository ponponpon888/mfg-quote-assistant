"""PDF の抽出結果から、構造化した項目をルールベースで取り出す。

LLM は使わない。見積の数字を LLM に読ませると、桁や単位を静かに間違えたときに
誰も気づけないため、ここは決定的な規則だけで処理する。

やり方は 2 段構え。

- 罫線のある表は pdfplumber の ``extract_tables()`` が返すセルをそのまま使う。
  「SPCC t3.2」のように値の中に空白が入っても列がずれない。
- 表に入っていない値（合計金額など）だけ、ページテキストに正規表現を当てる。
"""

from __future__ import annotations

import re
from typing import Any

from .extract import DocumentContent, Table
from .chunk import is_heading

_TOTAL_RE = re.compile(r"合計金額\s*[：:]\s*([\d,]+)\s*円")
_NUMBER_RE = re.compile(r"-?\d[\d,]*")
_HONORIFIC_RE = re.compile(r"\s*御中\s*$")


def to_int(value: str | int | None) -> int | None:
    """「1,480」「20 個」「14 営業日」から整数を取り出す。取れなければ None。"""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    match = _NUMBER_RE.search(str(value))
    if not match:
        return None
    return int(match.group(0).replace(",", ""))


def _is_label_table(table: Table) -> bool:
    """「ラベル / 値」の 2 列表かどうか。"""
    return bool(table) and all(len(row) == 2 for row in table)


def label_map(content: DocumentContent) -> dict[str, str]:
    """書類の冒頭にある 2 列表（ラベル→値）をまとめて辞書にする。"""
    mapping: dict[str, str] = {}
    for page in content.pages:
        for table in page.tables:
            if not _is_label_table(table):
                continue
            for label, value in table:
                label = label.strip()
                if label and label not in mapping:
                    mapping[label] = value.strip()
    return mapping


def _find_table(content: DocumentContent, predicate) -> tuple[Table | None, int | None]:
    for page in content.pages:
        for table in page.tables:
            if table and predicate(table[0]):
                return table, page.page
    return None, None


def locate_sections(content: DocumentContent) -> list[dict[str, Any]]:
    """見出しが何ページ目に出てくるかを列挙する。根拠のページ送りに使う。"""
    found: list[dict[str, Any]] = []
    for page in content.pages:
        for line in page.text.split("\n"):
            if is_heading(line):
                found.append({"section": line.strip(), "page": page.page})
    return found


def extract_quote(content: DocumentContent) -> dict[str, Any]:
    """見積書 PDF から、ヘッダ項目と明細行を取り出す。"""
    header = label_map(content)

    customer = _HONORIFIC_RE.sub("", header.get("宛先", "")).strip()

    detail, detail_page = _find_table(content, lambda row: row and row[0] == "No.")
    breakdown, _ = _find_table(
        content, lambda row: any("材料費" in cell for cell in row)
    )

    lines: list[dict[str, Any]] = []
    if detail:
        columns = detail[0]
        index = {name: i for i, name in enumerate(columns)}
        for row in detail[1:]:
            if not any(cell for cell in row):
                continue

            def cell(name: str) -> str:
                position = index.get(name)
                return row[position].strip() if position is not None and position < len(row) else ""

            lines.append(
                {
                    "drawing_no": cell("図番"),
                    "name": cell("品名"),
                    "material": cell("材質"),
                    "surface_treatment": cell("表面処理"),
                    "quantity": to_int(cell("数量")),
                    "unit_price": to_int(cell("単価(円)")),
                    "amount": to_int(cell("金額(円)")),
                }
            )

    if breakdown and lines:
        columns = breakdown[0]
        index = {name: i for i, name in enumerate(columns)}
        rows = [row for row in breakdown[1:] if any(cell for cell in row)]

        def read(row: list[str], name: str) -> int | None:
            position = index.get(name)
            if position is None or position >= len(row):
                return None
            return to_int(row[position])

        drawing_column = index.get("図番", 0)
        by_drawing = {
            row[drawing_column].strip(): row
            for row in rows
            if drawing_column < len(row)
        }
        # 同じ図番が複数行あると辞書引きでは取り違える。その場合だけ並び順で対応づける。
        use_position = len(by_drawing) != len(rows)

        for position, line in enumerate(lines):
            if use_position:
                row = rows[position] if position < len(rows) else None
            else:
                row = by_drawing.get(line["drawing_no"])
            if row is None:
                continue
            line["material_cost"] = read(row, "材料費(円/個)")
            line["processing_cost"] = read(row, "加工費(円/個)")
            line["surface_cost"] = read(row, "表面処理費(円/個)")
            line["lead_time_days"] = read(row, "納期(営業日)")

    total = None
    total_match = _TOTAL_RE.search(content.full_text)
    if total_match:
        total = to_int(total_match.group(1))

    return {
        "quote_no": header.get("見積番号", ""),
        "issued_on": header.get("発行日", ""),
        "valid_until": header.get("有効期限", ""),
        "customer": customer,
        "issuer": header.get("発行元", ""),
        "payment_terms": header.get("支払条件", ""),
        "delivery_place": header.get("納入場所", ""),
        "total_amount": total,
        "detail_page": detail_page,
        "lines": lines,
    }


def extract_part_spec(content: DocumentContent) -> dict[str, Any]:
    """部品仕様書 PDF から、部品の諸元を取り出す。"""
    header = label_map(content)
    return {
        "drawing_no": header.get("図番", ""),
        "name": header.get("品名", ""),
        "material": header.get("材質", ""),
        "surface_treatment": header.get("表面処理", ""),
        "dimensions": header.get("外形寸法", ""),
        "tolerance": header.get("公差", ""),
        "process_category": header.get("加工区分", ""),
        "min_lot": to_int(header.get("最小ロット")),
        "standard_lead_time_days": to_int(header.get("標準納期")),
        "issued_on": header.get("発行日", ""),
        "revision": header.get("改訂", ""),
        "issuer": header.get("発行元", ""),
        "page": 1,
    }


def extract_fields(content: DocumentContent, doc_type: str) -> dict[str, Any]:
    """doc_type に応じた抽出を行う。社内ルールは表を持たないので空を返す。"""
    if doc_type == "quote":
        return extract_quote(content)
    if doc_type == "part_spec":
        return extract_part_spec(content)
    return {}

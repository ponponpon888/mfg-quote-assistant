"""抽出済みのページテキストを、見出し単位・ページ単位のチャンクに割る。

チャンクはそのまま「根拠カード」になる。だから分割の単位は検索の都合ではなく、
人が読んで出典をたどれる単位に合わせてある。

- ページをまたいでチャンクを作らない。根拠として示すページ番号が一意に決まらなくなるため。
- 見出し（「4. 加工工程」「見積明細」など）が来たらそこで切る。
- 見出しはチャンク本文の 1 行目として残す。抜粋だけ見ても何の話か分かるようにするため。
- 1 チャンクが長くなりすぎる場合だけ、行の境界で分割する。
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from .extract import DocumentContent

#: 「1. 適用範囲」のような章見出し。
_NUMBERED_HEADING_RE = re.compile(r"^\d+\.\s*\S")

#: 見積書で使っている見出し。章番号が付かないので名前で持つ。
_NAMED_HEADINGS = frozenset({"見積明細", "単価内訳および納期", "備考"})

#: 見出しが現れる前の領域につける名前。
_LEAD_SECTION = {
    "quote": "見積条件",
    "part_spec": "書類情報",
    "internal_rule": "書類情報",
}

DEFAULT_MAX_CHARS = 700


@dataclass
class Chunk:
    """検索と根拠表示の最小単位。"""

    chunk_id: str
    doc_id: str
    doc_title: str
    doc_type: str
    pdf: str
    page: int
    section: str
    text: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def is_heading(line: str) -> bool:
    line = line.strip()
    if not line:
        return False
    return bool(_NUMBERED_HEADING_RE.match(line)) or line in _NAMED_HEADINGS


def _split_by_length(lines: list[str], max_chars: int) -> list[list[str]]:
    """行の境界を保ったまま、max_chars を目安に分割する。"""
    groups: list[list[str]] = []
    current: list[str] = []
    size = 0
    for line in lines:
        # 1 行だけで上限を超える場合は、その行を単独のグループにする（行は割らない）。
        if current and size + len(line) + 1 > max_chars:
            groups.append(current)
            current = []
            size = 0
        current.append(line)
        size += len(line) + 1
    if current:
        groups.append(current)
    return groups


def chunk_document(
    content: DocumentContent,
    *,
    doc_id: str,
    doc_title: str,
    doc_type: str,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[Chunk]:
    """1 本の PDF をチャンクに割る。"""
    chunks: list[Chunk] = []
    section = _LEAD_SECTION.get(doc_type, "書類情報")
    counter = 0

    def flush(buffer: list[str], page: int, current_section: str) -> None:
        nonlocal counter
        if not buffer:
            return
        for group in _split_by_length(buffer, max_chars):
            text = "\n".join(group).strip()
            if not text:
                continue
            chunks.append(
                Chunk(
                    chunk_id=f"{doc_id}#p{page}#c{counter}",
                    doc_id=doc_id,
                    doc_title=doc_title,
                    doc_type=doc_type,
                    pdf=content.pdf_name,
                    page=page,
                    section=current_section,
                    text=text,
                )
            )
            counter += 1

    for page_content in content.pages:
        buffer: list[str] = []
        for line in page_content.text.split("\n"):
            if is_heading(line):
                flush(buffer, page_content.page, section)
                buffer = []
                section = line.strip()
            buffer.append(line)
        # ページ末で必ず切る。見出し(section)だけは次ページへ引き継ぐ。
        flush(buffer, page_content.page, section)

    return chunks

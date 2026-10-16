"""PDF からページ単位でテキストと表を取り出す。

pypdf ではなく pdfplumber を使う。理由は 2 つある。

1. 本デモの見積書は罫線つきの表で金額を持つ。pdfplumber の ``extract_tables()`` は
   罫線からセル境界を復元できるので、「SPCC t3.2」のように値の中に空白を含む
   セルでも列を取り違えない。テキストだけを空白で分割する方式では壊れる。
2. ページ単位の座標情報を保持したまま扱えるため、根拠として「何ページ目か」を
   そのまま提示できる。

ここでは外部 API を呼ばない。入力は data/pdf のローカルファイルだけ。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

from . import PDF_DIR

#: 全ページの上部・下部に入るデモ注記。検索ノイズになるため本文からは落とす。
_NOTICE_RE = re.compile(r"^※\s*これはデモ用の架空書類です。.*$")
#: フッタのページ番号（" - 1 -"）だけの行。
_PAGE_NO_RE = re.compile(r"^-\s*\d+\s*-$")

Table = list[list[str]]


@dataclass
class PageContent:
    """PDF 1 ページぶんの抽出結果。"""

    page: int
    text: str
    tables: list[Table] = field(default_factory=list)


@dataclass
class DocumentContent:
    """PDF 1 本ぶんの抽出結果。"""

    pdf_name: str
    page_count: int
    pages: list[PageContent]

    @property
    def full_text(self) -> str:
        return "\n".join(page.text for page in self.pages)


def normalize_text(raw: str | None) -> str:
    """改行コードを LF に揃え、デモ注記とページ番号の行を落とす。

    CRLF のまま扱うと、抽出テキストと YAML の正解値を突き合わせるテストが
    環境依存で落ちる。入口で LF に正規化しておく。
    """
    if not raw:
        return ""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    lines: list[str] = []
    for line in text.split("\n"):
        line = line.rstrip()
        if not line:
            continue
        # フッタは「注記 + ページ番号」が 1 行に連結されて出てくることがある。
        line = _PAGE_NO_RE.sub("", line).rstrip()
        if _NOTICE_RE.match(line):
            continue
        if not line:
            continue
        lines.append(line)
    return "\n".join(lines)


def _clean_cell(cell: str | None) -> str:
    if cell is None:
        return ""
    return re.sub(r"\s+", " ", cell.replace("\r\n", "\n").replace("\n", " ")).strip()


def _clean_table(table: list[list[str | None]] | None) -> Table:
    if not table:
        return []
    return [[_clean_cell(cell) for cell in row] for row in table]


def extract_pdf(pdf_path: Path) -> DocumentContent:
    """1 本の PDF をページ単位で読み出す。"""
    pdf_path = Path(pdf_path)
    pages: list[PageContent] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = [t for t in (_clean_table(tbl) for tbl in page.extract_tables()) if t]
            pages.append(
                PageContent(
                    page=page.page_number,
                    text=normalize_text(page.extract_text()),
                    tables=tables,
                )
            )
    return DocumentContent(pdf_name=pdf_path.name, page_count=len(pages), pages=pages)


def extract_all(pdf_dir: Path | None = None) -> dict[str, DocumentContent]:
    """ディレクトリ内の PDF をすべて読み出し、ファイル名をキーに返す。"""
    pdf_dir = Path(pdf_dir) if pdf_dir else PDF_DIR
    return {path.name: extract_pdf(path) for path in sorted(pdf_dir.glob("*.pdf"))}


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="PDF のテキスト抽出結果を確認する")
    parser.add_argument("--dir", type=Path, default=None)
    args = parser.parse_args()

    for name, doc in extract_all(args.dir).items():
        chars = sum(len(p.text) for p in doc.pages)
        tables = sum(len(p.tables) for p in doc.pages)
        print(f"{name}: {doc.page_count} ページ / {chars} 文字 / 表 {tables} 個")


if __name__ == "__main__":
    main()

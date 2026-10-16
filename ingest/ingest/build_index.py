"""PDF からフロントエンドが読む 2 つの JSON を組み立てる。

- ``web/public/index.json``  : 全文検索用のチャンクと、ビューア表示用のページテキスト
- ``web/public/quotes.json`` : 過去見積・部品諸元・社内ルールの構造化データ

数字は PDF から抽出した値を入れる。YAML からは doc_id・タイトル・doc_type と
社内ルールの数値表だけを取る。社内ルールは本文が散文なので、PDF から正規表現で
拾うより原本の表をそのまま使うほうが壊れにくい。ただし根拠として示すページ番号は
抽出結果から引くので、PDF と JSON がずれたら気づけるようにしてある。
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from . import DEMO_COMPANY, PDF_DIR, SOURCE_DIR, WEB_PUBLIC_DIR
from .chunk import chunk_document
from .extract import extract_pdf
from .fields import extract_fields, locate_sections
from .make_pdfs import load_source_docs

#: 社内ルールの各項目が、PDF の何章に書かれているか。根拠表示に使う。
RULE_SECTIONS = {
    "quote_validity_days": "2. 見積有効期限",
    "min_order_amount": "3. 最低受注金額",
    "volume_discounts": "4. 数量値引基準",
    "rush_surcharges": "5. 短納期割増率",
    "min_lots": "6. 最小ロット",
    "standard_lead_time_days": "7. 標準納期",
    "material_revision": "8. 材料費の改定",
}


def _json_default(value: Any) -> str:
    """PyYAML は `2026-07-01` を date として読む。JSON では ISO 文字列に倒す。"""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"JSON にできない型です: {type(value).__name__}")


def load_inquiries(source_dir: Path) -> list[dict[str, Any]]:
    """問い合わせメール（Markdown）を読む。PDF にはせず、画面のサンプル入力に使う。

    冒頭の `---` で囲んだ数行は id と label。本文と分けて返す。
    """
    inquiries: list[dict[str, Any]] = []
    for path in sorted(source_dir.glob("inquiry_*.md")):
        raw = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        meta: dict[str, str] = {}
        body = raw
        if raw.startswith("---\n"):
            _, front, body = raw.split("---\n", 2)
            for line in front.strip().split("\n"):
                if ":" in line:
                    key, value = line.split(":", 1)
                    meta[key.strip()] = value.strip()
        inquiries.append(
            {
                "id": meta.get("id", path.stem),
                "label": meta.get("label", path.stem),
                "text": body.strip(),
            }
        )
    return inquiries


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default) + "\n"
    # BOM なし UTF-8 / 改行は LF で固定する。
    path.write_text(text, encoding="utf-8", newline="\n")


def build(
    source_dir: Path | None = None,
    pdf_dir: Path | None = None,
    out_dir: Path | None = None,
) -> dict[str, Any]:
    """index.json と quotes.json を組み立てて書き出す。戻り値は統計情報。"""
    source_dir = source_dir or SOURCE_DIR
    pdf_dir = Path(pdf_dir) if pdf_dir else PDF_DIR
    out_dir = Path(out_dir) if out_dir else WEB_PUBLIC_DIR

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    docs_meta: list[dict[str, Any]] = []
    chunks: list[dict[str, Any]] = []
    quotes: list[dict[str, Any]] = []
    parts: list[dict[str, Any]] = []
    rules: dict[str, Any] = {}

    for source in load_source_docs(source_dir):
        pdf_path = pdf_dir / source["pdf_name"]
        if not pdf_path.exists():
            raise FileNotFoundError(
                f"PDF がありません: {pdf_path}\n"
                "先に `python -m ingest.make_pdfs` を実行してください。"
            )

        content = extract_pdf(pdf_path)
        doc_id = source["doc_id"]
        doc_type = source["doc_type"]
        title = source["title"]

        docs_meta.append(
            {
                "doc_id": doc_id,
                "title": title,
                "doc_type": doc_type,
                "pdf": content.pdf_name,
                "issued_on": str(source.get("issued_on", "")),
                "page_count": content.page_count,
                "sections": locate_sections(content),
                "pages": [{"page": p.page, "text": p.text} for p in content.pages],
            }
        )

        chunks.extend(
            chunk.to_dict()
            for chunk in chunk_document(
                content, doc_id=doc_id, doc_title=title, doc_type=doc_type
            )
        )

        fields = extract_fields(content, doc_type)

        if doc_type == "quote":
            quotes.append(
                {
                    "doc_id": doc_id,
                    "title": title,
                    "pdf": content.pdf_name,
                    "page": fields.get("detail_page") or 1,
                    **{k: v for k, v in fields.items() if k != "detail_page"},
                }
            )
        elif doc_type == "part_spec":
            parts.append(
                {
                    "doc_id": doc_id,
                    "title": title,
                    "pdf": content.pdf_name,
                    **fields,
                }
            )
        elif doc_type == "internal_rule":
            section_pages = {
                item["section"]: item["page"] for item in locate_sections(content)
            }
            rules = {
                "doc_id": doc_id,
                "title": title,
                "pdf": content.pdf_name,
                "issued_on": str(source.get("issued_on", "")),
                "values": source.get("rules", {}),
                "refs": {
                    key: {
                        "section": section,
                        "page": section_pages.get(section, 1),
                    }
                    for key, section in RULE_SECTIONS.items()
                },
            }

    quotes.sort(key=lambda q: str(q.get("issued_on", "")))
    parts.sort(key=lambda p: str(p.get("drawing_no", "")))

    _write_json(
        out_dir / "index.json",
        {
            "generated_at": generated_at,
            "company": DEMO_COMPANY,
            "notice": "デモ用の架空書類です。実在の企業・取引とは関係ありません。",
            "docs": docs_meta,
            "chunks": chunks,
        },
    )
    inquiries = load_inquiries(source_dir)

    _write_json(
        out_dir / "quotes.json",
        {
            "generated_at": generated_at,
            "company": DEMO_COMPANY,
            "quotes": quotes,
            "parts": parts,
            "rules": rules,
            "inquiries": inquiries,
        },
    )

    return {
        "docs": len(docs_meta),
        "chunks": len(chunks),
        "quotes": len(quotes),
        "parts": len(parts),
        "inquiries": len(inquiries),
        "has_rules": bool(rules),
        "out_dir": str(out_dir),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="検索インデックスを組み立てる")
    parser.add_argument("--source", type=Path, default=None)
    parser.add_argument("--pdf", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    stats = build(args.source, args.pdf, args.out)
    print(
        f"書類 {stats['docs']} 件 / チャンク {stats['chunks']} 件 / "
        f"過去見積 {stats['quotes']} 件 / 部品 {stats['parts']} 件 / "
        f"問い合わせ {stats['inquiries']} 件"
    )
    print(f"社内ルール: {'あり' if stats['has_rules'] else 'なし'}")
    print(f"出力先: {stats['out_dir']}")


if __name__ == "__main__":
    main()

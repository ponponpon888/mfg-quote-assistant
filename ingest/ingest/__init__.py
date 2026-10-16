"""架空の製造業書類を PDF 化し、検索インデックスを組み立てるパイプライン。

このパッケージは外部 API を一切呼ばない。すべてローカルのファイル入出力だけで完結する。
"""

from __future__ import annotations

from pathlib import Path

# ingest/ingest/__init__.py -> parents[2] がリポジトリのルート
ROOT = Path(__file__).resolve().parents[2]

SOURCE_DIR = ROOT / "data" / "source"
PDF_DIR = ROOT / "data" / "pdf"
FONT_PATH = ROOT / "data" / "fonts" / "ipaexg.ttf"
WEB_PUBLIC_DIR = ROOT / "web" / "public"

FONT_NAME = "IPAexGothic"

#: デモ上の発行元。実在企業ではない。
DEMO_COMPANY = "株式会社サンプル精機（架空）"

__all__ = [
    "ROOT",
    "SOURCE_DIR",
    "PDF_DIR",
    "FONT_PATH",
    "WEB_PUBLIC_DIR",
    "FONT_NAME",
    "DEMO_COMPANY",
]

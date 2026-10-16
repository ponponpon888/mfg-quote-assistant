"""テスト共通の下ごしらえ。

PDF はコミット済みの data/pdf ではなく、テストのたびに data/source から作り直す。
そうしないと「YAML を直したのに PDF を作り直し忘れた」状態をテストが素通りさせる。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# `python -m pytest` をどこから叩いても ingest パッケージを import できるようにする。
INGEST_ROOT = Path(__file__).resolve().parents[1]
if str(INGEST_ROOT) not in sys.path:
    sys.path.insert(0, str(INGEST_ROOT))

from ingest.extract import DocumentContent, extract_pdf  # noqa: E402
from ingest.make_pdfs import build_all, load_source_docs  # noqa: E402


@pytest.fixture(scope="session")
def source_docs() -> list[dict]:
    """data/source の YAML（正解データ）。"""
    return load_source_docs()


@pytest.fixture(scope="session")
def pdf_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """data/source から作り直した PDF の置き場。"""
    out = tmp_path_factory.mktemp("pdf")
    build_all(out_dir=out)
    return out


@pytest.fixture(scope="session")
def contents(pdf_dir: Path) -> dict[str, DocumentContent]:
    """PDF 名 -> 抽出結果。"""
    return {path.name: extract_pdf(path) for path in sorted(pdf_dir.glob("*.pdf"))}


@pytest.fixture(scope="session")
def quote_sources(source_docs: list[dict]) -> list[dict]:
    return [doc for doc in source_docs if doc["doc_type"] == "quote"]


@pytest.fixture(scope="session")
def spec_sources(source_docs: list[dict]) -> list[dict]:
    return [doc for doc in source_docs if doc["doc_type"] == "part_spec"]

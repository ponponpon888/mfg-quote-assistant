"""コミット済みの web/public/*.json が、data/source と食い違っていないか。

画面は web/public の JSON しか読まない。Vercel 側で ingest は動かないので、
「YAML を直したのにインデックスを作り直し忘れた」まま公開される事故が起きうる。
ここで止める。

PDF は生成時刻が埋め込まれるのでバイト比較できない。代わりに、元データから
作り直した JSON と突き合わせる（生成時刻の項目だけ除く）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ingest import WEB_PUBLIC_DIR
from ingest.build_index import build
from ingest.make_pdfs import build_all


@pytest.fixture(scope="module")
def rebuilt(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("public")
    pdf = tmp_path_factory.mktemp("pdf")
    build_all(out_dir=pdf)
    build(pdf_dir=pdf, out_dir=out)
    return out


def _load(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.pop("generated_at", None)
    return payload


@pytest.mark.parametrize("name", ["index.json", "quotes.json"])
def test_committed_json_matches_source(rebuilt: Path, name: str) -> None:
    committed_path = WEB_PUBLIC_DIR / name
    assert committed_path.exists(), (
        f"{committed_path} がありません。`python -m ingest.build_index` を実行してください。"
    )

    committed = _load(committed_path)
    fresh = _load(rebuilt / name)

    assert committed == fresh, (
        f"web/public/{name} が data/source と一致しません。"
        "`python -m ingest.make_pdfs` と `python -m ingest.build_index` を実行して、"
        "生成物をコミットしてください。"
    )

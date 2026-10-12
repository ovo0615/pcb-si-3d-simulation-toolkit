"""dist/assets 必須與 dist/index.html 一一對應。

公開版的前端 bundle 是從私有版整包同步過來的。同步時若多帶了一個舊 bundle
（例如上一張卡建出來、已被取代的 index-*.js），或漏帶 index.html 引用的檔案，
CI 的 build 仍會通過——它重建的是自己的 dist，不檢查版控裡那一份。
結果是 Source ZIP 帶著沒人引用的舊程式，或使用者打開是一片空白。

用法：python .github/scripts/check_dist_assets.py [dist 目錄]
預設檢查 web_app/frontend/dist；只看 git 追蹤中的檔案。
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ASSET_REF = re.compile(r"""(?:src|href)=["']/(assets/[^"']+)["']""")


def tracked_assets(dist: Path) -> set[str]:
    out = subprocess.run(
        ["git", "ls-files", "--", (dist / "assets").as_posix()],
        check=True, capture_output=True, text=True, encoding="utf-8",
    ).stdout
    prefix = dist.as_posix().rstrip("/") + "/"
    return {line[len(prefix):] for line in out.splitlines() if line.startswith(prefix)}


def check(dist: Path) -> list[str]:
    index = dist / "index.html"
    if not index.is_file():
        return [f"{index.as_posix()} 不存在"]
    referenced = set(ASSET_REF.findall(index.read_text(encoding="utf-8")))
    tracked = tracked_assets(dist)
    errors = [f"index.html 引用但未追蹤：{p}" for p in sorted(referenced - tracked)]
    errors += [f"已追蹤但 index.html 沒引用（舊 bundle？）：{p}" for p in sorted(tracked - referenced)]
    return errors


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "web_app/frontend/dist")
    errors = check(dist)
    for e in errors:
        print(e)
    if errors:
        return 1
    print("OK: dist/assets 與 index.html 一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

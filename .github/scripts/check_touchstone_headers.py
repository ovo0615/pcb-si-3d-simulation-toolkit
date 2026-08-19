# -*- coding: utf-8 -*-
"""發佈出去的 Touchstone 檔頭一律要是 UTF-8。

AEDT 寫出來的 Touchstone 檔頭用的是**求解機的系統 ANSI**（繁中 Windows 上是
cp950）。那種檔案直接推上 GitHub，`! Port[n] = 訊號_控制` 這幾行會變成亂碼，
而其他任何檢查都抓不到——數值照樣解得開，**失敗的樣子跟成功一模一樣**。

2026-08-17 就發生過一次。寫入端已經改成顯式 UTF-8，這支腳本守的是產物：
每一個進版控的 `.sNp` 都要解得開。
"""

import pathlib
import re
import subprocess
import sys

TOUCHSTONE = re.compile(r"^\.s\d+p$", re.IGNORECASE)


def tracked_touchstone_files():
    out = subprocess.run(["git", "ls-files", "-z"],
                         capture_output=True, check=True)
    for name in out.stdout.decode("utf-8").split("\0"):
        if name and TOUCHSTONE.match(pathlib.PurePosixPath(name).suffix):
            yield name


def main() -> int:
    targets = sorted(tracked_touchstone_files())
    if not targets:
        print("沒有追蹤中的 Touchstone 檔，略過。")
        return 0

    bad = []
    for name in targets:
        try:
            pathlib.Path(name).read_bytes().decode("utf-8")
        except UnicodeDecodeError as exc:
            bad.append(f"{name}：{exc}")

    print(f"檢查了 {len(targets)} 個 Touchstone 檔。")
    if bad:
        print("以下檔頭不是 UTF-8（多半是求解機的 cp950）：")
        for line in bad:
            print("  " + line)
        print("\n修法：用工具重新匯出，或以 UTF-8 重寫檔頭那幾行註解。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

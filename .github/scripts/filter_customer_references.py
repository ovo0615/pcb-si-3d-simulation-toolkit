"""保留客戶詞命中，只移除精確且大小寫相同的 API 識別字。"""
import re
import sys

IDENTIFIER = re.compile(r"(?<![A-Za-z0-9_$])customer_display(?![A-Za-z0-9_$])")


def blocked(line):
    # git grep -n 的檔名與行號不屬於待檢查的原始碼。
    content = line.split(":", 2)[-1]
    return "customer" in IDENTIFIER.sub("", content).lower()


if __name__ == "__main__":
    for line in sys.stdin:
        if blocked(line):
            sys.stdout.write(line)

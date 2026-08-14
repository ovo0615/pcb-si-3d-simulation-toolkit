# Public showcase repository guidelines

This repository contains the public demonstration edition of the PCB SI 3D Simulation Toolkit.
The complete implementation is maintained separately in a restricted-access repository that
holds the full front-end + back-end + test suite + launcher scripts.

## Scope

- Keep this repository limited to public front-end assets, workflow visualization, documentation, and demonstration data.
- Do not add company-specific back-end implementations, customer data, internal file paths, credentials, solver orchestration, or licensed execution environments.
- `web_app/backend/` does not exist on this branch on purpose — that is expected, not a missing file.
- Use Demo or anonymized PCB data in screenshots and examples.

## Files that exist on both sides

### The manual: same text on both sides, safe to sync wholesale

Since 2026-08-14, `操作說明.md` and `docs/manual/` (ten chapters) carry **word-for-word
identical text** on both sides. The private repository is the single source; the whole set can
be copied over.

The only difference is four screenshots whose log, path, or location fields expose a local
absolute path. The public side must reference the anonymized `-public` variants instead:

| Private reference | Public must use | What leaked |
|---|---|---|
| `指定裁切區_20260730.png` | `指定裁切區_20260730-public.png` | `.aedb` path in the log and input field |
| `混合排程模擬過程_20260805.png` | `混合排程模擬過程_20260805-public.png` | solver output path |
| `背鑽示意_20260805.png` | `背鑽示意_20260805-public.png` | save-as path field |
| `IBIS模型庫_20260813.png` | `IBIS模型庫_20260813-public.png` | managed model library location, including the user name |

Unredacted originals stay in the private repository only. The public repository carries the
`-public` variant alone — never both.

After syncing, run `bash .github/scripts/ci_scan_local.sh`, which reproduces every CI scan
locally. **Do not rewrite those patterns as inline shell commands** — the shell eats one level
of backslash escaping, so the check passes locally and then fails in CI (the drive-letter match
was silently disabled that way once, and two example paths got pushed).

> An earlier rule said the manual must never be overwritten wholesale — that applied when the
> public manual was the shorter one and no longer holds. **Other files** (READMEs, validation
> reports) are still maintained independently and must not be copied over wholesale.

### graph/: not every image is publishable

Most images are shared, but any image containing local paths or customer data needs an
anonymized `-public` variant first. Before copying in any image the public repository does not
already have, actually look at the image content and decide.

## Before publishing

Review changed files for private/local file paths (including this machine's own directory
paths), customer identifiers, API keys, tokens, passwords, and proprietary model files. Keep the
public repository separate from any private implementation repository. Before pushing, confirm
no backend files were accidentally staged:

```bash
git ls-files | grep -iE "backend|\.py$|pyedb|aedt|start\.(bat|ps1)"
```

The command above should produce no output.

## Technical note

The showcase describes workflows related to Ansys HFSS 3D Layout, PyAEDT, and EDB. It is an independent technical portfolio and is not an official Ansys project.

# Public showcase repository guidelines

This repository contains the public demonstration edition of the PCB SI 3D Simulation Toolkit.
The complete implementation is maintained separately in a restricted-access repository that
holds the full front-end + back-end + test suite + launcher scripts.

## Scope

- Keep this repository limited to public front-end assets, workflow visualization, documentation, and demonstration data.
- Do not add company-specific back-end implementations, customer data, internal file paths, credentials, solver orchestration, or licensed execution environments.
- `web_app/backend/` does not exist on this branch on purpose — that is expected, not a missing file.
- Use Demo or anonymized PCB data in screenshots and examples.

## Files that exist on both sides but differ

`操作說明.md` and `graph/` exist in both the public and private repositories, but the private
version of `操作說明.md` is more detailed (it documents solver selection, monitor data,
re-export, core/memory budgeting, and automatic material creation — features that are not part
of the public showcase).

> **Never overwrite one side's file wholesale with the other's.** When a change needs to be
> mirrored, apply the same edit separately to each side; a blind `cp` will delete the other
> side's exclusive content. (This rule exists because that exact mistake happened once.)

Image files under `graph/` are shared and can be copied directly between the two repositories.

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

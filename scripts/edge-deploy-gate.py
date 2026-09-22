"""Edge-function deploy helper for the MCP route (the supabase CLI has no token on this machine).

  python scripts/edge-deploy-gate.py bundle <function>
      Derives the bundle from the function's RELATIVE IMPORT GRAPH and writes
      <function>-bundle.json (the `files` array deploy_edge_function takes).
      Derived, never hand-named: a deploy replaces the whole bundle, so a
      hand-typed file list ships a function without its own imports.

  python scripts/edge-deploy-gate.py verify <function> <get_edge_function-output-file>
      Read-back gate after a deploy. Every deployed file must equal HEAD with CR
      stripped, the file count must equal the derived bundle, and a mutated copy
      must read DIFF (the positive control: a comparator that cannot say DIFF
      would pass anything).

Exit 0 pass, 1 fail, 2 usage/unreadable input.
"""
import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNCS = os.path.join(REPO, "supabase", "functions")
IMPORT_RE = re.compile(r"""(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]""")


def derive(fn):
    entry = f"{fn}/index.ts"
    if not os.path.isfile(os.path.join(FUNCS, entry)):
        sys.exit(f"no entrypoint {entry}")
    seen, stack = [], [entry]
    while stack:
        f = stack.pop()
        if f in seen:
            continue
        seen.append(f)
        src = open(os.path.join(FUNCS, f), encoding="utf-8").read()
        for m in IMPORT_RE.findall(src):
            stack.append(os.path.normpath(os.path.join(os.path.dirname(f), m)).replace(os.sep, "/"))
    return seen


def cmd_bundle(fn):
    files = []
    for f in derive(fn):
        content = open(os.path.join(FUNCS, f), encoding="utf-8", newline="").read()
        files.append({"name": os.path.relpath(f, fn).replace(os.sep, "/"), "content": content})
        print(len(content), files[-1]["name"])
    out = f"{fn}-bundle.json"
    json.dump(files, open(out, "w", encoding="utf-8"))
    print(f"{len(files)} files, {sum(len(x['content']) for x in files)} chars -> {out}")


def head(rel):
    return subprocess.run(["git", "-C", REPO, "show", "HEAD:" + rel],
                          capture_output=True, encoding="utf-8").stdout


def norm(s):
    return s.replace("\r", "")


def cmd_verify(fn, path):
    try:
        d = json.loads(open(path, encoding="utf-8").read())
    except (OSError, ValueError) as e:
        print(f"UNREADABLE read-back: {e}")
        sys.exit(2)
    if isinstance(d, list):
        d = d[0]
    if "text" in d:
        d = json.loads(d["text"])
    print({k: v for k, v in d.items() if k != "files"})
    expected = len(derive(fn))
    bs = chr(92)
    rows, same = [], 0
    for f in d.get("files", []):
        name = f["name"].replace(bs, "/")
        m = re.search(rf"({re.escape(fn)}/.*|_shared/.*)$", name)
        rel = "supabase/functions/" + (m.group(1) if m else f"{fn}/" + name.split("/")[-1])
        h = head(rel)
        state = "MISSING@HEAD" if not h else ("SAME" if norm(h) == norm(f["content"]) else "DIFF")
        same += state == "SAME"
        rows.append((rel, f["content"]))
        print(state, rel)
    if not rows:
        print("examined 0 files - the read-back carried nothing")
        sys.exit(2)
    rel, content = rows[0]
    ctrl = "DIFF" if norm(head(rel)) != norm(content + "x") else "SAME"
    print("control (mutated copy) ->", ctrl)
    print(f"{same} of {len(rows)} SAME; derived bundle is {expected} files")
    sys.exit(0 if ctrl == "DIFF" and len(rows) == expected and same == expected else 1)


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 2 and a[0] == "bundle":
        cmd_bundle(a[1])
    elif len(a) == 3 and a[0] == "verify":
        cmd_verify(a[1], a[2])
    else:
        print(__doc__)
        sys.exit(2)

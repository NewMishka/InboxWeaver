#!/usr/bin/env bash
set -euo pipefail

ref="${1:-HEAD}"
version="$(git show "${ref}:manifest.json" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).version))')"
output="${2:-inbox-weaver-v${version}.xpi}"

case "$output" in
  *.xpi) ;;
  *) echo "Output must end with .xpi" >&2; exit 2 ;;
esac

# Read only committed runtime blobs. Stable entry order and timestamps mean
# an identical runtime tree produces an identical XPI across Git commits.
python3 - "$ref" "$output" <<'PY'
import subprocess
import sys
import zipfile

ref, output = sys.argv[1:]
roots = (
    "LICENSE", "manifest.json", "background.html", "background.js", "images",
    "auditTab", "core", "mainPopup", "modules", "rulesTab",
    "settingsTab", "statisticsTab",
)
raw = subprocess.check_output(["git", "ls-tree", "-r", "-z", "--name-only", ref, "--", *roots])
paths = sorted(p.decode("utf-8") for p in raw.split(b"\0") if p)
if "manifest.json" not in paths:
    raise SystemExit("manifest.json missing from source commit")
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in paths:
        data = subprocess.check_output(["git", "show", f"{ref}:{path}"])
        entry = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
PY
unzip -t "$output" >/dev/null
sha256sum "$output"

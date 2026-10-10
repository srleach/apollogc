#!/usr/bin/env bash
# Build the browser AGC from source:
#   1. fetch chrislgarry/Apollo-11 (the flight software) and virtualagc (yaYUL + yaAGC)
#   2. build the yaYUL assembler and assemble Comanche055 and Luminary099
#   3. verify each rope word-for-word against Virtual AGC's own verified source
#   4. compile the yaAGC CPU engine + wasm/agc_wasm.c to WebAssembly
#   5. assemble everything into dist/ ready for GitHub Pages
#
# Requires: git, cc, clang (with the wasm32 target), wasm-ld, curl, perl, python3.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$ROOT/.work}"
DIST="${DIST:-$ROOT/dist}"
APOLLO_REPO="${APOLLO_REPO:-https://github.com/chrislgarry/Apollo-11}"
APOLLO_REF="${APOLLO_REF:-911e5c0283c629c50cb97666f34065e8c07d71a5}"
VAGC_REPO="${VAGC_REPO:-https://github.com/virtualagc/virtualagc}"
VAGC_REF="${VAGC_REF:-6e767035fc18f35bee7e3c770f31153ade71185b}"
WASI_VER="${WASI_VER:-25}"
PROGRAMS=(Comanche055 Luminary099)

mkdir -p "$WORK" "$DIST/ropes"

fetch() { # repo ref dir
  if [ ! -d "$3/.git" ]; then
    git init -q "$3"; git -C "$3" remote add origin "$1"
  fi
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" -c advice.detachedHead=false checkout -q FETCH_HEAD
}

echo "==> Fetching sources"
fetch "$APOLLO_REPO" "$APOLLO_REF" "$WORK/Apollo-11"
fetch "$VAGC_REPO" "$VAGC_REF" "$WORK/virtualagc"
VAGC="$WORK/virtualagc"

echo "==> Building yaYUL"
cc -O2 -w -DNVER='"agc-web"' -o "$WORK/yaYUL" "$VAGC"/yaYUL/*.c -lm

assemble() { # srcdir outdir patches...
  rm -rf "$2"; mkdir -p "$2"; cp "$1"/*.agc "$2"/
  ( cd "$2"
    shift 2
    for p in "$@"; do [ -f "$p" ] && bash "$p"; done
    "$WORK/yaYUL" --force MAIN.agc > yul.log 2>&1 || true
    grep -q 'Fatal errors (final)' yul.log && { grep 'Fatal Error' yul.log | sort -u | tail -20; return 1; } || true
  )
}

REPORT="$DIST/build-report.txt"
: > "$REPORT"
for P in "${PROGRAMS[@]}"; do
  echo "==> Assembling $P from Apollo-11"
  assemble "$WORK/Apollo-11/$P" "$WORK/asm/$P" "$ROOT/patches/common.sh" "$ROOT/patches/$P.sh"
  echo "==> Assembling $P from Virtual AGC (reference)"
  assemble "$VAGC/$P" "$WORK/ref/$P"
  python3 - "$WORK/asm/$P/MAIN.agc.bin" "$WORK/ref/$P/MAIN.agc.bin" "$P" <<'PY'
import sys
a, b, name = open(sys.argv[1], 'rb').read(), open(sys.argv[2], 'rb').read(), sys.argv[3]
diff = sum(1 for i in range(0, max(len(a), len(b)), 2) if a[i:i+2] != b[i:i+2])
print(f'    {name}: {len(a)//2} words, {diff} differ from the Virtual AGC reference')
sys.exit(1 if diff or len(a) != len(b) else 0)
PY
  cp "$WORK/asm/$P/MAIN.agc.bin" "$DIST/ropes/$P.bin"
  # Record exactly what changed relative to the pristine Apollo-11 source.
  python3 - "$WORK/Apollo-11/$P" "$WORK/asm/$P" "$P" >> "$REPORT" <<'PY'
import sys, os, difflib
orig, new, name = sys.argv[1:4]
out, n = [], 0
for f in sorted(os.listdir(new)):
    if not f.endswith('.agc'):
        continue
    if not os.path.exists(os.path.join(orig, f)):
        out.append(f'  + {f} (copy of a file present under another name, for MAIN.agc)')
        continue
    a = open(os.path.join(orig, f), errors='replace').read().splitlines()
    b = open(os.path.join(new, f), errors='replace').read().splitlines()
    for line in difflib.unified_diff(a, b, f, f, n=0, lineterm=''):
        if line.startswith(('---', '+++', '@@')):
            continue
        if line.startswith('+'):
            n += 1
        out.append('  ' + line)
print(f'{name}: verified identical to the Virtual AGC rope; {n} source lines adjusted (see patches/).')
print('\n'.join(out))
PY
done

echo "==> Fetching WASI sysroot"
WASI="$WORK/wasi"
if [ ! -d "$WASI/wasi-sysroot-$WASI_VER.0" ]; then
  mkdir -p "$WASI"
  base="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_VER"
  curl -sSfL "$base/wasi-sysroot-$WASI_VER.0.tar.gz" | tar xz -C "$WASI"
  curl -sSfL "$base/libclang_rt.builtins-wasm32-wasi-$WASI_VER.0.tar.gz" | tar xz -C "$WASI"
  mkdir -p "$WASI/rt/lib/wasi"
  cp "$WASI/libclang_rt.builtins-wasm32-wasi-$WASI_VER.0/libclang_rt.builtins-wasm32.a" "$WASI/rt/lib/wasi/"
fi

echo "==> Compiling yaAGC to WebAssembly"
CLANG="${CLANG:-clang}"
RESDIR="$($CLANG -print-resource-dir)"
"$CLANG" --target=wasm32-wasi --sysroot="$WASI/wasi-sysroot-$WASI_VER.0" \
  -resource-dir="$WASI/rt" -I"$RESDIR/include" \
  -O2 -w -DWASI=yes -DNVER='"agc-web"' -I"$VAGC/yaAGC" \
  -mexec-model=reactor -Wl,--strip-debug \
  -o "$DIST/agc.wasm" \
  "$ROOT/wasm/agc_wasm.c" "$VAGC/yaAGC/agc_engine.c" "$VAGC/yaAGC/agc_engine_init.c"

echo "==> Channel tables from the AGC source"
python3 -I "$ROOT/tools/channels.py" "$WORK/Apollo-11/Luminary099" "$DIST"

echo "==> Web front-end"
cp "$ROOT"/web/* "$DIST"/
python3 -I "$ROOT/tools/bundle.py" "$DIST"
touch "$DIST/.nojekyll"
{
  echo "Apollo-11 $APOLLO_REF"
  echo "virtualagc $VAGC_REF"
} > "$DIST/SOURCES.txt"

echo "==> Done: $DIST"
ls -la "$DIST" "$DIST/ropes"

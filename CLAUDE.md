# CLAUDE.md

Apollo 11 guidance computer (Comanche055 / Luminary099) assembled from source and run in the browser on yaAGC compiled to WebAssembly. Deployed to GitHub Pages. See README.md for the full background.

## Commands

```sh
./build.sh                          # fetch upstream, assemble + verify ropes, compile wasm → dist/
node tests/smoke.mjs dist           # boots both ropes, checks V35, V16N36, V91 on all 36 banks
python3 -m http.server -d dist 8000 # serve locally (wasm will not load from file://)
```

`build.sh` needs git, cc, clang with the wasm32 target, wasm-ld (`apt install clang lld`), curl, perl, python3. Upstream checkouts and the WASI sysroot are cached in `.work/`; `dist/` is build output. Both are gitignored — never commit them.

Always run the build and the smoke test before pushing; CI runs exactly these two.

## Layout

- `build.sh` — the whole pipeline. Upstream commits are pinned via `APOLLO_REF` / `VAGC_REF` at the top.
- `patches/` — shell scripts run inside a copy of each program's `.agc` sources before yaYUL (`common.sh` for both, then `<Program>.sh`).
- `wasm/agc_wasm.c` — the only new C: replaces yaAGC's socket I/O with exported functions (`WASM_EXPORT`). `agc_engine.c` from yaAGC is compiled unmodified.
- `web/agc.js` — JS wrapper around the wasm (`AGC` class: `boot`, `run`, `key`, `pro`, `dsky`, channel reads). Shared by the page and the smoke test.
- `web/app.js`, `web/index.html`, `web/style.css` — DSKY and I/O panel UI. Plain ES modules, no bundler or npm.
- `tools/channels.py` — builds the I/O panel bit labels (LM labels parsed from the Luminary099 source; CSM table is hand-written in the script).
- `tools/bundle.py` — produces `dist/standalone.html` with all assets inlined.
- `.github/workflows/pages.yml` — on push to `main`: build, smoke test, deploy `dist/` to Pages.

## Rules

- The ropes must stay bit-identical to Virtual AGC's reference assembly; `build.sh` fails otherwise. Source patches are only for transcription errors and whitespace, never behavioural edits.
- Do not modify yaAGC engine sources; keep all glue in `wasm/agc_wasm.c` and `web/agc.js`.
- The engine is clocked at real AGC speed (`MCT_PER_SEC` in `web/agc.js`); don't change timing to make tests pass.
- If you add a function to `agc_wasm.c`, mark it `WASM_EXPORT` and wrap it in `web/agc.js`.
- Licensing: yaAGC is GPL v2+, so `wasm/agc_wasm.c` and the built `agc.wasm` are too.

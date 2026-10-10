# Apollo 11 AGC in the browser

The Apollo 11 guidance computer software — **Comanche 055** (Command Module *Columbia*) and **Luminary 099** (Lunar Module *Eagle*) — assembled from the source in [chrislgarry/Apollo-11](https://github.com/chrislgarry/Apollo-11) and running in the browser on a WebAssembly build of the [Virtual AGC](https://github.com/virtualagc/virtualagc) CPU, with a DSKY you can key and a panel of the spacecraft interface lamps the software drives.

Nothing on the display is scripted. Every digit and lamp comes from the 1969 code writing to the computer's I/O channels.

## How it fits together

```
chrislgarry/Apollo-11  ──►  patches/ (whitespace + 5 errata)  ──►  yaYUL  ──►  Comanche055.bin
     *.agc source                                                              Luminary099.bin
                                                                                    │
virtualagc/yaAGC  agc_engine.c ─┐                                                   ▼
                                ├─ clang → wasm32-wasi ─► agc.wasm ◄── agc.js ◄── app.js (DSKY + I/O panel)
wasm/agc_wasm.c (I/O bridge) ───┘
```

- **The software is the real thing.** `build.sh` assembles the repo's `.agc` files with yaYUL, then assembles Virtual AGC's independently proofread copy of the same program and requires the two ropes to match word for word (36,864 words each). They do.
- **The CPU is unmodified.** `agc_engine.c` from yaAGC is compiled as-is. The only new C is `wasm/agc_wasm.c`, which replaces yaAGC's socket I/O layer with functions JavaScript can call: load a rope, run N memory cycles, push a keystroke, read a channel.
- **Real timing.** The page clocks the engine at 85,333 memory cycles per second, the AGC's actual rate. The engine runs a couple of hundred times faster than that, so there's ample headroom.
- **Indicator labels come from the source.** For the LM, the I/O panel's bit labels are parsed from `INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc` in Luminary 099.

## What had to change in the source

The Apollo-11 repo is a transcription of the printed listings, and a handful of spots don't assemble as transcribed. `patches/` holds the minimum to fix them, and `dist/build-report.txt` lists every changed line after each build.

| Program | Change | Why |
|---|---|---|
| both | Move `+1`, `-2`, `+9D`… annotations into the label field with a leading space (whitespace only) | These margin notes on the original listing landed in the label/opcode column, so yaYUL read them as code |
| Comanche055 | `ZEROERROR` → `ZEROEROR`, `GETDLEWD` → `GETLEWD` | Label typos; the references elsewhere already use the correct spelling |
| Comanche055 | `.063296` → `.063298`, `1.08-2` → `1.0 B-2` | Digits misread from the scan |
| Comanche055 | Stray `-16` line marked as a comment | It's the exponent of the comment above it (`2^-16`) |
| Luminary099 | Copy two files to the names `MAIN.agc` includes | Files were renamed in the repo but `MAIN.agc` wasn't updated |

The word-for-word check against Virtual AGC is what proves these are corrections rather than edits: the result is bit-identical to Virtual AGC's proofread rope, and the flight software's own V91 checksum passes on every bank.

## Build locally

Needs `git`, a C compiler, `clang` with the wasm32 target plus `wasm-ld` (Ubuntu: `apt install clang lld`), `curl`, `perl`, `python3`, and Node 18+ for the tests.

```sh
./build.sh                 # fetches sources, assembles, verifies, compiles → dist/
node tests/smoke.mjs dist  # boots both ropes and checks V35, V16N36 and V91 on all 36 banks
python3 -m http.server -d dist 8000
```

Then open http://localhost:8000 (`?rope=Luminary099` opens the LM). The page has to be served over HTTP; opening `index.html` directly won't load the WebAssembly.

Upstream commits are pinned at the top of `build.sh` (`APOLLO_REF`, `VAGC_REF`).

## Deploy to GitHub Pages

1. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Push to `main` (or run the workflow by hand from the **Actions** tab). `.github/workflows/pages.yml` runs `build.sh`, the smoke test, and publishes `dist/`.

## Using the DSKY

Press **RSET** first to clear the RESTART lamp that lights at power-on.

| Keys | Does |
|---|---|
| `V35E` | Lamp test |
| `V16N36E` | Monitor mission clock |
| `V37E00E` | Go to P00 (idle) |
| `V05N09E` | Show alarm codes |
| `V91E` | Show each rope bank's checksum; **PRO** steps to the next bank |

Keyboard: digits, `V` verb, `N` noun, `Enter` ENTR, `C`/Backspace CLR, `R` RSET, `K` KEY REL, `P` PRO (hold), `+`, `-`.

Input channels 30–33 on the I/O panel are clickable: they're the discretes the spacecraft feeds the computer (IMU operate, thrusters disabled, and so on). They're active-low, so a lit bit means the signal is present.

## Licences

- AGC source (chrislgarry/Apollo-11): public domain.
- Virtual AGC (yaYUL, yaAGC): GPL v2 or later. `agc.wasm` is built from yaAGC, so `wasm/agc_wasm.c` and the built `agc.wasm` are GPL v2 or later as well. Releasing the whole repository under the GPL is the simplest choice.

// agc.js — loads the Virtual AGC engine (agc.wasm) and a rope assembled from
// the Apollo 11 source, and exposes a small API for the DSKY front-end.
//
// 1 AGC memory cycle (MCT) = 11.71875 µs, i.e. 85 333⅓ MCT per second.

export const MCT_PER_SEC = 1024000 / 12;

// Minimal WASI preview1 shim. The engine only prints the odd diagnostic;
// everything else (files, sockets) is unused in this build.
function wasiShim(getMemory, log) {
  const ENOSYS = 52, EBADF = 8;
  let line = '';
  return {
    fd_write(fd, iovs, iovsLen, nwrittenPtr) {
      const mem = new DataView(getMemory().buffer);
      const bytes = new Uint8Array(getMemory().buffer);
      let written = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = mem.getUint32(iovs + i * 8, true);
        const len = mem.getUint32(iovs + i * 8 + 4, true);
        for (let j = 0; j < len; j++) {
          const c = bytes[ptr + j];
          if (c === 10) { log(line); line = ''; } else line += String.fromCharCode(c);
        }
        written += len;
      }
      mem.setUint32(nwrittenPtr, written, true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => ENOSYS,
    fd_read: () => ENOSYS,
    fd_fdstat_get: () => 0,
    fd_fdstat_set_flags: () => 0,
    fd_prestat_get: () => EBADF,
    fd_prestat_dir_name: () => EBADF,
    path_open: () => ENOSYS,
    proc_exit: (code) => { throw new Error(`AGC engine exited (${code})`); },
  };
}

// DSKY keycodes as wired to input channel 15 (from PINBALL / the DSKY spec).
export const KEYCODES = {
  '0': 0o20, '1': 0o01, '2': 0o02, '3': 0o03, '4': 0o04,
  '5': 0o05, '6': 0o06, '7': 0o07, '8': 0o10, '9': 0o11,
  VERB: 0o21, NOUN: 0o37, ENTR: 0o34, CLR: 0o36, RSET: 0o22,
  KEYREL: 0o31, '+': 0o32, '-': 0o33,
};

// 7-segment relay codes used on channel 10 → characters.
const RELAY_DIGIT = { 0: ' ', 0o25: '0', 0o03: '1', 0o31: '2', 0o33: '3', 0o17: '4',
  0o36: '5', 0o34: '6', 0o23: '7', 0o35: '8', 0o37: '9' };

export class AGC {
  static async load(wasmUrl) {
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    return AGC.fromBytes(bytes);
  }

  static async fromBytes(bytes, log = (s) => console.log('[AGC]', s)) {
    let memory;
    const { instance } = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: wasiShim(() => memory, log),
    });
    memory = instance.exports.memory;
    if (instance.exports._initialize) instance.exports._initialize();
    return new AGC(instance.exports);
  }

  constructor(x) {
    this.x = x;
    this.carry = 0; // fractional MCTs owed
  }

  boot(ropeBytes) {
    const rope = new Uint8Array(ropeBytes);
    const ptr = this.x.agc_rope_buffer();
    const cap = this.x.agc_rope_capacity();
    if (rope.length > cap) throw new Error('rope too large');
    new Uint8Array(this.x.memory.buffer, ptr, rope.length).set(rope);
    const rc = this.x.agc_boot(rope.length);
    if (rc) throw new Error(`agc_boot failed (${rc})`);
  }

  step(n) { if (n > 0) this.x.agc_step(n | 0); }

  // Run for `seconds` of AGC time.
  run(seconds) {
    const want = seconds * MCT_PER_SEC + this.carry;
    const n = Math.floor(want);
    this.carry = want - n;
    this.step(n);
  }

  key(name, chan = 0o15) { this.x.agc_key(KEYCODES[name], chan); }
  pro(down) { this.x.agc_pro(down ? 1 : 0); }
  setInputBits(chan, mask, value) { this.x.agc_set_input_bits(chan, mask, value); }

  channel(c) { return this.x.agc_channel(c) & 0o77777; }
  io(c) { return this.x.agc_io(c) & 0o77777; }
  relay(row) { return this.x.agc_chan10(row) & 0o77777; }
  get cycles() { return this.x.agc_cycles_hi() * 2 ** 32 + this.x.agc_cycles_lo(); }
  get z() { return this.x.agc_reg_z() & 0o77777; }
  erasable(bank, off) { return this.x.agc_erasable(bank, off) & 0o77777; }

  // Decode the DSKY relay matrix (channel 10 rows 1-12, plus channels 11 and
  // the engine's synthetic channel 163) into display state.
  dsky() {
    const r = [];
    for (let i = 0; i <= 12; i++) r[i] = this.relay(i);
    const L = (i) => RELAY_DIGIT[(r[i] >> 5) & 0o37] ?? ' ';
    const R = (i) => RELAY_DIGIT[r[i] & 0o37] ?? ' ';
    const sign = (p, m) => (r[p] & 0o2000) ? '+' : (r[m] & 0o2000) ? '-' : ' ';
    const ch11 = this.channel(0o11);
    const c163 = this.x.agc_dsky163();
    const row12 = r[12] & 0o3777;
    const flash = !!(c163 & 0o40); // V/N flash phase: off
    return {
      prog: L(11) + R(11),
      verb: L(10) + R(10),
      noun: L(9) + R(9),
      r1: sign(7, 6) + R(8) + L(7) + R(7) + L(6) + R(6),
      r2: sign(5, 4) + L(5) + R(5) + L(4) + R(4) + L(3),
      r3: sign(2, 1) + R(3) + L(2) + R(2) + L(1) + R(1),
      vnBlank: flash,
      compActy: !!(ch11 & 0o2),
      lamps: {
        UPLINK_ACTY: !!(ch11 & 0o4),
        NO_ATT: !!(row12 & 0o10),
        STBY: !!(c163 & 0o400),
        KEY_REL: !!(c163 & 0o20),
        OPR_ERR: !!(c163 & 0o100),
        PRIO_DISP: !!(row12 & 0o1),
        NO_DAP: !!(row12 & 0o2),
        TEMP: !!(c163 & 0o10),
        GIMBAL_LOCK: !!(row12 & 0o40),
        PROG: !!(row12 & 0o400),
        RESTART: !!(c163 & 0o200),
        TRACKER: !!(row12 & 0o200),
        ALT: !!(row12 & 0o20),
        VEL: !!(row12 & 0o4),
      },
      agcWarn: !!(c163 & 0o1),
    };
  }
}

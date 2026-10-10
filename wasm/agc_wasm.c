/*
 * agc_wasm.c -- WebAssembly front-end for the Virtual AGC CPU engine.
 *
 * This file is the only new C code in the build. It links against the
 * unmodified Virtual AGC engine (yaAGC/agc_engine.c, agc_utilities.c etc.)
 * and replaces the socket peripheral layer (SocketAPI.c) with a tiny
 * memory-mapped interface that JavaScript can poke and peek:
 *
 *   - JS copies an assembled rope (the .bin produced by yaYUL from the
 *     Apollo-11 source) into agc_rope_buffer() and calls agc_boot().
 *   - JS calls agc_step(n) to run n memory cycles (1 MCT = 11.71875 us).
 *   - Keystrokes go in via agc_key(); PRO via agc_pro().
 *   - Output channels (DSKY relay rows, lamps, discretes) are read back
 *     with agc_channel() / agc_chan10().
 *
 * Licensed GPL v2 or later, like the Virtual AGC code it links with.
 */
#include <stdio.h>
#include <string.h>
#include "yaAGC.h"
#include "agc_engine.h"

#define WASM_EXPORT(name) __attribute__((export_name(#name)))

static agc_t State;
static unsigned char Rope[36 * 02000 * 2];
static int RopeBytes = 0;

/* Latest value written to each output channel (index = channel number). */
static int OutChannel[0400];
/* Channel 010 drives 12 relay rows (selected by bits 15-12). */
static int Chan10[16];
/* Count of output events, so JS can cheaply see if anything changed. */
static unsigned OutputSerial = 0;

/* Keystroke queue: each entry is (channel << 8) | code. */
#define KQ 64
static int KeyQueue[KQ];
static int KeyHead = 0, KeyTail = 0;
static int KeyHold = 0; /* MCTs remaining before the next key may be injected */

/* ----------------------------------------------------------------------- */
/* Peripheral hooks required by agc_engine.c (normally in SocketAPI.c).    */

void ChannelOutput(agc_t *s, int Channel, int Value)
{
  if (Channel == 7) {
    /* Superbank bits: the engine expects the peripheral layer to latch these
     * (exactly as SocketAPI.c does). */
    s->InputChannel[7] = s->OutputChannel7 = (Value & 0160);
    return;
  }
  if (Channel == 010) {
    Chan10[(Value >> 11) & 017] = Value;
  } else if (Channel >= 0 && Channel < 0400) {
    OutChannel[Channel] = Value;
  }
  OutputSerial++;
}

int ChannelInput(agc_t *s)
{
  if (KeyHold > 0) { KeyHold--; return 0; }
  if (KeyHead != KeyTail) {
    int k = KeyQueue[KeyTail];
    KeyTail = (KeyTail + 1) % KQ;
    int chan = (k >> 8) & 0377, code = k & 037;
    WriteIO(s, chan, code);
    s->InterruptRequests[chan == 016 ? 6 : 5] = 1; /* KEYRUPT1 / KEYRUPT2 */
    KeyHold = 2000; /* ~23 ms between injected keys, like a fast human */
    return 1;
  }
  return 0;
}

void ChannelRoutine(agc_t *s) { (void)s; }
void ChannelRoutineGeneric(void *s, void (*u)(void *, Client_t *)) { (void)s; (void)u; }
void ShiftToDeda(agc_t *s, int Data) { (void)s; (void)Data; }
void RequestRadarData(agc_t *s) { (void)s; }

/* Debugger / host-OS hooks referenced by the engine but unused here. */
void BacktraceAdd(agc_t *s, int Cause) { (void)s; (void)Cause; }
void UnblockSocket(int SocketNum) { (void)SocketNum; }
FILE *rfopen(const char *Filename, const char *mode) { (void)Filename; (void)mode; return NULL; }

/* ----------------------------------------------------------------------- */
/* Exports                                                                  */

WASM_EXPORT(agc_rope_buffer) unsigned char *agc_rope_buffer(void) { return Rope; }
WASM_EXPORT(agc_rope_capacity) int agc_rope_capacity(void) { return sizeof(Rope); }

/* Load the rope exactly as yaAGC's agc_load_binfile() does (bank order
 * 2,3,0,1,4,5,...), then let the stock agc_engine_init() reset the CPU. */
WASM_EXPORT(agc_boot) int agc_boot(int nbytes)
{
  int Bank = 2, j = 0, i, n;
  if (nbytes <= 0 || (nbytes & 1) || nbytes > (int)sizeof(Rope)) return 1;
  RopeBytes = nbytes;
  memset(&State, 0, sizeof(State));
  n = nbytes / 2;
  for (i = 0; i < n; i++) {
    unsigned raw = Rope[2 * i] * 256 + Rope[2 * i + 1];
    State.Fixed[Bank][j] = raw >> 1;
    State.Parities[(Bank * 02000 + j) / 32] |= (raw & 1) << (j % 32);
    if (raw & 1) State.CheckParity = 1;
    if (++j == 02000) {
      j = 0;
      if (Bank == 2) Bank = 3;
      else if (Bank == 3) Bank = 0;
      else if (Bank == 0) Bank = 1;
      else if (Bank == 1) Bank = 4;
      else Bank++;
    }
  }
  i = agc_engine_init(&State, NULL, NULL, 0);
  memset(OutChannel, 0, sizeof(OutChannel));
  memset(Chan10, 0, sizeof(Chan10));
  KeyHead = KeyTail = KeyHold = 0;
  return i;
}

/* Run n machine cycles. */
WASM_EXPORT(agc_step) void agc_step(int n)
{
  while (n-- > 0) agc_engine(&State);
}

/* code: 5-bit DSKY keycode; chan: 015 (main DSKY) or 016 (nav DSKY). */
WASM_EXPORT(agc_key) void agc_key(int code, int chan)
{
  int next = (KeyHead + 1) % KQ;
  if (next == KeyTail) return;
  KeyQueue[KeyHead] = ((chan ? chan : 015) << 8) | (code & 037);
  KeyHead = next;
}

/* PRO (proceed) key: channel 32 bit 14, active low. */
WASM_EXPORT(agc_pro) void agc_pro(int pressed)
{
  int v = ReadIO(&State, 032);
  if (pressed) v &= ~020000; else v |= 020000;
  WriteIO(&State, 032, v);
}

/* Set or clear a bit in an input channel (for spacecraft discretes). */
WASM_EXPORT(agc_set_input_bits) void agc_set_input_bits(int chan, int mask, int value)
{
  int v = ReadIO(&State, chan);
  v = (v & ~mask) | (value & mask);
  WriteIO(&State, chan, v);
}

WASM_EXPORT(agc_channel) int agc_channel(int chan) { return OutChannel[chan & 0377]; }
WASM_EXPORT(agc_io) int agc_io(int chan) { return ReadIO(&State, chan); }
WASM_EXPORT(agc_chan10) int agc_chan10(int row) { return Chan10[row & 017]; }
WASM_EXPORT(agc_serial) unsigned agc_serial(void) { return OutputSerial; }
WASM_EXPORT(agc_dsky163) int agc_dsky163(void) { return State.DskyChannel163; }
WASM_EXPORT(agc_restart_light) int agc_restart_light(void) { return State.RestartLight; }
WASM_EXPORT(agc_standby) int agc_standby(void) { return State.Standby; }
WASM_EXPORT(agc_cycles_lo) unsigned agc_cycles_lo(void) { return (unsigned)State.CycleCounter; }
WASM_EXPORT(agc_cycles_hi) unsigned agc_cycles_hi(void) { return (unsigned)(State.CycleCounter >> 32); }
WASM_EXPORT(agc_reg_z) int agc_reg_z(void) { return State.Erasable[0][RegZ]; }

/* Read a word of erasable memory (bank 0-7, offset 0-0377). */
WASM_EXPORT(agc_erasable) int agc_erasable(int bank, int off)
{
  return State.Erasable[bank & 7][off & 0377];
}
WASM_EXPORT(agc_erasable_write) void agc_erasable_write(int bank, int off, int v)
{
  State.Erasable[bank & 7][off & 0377] = v & 077777;
}

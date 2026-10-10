#!/usr/bin/env python3
"""Build the I/O channel bit-label tables used by the indicator panel.

For the LM (Luminary 099) the labels are read straight out of the AGC source
file INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc, so the panel is documented by
the flight software itself. Comanche 055 has no such file, so the CSM table is
written out below from the Comanche 055 code and the Virtual AGC developer
notes.

usage: channels.py <path to Luminary099 dir> <output dir>
"""
import json, re, sys, os

def parse_luminary(path):
    chans, cur, name, last = {}, None, {}, None
    for raw in open(path, encoding='utf-8', errors='replace'):
        line = raw.rstrip('\n')
        if not line.startswith('#'):
            continue
        body = line[1:]
        m = re.match(r'\s*CHANNEL\s+(\d+)\s+(.*)', body)
        if m:
            cur = int(m.group(1), 8)
            chans.setdefault(cur, {})
            first = m.group(2).split(';')[0].strip()
            name[cur] = first if first and not first.upper().startswith('INPUT CHANNEL') else ''
            last = None
            continue
        m = re.match(r'\s*BIT\s+(\d+)\s+(.*)', body)
        if m and cur is not None:
            bit = int(m.group(1))
            text = re.sub(r'\s+', ' ', m.group(2)).strip()
            chans[cur][bit] = text
            last = bit
            continue
        # continuation of a long bit description (deeply indented, no BIT)
        if cur is not None and last is not None and re.match(r'\s{3,}\S', body) \
                and not re.match(r'\s*(Page|NOTE)', body):
            chans[cur][last] += ' ' + re.sub(r'\s+', ' ', body).strip()
        if re.match(r'\s*Page', body) is None and body.strip() == '':
            last = None
    return chans, name

LM_JETS = {
    0o5: {1: 'JET B4U', 2: 'JET A4D', 3: 'JET A3U', 4: 'JET B3D',
          5: 'JET B2U', 6: 'JET A2D', 7: 'JET A1U', 8: 'JET B1D'},
    0o6: {1: 'JET B3A', 2: 'JET B4F', 3: 'JET A1F', 4: 'JET A2A',
          5: 'JET B2L', 6: 'JET A3R', 7: 'JET A4R', 8: 'JET B1L'},
}

CSM = {
    0o5: {b: f'SM RCS PITCH/YAW JET (BIT {b})' for b in range(1, 9)},
    0o6: {b: f'SM RCS ROLL JET (BIT {b})' for b in range(1, 9)},
    0o11: {1: 'ISS WARNING', 2: 'COMPUTER ACTIVITY', 3: 'UPLINK ACTIVITY',
           4: 'TEMP CAUTION', 5: 'KEYBOARD RELEASE', 6: 'FLASH VERB AND NOUN',
           7: 'OPERATOR ERROR', 9: 'TEST CONNECTOR OUTBIT', 10: 'CAUTION RESET',
           13: 'SPS ENGINE ON'},
    0o12: {1: 'ZERO OPTICS CDUS', 2: 'ENABLE OPTICS CDU ERROR COUNTERS',
           4: 'COARSE ALIGN ENABLE OF IMU', 5: 'ZERO IMU CDUS',
           6: 'ENABLE IMU CDU ERROR COUNTERS', 8: 'TVC ENABLE',
           9: 'ENABLE S-IVB TAKEOVER', 10: 'ZERO OPTICS',
           11: 'DISENGAGE OPTICS DAC', 13: 'S-IVB INJECTION SEQUENCE START',
           14: 'S-IVB CUTOFF', 15: 'ISS TURN ON DELAY COMPLETE'},
    0o13: {4: 'RADAR ACTIVITY', 6: 'BLOCK INPUTS TO UPLINK CELL',
           7: 'DOWNLINK WORD ORDER CODE BIT', 10: 'TEST ALARMS, TEST DSKY LIGHTS',
           11: 'ENABLE STANDBY', 15: 'ENABLE T6 RUPT'},
    0o14: {1: 'OUTLINK ACTIVITY', 6: 'GYRO ENABLE POWER FOR PULSES',
           7: 'GYRO SELECT B', 8: 'GYRO SELECT A', 9: 'GYRO TORQUE NEGATIVE',
           10: 'GYRO ACTIVITY', 11: 'DRIVE CDU S (OPTICS SHAFT)',
           12: 'DRIVE CDU T (OPTICS TRUNNION)', 13: 'DRIVE CDU Z',
           14: 'DRIVE CDU Y', 15: 'DRIVE CDU X'},
    0o30: {1: 'ULLAGE THRUST PRESENT', 2: 'SM/CM SEPARATE', 3: 'SPS READY',
           4: 'S-IVB SEPARATE, ABORT', 5: 'LIFTOFF', 6: 'G&N AUTOPILOT CONTROL',
           7: 'OPTICS CDU FAIL', 9: 'IMU OPERATE', 10: 'S/C CONTROL OF SATURN',
           11: 'IMU CAGE', 12: 'IMU CDU FAIL', 13: 'IMU FAIL',
           14: 'ISS TURN ON REQUEST', 15: 'TEMP IN LIMITS'},
    0o31: {1: '+PITCH MANUAL ROTATION', 2: '-PITCH MANUAL ROTATION',
           3: '+YAW MANUAL ROTATION', 4: '-YAW MANUAL ROTATION',
           5: '+ROLL MANUAL ROTATION', 6: '-ROLL MANUAL ROTATION',
           7: '+X TRANSLATION', 8: '-X TRANSLATION', 9: '+Y TRANSLATION',
           10: '-Y TRANSLATION', 11: '+Z TRANSLATION', 12: '-Z TRANSLATION',
           13: 'HOLD FUNCTION', 14: 'FREE FUNCTION', 15: 'G&N AUTOPILOT CONTROL'},
    0o32: {11: 'LM ATTACHED', 14: 'PROCEED KEY DEPRESSED'},
    0o33: {2: 'RANGE UNIT DATA GOOD', 4: 'ZERO OPTICS', 5: 'CMC CONTROL OF OPTICS',
           11: 'UPLINK TOO FAST', 12: 'DOWNLINK TOO FAST', 13: 'PIPA FAIL',
           14: 'AGC WARNING', 15: 'AGC OSCILLATOR STOPPED'},
}
CSM_NAMES = {0o5: 'PYJETS', 0o6: 'ROLLJETS', 0o11: 'DSALMOUT', 0o12: 'CHAN12',
             0o13: 'CHAN13', 0o14: 'CHAN14', 0o30: 'INPUT', 0o31: 'INPUT',
             0o32: 'INPUT', 0o33: 'CHAN33'}

WANT = [0o5, 0o6, 0o11, 0o12, 0o13, 0o14, 0o30, 0o31, 0o32, 0o33]

def emit(chans, names, source):
    out = []
    for c in WANT:
        out.append({'channel': c, 'octal': f'{c:o}', 'name': names.get(c, ''),
                    'direction': 'in' if c >= 0o30 else 'out',
                    'bits': {str(b): t for b, t in sorted(chans.get(c, {}).items())}})
    return {'source': source, 'channels': out}

def main():
    lum, outdir = sys.argv[1], sys.argv[2]
    chans, names = parse_luminary(os.path.join(lum, 'INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc'))
    for c, jets in LM_JETS.items():
        chans.setdefault(c, {}).update(jets)
    json.dump(emit(chans, names, 'Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc'),
              open(os.path.join(outdir, 'channels-Luminary099.json'), 'w'), indent=1)
    json.dump(emit(CSM, CSM_NAMES, 'Comanche055 code + Virtual AGC developer notes'),
              open(os.path.join(outdir, 'channels-Comanche055.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()

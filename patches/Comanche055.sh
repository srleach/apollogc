# Transcription errata vs. the original scans (as corrected by the Virtual AGC project).
perl -pi -e 's/^ZEROERROR(\s)/ZEROEROR$1/' KALCMANU_STEERING.agc
perl -pi -e 's/^GETDLEWD(\s)/GETLEWD$1/' REENTRY_CONTROL.agc
perl -pi -e 's/(DEC\s+)\.063296/${1}.063298/' REENTRY_CONTROL.agc
perl -pi -e 's/^(1DPB2\s+2DEC\s+)1\.08-2/${1}1.0 B-2/' P32-P33_P72-P73.agc
# Superscript "-16" from the preceding comment ("SCALED 2^-16") landed on its own line.
perl -pi -e 's/^(\s+)(-16)\s*$/$1# $2\n/' ERASABLE_ASSIGNMENTS.agc

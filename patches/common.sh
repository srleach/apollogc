# Whitespace-only normalisation of listing annotations ("+1", "-1", "+9D" ...) that the
# original YUL listing printed beside an instruction. In this transcription they sit in
# the label or opcode column; yaYUL expects " +N" (leading space, label field) so it
# treats them as annotations. Only whitespace is changed.
for f in *.agc; do
  perl -pi -e 's/^[ \t]*([+-][0-9]+D?)[ \t]+(?=[A-Z0-9])/ $1\t\t/' "$f"
done

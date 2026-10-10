#!/usr/bin/env python3
"""Bundle dist/ into a single self-contained HTML file (standalone.html).

The engine, both ropes and the channel tables are embedded as base64, so the
file runs anywhere a browser can open it, including from disk.

usage: bundle.py <dist dir> [--fragment]
  --fragment  omit <!doctype>/<html>/<head>/<body> (for hosts that add them)
"""
import base64, json, os, re, sys

dist = sys.argv[1]
fragment = '--fragment' in sys.argv
rd = lambda p: open(os.path.join(dist, p), encoding='utf-8').read()

assets = {}
for p in ['agc.wasm', 'ropes/Comanche055.bin', 'ropes/Luminary099.bin',
          'channels-Comanche055.json', 'channels-Luminary099.json']:
    assets[p] = base64.b64encode(open(os.path.join(dist, p), 'rb').read()).decode()

html = rd('index.html')
css = rd('style.css')
agc = re.sub(r'^export ', '', rd('agc.js'), flags=re.M)
app = rd('app.js').replace("import { AGC, MCT_PER_SEC } from './agc.js';\n", '')

head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
head = re.sub(r'\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>', '', head)
head = head.replace('<link rel="stylesheet" href="style.css">',
                    '<style>\n:root { color-scheme: dark; }\n' + css + '</style>')
body = re.search(r'<body>(.*?)<script type="module"', html, re.S).group(1)

shim = '''const __ASSETS = %s;
const __fetch = window.fetch.bind(window);
window.fetch = async (url, ...rest) => {
  const key = String(url).replace(/^\\.\\//, '');
  if (key in __ASSETS) {
    const bin = Uint8Array.from(atob(__ASSETS[key]), (c) => c.charCodeAt(0));
    return new Response(bin, { status: 200 });
  }
  return __fetch(url, ...rest);
};
''' % json.dumps(assets)

script = '<script type="module">\n' + shim + agc + '\n' + app + '</script>\n'
if fragment:
    out = head.strip() + '\n' + body + script
else:
    out = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
           + head.strip() + '\n</head>\n<body>' + body + script + '</body>\n</html>\n')
name = 'standalone-fragment.html' if fragment else 'standalone.html'
open(os.path.join(dist, name), 'w', encoding='utf-8').write(out)
print(f'{name}: {len(out)//1024} KB')

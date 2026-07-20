#!/usr/bin/env python3
import subprocess, re, base64, sys

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# (css family name, url family token, weight, style)
JOBS = [
    ("Playfair Display", "Playfair+Display", 600, "normal"),
    ("Playfair Display", "Playfair+Display", 700, "normal"),
    ("Playfair Display", "Playfair+Display", 800, "normal"),
    ("Playfair Display", "Playfair+Display", 900, "normal"),
    ("Montserrat", "Montserrat", 400, "normal"),
    ("Montserrat", "Montserrat", 500, "normal"),
    ("Montserrat", "Montserrat", 600, "normal"),
    ("Montserrat", "Montserrat", 700, "normal"),
    ("JetBrains Mono", "JetBrains+Mono", 500, "normal"),
    ("JetBrains Mono", "JetBrains+Mono", 700, "normal"),
]

def curl(url, binary=False):
    args = ["curl", "-sS", "--max-time", "40", "-A", UA, url]
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"curl failed {url}: {r.stderr.decode(errors='ignore')}")
    return r.stdout if binary else r.stdout.decode("utf-8", errors="ignore")

def latin_woff2(css):
    # Split into (comment, block) pairs; pick the one labelled 'latin' (exact)
    blocks = re.split(r"/\*\s*([\w-]+)\s*\*/", css)
    # blocks = ['', label1, body1, label2, body2, ...]
    found = {}
    for i in range(1, len(blocks) - 1, 2):
        label = blocks[i].strip()
        body = blocks[i + 1]
        m = re.search(r"url\((https://[^)]+\.woff2)\)", body)
        if m:
            found[label] = m.group(1)
    return found.get("latin") or found.get("latin-ext") or next(iter(found.values()), None)

out = []
for css_name, token, weight, style in JOBS:
    url = f"https://fonts.googleapis.com/css2?family={token}:wght@{weight}&display=swap"
    css = curl(url)
    woff2 = latin_woff2(css)
    if not woff2:
        print(f"!! no woff2 for {css_name} {weight}", file=sys.stderr)
        continue
    data = curl(woff2, binary=True)
    b64 = base64.b64encode(data).decode("ascii")
    out.append(
        f"@font-face{{font-family:'{css_name}';font-style:{style};"
        f"font-weight:{weight};font-display:block;"
        f"src:url(data:font/woff2;base64,{b64}) format('woff2');}}"
    )
    print(f"ok {css_name} {weight}  ({len(data)//1024} KB)", file=sys.stderr)

with open("fonts.css", "w") as f:
    f.write("\n".join(out))
print(f"WROTE fonts.css with {len(out)} faces", file=sys.stderr)

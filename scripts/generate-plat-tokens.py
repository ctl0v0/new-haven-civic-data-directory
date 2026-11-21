"""tokens.json -> plat-tokens.css (light default, dark via prefers-color-scheme and [data-theme]) + contrast report.

Usage: python3 -I gen_tokens.py <tokens.json> <out.css>
"""
import json, sys

def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def lum(h):
    def ch(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = map(ch, hex2rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

TEXT_PAIRS = [
    ("ink", ["surface", "surface-raised", "surface-sunken", "civic-soft", "parcel-soft"], 4.5),
    ("ink-muted", ["surface", "surface-raised", "surface-sunken"], 4.5),
    ("civic", ["surface", "surface-raised", "civic-soft"], 4.5),
    ("on-civic", ["civic"], 4.5),
    ("on-deep", ["deep"], 4.5),
    ("on-deep-muted", ["deep"], 4.5),
    ("on-parcel", ["parcel"], 4.5),
    ("status-ok", ["status-ok-soft", "surface"], 4.5),
    ("status-closed", ["status-closed-soft", "surface"], 4.5),
    ("status-pending", ["status-pending-soft", "surface"], 4.5),
    ("status-void", ["status-void-soft", "surface"], 4.5),
    ("status-partial", ["status-partial-soft", "surface"], 4.5),
    ("line-strong", ["surface", "surface-raised"], 3.0),
    ("focus", ["surface", "surface-raised", "surface-sunken", "civic-soft"], 3.0),
    ("parcel-edge", ["parcel"], 3.0),
    ("cat-permit", ["surface"], 3.0), ("cat-license", ["surface"], 3.0), ("cat-document", ["surface"], 3.0),
    ("cat-enforcement", ["surface"], 3.0), ("cat-sale", ["surface"], 3.0), ("chart-land", ["surface"], 3.0),
]

def main(src, dst):
    t = json.load(open(src))
    themes = [th["id"] for th in t["color"]["themes"]]
    col = {c["name"]: c["value"] for c in t["color"]["tokens"]}
    val = lambda n, th: col[n][th] if isinstance(col[n], dict) else col[n]
    fails = 0
    for th in themes:
        for fg, bgs, need in TEXT_PAIRS:
            for bg in bgs:
                r = ratio(val(fg, th), val(bg, th))
                if r < need:
                    fails += 1
                    print(f"FAIL {th}: {fg} on {bg} = {r:.2f} (< {need})")
    print("contrast failures:", fails)

    def block(th, extra=""):
        lines = [f"  --{n}: {val(n, th)};" for n in col]
        for s in t.get("shadow", {}).get("tokens", []):
            v = s["value"][th] if isinstance(s["value"], dict) else s["value"]
            lines.append(f"  --{s['name']}: {v};")
        return "\n".join(lines) + extra

    fam = t["type"]["families"]
    static = [f"  --font-{k}: {v};" for k, v in fam.items()]
    for fam_key in ("spacing", "radius", "layout"):
        static += [f"  --{x['name']}: {x['value']};" for x in t[fam_key]["tokens"]]
    css = ["/* Plat — generated from tokens.json. Do not edit by hand; edit tokens.json and regenerate. */",
           ":root {", block("light"), "\n".join(static), "  color-scheme: light;", "}",
           "@media screen and (prefers-color-scheme: dark) {", '  :root:not([data-theme="light"]) {',
           block("dark").replace("\n  --", "\n    --").replace("  --", "    --", 1), "    color-scheme: dark;", "  }", "}",
           ':root[data-theme="dark"] {', block("dark"), "  color-scheme: dark;", "}"]
    open(dst, "w").write("\n".join(css) + "\n")
    print("wrote", dst)
    return int(fails > 0)

if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))

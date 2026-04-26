#!/usr/bin/env python3
"""Convert a black-ink-on-white logo PNG to black-ink-on-transparent.

The upstream Wado logo PNGs ship with a near-white (~#fcfcfc) background
that creates a visible square against a pure-white site background. This
script lifts the ink onto a transparent layer:

    raw_alpha = 255 - min(R, G, B)
    alpha     = clamp((raw_alpha - FLOOR) * 255 / (255 - FLOOR), 0, 255)
    RGB       = (0, 0, 0)

The FLOOR threshold drops the faint background haze (raw alpha < FLOOR
becomes fully transparent), while remapping above FLOOR keeps the
anti-aliased brushstroke edges smooth. A naive ``alpha = 255 - min`` would
leave the background as low-alpha black, which composites to the same
gray on a white page — defeating the purpose.
"""

import sys
from pathlib import Path

from PIL import Image

FLOOR = 20  # raw_alpha values below this are treated as background.


def transparentize(src: Path, dst: Path) -> None:
    img = Image.open(src).convert("RGBA")
    px = img.load()
    w, h = img.size
    scale = 255.0 / (255 - FLOOR)
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            raw_alpha = 255 - min(r, g, b)
            if raw_alpha <= FLOOR:
                px[x, y] = (0, 0, 0, 0)
            else:
                a = int(round((raw_alpha - FLOOR) * scale))
                if a > 255:
                    a = 255
                px[x, y] = (0, 0, 0, a)
    img.save(dst, optimize=True)
    print(f"  {src} -> {dst}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: transparentize-logo.py <png> [<png> ...]", file=sys.stderr)
        return 2
    for arg in argv[1:]:
        path = Path(arg)
        transparentize(path, path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

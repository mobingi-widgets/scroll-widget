"""Cut the white glyph out of each life-skill icon (inside the progress ring) as a
transparent PNG, from the user's screenshot of the game's 생활 스킬 screen."""
import sys, os
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
im = Image.open(SRC).convert("RGB")
# icon centres on the 생활 스킬 screen, game client 1300x1020 (2026-11-27):
# columns 219 + 140k, rows 164 / 369 / 574
CELLS = {
    "대장 기술": (359, 369), "목공": (499, 369), "매직 크래프트": (639, 369), "중갑 제작": (779, 369),
    "경갑 제작": (919, 369), "천옷 제작": (1059, 369), "핸디크래프트": (359, 574),
}
FILE = {"대장 기술": "blacksmith", "목공": "carpentry", "매직 크래프트": "magic", "중갑 제작": "heavy",
        "경갑 제작": "light", "천옷 제작": "cloth", "핸디크래프트": "handicraft"}
R = 37          # inside the ring (ring runs ~39-46 px from the centre at 1300x1020)
SIZE = 64


def best_centre(x, y):
    """Nudge the centre so the ring is symmetric (the grid estimate can be 1-2 px off)."""
    def ring(px, py):
        p = im.getpixel((px, py))
        return max(p) - min(p) > 60 or min(p) > 200
    best = (x, y)
    best_score = -1
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            cx, cy = x + dx, y + dy
            score = 0
            for r in (41, 42, 43):
                for ox, oy in ((r, 0), (-r, 0), (0, r), (0, -r)):
                    if ring(cx + ox, cy + oy):
                        score += 1
            if score > best_score:
                best, best_score = (cx, cy), score
    return best


for name, (x, y) in CELLS.items():
    cx, cy = best_centre(x, y)
    glyph = Image.new("RGBA", (2 * R, 2 * R), (0, 0, 0, 0))
    for j in range(-R, R):
        for i in range(-R, R):
            if i * i + j * j > R * R:
                continue
            r, g, b = im.getpixel((cx + i, cy + j))
            lo = min(r, g, b)
            sat = max(r, g, b) - lo
            a = max(0.0, min(1.0, (lo - 70) / (215 - 70)))
            if sat > 70:          # coloured overlay pixels (ring, badges) are not glyph
                a = 0.0
            glyph.putpixel((i + R, j + R), (255, 255, 255, int(a * 255)))
    bbox = glyph.getbbox()
    glyph.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, FILE[name] + ".png"))
    print(name, "centre", (cx, cy), "bbox", bbox)

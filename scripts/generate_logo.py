"""Generate Nafis Ride Alwar branding assets (icon, splash, adaptive-icon, favicon).

Run: python /app/scripts/generate_logo.py

Design language:
  - Primary: #FFCC00 (yellow, from theme.ts brandPrimary)
  - On-brand: #111111 (near-black)
  - Icon glyph: bold "N" wordmark + subtle two-wheel motif at bottom
  - Rounded-square icon (iOS/Android will mask their own corners)
"""
from __future__ import annotations
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = "/app/frontend/assets/images"
YELLOW = (255, 204, 0, 255)         # #FFCC00
YELLOW_DARK = (230, 168, 0, 255)    # #E6A800
BLACK = (17, 17, 17, 255)           # #111111
WHITE = (255, 255, 255, 255)
GREY = (163, 163, 163, 255)         # #A3A3A3


def _try_font(paths: list[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in paths:
        try:
            return ImageFont.truetype(p, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


BOLD_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]
REG_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
]


def _rounded_rect(size: int, radius: int, fill: tuple[int, int, int, int]) -> Image.Image:
    """Create a rounded-square image with solid fill."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return im


def _draw_bike_glyph(draw: ImageDraw.ImageDraw, cx: int, cy: int, wheel_r: int,
                      color: tuple[int, int, int, int], stroke: int) -> None:
    """Minimal two-wheeler glyph — two wheels + a slanted connector.
    Placed centered at (cx, cy)."""
    wheel_gap = wheel_r * 2 + int(wheel_r * 0.9)   # distance between wheel centers
    left = (cx - wheel_gap // 2, cy)
    right = (cx + wheel_gap // 2, cy)
    # tyres (open circles)
    for wx, wy in (left, right):
        draw.ellipse((wx - wheel_r, wy - wheel_r, wx + wheel_r, wy + wheel_r),
                      outline=color, width=stroke)
        draw.ellipse((wx - stroke // 2, wy - stroke // 2, wx + stroke // 2, wy + stroke // 2),
                      fill=color)
    # frame – slanted bar
    frame_top = (cx, cy - int(wheel_r * 1.05))
    draw.line((left[0] + int(wheel_r * 0.2), left[1] - int(wheel_r * 0.15),
               frame_top[0], frame_top[1]), fill=color, width=stroke)
    draw.line((frame_top[0], frame_top[1],
               right[0] - int(wheel_r * 0.2), right[1] - int(wheel_r * 0.15)),
              fill=color, width=stroke)
    # handlebar
    draw.line((right[0] - int(wheel_r * 0.6), right[1] - int(wheel_r * 1.55),
               right[0] + int(wheel_r * 0.2), right[1] - int(wheel_r * 1.35)),
              fill=color, width=stroke)


def _draw_wordmark_n(im: Image.Image, size: int, glyph_color: tuple[int, int, int, int]) -> None:
    """Bold 'N' centered on top ~60%, small caps 'RIDE' below."""
    draw = ImageDraw.Draw(im)
    # Big N — sits in upper 65% of canvas
    n_font = _try_font(BOLD_FONT_CANDIDATES, size=int(size * 0.58))
    text = "N"
    bbox = draw.textbbox((0, 0), text, font=n_font, anchor="lt")
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    tx = (size - text_w) // 2 - bbox[0]
    ty = int(size * 0.14) - bbox[1]
    draw.text((tx, ty), text, font=n_font, fill=glyph_color)
    # Small caps 'RIDE' band underneath
    tag_font = _try_font(BOLD_FONT_CANDIDATES, size=int(size * 0.11))
    tag = "RIDE"
    tb = draw.textbbox((0, 0), tag, font=tag_font, anchor="lt")
    tw = tb[2] - tb[0]
    ttx = (size - tw) // 2 - tb[0]
    tty = int(size * 0.78) - tb[1]
    # tracking / letter spacing look — draw each letter with a small gap
    letter_gap = int(size * 0.02)
    total_w = sum((draw.textbbox((0, 0), c, font=tag_font, anchor="lt")[2]
                    - draw.textbbox((0, 0), c, font=tag_font, anchor="lt")[0]) for c in tag)
    total_w += letter_gap * (len(tag) - 1)
    cursor = (size - total_w) // 2
    for c in tag:
        cb = draw.textbbox((0, 0), c, font=tag_font, anchor="lt")
        draw.text((cursor - cb[0], tty), c, font=tag_font, fill=glyph_color)
        cursor += (cb[2] - cb[0]) + letter_gap
    _ = ttx  # unused after letter-by-letter draw


def make_icon() -> None:
    """1024x1024 rounded-square yellow icon with black N + bike glyph."""
    size = 1024
    radius = int(size * 0.22)  # Apple-like ~22% corner
    icon = _rounded_rect(size, radius, YELLOW)
    # subtle radial highlight in the top-left for depth
    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.ellipse((-size // 3, -size // 3, size // 2, size // 2),
                fill=(255, 255, 255, 40))
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=size // 20))
    icon.alpha_composite(highlight)
    _draw_wordmark_n(icon, size, BLACK)
    icon.save(os.path.join(OUT, "icon.png"))
    print("wrote icon.png (1024x1024, rounded yellow, black N + bike)")


def make_adaptive_icon() -> None:
    """1024x1024 transparent PNG with centered logo mark for Android adaptive icons.
    Android will place this on top of a background color we set in app.json.
    Keep the glyph in the safe zone (~66% of canvas)."""
    size = 1024
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # We want the SAME yellow badge but centered in the safe zone so Android's
    # circular / squircle masks look great.
    inner = int(size * 0.66)
    offset = (size - inner) // 2
    badge = _rounded_rect(inner, int(inner * 0.28), YELLOW)
    _draw_wordmark_n(badge, inner, BLACK)
    im.paste(badge, (offset, offset), badge)
    im.save(os.path.join(OUT, "adaptive-icon.png"))
    print("wrote adaptive-icon.png (1024x1024, transparent bg, safe-zone yellow badge)")


def make_splash() -> None:
    """1242x2688 black splash with centered yellow badge + wordmark below.
    Expo will scale/contain this to the device."""
    W, H = 1242, 2688
    im = Image.new("RGBA", (W, H), BLACK)
    # badge in the visual center (~40% down)
    badge_size = int(W * 0.42)
    badge_x = (W - badge_size) // 2
    badge_y = int(H * 0.36)
    badge = _rounded_rect(badge_size, int(badge_size * 0.22), YELLOW)
    _draw_wordmark_n(badge, badge_size, BLACK)
    im.paste(badge, (badge_x, badge_y), badge)

    draw = ImageDraw.Draw(im)
    # brand name
    brand_font = _try_font(BOLD_FONT_CANDIDATES, size=int(W * 0.09))
    brand = "Nafis Ride"
    bb = draw.textbbox((0, 0), brand, font=brand_font, anchor="lt")
    bw = bb[2] - bb[0]
    draw.text(((W - bw) // 2 - bb[0], badge_y + badge_size + int(H * 0.03)),
               brand, font=brand_font, fill=WHITE)
    # tagline
    tag_font = _try_font(REG_FONT_CANDIDATES, size=int(W * 0.035))
    tag = "Alwar's own ride experience"
    tb = draw.textbbox((0, 0), tag, font=tag_font, anchor="lt")
    tw = tb[2] - tb[0]
    draw.text(((W - tw) // 2 - tb[0],
                badge_y + badge_size + int(H * 0.03) + (bb[3] - bb[1]) + int(H * 0.015)),
               tag, font=tag_font, fill=GREY)

    im.save(os.path.join(OUT, "splash-image.png"))
    print(f"wrote splash-image.png ({W}x{H}, black bg, yellow badge + wordmark)")


def make_favicon() -> None:
    """96x96 favicon — a scaled-down icon."""
    src = Image.open(os.path.join(OUT, "icon.png"))
    fav = src.resize((96, 96), Image.LANCZOS)
    fav.save(os.path.join(OUT, "favicon.png"))
    print("wrote favicon.png (96x96)")


def make_app_image() -> None:
    """A wider 'app-image.png' used elsewhere — same brand, transparent bg, safe."""
    src = Image.open(os.path.join(OUT, "icon.png"))
    im = src.resize((512, 512), Image.LANCZOS)
    im.save(os.path.join(OUT, "app-image.png"))
    print("wrote app-image.png (512x512, replaces the old one)")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    make_icon()
    make_adaptive_icon()
    make_splash()
    make_favicon()
    make_app_image()
    print("\nAll assets written to", OUT)

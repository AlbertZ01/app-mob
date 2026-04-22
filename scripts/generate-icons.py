from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "mobile" / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_icon(size: int, foreground_only: bool = False) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0) if foreground_only else "#0D1321")
    draw = ImageDraw.Draw(image)

    if not foreground_only:
        for y in range(size):
            blend = y / size
            r = round(13 * (1 - blend) + 29 * blend)
            g = round(19 * (1 - blend) + 120 * blend)
            b = round(33 * (1 - blend) + 116 * blend)
            draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        glow_draw.ellipse(
            (size * 0.10, size * 0.06, size * 0.86, size * 0.82),
            fill=(238, 66, 102, 64),
        )
        glow = glow.filter(ImageFilter.GaussianBlur(size // 10))
        image.alpha_composite(glow)

    cx, cy = size // 2, size // 2
    radius = int(size * 0.285)
    ring_width = int(size * 0.045)

    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        outline="#D9B44A",
        width=ring_width,
    )
    draw.ellipse(
        (cx - radius // 3, cy - radius // 3, cx + radius // 3, cy + radius // 3),
        fill="#F4F1EA",
    )
    draw.ellipse(
        (cx - radius // 9, cy - radius // 9, cx + radius // 9, cy + radius // 9),
        fill="#1D7874",
    )

    stem_x = int(size * 0.62)
    stem_top = int(size * 0.24)
    stem_bottom = int(size * 0.52)
    draw.rounded_rectangle(
        (stem_x, stem_top, stem_x + int(size * 0.055), stem_bottom),
        radius=int(size * 0.018),
        fill="#F4F1EA",
    )
    draw.ellipse(
        (
            stem_x - int(size * 0.01),
            stem_bottom - int(size * 0.01),
            stem_x + int(size * 0.13),
            stem_bottom + int(size * 0.11),
        ),
        fill="#F4F1EA",
    )

    label_font = font(int(size * 0.13))
    label = "AUX"
    bbox = draw.textbbox((0, 0), label, font=label_font)
    draw.text(
        ((size - (bbox[2] - bbox[0])) / 2, int(size * 0.70)),
        label,
        fill="#F4F1EA",
        font=label_font,
    )

    return image


def draw_splash() -> Image.Image:
    size = 1024
    image = Image.new("RGBA", (size, size), "#0D1321")
    icon = draw_icon(520, foreground_only=True)
    image.alpha_composite(icon, ((size - 520) // 2, 170))

    draw = ImageDraw.Draw(image)
    title_font = font(88)
    subtitle_font = font(34)
    for text, y, fnt, fill in [
        ("AUX Roast", 700, title_font, "#F4F1EA"),
        ("Spotify party intelligence", 805, subtitle_font, "#D9B44A"),
    ]:
        bbox = draw.textbbox((0, 0), text, font=fnt)
        draw.text(((size - (bbox[2] - bbox[0])) / 2, y), text, fill=fill, font=fnt)

    return image


draw_icon(1024).save(ASSETS / "icon.png")
draw_icon(1024, foreground_only=True).save(ASSETS / "adaptive-icon.png")
draw_splash().save(ASSETS / "splash.png")

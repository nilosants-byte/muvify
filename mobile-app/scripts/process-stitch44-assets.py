from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "assets" / "stitch-44-dark"
OUT_DIR = ROOT / "assets" / "stitch-44-dark-processed"
LOGO_PATH = ROOT / "assets" / "branding" / "muvify-logo-transparent.png"

TARGET_W = 390
TARGET_H = 844

TOP_LOGO_IDS = {"02", "03", "04", "05", "06", "10", "14"}
TOP_LOGO_Y = {"02": 34, "03": 34, "04": 30, "05": 30, "06": 52, "10": 52, "14": 46}
OLD_BADGE_BOX = {
    "02": (150, 46, 238, 138),
    "03": (150, 46, 238, 138),
    "04": (152, 42, 238, 120),
    "05": (152, 42, 238, 120),
    "06": (152, 95, 238, 168),
    "10": (152, 95, 238, 168),
    "14": (152, 76, 238, 152),
}

LOWERCASE_TOP_BRAND_IDS = {"16", "17", "18", "19", "20", "26", "27"}
TOP_BRAND_POS = {
    "16": (58, 21),
    "17": (58, 21),
    "18": (58, 21),
    "19": (58, 21),
    "20": (58, 21),
    "26": (52, 18),
    "27": (52, 18),
}


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def cover_resize(img: Image.Image, width: int, height: int) -> Image.Image:
    src_w, src_h = img.size
    scale = max(width / src_w, height / src_h)
    new_w = int(round(src_w * scale))
    new_h = int(round(src_h * scale))
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = max(0, (new_w - width) // 2)
    top = max(0, (new_h - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def clone_patch(
    img: Image.Image,
    target: tuple[int, int, int, int],
    source_top: int,
    blur_radius: float = 1.2,
) -> None:
    x0, y0, x1, y1 = target
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(img.width, x1)
    y1 = min(img.height, y1)
    h = y1 - y0
    if h <= 0 or x1 <= x0:
        return
    source_top = max(0, min(img.height - h, source_top))
    patch = img.crop((x0, source_top, x1, source_top + h))
    patch = patch.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    img.paste(patch, (x0, y0))


def paste_logo_top(img: Image.Image, logo: Image.Image, sid: str) -> None:
    box = OLD_BADGE_BOX[sid]
    clone_patch(img, box, max(2, box[1] - 26), blur_radius=1.4)

    logo_w = 156
    scale = logo_w / logo.width
    logo_h = int(round(logo.height * scale))
    logo_resized = logo.resize((logo_w, logo_h), Image.Resampling.LANCZOS)
    x = (img.width - logo_w) // 2
    y = TOP_LOGO_Y[sid]
    img.alpha_composite(logo_resized, (x, y))


def draw_muvify_word(
    img: Image.Image,
    x: int,
    y: int,
    size: int,
    stroke: int = 3,
    bg_stroke=(6, 14, 10),
) -> None:
    draw = ImageDraw.Draw(img, "RGBA")
    font = load_font(size=size, bold=True)
    draw.text((x, y), "muvi", font=font, fill=(240, 246, 242), stroke_width=stroke, stroke_fill=bg_stroke)
    muvi_w = int(draw.textlength("muvi", font=font))
    draw.text(
        (x + muvi_w - 1, y),
        "fy",
        font=font,
        fill=(126, 216, 120),
        stroke_width=stroke,
        stroke_fill=bg_stroke,
    )


def process_screen(sid: str, src_img: Image.Image, logo: Image.Image) -> Image.Image:
    img = cover_resize(src_img, TARGET_W, TARGET_H).convert("RGBA")

    if sid in TOP_LOGO_IDS:
        paste_logo_top(img, logo, sid)

    if sid == "03":
        clone_patch(img, (72, 800, 318, 840), 760, blur_radius=1.6)

    if sid == "04":
        clone_patch(img, (136, 765, 262, 810), 725, blur_radius=1.3)
        draw_muvify_word(img, 152, 777, size=18, stroke=2)

    if sid == "05":
        clone_patch(img, (110, 754, 286, 790), 716, blur_radius=1.3)
        shifted = Image.new("RGBA", (TARGET_W, TARGET_H), (5, 12, 9, 255))
        shifted.alpha_composite(img, (16, 0))
        img = shifted

    if sid == "07":
        clone_patch(img, (168, 176, 286, 226), 132, blur_radius=1.4)
        draw_muvify_word(img, 176, 190, size=20, stroke=2)
        draw = ImageDraw.Draw(img, "RGBA")
        f = load_font(size=20, bold=True)
        ww = int(draw.textlength("muvify", font=f))
        draw.text((176 + ww + 1, 190), "?", font=f, fill=(238, 244, 240), stroke_width=2, stroke_fill=(6, 14, 10))

    if sid == "11":
        clone_patch(img, (162, 44, 362, 78), 96, blur_radius=1.2)
        clone_patch(img, (34, 256, 292, 342), 346, blur_radius=1.2)

    if sid == "13":
        clone_patch(img, (34, 132, 356, 252), 264, blur_radius=1.1)

    if sid in LOWERCASE_TOP_BRAND_IDS:
        x, y = TOP_BRAND_POS[sid]
        draw_muvify_word(img, x, y, size=16, stroke=2)

    return img.convert("RGB")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    logo = Image.open(LOGO_PATH).convert("RGBA")

    for i in range(1, 45):
        sid = f"{i:02d}"
        src = SRC_DIR / f"{sid}.png"
        if not src.exists():
            raise FileNotFoundError(f"Missing source: {src}")
        image = Image.open(src).convert("RGBA")
        out = process_screen(sid, image, logo)
        out.save(OUT_DIR / f"{sid}.png", format="PNG", optimize=True)

    print(f"Processed 44 screens into: {OUT_DIR}")


if __name__ == "__main__":
    main()

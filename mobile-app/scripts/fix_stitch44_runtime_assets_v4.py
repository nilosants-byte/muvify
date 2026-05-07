from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "stitch-44-runtime-dark"
BACKUP = ROOT / "assets" / f"stitch-44-runtime-dark-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}-v4"
LOGO = ROOT / "assets" / "branding" / "muvify-logo-primary.png"
AGACHAMENTO = Path(r"C:/Users/Danilo/Documents/testes app/onboarding/onboarding_agachamento.jpeg")
SUPINO = Path(r"C:/Users/Danilo/Documents/testes app/onboarding/onboarding_supino.jpeg")

W, H = 390, 844


def font(size: int, bold: bool = False):
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for c in candidates:
        if c.exists():
            return ImageFont.truetype(str(c), size)
    return ImageFont.load_default()


def cover(path: Path) -> Image.Image:
    src = Image.open(path).convert("RGB")
    sw, sh = src.size
    scale = max(W / sw, H / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    src = src.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - W) // 2
    top = (nh - H) // 2
    return src.crop((left, top, left + W, top + H))


def crop_side(img: Image.Image, left=20, right=20) -> Image.Image:
    out = img.crop((left, 0, img.width - right, img.height))
    return out.resize((W, H), Image.Resampling.LANCZOS)


def hide_top_wordmark(im: Image.Image, y0=8, y1=110):
    # soft clone from nearby area to avoid hard black block
    strip = im.crop((0, 120, W, 240)).resize((W, y1 - y0), Image.Resampling.BILINEAR)
    strip = strip.filter(ImageFilter.GaussianBlur(4))
    im.paste(strip, (0, y0))
    # add subtle dark overlay for legibility
    overlay = Image.new("RGBA", (W, y1 - y0), (0, 0, 0, 80))
    im_rgba = im.convert("RGBA")
    im_rgba.paste(overlay, (0, y0), overlay)
    return im_rgba.convert("RGB")


def paste_logo(im: Image.Image, y=24, width=154):
    logo = Image.open(LOGO).convert("RGBA")
    ratio = width / logo.width
    logo = logo.resize((width, int(logo.height * ratio)), Image.Resampling.LANCZOS)
    x = (W - logo.width) // 2
    im.paste(logo, (x, y), logo)
    return im


def remove_logo_area_0203(im: Image.Image):
    # only left brand text should disappear, keep "Pular"
    draw = ImageDraw.Draw(im)
    draw.rectangle((18, 12, 150, 58), fill=(9, 18, 16))
    return im


def blend_background(im: Image.Image, bg_path: Path, alpha=0.35):
    bg = cover(bg_path).filter(ImageFilter.GaussianBlur(1.3))
    out = Image.blend(im.convert("RGB"), bg, alpha)
    # darken for contrast
    dark = Image.new("RGB", (W, H), (8, 14, 12))
    out = Image.blend(out, dark, 0.18)
    return out


def patch_screen_07(im: Image.Image):
    draw = ImageDraw.Draw(im)
    # clear title line and redraw with lowercase brand
    draw.rectangle((36, 92, 356, 194), fill=(7, 14, 12))
    f = font(19, True)
    t = "Como você usará o "
    x, y = 62, 118
    draw.text((x, y), t, fill=(236, 241, 237), font=f)
    offset = int(draw.textlength(t, font=f))
    draw.text((x + offset, y), "muvi", fill=(236, 241, 237), font=f)
    offset2 = int(draw.textlength(t + "muvi", font=f))
    draw.text((x + offset2, y), "fy?", fill=(63, 186, 94), font=f)
    return im


def patch_screen_11(im: Image.Image, bg_ref: Image.Image):
    # menu width ~2/3 and hide theme switch/helper text
    bg = bg_ref.filter(ImageFilter.GaussianBlur(4)).convert("RGBA")
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 120))
    canvas = Image.alpha_composite(bg, shade)

    drawer = im.crop((0, 0, 330, H)).resize((260, H), Image.Resampling.LANCZOS).convert("RGBA")
    d = ImageDraw.Draw(drawer)
    # remove helper text and close hint
    d.rectangle((102, 54, 255, 90), fill=(6, 14, 12, 255))
    # remove switch row and artifacts
    d.rectangle((20, 248, 245, 358), fill=(6, 14, 12, 255))
    # remove tiny footer text
    d.rectangle((20, 786, 245, 830), fill=(6, 14, 12, 255))

    canvas.paste(drawer, (0, 0), drawer)
    return canvas.convert("RGB")


def patch_screen_12(im: Image.Image, bg_ref: Image.Image):
    bg = bg_ref.filter(ImageFilter.GaussianBlur(4)).convert("RGBA")
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 120))
    canvas = Image.alpha_composite(bg, shade)
    panel = im.resize((260, H), Image.Resampling.LANCZOS).convert("RGBA")
    canvas.paste(panel, (W - 260, 0), panel)
    return canvas.convert("RGB")


def patch_screen_22(im: Image.Image):
    d = ImageDraw.Draw(im)
    # clear user avatar at top-right
    d.rectangle((343, 14, 382, 55), fill=(8, 16, 14))
    # draw minimalist bell icon
    d.ellipse((356, 24, 371, 39), outline=(186, 197, 190), width=2)
    d.rectangle((361, 37, 366, 43), fill=(186, 197, 190))
    d.ellipse((362, 43, 365, 46), fill=(186, 197, 190))
    return im


def draw_brand_lowercase(im: Image.Image):
    d = ImageDraw.Draw(im)
    d.rectangle((62, 10, 204, 52), fill=(8, 16, 14))
    f = font(21, True)
    x, y = 70, 16
    d.text((x, y), "muvi", fill=(236, 241, 237), font=f)
    off = int(d.textlength("muvi", font=f))
    d.text((x + off, y), "fy", fill=(63, 186, 94), font=f)
    return im


def apply_top_bottom_ref(images: dict[str, Image.Image], ids: list[str]):
    ref = images["30"]
    top = ref.crop((0, 0, W, 58))
    bottom = ref.crop((0, H - 82, W, H))
    for sid in ids:
        images[sid].paste(top, (0, 0))
        images[sid].paste(bottom, (0, H - 82))


def main():
    BACKUP.mkdir(parents=True, exist_ok=True)
    for p in ASSETS.glob("*.png"):
        (BACKUP / p.name).write_bytes(p.read_bytes())

    images = {f"{i:02d}": Image.open(ASSETS / f"{i:02d}.png").convert("RGB") for i in range(1, 45)}

    # proportion correction (most screens with side margins)
    for i in range(4, 45):
        sid = f"{i:02d}"
        images[sid] = crop_side(images[sid], 20, 20)

    # Onboarding: requested backgrounds + no logo on top
    images["02"] = blend_background(images["02"], AGACHAMENTO, alpha=0.45)
    images["02"] = remove_logo_area_0203(images["02"])

    images["03"] = blend_background(images["03"], SUPINO, alpha=0.45)
    images["03"] = remove_logo_area_0203(images["03"])
    # remove watermark if present (low footer text)
    d3 = ImageDraw.Draw(images["03"])
    d3.rectangle((40, 790, 350, 836), fill=(7, 14, 12))

    # Official logo replacement on auth/support screens
    for sid in ["04", "05", "06", "10", "14"]:
        images[sid] = hide_top_wordmark(images[sid], 8, 112)
        images[sid] = paste_logo(images[sid], y=26, width=156)

    # Specific cleanup
    d6 = ImageDraw.Draw(images["06"])
    d6.rectangle((151, 85, 241, 146), fill=(8, 16, 14))

    # screen 07 title casing and brand split
    images["07"] = patch_screen_07(images["07"])

    # screen 11 / 12 overlay behavior
    ref_bg = images["16"].copy()
    images["11"] = patch_screen_11(images["11"], ref_bg)
    images["12"] = patch_screen_12(images["12"], ref_bg)

    # screen 22 top-right icon
    images["22"] = patch_screen_22(images["22"])

    # enforce lowercase brand in selected top bars
    for sid in ["16", "17", "18", "19", "20", "26", "27"]:
        images[sid] = draw_brand_lowercase(images[sid])

    # Top/bottom strip standardization
    apply_top_bottom_ref(images, ["31", "32", "33", "34", "36", "37", "38", "40", "42", "43", "44"])

    for sid, im in images.items():
        im.save(ASSETS / f"{sid}.png", optimize=True)

    print(f"Patched {len(images)} screens")
    print(f"Backup at: {BACKUP}")


if __name__ == "__main__":
    main()

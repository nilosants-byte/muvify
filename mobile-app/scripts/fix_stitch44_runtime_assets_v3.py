from __future__ import annotations

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "stitch-44-runtime-dark"
BACKUP = ROOT / "assets" / f"stitch-44-runtime-dark-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

LOGO = ROOT / "assets" / "branding" / "muvify-logo-primary.png"
BG_AGACHAMENTO = Path(r"C:/Users/Danilo/Documents/testes app/onboarding/onboarding_agachamento.jpeg")
BG_SUPINO = Path(r"C:/Users/Danilo/Documents/testes app/onboarding/onboarding_supino.jpeg")

W, H = 390, 844


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for p in candidates:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def rounded_rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def cover_image(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    sw, sh = im.size
    scale = max(W / sw, H / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - W) // 2
    top = (nh - H) // 2
    return im.crop((left, top, left + W, top + H))


def blend_overlay(base: Image.Image) -> Image.Image:
    # dark premium overlay + subtle top/bottom gradients
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 96))
    base_rgba = base.convert("RGBA")
    out = Image.alpha_composite(base_rgba, overlay)

    grad_top = Image.new("L", (1, H), 0)
    px = grad_top.load()
    for y in range(H):
        v = int(max(0, 170 - (y * 0.65)))
        px[0, y] = v
    grad_top = grad_top.resize((W, H))
    shade_top = Image.new("RGBA", (W, H), (0, 0, 0, 120))
    out = Image.composite(shade_top, out, grad_top)

    grad_bottom = Image.new("L", (1, H), 0)
    px2 = grad_bottom.load()
    for y in range(H):
        v = int(max(0, (y - H * 0.56) * 0.75))
        px2[0, y] = min(180, v)
    grad_bottom = grad_bottom.resize((W, H))
    shade_bottom = Image.new("RGBA", (W, H), (2, 7, 5, 120))
    out = Image.composite(shade_bottom, out, grad_bottom)
    return out


def paste_logo_top_center(im: Image.Image, y: int = 36, width: int = 164) -> Image.Image:
    logo = Image.open(LOGO).convert("RGBA")
    ratio = width / logo.width
    logo = logo.resize((width, int(logo.height * ratio)), Image.Resampling.LANCZOS)
    x = (W - logo.width) // 2
    im.paste(logo, (x, y), logo)
    return im


def draw_brand_word(draw: ImageDraw.ImageDraw, x: int, y: int, size: int = 28):
    f = load_font(size, bold=True)
    draw.text((x, y), "muvi", fill=(245, 248, 246), font=f)
    muvi_w = draw.textlength("muvi", font=f)
    draw.text((x + muvi_w, y), "fy", fill=(64, 186, 94), font=f)


def patch_onboarding_02() -> Image.Image:
    bg = cover_image(BG_AGACHAMENTO).filter(ImageFilter.GaussianBlur(1.6))
    img = blend_overlay(bg)
    d = ImageDraw.Draw(img)

    title_f = load_font(62, bold=True)
    body_f = load_font(22, bold=False)
    btn_f = load_font(34, bold=True)
    small_f = load_font(30, bold=False)

    d.multiline_text((30, 500), "Transforme sua\nrotina com\npersonal trainers\nqualificados.", fill=(236, 241, 237), font=title_f, spacing=6)

    # dots
    d.ellipse((30, 694, 58, 702), fill=(120, 248, 145))
    d.ellipse((66, 695, 74, 703), fill=(85, 96, 90))

    rounded_rect(d, (30, 742, 214, 804), 12, (33, 128, 58, 245))
    d.text((68, 760), "Próximo", fill=(26, 45, 32), font=btn_f)
    d.text((296, 757), "Pular", fill=(180, 189, 183), font=small_f)

    return img.convert("RGB")


def patch_onboarding_03() -> Image.Image:
    bg = cover_image(BG_SUPINO).filter(ImageFilter.GaussianBlur(1.6))
    img = blend_overlay(bg)
    d = ImageDraw.Draw(img)

    title_f = load_font(47, bold=True)
    btn_f = load_font(38, bold=True)

    d.multiline_text((30, 560), "Sua jornada fitness personalizada\nna palma da mão.", fill=(236, 241, 237), font=title_f, spacing=8)

    d.ellipse((166, 701, 174, 709), fill=(85, 96, 90))
    d.ellipse((180, 700, 210, 710), fill=(120, 248, 145))

    rounded_rect(d, (30, 738, 360, 804), 12, (51, 155, 63, 245))
    d.text((128, 758), "COMEÇAR", fill=(22, 39, 25), font=btn_f)

    return img.convert("RGB")


def crop_resize(im: Image.Image, left: int = 24, right: int = 24, top: int = 0, bottom: int = 0) -> Image.Image:
    w, h = im.size
    cropped = im.crop((left, top, w - right, h - bottom))
    return cropped.resize((W, H), Image.Resampling.LANCZOS)


def patch_logo_screens(screen_id: str, img: Image.Image) -> Image.Image:
    d = ImageDraw.Draw(img)
    # remove old generic logo/square region
    rounded_rect(d, (110, 24, 280, 130), 18, (5, 12, 10, 210))
    return paste_logo_top_center(img, y=34, width=170)


def patch_screen_04(img: Image.Image) -> Image.Image:
    img = patch_logo_screens("04", img)
    d = ImageDraw.Draw(img)
    # normalize bottom branding to lowercase
    rounded_rect(d, (118, 760, 270, 815), 8, (5, 12, 10, 220))
    draw_brand_word(d, 142, 772, size=30)
    return img


def patch_screen_05(img: Image.Image) -> Image.Image:
    img = patch_logo_screens("05", img)
    d = ImageDraw.Draw(img)
    # remove english footer watermark
    rounded_rect(d, (95, 680, 300, 735), 6, (6, 13, 11, 230))
    return img


def patch_screen_06(img: Image.Image) -> Image.Image:
    img = patch_logo_screens("06", img)
    d = ImageDraw.Draw(img)
    # clear small black badge under logo
    rounded_rect(d, (150, 86, 242, 150), 10, (8, 15, 13, 230))
    return img


def patch_screen_07(img: Image.Image) -> Image.Image:
    d = ImageDraw.Draw(img)
    rounded_rect(d, (48, 98, 344, 192), 8, (5, 12, 10, 220))
    f = load_font(56, bold=True)
    prefix = "Como você usará o "
    y = 114
    x = 28
    d.text((x, y), prefix, fill=(236, 241, 237), font=f)
    px = int(d.textlength(prefix, font=f))
    d.text((x + px, y), "muvi", fill=(236, 241, 237), font=f)
    px2 = int(d.textlength(prefix + "muvi", font=f))
    d.text((x + px2, y), "fy?", fill=(64, 186, 94), font=f)
    return img


def patch_screen_11(img: Image.Image) -> Image.Image:
    # rebuild side drawer width around 2/3 and remove switch/helper text blocks
    base_bg = Image.open(ASSETS / "16.png").convert("RGB")
    base_bg = crop_resize(base_bg, 24, 24)
    base_bg = base_bg.filter(ImageFilter.GaussianBlur(3))
    mask_overlay = Image.new("RGBA", (W, H), (0, 0, 0, 110))
    canvas = Image.alpha_composite(base_bg.convert("RGBA"), mask_overlay)

    drawer = img.crop((0, 0, 332, H)).convert("RGBA")
    drawer = drawer.resize((260, H), Image.Resampling.LANCZOS)
    dd = ImageDraw.Draw(drawer)
    # remove theme row + helper text and dirty block
    rounded_rect(dd, (18, 232, 246, 360), 14, (6, 14, 12, 255))
    rounded_rect(dd, (114, 54, 246, 96), 10, (6, 14, 12, 245))
    rounded_rect(dd, (16, 760, 246, 830), 10, (6, 14, 12, 255))

    canvas.paste(drawer, (0, 0), drawer)
    return canvas.convert("RGB")


def patch_screen_12(img: Image.Image) -> Image.Image:
    # Notifications panel on right occupying ~2/3 width
    base_bg = Image.open(ASSETS / "16.png").convert("RGB")
    base_bg = crop_resize(base_bg, 24, 24)
    base_bg = base_bg.filter(ImageFilter.GaussianBlur(3))
    canvas = Image.alpha_composite(base_bg.convert("RGBA"), Image.new("RGBA", (W, H), (0, 0, 0, 110)))

    panel = img.crop((0, 0, W, H)).convert("RGBA")
    panel = panel.resize((260, H), Image.Resampling.LANCZOS)
    x = W - 260
    canvas.paste(panel, (x, 0), panel)
    return canvas.convert("RGB")


def patch_screen_22(img: Image.Image) -> Image.Image:
    d = ImageDraw.Draw(img)
    # replace user avatar in top-right with notification bell style
    rounded_rect(d, (344, 16, 382, 54), 10, (8, 16, 14, 230))
    # simple bell glyph shape
    d.ellipse((357, 26, 373, 42), outline=(168, 178, 171), width=2)
    d.rectangle((362, 37, 368, 45), fill=(168, 178, 171))
    d.ellipse((364, 45, 366, 47), fill=(168, 178, 171))
    return img


def apply_top_bottom_from_30(images: dict[str, Image.Image], ids: list[str]):
    ref = images["30"]
    top_strip = ref.crop((0, 0, W, 58))
    bottom_strip = ref.crop((0, H - 82, W, H))
    for sid in ids:
        im = images[sid]
        im.paste(top_strip, (0, 0))
        im.paste(bottom_strip, (0, H - 82))
        images[sid] = im


def main():
    BACKUP.mkdir(parents=True, exist_ok=True)
    for p in ASSETS.glob("*.png"):
        (BACKUP / p.name).write_bytes(p.read_bytes())

    images: dict[str, Image.Image] = {}
    for i in range(1, 45):
        sid = f"{i:02d}"
        images[sid] = Image.open(ASSETS / f"{sid}.png").convert("RGB")

    # General proportion correction on app content screens
    for i in range(8, 45):
        sid = f"{i:02d}"
        images[sid] = crop_resize(images[sid], 24, 24)

    # Build onboarding screens as requested
    images["02"] = patch_onboarding_02()
    images["03"] = patch_onboarding_03()

    # targeted logo/cleanup screens
    images["04"] = patch_screen_04(crop_resize(images["04"], 20, 20))
    images["05"] = patch_screen_05(crop_resize(images["05"], 20, 20))
    images["06"] = patch_screen_06(crop_resize(images["06"], 20, 20))
    images["10"] = patch_logo_screens("10", crop_resize(images["10"], 20, 20))
    images["14"] = patch_logo_screens("14", crop_resize(images["14"], 20, 20))

    # phrase/casing fix
    images["07"] = patch_screen_07(crop_resize(images["07"], 20, 20))

    # panel behavior visuals
    images["11"] = patch_screen_11(crop_resize(images["11"], 24, 24))
    images["12"] = patch_screen_12(crop_resize(images["12"], 24, 24))

    # top-right icon correction
    images["22"] = patch_screen_22(images["22"])

    # enforce lowercase brand in top app bars where requested
    for sid in ["16", "17", "18", "19", "20", "26", "27"]:
        im = images[sid]
        d = ImageDraw.Draw(im)
        rounded_rect(d, (64, 12, 206, 52), 8, (8, 16, 14, 235))
        draw_brand_word(d, 72, 16, size=28)
        images[sid] = im

    # top/bottom strip standardization requested
    apply_top_bottom_from_30(images, ["31", "32", "33", "34", "36", "37", "38", "40", "42", "43", "44"])

    # save
    for sid, im in images.items():
        im.save(ASSETS / f"{sid}.png", optimize=True)

    print(f"Patched assets in {ASSETS}")
    print(f"Backup created at {BACKUP}")


if __name__ == "__main__":
    main()

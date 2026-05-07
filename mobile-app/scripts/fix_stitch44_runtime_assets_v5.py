from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "stitch-44-runtime-dark"
BACKUP = ROOT / "assets" / f"stitch-44-runtime-dark-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}-v5"
LOGO = ROOT / "assets" / "branding" / "muvify-logo-primary.png"
AGACHAMENTO = Path(r"C:/Users/Danilo/Documents/testes app/onboarding/onboarding_agachamento.jpeg")
SUPINO = Path(r"C:/Users/Danilo/Documents/testes app/onboarding/onboarding_supino.jpeg")

W, H = 390, 844


def fnt(size: int, bold: bool = False):
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for p in candidates:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def cover(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    sw, sh = im.size
    scale = max(W / sw, H / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - W) // 2
    top = (nh - H) // 2
    return im.crop((left, top, left + W, top + H))


def crop_side(im: Image.Image, left=20, right=20) -> Image.Image:
    out = im.crop((left, 0, im.width - right, im.height))
    return out.resize((W, H), Image.Resampling.LANCZOS)


def draw_round_rect(draw: ImageDraw.ImageDraw, box, radius=12, fill=(45, 165, 72, 255)):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make_onboarding(bg_path: Path, title: str, subtitle: str, primary_btn: str, secondary_btn: str | None, dots=(1, 0)) -> Image.Image:
    bg = cover(bg_path).filter(ImageFilter.GaussianBlur(1.2)).convert("RGBA")
    # overlays for readability
    top = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dt = ImageDraw.Draw(top)
    dt.rectangle((0, 0, W, 84), fill=(5, 14, 12, 130))
    dt.rectangle((0, 430, W, H), fill=(3, 10, 8, 150))
    bg = Image.alpha_composite(bg, top)

    d = ImageDraw.Draw(bg)
    title_font = fnt(26, True)
    sub_font = fnt(18, False)
    btn_font = fnt(20, True)
    small_font = fnt(16, False)

    # text block
    d.multiline_text((28, 500), title, font=title_font, fill=(236, 241, 237), spacing=6)
    d.multiline_text((28, 620), subtitle, font=sub_font, fill=(182, 192, 186), spacing=4)

    # dots
    x0 = 30
    for i in range(2):
        color = (120, 248, 145) if dots[i] else (82, 92, 88)
        wdot = 28 if dots[i] else 8
        d.rounded_rectangle((x0, 696, x0 + wdot, 704), radius=4, fill=color)
        x0 += wdot + 8

    # buttons
    draw_round_rect(d, (28, 730, 214, 794), radius=14, fill=(51, 160, 68, 245))
    d.text((79, 752), primary_btn, fill=(20, 35, 24), font=btn_font)

    if secondary_btn:
        d.text((300, 750), secondary_btn, fill=(190, 197, 192), font=small_font)

    return bg.convert("RGB")


def hide_center_top_word(im: Image.Image):
    d = ImageDraw.Draw(im)
    # mask only center brand text area
    d.rectangle((120, 12, 272, 78), fill=(6, 14, 12))
    return im


def paste_logo(im: Image.Image, y=20, width=160):
    logo = Image.open(LOGO).convert("RGBA")
    ratio = width / logo.width
    logo = logo.resize((width, int(logo.height * ratio)), Image.Resampling.LANCZOS)
    x = (W - logo.width) // 2
    im.paste(logo, (x, y), logo)
    return im


def patch_07(im: Image.Image):
    d = ImageDraw.Draw(im)
    d.rectangle((48, 98, 344, 182), fill=(8, 16, 14))
    tfont = fnt(18, True)
    prefix = "Como você usará o "
    x, y = 58, 122
    d.text((x, y), prefix, fill=(236, 241, 237), font=tfont)
    off = int(d.textlength(prefix, font=tfont))
    d.text((x + off, y), "muvi", fill=(236, 241, 237), font=tfont)
    off2 = int(d.textlength(prefix + "muvi", font=tfont))
    d.text((x + off2, y), "fy?", fill=(64, 186, 94), font=tfont)
    return im


def patch_11(im: Image.Image):
    d = ImageDraw.Draw(im)
    # hide helper text
    d.rectangle((168, 64, 352, 92), fill=(8, 16, 14))
    # remove theme option row + artifacts
    d.rectangle((30, 250, 300, 338), fill=(8, 16, 14))
    # remove footer tiny text
    d.rectangle((40, 806, 264, 842), fill=(8, 16, 14))
    # keep drawer width visually <=2/3 by darkening right area
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle((260, 0, W, H), fill=(0, 0, 0, 110))
    return Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")


def patch_12(im: Image.Image, bg_ref: Image.Image):
    # create right sheet occupying 2/3
    bg = bg_ref.filter(ImageFilter.GaussianBlur(4)).convert("RGBA")
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 120))
    canvas = Image.alpha_composite(bg, shade)
    panel = im.resize((260, H), Image.Resampling.LANCZOS).convert("RGBA")
    canvas.paste(panel, (W - 260, 0), panel)
    return canvas.convert("RGB")


def patch_22(im: Image.Image):
    d = ImageDraw.Draw(im)
    d.rectangle((344, 14, 382, 54), fill=(8, 16, 14))
    d.ellipse((356, 24, 371, 39), outline=(184, 194, 188), width=2)
    d.rectangle((361, 37, 366, 43), fill=(184, 194, 188))
    d.ellipse((362, 43, 365, 46), fill=(184, 194, 188))
    return im


def draw_brand_lower(im: Image.Image):
    d = ImageDraw.Draw(im)
    d.rectangle((62, 10, 206, 50), fill=(8, 16, 14))
    bf = fnt(20, True)
    x, y = 70, 15
    d.text((x, y), "muvi", fill=(236, 241, 237), font=bf)
    off = int(d.textlength("muvi", font=bf))
    d.text((x + off, y), "fy", fill=(64, 186, 94), font=bf)
    return im


def apply_strip(images, ids):
    ref = images["30"]
    top = ref.crop((0, 0, W, 58))
    bottom = ref.crop((0, H - 82, W, H))
    for sid in ids:
        images[sid].paste(top, (0, 0))
        images[sid].paste(bottom, (0, H - 82))


def main():
    BACKUP.mkdir(parents=True, exist_ok=True)
    for p in ASSETS.glob("*.png"):
        if p.name.startswith("_"):
            continue
        (BACKUP / p.name).write_bytes(p.read_bytes())

    images = {f"{i:02d}": Image.open(ASSETS / f"{i:02d}.png").convert("RGB") for i in range(1, 45)}

    for i in range(4, 45):
        sid = f"{i:02d}"
        images[sid] = crop_side(images[sid], 20, 20)

    # rebuild onboarding 2/3 with requested backgrounds and no logo
    images["02"] = make_onboarding(
        AGACHAMENTO,
        "Transforme sua\nrotina com\npersonal trainers\nqualificados.",
        "Encontre os melhores profissionais\ne alcance seus objetivos com a MuviFy.",
        "Próximo",
        "Pular",
        dots=(1, 0)
    )
    images["03"] = make_onboarding(
        SUPINO,
        "Sua jornada fitness\npersonalizada na\npalma da mão.",
        "Agenda, consultoria e\nacompanhamento em um só lugar.",
        "COMEÇAR",
        None,
        dots=(0, 1)
    )

    for sid in ["04", "05", "06", "10", "14"]:
        images[sid] = hide_center_top_word(images[sid])
        images[sid] = paste_logo(images[sid], y=22, width=158)

    # small badge under logo on 06
    d6 = ImageDraw.Draw(images["06"])
    d6.rectangle((151, 84, 242, 144), fill=(8, 16, 14))

    images["07"] = patch_07(images["07"])
    images["11"] = patch_11(images["11"])
    images["12"] = patch_12(images["12"], images["16"])
    images["22"] = patch_22(images["22"])

    for sid in ["16", "17", "18", "19", "20", "26", "27"]:
        images[sid] = draw_brand_lower(images[sid])

    apply_strip(images, ["31", "32", "33", "34", "36", "37", "38", "40", "42", "43", "44"])

    for sid, im in images.items():
        im.save(ASSETS / f"{sid}.png", optimize=True)

    print("done")
    print(BACKUP)


if __name__ == "__main__":
    main()

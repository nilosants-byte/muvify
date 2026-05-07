from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'assets' / 'stitch-44-dark'
CLEAN = Path(r'C:\Users\Danilo\Documents\testes app\design\stitch_onboarding_2_dark\stitch_onboarding_2_dark')
OUT = ROOT / 'assets' / 'stitch-44-runtime-dark'

REPLACE = {
    '02': CLEAN / 'onboarding_1_dark_gramado' / 'screen.png',
    '03': CLEAN / 'onboarding_2_dark_gramado' / 'screen.png',
    '04': CLEAN / 'login_dark_gramado' / 'screen.png',
    '05': CLEAN / 'cadastro_dark_gramado' / 'screen.png',
    '06': CLEAN / 'recuperar_senha_dark_gramado' / 'screen.png',
    '07': CLEAN / 'escolha_de_perfil_dark_gramado' / 'screen.png',
    '10': CLEAN / 'sess_o_expirada_dark_gramado' / 'screen.png',
    '14': CLEAN / 'sem_internet_dark' / 'screen.png',
}
LOWER_IDS = {'16','17','18','19','20','26','27'}
LOWER_POS = {'16':(54,18),'17':(54,18),'18':(54,18),'19':(54,18),'20':(54,18),'26':(49,15),'27':(49,15)}

def fnt(sz):
    for p in [r'C:\Windows\Fonts\arialbd.ttf',r'C:\Windows\Fonts\segoeuib.ttf']:
        try: return ImageFont.truetype(p, sz)
        except: pass
    return ImageFont.load_default()


def avg(img, rect):
    x0,y0,x1,y1 = rect
    vals=[]
    for x in (x0,x1):
        for y in (y0,y1):
            x=max(0,min(img.width-1,x)); y=max(0,min(img.height-1,y))
            vals.append(img.getpixel((x,y)))
    r=sum(v[0] for v in vals)//len(vals); g=sum(v[1] for v in vals)//len(vals); b=sum(v[2] for v in vals)//len(vals)
    return (r,g,b,255)

OUT.mkdir(parents=True, exist_ok=True)
for i in range(1,45):
    sid=f'{i:02d}'
    src = REPLACE.get(sid, RAW / f'{sid}.png')
    img = Image.open(src).convert('RGBA').resize((390,844), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(img,'RGBA')

    if sid == '11':
        c1 = avg(img,(170,66,370,94))
        draw.rounded_rectangle((168,66,372,96),radius=6,fill=c1)
        c2 = avg(img,(24,256,266,324))
        draw.rounded_rectangle((24,252,266,326),radius=12,fill=c2)

    if sid in LOWER_IDS:
        x,y = LOWER_POS[sid]
        c = avg(img,(x-4,y+8,x+96,y+24))
        draw.rounded_rectangle((x-4,y-2,x+98,y+24),radius=6,fill=c)
        font = fnt(16)
        draw.text((x,y),'muvi',font=font,fill=(240,246,242,255),stroke_width=2,stroke_fill=(6,18,12,255))
        w = int(draw.textlength('muvi',font=font))
        draw.text((x+w-1,y),'fy',font=font,fill=(121,214,110,255),stroke_width=2,stroke_fill=(6,18,12,255))

    img.convert('RGB').save(OUT / f'{sid}.png', optimize=True)

print('rebuilt', OUT)

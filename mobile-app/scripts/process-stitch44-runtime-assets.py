from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / 'assets' / 'stitch-44-dark'
OUT_DIR = ROOT / 'assets' / 'stitch-44-runtime-dark'
LOGO_PATH = ROOT / 'assets' / 'branding' / 'muvify-logo-primary.png'
W, H = 390, 844

TOP_REPLACE = {
    '02': {'rect': (174, 82, 216, 120), 'logo_y': 20, 'logo_w': 170},
    '03': {'rect': (174, 82, 216, 120), 'logo_y': 20, 'logo_w': 170},
    '04': {'rect': (174, 96, 216, 134), 'logo_y': 30, 'logo_w': 170},
    '05': {'rect': (174, 96, 216, 134), 'logo_y': 30, 'logo_w': 170},
    '06': {'rect': (174, 118, 216, 156), 'logo_y': 48, 'logo_w': 170},
    '10': {'rect': (174, 118, 216, 156), 'logo_y': 48, 'logo_w': 170},
    '14': {'rect': (156, 102, 234, 144), 'logo_y': 44, 'logo_w': 170},
}
LOWER_IDS = {'16','17','18','19','20','26','27'}
LOWER_POS = {'16':(54,18),'17':(54,18),'18':(54,18),'19':(54,18),'20':(54,18),'26':(49,15),'27':(49,15)}


def font(sz:int,b=True):
    for p in [r'C:\Windows\Fonts\arialbd.ttf',r'C:\Windows\Fonts\segoeuib.ttf',r'C:\Windows\Fonts\arial.ttf']:
        try:
            return ImageFont.truetype(p,sz)
        except: pass
    return ImageFont.load_default()


def avg(img, pts):
    rs=gs=bs=0
    n=0
    for x,y in pts:
        x=max(0,min(img.width-1,x)); y=max(0,min(img.height-1,y))
        r,g,b,a=img.getpixel((x,y))
        rs+=r; gs+=g; bs+=b; n+=1
    return (rs//n,gs//n,bs//n,255)


def fill(img, rect, color, r=8):
    ImageDraw.Draw(img,'RGBA').rounded_rectangle(rect, radius=r, fill=color)


def put_logo(img, logo, y, w):
    ratio=w/logo.width
    h=int(logo.height*ratio)
    l=logo.resize((w,h), Image.Resampling.LANCZOS)
    x=(img.width-w)//2
    img.alpha_composite(l,(x,y))


def draw_muvify(img, x, y, size):
    d=ImageDraw.Draw(img,'RGBA')
    f=font(size,True)
    d.text((x,y),'muvi',font=f,fill=(240,246,242,255),stroke_width=2,stroke_fill=(6,18,12,255))
    w=int(d.textlength('muvi',font=f))
    d.text((x+w-1,y),'fy',font=f,fill=(121,214,110,255),stroke_width=2,stroke_fill=(6,18,12,255))


def process(sid):
    img=Image.open(SRC_DIR/f'{sid}.png').convert('RGBA').resize((W,H),Image.Resampling.LANCZOS)
    logo=Image.open(LOGO_PATH).convert('RGBA')

    if sid in TOP_REPLACE:
        x0,y0,x1,y1=TOP_REPLACE[sid]['rect']
        c=avg(img,[(x0-10,y0+8),(x1+10,y0+8),(x0-10,y1-8),(x1+10,y1-8)])
        fill(img,(x0,y0,x1,y1),c,7)
        put_logo(img,logo,TOP_REPLACE[sid]['logo_y'],TOP_REPLACE[sid]['logo_w'])

    if sid=='03':
        c=avg(img,[(20,806),(370,806),(20,836),(370,836)])
        fill(img,(30,810,360,842),c,4)

    if sid=='05':
        c=avg(img,[(92,760),(298,760),(92,778),(298,778)])
        fill(img,(88,756,302,782),c,6)

    if sid=='07':
        c1=avg(img,[(18,132),(166,132),(18,146),(166,146)])
        fill(img,(16,126,170,148),c1,6)
        c2=avg(img,[(96,186),(234,186),(96,220),(234,220)])
        fill(img,(94,178,238,224),c2,8)
        d=ImageDraw.Draw(img,'RGBA')
        f=font(20,True)
        d.text((102,186),'muvi',font=f,fill=(240,246,242,255),stroke_width=2,stroke_fill=(6,18,12,255))
        w=int(d.textlength('muvi',font=f))
        d.text((102+w-1,186),'fy',font=f,fill=(121,214,110,255),stroke_width=2,stroke_fill=(6,18,12,255))
        w2=int(d.textlength('muvify',font=f))
        d.text((102+w2+1,186),'?',font=f,fill=(240,246,242,255),stroke_width=2,stroke_fill=(6,18,12,255))

    if sid=='11':
        c1=avg(img,[(182,78),(364,78),(182,92),(364,92)])
        fill(img,(178,72,368,94),c1,6)
        c2=avg(img,[(26,264),(262,264),(26,314),(262,314)])
        fill(img,(24,256,266,324),c2,10)

    if sid in LOWER_IDS:
        x,y=LOWER_POS[sid]
        c=avg(img,[(x-4,y+8),(x+94,y+8),(x-4,y+24),(x+94,y+24)])
        fill(img,(x-3,y-2,x+96,y+24),c,6)
        draw_muvify(img,x,y,16)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    img.convert('RGB').save(OUT_DIR/f'{sid}.png', optimize=True)


def main():
    for i in range(1,45):
        sid=f'{i:02d}'
        process(sid)
    print('ok', OUT_DIR)

if __name__=='__main__':
    main()

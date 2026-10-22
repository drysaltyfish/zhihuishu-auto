import os
from PIL import Image, ImageDraw, ImageFont

out_dir = r"D:\Projects\MultiProject\zhihuishu-auto\desktop\assets"
os.makedirs(out_dir, exist_ok=True)

def make(size):
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.24)
    # 圆角渐变底：蓝 -> 绿
    grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for i in range(S * 2):
        t = i / (S * 2 - 1)
        c = (int(59 + (34 - 59) * t), int(130 + (197 - 130) * t), int(246 + (94 - 246) * t), 255)
        gd.line([(i, 0), (0, i)], fill=c)
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    img.paste(grad, (0, 0), mask)


    # 文字「智」
    font = None
    for fp in [r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"]:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, int(S * 0.52))
                break
            except Exception:
                pass
    text = "智"
    if font:
        box = d.textbbox((0, 0), text, font=font)
        w, h = box[2] - box[0], box[3] - box[1]
        d.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1] - int(S*0.02)), text, font=font, fill=(255, 255, 255, 245))
    return img.resize((size, size), Image.LANCZOS)

sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [make(s) for s in sizes]
imgs[-1].save(os.path.join(out_dir, "icon.ico"), format="ICO", sizes=[(s, s) for s in sizes])
imgs[sizes.index(128)].save(os.path.join(out_dir, "icon.png"))
make(64).save(os.path.join(out_dir, "tray.png"))
make(64).save(os.path.join(out_dir, "tray.ico"), format="ICO", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64)])
print("ok", os.listdir(out_dir))
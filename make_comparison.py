from PIL import Image, ImageDraw, ImageFont
import os

base = r"E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp\screenshots"
shot = Image.open(os.path.join(base, "capture.png")).convert("RGB")
w, h = shot.size
pad, header = 24, 56
canvas = Image.new("RGB", (w * 2 + pad * 3, h + header + pad * 2), (24, 26, 30))
try:
    f_title = ImageFont.truetype("arial.ttf", 22)
    f_note = ImageFont.truetype("arial.ttf", 16)
except Exception:
    f_title = f_note = ImageFont.load_default()
d = ImageDraw.Draw(canvas)
d.text((pad, 16), "What the user sees: NOTHING - window parked off-screen", font=f_title, fill=(255, 120, 120))
left = Image.new("RGB", (w, h), (40, 44, 52))
ld = ImageDraw.Draw(left)
for y in range(0, h, 4):
    ld.line([(0, y), (w, y)], fill=(44, 48, 56))
ld.text((20, h // 2 - 30), "no window here", font=f_note, fill=(120, 126, 136))
canvas.paste(left, (pad, header))
d.text((w + pad * 2, 16), "What the agent captures (PrintWindow, off-screen)", font=f_title, fill=(120, 220, 140))
canvas.paste(shot, (w + pad * 2, header))
out = os.path.join(base, "invisible-window-capture.png")
canvas.save(out)
print(canvas.size, "->", out)

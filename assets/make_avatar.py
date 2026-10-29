import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def make_avatar():
    size = 1024
    img = Image.new("RGBA", (size, size), (10, 14, 26, 255))
    draw = ImageDraw.Draw(img)

    # Gradient background (deep midnight indigo to dark slate)
    for y in range(size):
        ratio = y / size
        r = int(9 + ratio * 14)
        g = int(14 + ratio * 24)
        b = int(28 + ratio * 48)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # Ambient glowing orbs
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)

    # Emerald green glow (top right)
    for r in range(450, 0, -10):
        alpha = int(35 * (1 - r / 450))
        gdraw.ellipse([700 - r, 300 - r, 700 + r, 300 + r], fill=(16, 185, 129, alpha))

    # Electric cyan glow (bottom left)
    for r in range(420, 0, -10):
        alpha = int(38 * (1 - r / 420))
        gdraw.ellipse([320 - r, 720 - r, 320 + r, 720 + r], fill=(6, 182, 212, alpha))

    # Concentric radar/broadcast rings
    center_x, center_y = 512, 490
    for rad in [140, 220, 310, 400]:
        gdraw.ellipse([center_x - rad, center_y - rad, center_x + rad, center_y + rad], outline=(255, 255, 255, 12), width=2)

    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # 3D Glassmorphic Newspaper / Studio Tablet Card
    card_w = 460
    card_h = 540
    card_x = (size - card_w) // 2
    card_y = 220

    # Glow beneath card
    glow_card = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gc_draw = ImageDraw.Draw(glow_card)
    for g_rad in range(30, 0, -3):
        alpha = int(45 * (1 - g_rad / 30))
        gc_draw.rounded_rectangle([card_x - g_rad, card_y - g_rad, card_x + card_w + g_rad, card_y + card_h + g_rad], radius=36 + g_rad, outline=(16, 185, 129, alpha), width=3)
    img = Image.alpha_composite(img, glow_card)
    draw = ImageDraw.Draw(img)

    # Glass Card Body
    card_img = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(card_img)
    cdraw.rounded_rectangle([0, 0, card_w, card_h], radius=32, fill=(18, 25, 44, 230), outline=(16, 185, 129, 210), width=3)

    # Top accent header
    cdraw.rounded_rectangle([0, 0, card_w, 8], radius=4, fill=(16, 185, 129, 255))

    # Mini holographic news broadcast lines
    # Headline block
    cdraw.rounded_rectangle([36, 45, card_w - 36, 95], radius=12, fill=(6, 182, 212, 70), outline=(6, 182, 212, 180), width=1)
    
    # Live Broadcast Red/Green Dot
    cdraw.ellipse([54, 62, 70, 78], fill=(16, 185, 129, 255))
    
    # Thumbnail image placeholder
    cdraw.rounded_rectangle([36, 120, 180, 240], radius=16, fill=(30, 42, 68, 240), outline=(0, 210, 255, 100), width=1)
    # Play icon inside thumb
    cdraw.polygon([(95, 160), (95, 200), (130, 180)], fill=(0, 210, 255, 220))

    # Lines representing rich paragraphs
    line_y = 130
    for _ in range(4):
        cdraw.rounded_rectangle([205, line_y, card_w - 36, line_y + 14], radius=7, fill=(148, 163, 184, 180))
        line_y += 30

    # Expandable quote block inside the card
    quote_y = 270
    cdraw.rounded_rectangle([36, quote_y, card_w - 36, quote_y + 110], radius=14, fill=(15, 23, 42, 240), outline=(139, 92, 246, 160), width=2)
    cdraw.rounded_rectangle([36, quote_y, 42, quote_y + 110], radius=2, fill=(139, 92, 246, 255))
    cdraw.rounded_rectangle([56, quote_y + 20, card_w - 60, quote_y + 36], radius=8, fill=(167, 139, 250, 140))
    cdraw.rounded_rectangle([56, quote_y + 52, card_w - 100, quote_y + 66], radius=7, fill=(148, 163, 184, 120))
    cdraw.rounded_rectangle([56, quote_y + 80, card_w - 140, quote_y + 92], radius=6, fill=(148, 163, 184, 90))

    # Bottom action buttons
    btn_y = 415
    cdraw.rounded_rectangle([36, btn_y, 220, btn_y + 44], radius=22, fill=(16, 185, 129, 230))
    cdraw.rounded_rectangle([240, btn_y, card_w - 36, btn_y + 44], radius=22, fill=(30, 41, 59, 240), outline=(255, 255, 255, 60), width=1)

    # Floating AI Sparkle Badge at Top Right
    ai_badge = Image.new("RGBA", (140, 140), (0, 0, 0, 0))
    ab_draw = ImageDraw.Draw(ai_badge)
    ab_draw.ellipse([10, 10, 130, 130], fill=(13, 22, 38, 250), outline=(6, 182, 212, 255), width=3)
    # Sparkle rays
    ab_draw.line([(70, 28), (70, 112)], fill=(6, 182, 212, 255), width=5)
    ab_draw.line([(28, 70), (112, 70)], fill=(6, 182, 212, 255), width=5)
    ab_draw.line([(42, 42), (98, 98)], fill=(16, 185, 129, 255), width=4)
    ab_draw.line([(98, 42), (42, 98)], fill=(16, 185, 129, 255), width=4)

    img.alpha_composite(card_img, (card_x, card_y))
    img.alpha_composite(ai_badge, (card_x + card_w - 80, card_y - 50))

    # Fonts for typography
    fonts_dir = "C:\\Windows\\Fonts"
    try:
        f_brand = ImageFont.truetype(os.path.join(fonts_dir, "segoeuib.ttf"), 62)
        f_tag = ImageFont.truetype(os.path.join(fonts_dir, "segoeui.ttf"), 26)
    except Exception:
        f_brand = ImageFont.load_default()
        f_tag = f_brand

    draw = ImageDraw.Draw(img)
    brand_text = "NewsStudio AI"
    draw.text((size // 2 - 215, 805), brand_text, fill=(255, 255, 255, 255), font=f_brand)
    tag_text = "Smart Channel Studio & Feed Monitor"
    draw.text((size // 2 - 225, 885), tag_text, fill=(148, 163, 184, 255), font=f_tag)

    out_path = "C:/Users/MOHSEN/Desktop/Github Projects/NewsStudio_Bot/assets/avatar.jpg"
    final = img.convert("RGB")
    final.save(out_path, quality=96)
    
    # Save to artifact directory
    final.save("C:/Users/MOHSEN/.gemini/antigravity/brain/8769436c-05d2-4609-9435-57ae129c8ad5/news_studio_avatar.jpg", quality=96)
    print("Avatar generated successfully at:", out_path)

if __name__ == "__main__":
    make_avatar()

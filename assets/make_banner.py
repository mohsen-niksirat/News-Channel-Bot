import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def make_banner():
    width = 1280
    height = 720
    
    # 1. Base Dark Canvas
    img = Image.new("RGBA", (width, height), (9, 13, 24, 255))
    draw = ImageDraw.Draw(img)

    # Gradient background
    for y in range(height):
        ratio = y / height
        r = int(7 + ratio * 8)
        g = int(12 + ratio * 14)
        b = int(24 + ratio * 30)
        draw.line([(0, y), (width, y)], fill=(r, g, b, 255))

    # 2. Glowing Orbs
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)

    # Emerald green orb (top left)
    for rad in range(340, 0, -8):
        alpha = int(30 * (1 - rad / 340))
        glow_draw.ellipse([180 - rad, 160 - rad, 180 + rad, 160 + rad], fill=(16, 185, 129, alpha))

    # Cyan orb (bottom right / behind avatar)
    for rad in range(380, 0, -8):
        alpha = int(32 * (1 - rad / 380))
        glow_draw.ellipse([980 - rad, 360 - rad, 980 + rad, 360 + rad], fill=(6, 182, 212, alpha))

    # Subtle modern grid
    for x in range(0, width, 50):
        glow_draw.line([(x, 0), (x, height)], fill=(255, 255, 255, 5))
    for y in range(0, height, 50):
        glow_draw.line([(0, y), (width, y)], fill=(255, 255, 255, 5))

    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # Fonts
    fonts_dir = "C:\\Windows\\Fonts"
    f_title = ImageFont.truetype(os.path.join(fonts_dir, "segoeuib.ttf"), 62)
    f_sub = ImageFont.truetype(os.path.join(fonts_dir, "segoeui.ttf"), 24)
    f_desc = ImageFont.truetype(os.path.join(fonts_dir, "segoeui.ttf"), 17)
    f_badge = ImageFont.truetype(os.path.join(fonts_dir, "segoeuib.ttf"), 14)
    f_feat_title = ImageFont.truetype(os.path.join(fonts_dir, "segoeuib.ttf"), 17)
    f_feat_sub = ImageFont.truetype(os.path.join(fonts_dir, "segoeui.ttf"), 15)
    f_btn = ImageFont.truetype(os.path.join(fonts_dir, "segoeuib.ttf"), 19)
    f_btn_sub = ImageFont.truetype(os.path.join(fonts_dir, "segoeui.ttf"), 15)

    # 3. Top Category Pill
    badge_x = 75
    badge_y = 65
    draw.rounded_rectangle([badge_x, badge_y, badge_x + 245, badge_y + 34], radius=17, fill=(16, 185, 129, 30), outline=(16, 185, 129, 140), width=1)
    draw.text((badge_x + 20, badge_y + 7), "TELEGRAM CHANNEL STUDIO", fill=(52, 211, 153, 255), font=f_badge)

    # 4. Main Title: "NewsStudio AI"
    title_y = badge_y + 48
    draw.text((badge_x + 3, title_y + 3), "NewsStudio AI", fill=(16, 185, 129, 70), font=f_title)
    draw.text((badge_x, title_y), "NewsStudio AI", fill=(255, 255, 255, 255), font=f_title)

    # Tagline
    tagline_y = title_y + 80
    draw.text((badge_x, tagline_y), "Autonomous Channel Manager & Newsfeed Studio", fill=(190, 225, 240, 255), font=f_sub)

    desc_y = tagline_y + 38
    draw.text((badge_x, desc_y), "Monitor Telegram channels & RSS, rewrite with AI, publish rich posts.", fill=(148, 163, 184, 255), font=f_desc)

    # 5. Features Grid (2x2 cards on left side: x: 75 to 695)
    features = [
        ("DUAL SOURCE MONITOR", "Scrape public Telegram channels\nand RSS web feeds in real-time", (16, 185, 129)),
        ("MULTI-AI ROUTER (9ROUTER)", "Gemini, Groq, DeepSeek with\nautomatic 429 failover rotation", (6, 182, 212)),
        ("RASA RICH POST ENGINE", "Expandable quotes, spoiler tags\nand instant copy-text buttons", (139, 92, 246)),
        ("CHANNEL AUTO-PILOT", "Auto-publish to your channel or\napprove via interactive review queue", (245, 158, 11)),
    ]

    cw = 300
    ch = 105
    gap_x = 16
    gap_y = 16
    start_feat_y = desc_y + 42

    for idx, (ftitle, fdesc, col) in enumerate(features):
        col_idx = idx % 2
        row_idx = idx // 2
        fx = badge_x + col_idx * (cw + gap_x)
        fy = start_feat_y + row_idx * (ch + gap_y)

        card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        cdraw = ImageDraw.Draw(card)
        cdraw.rounded_rectangle([0, 0, cw, ch], radius=14, fill=(18, 25, 42, 220), outline=col + (90,), width=1)
        
        # Left colored accent bar
        cdraw.rounded_rectangle([0, 0, 4, ch], radius=2, fill=col + (230,))
        
        # Small colored pill / circle
        cdraw.ellipse([16, 17, 24, 25], fill=col + (255,))
        cdraw.text((32, 12), ftitle, fill=(240, 245, 255, 255), font=f_feat_title)
        cdraw.multiline_text((16, 44), fdesc, fill=(148, 163, 184, 255), font=f_feat_sub, spacing=4)
        
        img.alpha_composite(card, (fx, fy))

    # 6. Bottom Action Bar
    btn_y = start_feat_y + 2 * (ch + gap_y) + 16
    draw.rounded_rectangle([badge_x, btn_y, badge_x + 280, btn_y + 44], radius=22, fill=(16, 185, 129, 220), outline=(52, 211, 153, 240), width=1)
    draw.text((badge_x + 26, btn_y + 10), "Channel Manager Bot", fill=(255, 255, 255, 255), font=f_btn)
    
    # Official Channel
    draw.text((badge_x + 305, btn_y + 12), "Channel: @MyLeitner   •   Serverless Edge Engine", fill=(148, 163, 184, 240), font=f_btn_sub)

    # 7. Right Side: 3D Glass Mockup of Avatar Image
    avatar_path = "C:/Users/MOHSEN/Desktop/Github Projects/NewsStudio_Bot/assets/avatar.jpg"
    if os.path.exists(avatar_path):
        av_img = Image.open(avatar_path).convert("RGBA")
        av_size = 460
        av_img = av_img.resize((av_size, av_size), Image.Resampling.LANCZOS)

        # Rounded mask for avatar
        mask = Image.new("L", (av_size, av_size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, av_size, av_size], radius=44, fill=255)

        # Avatar container with glow & border
        av_x = 735
        av_y = 130

        # Glowing frame under avatar
        glow_box = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glow_box)
        for g_rad in range(35, 0, -3):
            g_alpha = int(36 * (1 - g_rad / 35))
            gdraw.rounded_rectangle([av_x - g_rad, av_y - g_rad, av_x + av_size + g_rad, av_y + av_size + g_rad], radius=44 + g_rad, outline=(16, 185, 129, g_alpha), width=2)
        img = Image.alpha_composite(img, glow_box)

        # Paste avatar with mask
        img.paste(av_img, (av_x, av_y), mask)

        # Crisp glassmorphic border on top of avatar
        top_draw = ImageDraw.Draw(img)
        top_draw.rounded_rectangle([av_x, av_y, av_x + av_size, av_y + av_size], radius=44, outline=(16, 185, 129, 180), width=2)

        # Small floating tag over avatar bottom
        tag_w = 260
        tag_h = 42
        tag_x = av_x + (av_size - tag_w) // 2
        tag_y = av_y + av_size - 22
        top_draw.rounded_rectangle([tag_x, tag_y, tag_x + tag_w, tag_y + tag_h], radius=21, fill=(11, 16, 28, 245), outline=(16, 185, 129, 160), width=1)
        top_draw.text((tag_x + 24, tag_y + 11), "EDITORIAL NEWS STUDIO", fill=(52, 211, 153, 255), font=f_badge)

    # Save final RGB
    final = img.convert("RGB")
    final.save("C:/Users/MOHSEN/Desktop/Github Projects/NewsStudio_Bot/assets/banner.jpg", quality=96)
    final.save("C:/Users/MOHSEN/.gemini/antigravity/brain/8769436c-05d2-4609-9435-57ae129c8ad5/news_studio_banner.jpg", quality=96)
    print("NewsStudio Banner created successfully!")

if __name__ == "__main__":
    make_banner()

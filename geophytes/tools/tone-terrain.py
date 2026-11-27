"""צובע את מפת Terrain Light החיוורת למפה "מצוירת" ברורה: יבשה בגווני קרם-חום עם הצללה חזקה, מים בכחול. מריצים אחרי build-map-tiles.py."""
import glob, os
import numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DARK = np.array([138, 128, 100], np.float32)
LIGHT = np.array([247, 243, 230], np.float32)
WATER = np.array([160, 196, 222], np.float32)
for f in glob.glob(os.path.join(ROOT, 'map', 'ter*.jpg')):
    a = np.asarray(Image.open(f).convert('RGB'), np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    water = (b - r > 14) & (b > 150)
    lum = (r * .3 + g * .59 + b * .11)
    t = np.clip((lum - 205) / 50, 0, 1) ** 1.6  # הדגשת הצללים
    land = DARK + (LIGHT - DARK) * t[..., None]
    # מעט ירוק באזורי צמחייה (הגוון הירקרק של המקור)
    green = np.clip((g - r - 2) / 14, 0, 1)[..., None]
    land = land * (1 - .28 * green) + np.array([150, 176, 120], np.float32) * (.28 * green)
    out = np.where(water[..., None], WATER + (lum[..., None] - 165) * .3, land)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(f, 'JPEG', quality=84, optimize=True, progressive=True)
print('toned')

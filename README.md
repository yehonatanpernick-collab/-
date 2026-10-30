# מנתח רילסים

דף אינטרנט פשוט: מדביקים קישור לריל מאינסטגרם, והאפליקציה מורידה את האודיו, מתמללת אותו (Whisper של OpenAI) ומחזירה תקציר, נקודות מרכזיות ומה כדאי להבין מהסרטון בעברית (Claude).

## הרצה מקומית

דרישות: Python 3.10+.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # ב-Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # ואז מלאו את המפתחות
uvicorn app:app --reload
```

פתחו בדפדפן: http://127.0.0.1:8000

## מבנה

- `index.html` - הממשק (RTL, עברית).
- `backend/app.py` - שרת FastAPI: `POST /api/analyze` מקבל `{"url": "..."}` ומחזיר `transcript`, `summary`, `keyPoints`, `takeaways`.
- `backend/.env.example` - המפתחות הנדרשים.

## הערות

- ההורדה נעשית עם `yt-dlp`, ועובדת בעיקר על רילסים ציבוריים. ריל פרטי או חסימה מצד אינסטגרם יחזירו הודעת שגיאה.
- Whisper מקבל עד 25MB, ולכן רילסים רגילים עוברים בלי בעיה.
- כל ניתוח עולה כסף קטן (תמלול + קריאה למודל). המודל של התקציר ניתן לשינוי דרך `ANTHROPIC_MODEL`.
- אין כרגע הגבלת קצב או אימות משתמשים. לפני פרסום לציבור כדאי להוסיף את שניהם.

import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from anthropic import Anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from openai import OpenAI
from pydantic import BaseModel

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-5-5")
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # Whisper API upload limit

ALLOWED_HOSTS = {"instagram.com", "www.instagram.com"}
REEL_PATH = re.compile(r"^/(reel|reels|tv)/[\w-]+/?$")

SYSTEM_PROMPT = """את/ה עוזר/ת שמנתח/ת תמלולים של רילסים מאינסטגרם.
קבל/י תמלול ו/או תיאור של סרטון והחזר/י JSON בלבד, במבנה הבא:
{"summary": "תקציר של 3-5 משפטים", "keyPoints": ["נקודה מרכזית", "..."], "takeaways": ["מה כדאי להבין או לקחת מהסרטון", "..."]}
כתוב/י הכול בעברית. אם התמלול בשפה אחרת, תרגם/י את התוצאה לעברית.
אם אין דיבור בסרטון, כתוב/י זאת בשדה summary ובנה/י את השאר על בסיס הטקסט הקיים.
אל תוסיף/י טקסט מחוץ ל-JSON."""

app = FastAPI(title="Reels Analyzer")
openai_client = OpenAI()
anthropic_client = Anthropic()


class AnalyzeRequest(BaseModel):
    url: str


def validate_reel_url(raw: str) -> str:
    url = raw.strip()
    parsed = urlparse(url)
    if (
        parsed.scheme not in ("http", "https")
        or parsed.hostname not in ALLOWED_HOSTS
        or not REEL_PATH.match(parsed.path)
    ):
        raise HTTPException(
            400,
            "הקישור חייב להיות קישור לריל באינסטגרם, למשל https://www.instagram.com/reel/XXXX/",
        )
    return url


def download_audio(url: str, workdir: str) -> Path:
    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(Path(workdir) / "reel.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "max_filesize": MAX_AUDIO_BYTES,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(
            422,
            "לא הצלחתי להוריד את הסרטון. ייתכן שהוא פרטי, או שאינסטגרם חסמה את הבקשה.",
        ) from e

    files = list(Path(workdir).glob("reel.*"))
    if not files:
        raise HTTPException(422, "ההורדה הסתיימה בלי קובץ. נסה/י קישור אחר.")
    if files[0].stat().st_size > MAX_AUDIO_BYTES:
        raise HTTPException(413, "הקובץ גדול מדי לתמלול.")
    return files[0]


def transcribe(path: Path) -> str:
    with path.open("rb") as f:
        result = openai_client.audio.transcriptions.create(model="whisper-1", file=f)
    return result.text.strip()


def summarize(transcript: str) -> dict:
    message = anthropic_client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f'תמלול:\n"""\n{transcript}\n"""'}],
    )
    text = "".join(block.text for block in message.content if block.type == "text").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(502, "קיבלתי תשובה לא תקינה מהמודל. נסה/י שוב.") from e

    return {
        "summary": str(data.get("summary", "")),
        "keyPoints": [str(x) for x in data.get("keyPoints", [])],
        "takeaways": [str(x) for x in data.get("takeaways", [])],
    }


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    url = validate_reel_url(req.url)
    with tempfile.TemporaryDirectory() as workdir:
        audio = download_audio(url, workdir)
        transcript = transcribe(audio)

    if not transcript:
        analysis = {
            "summary": "לא זוהה דיבור בסרטון.",
            "keyPoints": [],
            "takeaways": [],
        }
    else:
        analysis = summarize(transcript)

    return {"transcript": transcript, **analysis}


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")

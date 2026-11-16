# עֵדֶן — Eden Archipelago

עולם תלת־ממד קולנועי של ארכיפלג טרופי (three.js, WebGL).

הפעלה: מגישים את התיקייה בשרת מקומי (`python3 -m http.server` בתוך `paradise3d/`) ופותחים `index.html`.
הדפדפן צריך גישה ל־cdn.jsdelivr.net (three.js 0.169.0) ולגופני Google.

- **נוצר בקוד:** איים (heightfield + רעש), אוקיינוס בשיידר משלו (גלים, לגונות טורקיז לפי עומק, קצף חוף ושונית, קאוסטיקה), שמיים פיזיקליים, דקלים, ג׳ונגל, סלעים, מזח ו־12 בקתות על המים, קטמרנים, עננים, פוסט־פרוסס (bloom, flare אנמורפי, דירוג צבע, וינייטה, גרעין).
- **מודלים חינמיים (assets/):** Flamingo, Parrot, Stork — מדוגמאות three.js (mirada.com עבור ro.me); `waternormals.jpg`, `hardwood2_diffuse.jpg` — מדוגמאות three.js.

פרמטרים לבדיקה: `?shot=0..6&p=0.5` לשוט מסוים, `&sun=-4..60` לגובה השמש, `&still=1` לפריים בודד.

// Curated places to explore. Coordinates are approximate (good for flying the
// map there, NOT for navigation). ele = summit height in metres, peaks only.
// cat: peak | volcano | canyon | park | water | desert | israel
window.TREK_PLACES = [
  // Himalaya & Asia
  { he: 'אוורסט', en: 'Mount Everest', lat: 27.9881, lon: 86.9250, ele: 8849, cat: 'peak', country: 'נפאל/סין', note: 'הפסגה הגבוהה בעולם. טרק בסיס המחנה (EBC) נמשך כ-12 ימים.' },
  { he: 'K2', en: 'K2', lat: 35.8825, lon: 76.5133, ele: 8611, cat: 'peak', country: 'פקיסטן', note: 'הפסגה השנייה בגובהה ואחת הקשות לטיפוס. טרק קונקורדיה בקרקורום.' },
  { he: 'אנאפורנה I', en: 'Annapurna I', lat: 28.5961, lon: 83.8203, ele: 8091, cat: 'peak', country: 'נפאל', note: 'סובב אנאפורנה ומחנה הבסיס (ABC) הם מהטרקים הפופולריים בעולם.' },
  { he: 'מחנה בסיס אנאפורנה', en: 'Annapurna Base Camp', lat: 28.5302, lon: 83.8780, cat: 'park', country: 'נפאל', note: 'אמפיתאטרון של פסגות בגובה 4,130 מ׳.' },
  { he: 'הר קאילש', en: 'Mount Kailash', lat: 31.0670, lon: 81.3119, ele: 6638, cat: 'peak', country: 'טיבט', note: 'הר קדוש; מקיפים אותו בקורה של כ-52 ק״מ.' },
  { he: 'הר פוג׳י', en: 'Mount Fuji', lat: 35.3606, lon: 138.7274, ele: 3776, cat: 'volcano', country: 'יפן', note: 'עונת הטיפוס הרשמית: יולי–ספטמבר.' },
  { he: 'קינבאלו', en: 'Mount Kinabalu', lat: 6.0753, lon: 116.5582, ele: 4095, cat: 'peak', country: 'מלזיה', note: 'טיפוס של יומיים עם לינה בבקתה.' },
  { he: 'רינג׳אני', en: 'Mount Rinjani', lat: -8.4115, lon: 116.4570, ele: 3726, cat: 'volcano', country: 'אינדונזיה', note: 'הר געש עם אגם מכתש טורקיז.' },
  { he: 'ברומו', en: 'Mount Bromo', lat: -7.9425, lon: 112.9530, ele: 2329, cat: 'volcano', country: 'אינדונזיה', note: 'זריחה מעל ים חול געשי.' },
  { he: 'ז׳אנגג׳יאג׳יה', en: 'Zhangjiajie', lat: 29.3150, lon: 110.4344, cat: 'park', country: 'סין', note: 'עמודי אבן חול שמתנשאים מעל יער.' },
  { he: 'אררט', en: 'Mount Ararat', lat: 39.7019, lon: 44.2983, ele: 5137, cat: 'volcano', country: 'טורקיה', note: 'הר געש רדום מושלג.' },
  { he: 'קפדוקיה', en: 'Cappadocia', lat: 38.6431, lon: 34.8289, cat: 'desert', country: 'טורקיה', note: 'ארובות פיות ועמקים לטיולי יום.' },

  // Europe
  { he: 'מון בלאן', en: 'Mont Blanc', lat: 45.8326, lon: 6.8652, ele: 4806, cat: 'peak', country: 'צרפת/איטליה', note: 'סובב מון בלאן (TMB): כ-170 ק״מ ב-10–11 ימים.' },
  { he: 'מטרהורן', en: 'Matterhorn', lat: 45.9763, lon: 7.6586, ele: 4478, cat: 'peak', country: 'שווייץ/איטליה', note: 'פירמידת סלע מעל צרמט.' },
  { he: 'אייגר', en: 'Eiger', lat: 46.5776, lon: 8.0053, ele: 3967, cat: 'peak', country: 'שווייץ', note: 'הקיר הצפוני המפורסם. שבילים מעל גרינדלוולד.' },
  { he: 'טרה צ׳ימה', en: 'Tre Cime di Lavaredo', lat: 46.6186, lon: 12.3027, ele: 2999, cat: 'peak', country: 'איטליה', note: 'סמל הדולומיטים. מסלול מעגלי של כ-10 ק״מ.' },
  { he: 'טריגלב', en: 'Triglav', lat: 46.3783, lon: 13.8364, ele: 2864, cat: 'peak', country: 'סלובניה', note: 'הפסגה הגבוהה בסלובניה.' },
  { he: 'אולימפוס', en: 'Mount Olympus', lat: 40.0859, lon: 22.3583, ele: 2918, cat: 'peak', country: 'יוון', note: 'ביתם של האלים. טיפוס של יומיים מליטוכורו.' },
  { he: 'אטנה', en: 'Mount Etna', lat: 37.7510, lon: 14.9934, ele: 3357, cat: 'volcano', country: 'איטליה', note: 'הר הגעש הפעיל הגבוה באירופה. בדקו מצב התפרצות לפני יציאה.' },
  { he: 'אלברוס', en: 'Mount Elbrus', lat: 43.3499, lon: 42.4453, ele: 5642, cat: 'peak', country: 'רוסיה', note: 'הפסגה הגבוהה באירופה.' },
  { he: 'טרולטונגה', en: 'Trolltunga', lat: 60.1242, lon: 6.7400, cat: 'park', country: 'נורווגיה', note: 'לשון סלע מעל אגם. כ-27 ק״מ הלוך-חזור.' },
  { he: 'פרייקסטולן', en: 'Preikestolen', lat: 58.9864, lon: 6.1904, cat: 'park', country: 'נורווגיה', note: 'צוק 604 מ׳ מעל הפיורד.' },
  { he: 'ריינברינגן, לופוטן', en: 'Reinebringen', lat: 67.9327, lon: 13.0620, ele: 448, cat: 'peak', country: 'נורווגיה', note: 'מדרגות שרפא לתצפית על כפר הדייגים ריינה.' },
  { he: 'לנדמנלאוגר', en: 'Landmannalaugar', lat: 63.9910, lon: -19.0605, cat: 'park', country: 'איסלנד', note: 'הרי ריוליט צבעוניים; תחילת טרק לאוגווגור.' },
  { he: 'בן נוויס', en: 'Ben Nevis', lat: 56.7969, lon: -5.0036, ele: 1345, cat: 'peak', country: 'סקוטלנד', note: 'הפסגה הגבוהה בבריטניה.' },
  { he: 'האולד מן אוף סטור', en: 'Old Man of Storr', lat: 57.5070, lon: -6.1830, cat: 'park', country: 'סקוטלנד', note: 'עמוד סלע באי סקאי.' },
  { he: 'פליטביצה', en: 'Plitvice Lakes', lat: 44.8654, lon: 15.5820, cat: 'water', country: 'קרואטיה', note: '16 אגמים מדורגים ומפלים.' },

  // Africa & Middle East
  { he: 'קילימנג׳רו', en: 'Kilimanjaro', lat: -3.0674, lon: 37.3556, ele: 5895, cat: 'volcano', country: 'טנזניה', note: 'הפסגה הגבוהה באפריקה. 6–8 ימים, תלוי במסלול.' },
  { he: 'הר קניה', en: 'Mount Kenya', lat: -0.1521, lon: 37.3084, ele: 5199, cat: 'peak', country: 'קניה', note: 'פוינט לנאנה (4,985 מ׳) נגישה לטרקיסטים.' },
  { he: 'רוונזורי', en: 'Rwenzori (Margherita)', lat: 0.3858, lon: 29.8719, ele: 5109, cat: 'peak', country: 'אוגנדה', note: '"הרי הירח": קרחונים על קו המשווה.' },
  { he: 'טובקל', en: 'Toubkal', lat: 31.0597, lon: -7.9150, ele: 4167, cat: 'peak', country: 'מרוקו', note: 'הפסגה הגבוהה בצפון אפריקה; יומיים מאימליל.' },
  { he: 'הר השולחן', en: 'Table Mountain', lat: -33.9628, lon: 18.4098, ele: 1085, cat: 'peak', country: 'דרום אפריקה', note: 'מעל קייפטאון. מסלול פלאטקליפ.' },
  { he: 'מפלי ויקטוריה', en: 'Victoria Falls', lat: -17.9243, lon: 25.8572, cat: 'water', country: 'זמביה/זימבבואה', note: 'אחד המפלים הגדולים בעולם.' },
  { he: 'ואדי רם', en: 'Wadi Rum', lat: 29.5762, lon: 35.4196, cat: 'desert', country: 'ירדן', note: 'מדבר אבן חול אדום. מתאים לטרק ג׳יפים ורגל.' },
  { he: 'הר סיני (ג׳בל מוסא)', en: 'Mount Sinai', lat: 28.5394, lon: 33.9750, ele: 2285, cat: 'peak', country: 'מצרים', note: 'טיפוס לילי לזריחה מעל מנזר סנטה קתרינה.' },

  // Israel
  { he: 'הר מירון', en: 'Mount Meron', lat: 33.0012, lon: 35.4108, ele: 1204, cat: 'israel', country: 'ישראל', note: 'שביל הפסגה המעגלי בשמורת הר מירון.' },
  { he: 'הר ארבל', en: 'Mount Arbel', lat: 32.8231, lon: 35.4983, ele: 181, cat: 'israel', country: 'ישראל', note: 'מצוק מעל הכנרת; שביל ישראל עובר כאן.' },
  { he: 'עין גדי', en: 'Ein Gedi', lat: 31.4613, lon: 35.3897, cat: 'israel', country: 'ישראל', note: 'נחל דוד ונחל ערוגות. הגיעו מוקדם בקיץ.' },
  { he: 'מצדה', en: 'Masada', lat: 31.3156, lon: 35.3536, cat: 'israel', country: 'ישראל', note: 'שביל הנחש לזריחה מעל ים המלח.' },
  { he: 'מכתש רמון', en: 'Makhtesh Ramon', lat: 30.6100, lon: 34.8000, cat: 'israel', country: 'ישראל', note: 'המכתש הגדול בעולם; מצפה רמון על שפתו.' },

  // Americas
  { he: 'אקונקגואה', en: 'Aconcagua', lat: -32.6532, lon: -70.0109, ele: 6961, cat: 'peak', country: 'ארגנטינה', note: 'הפסגה הגבוהה מחוץ לאסיה.' },
  { he: 'פיץ רוי', en: 'Fitz Roy', lat: -49.2714, lon: -73.0431, ele: 3405, cat: 'peak', country: 'ארגנטינה', note: 'מאל צ׳לטן ללגונה דה לוס טרס: כ-20 ק״מ הלוך-חזור.' },
  { he: 'טורס דל פיינה', en: 'Torres del Paine', lat: -50.9420, lon: -72.9900, cat: 'park', country: 'צ׳ילה', note: 'טרק W (4–5 ימים) או O (8–10 ימים).' },
  { he: 'מאצ׳ו פיצ׳ו', en: 'Machu Picchu', lat: -13.1631, lon: -72.5450, cat: 'park', country: 'פרו', note: 'סוף שביל האינקה. נדרש היתר מראש.' },
  { he: 'הואסקרן', en: 'Huascarán', lat: -9.1220, lon: -77.6044, ele: 6768, cat: 'peak', country: 'פרו', note: 'הפסגה הגבוהה בפרו; קורדיירה בלנקה וטרק סנטה קרוז.' },
  { he: 'קוטופקסי', en: 'Cotopaxi', lat: -0.6838, lon: -78.4378, ele: 5897, cat: 'volcano', country: 'אקוודור', note: 'אחד מהרי הגעש הפעילים הגבוהים בעולם.' },
  { he: 'צ׳ימבורסו', en: 'Chimborazo', lat: -1.4692, lon: -78.8175, ele: 6263, cat: 'volcano', country: 'אקוודור', note: 'הנקודה הרחוקה ביותר ממרכז כדור הארץ.' },
  { he: 'מפלי איגואסו', en: 'Iguazu Falls', lat: -25.6953, lon: -54.4367, cat: 'water', country: 'ארגנטינה/ברזיל', note: 'כ-275 מפלים לאורך 2.7 ק״מ.' },
  { he: 'מפל אנחל', en: 'Angel Falls', lat: 5.9675, lon: -62.5356, cat: 'water', country: 'ונצואלה', note: 'המפל הגבוה בעולם (979 מ׳).' },
  { he: 'פיקו דה אוריסבה', en: 'Pico de Orizaba', lat: 19.0305, lon: -97.2698, ele: 5636, cat: 'volcano', country: 'מקסיקו', note: 'הפסגה הגבוהה במקסיקו.' },
  { he: 'דנאלי', en: 'Denali', lat: 63.0692, lon: -151.0070, ele: 6190, cat: 'peak', country: 'ארה״ב (אלסקה)', note: 'הפסגה הגבוהה בצפון אמריקה.' },
  { he: 'הר ריינייר', en: 'Mount Rainier', lat: 46.8523, lon: -121.7603, ele: 4392, cat: 'volcano', country: 'ארה״ב', note: 'שביל וונדרלנד סביב ההר: כ-150 ק״מ.' },
  { he: 'הר וויטני', en: 'Mount Whitney', lat: 36.5785, lon: -118.2923, ele: 4421, cat: 'peak', country: 'ארה״ב', note: 'הפסגה הגבוהה ב-48 המדינות; נדרש היתר.' },
  { he: 'האף דום, יוסמיטי', en: 'Half Dome', lat: 37.7459, lon: -119.5332, ele: 2694, cat: 'peak', country: 'ארה״ב', note: 'הכבלים בסוף המסלול; נדרש היתר.' },
  { he: 'הגרנד קניון', en: 'Grand Canyon', lat: 36.0619, lon: -112.1077, cat: 'canyon', country: 'ארה״ב', note: 'ירידה לנהר בקיץ מסוכנת: חום קיצוני.' },
  { he: 'אנג׳לס לנדינג, זאיון', en: 'Angels Landing', lat: 37.2692, lon: -112.9469, cat: 'canyon', country: 'ארה״ב', note: 'רכס צר עם שרשראות; נדרש היתר.' },
  { he: 'קילאואה', en: 'Kīlauea', lat: 19.4069, lon: -155.2834, cat: 'volcano', country: 'ארה״ב (הוואי)', note: 'מהרי הגעש הפעילים בעולם.' },
  { he: 'לייק לואיז, באנף', en: 'Lake Louise', lat: 51.4254, lon: -116.1773, cat: 'water', country: 'קנדה', note: 'אגם טורקיז ושביל לבית התה של אגם אגנס.' },

  // Oceania & Antarctica
  { he: 'אאורקי / הר קוק', en: 'Aoraki / Mount Cook', lat: -43.5950, lon: 170.1418, ele: 3724, cat: 'peak', country: 'ניו זילנד', note: 'מסלול עמק הוקר: כ-10 ק״מ הלוך-חזור, קל.' },
  { he: 'מעבר טונגרירו', en: 'Tongariro Alpine Crossing', lat: -39.1386, lon: 175.6633, cat: 'volcano', country: 'ניו זילנד', note: 'מעבר של 19.4 ק״מ בין מכתשים ואגמי אמרלד.' },
  { he: 'פונצ׳אק ג׳איה', en: 'Puncak Jaya', lat: -4.0833, lon: 137.1833, ele: 4884, cat: 'peak', country: 'אינדונזיה', note: 'הפסגה הגבוהה באוקיאניה.' },
  { he: 'הר וינסון', en: 'Mount Vinson', lat: -78.5254, lon: -85.6171, ele: 4892, cat: 'peak', country: 'אנטארקטיקה', note: 'הפסגה הגבוהה באנטארקטיקה.' },
];

window.TREK_CATS = {
  all: { he: 'הכל', icon: '🌍' },
  peak: { he: 'פסגות', icon: '🏔️' },
  volcano: { he: 'הרי געש', icon: '🌋' },
  canyon: { he: 'קניונים', icon: '🏜️' },
  park: { he: 'נופים ושמורות', icon: '🌲' },
  water: { he: 'מפלים ואגמים', icon: '💧' },
  desert: { he: 'מדבר', icon: '🐪' },
  israel: { he: 'ישראל', icon: '🇮🇱' },
};

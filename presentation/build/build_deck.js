// Builds the Colorado Wilderness Expedition deck.
// Facts are tagged on each slide: [מאומת] = checked against a source,
// [טווח] = sources disagree, the range is shown, [לאימות] = not checked yet.
const pptxgen = require("pptxgenjs");
const path = require("path");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "מסע טבע בקולורדו – Colorado Wilderness Expedition";
pres.theme = { headFontFace: "Cambria", bodyFontFace: "Calibri" };

const C = {
  dark: "1B2E26",
  forest: "2F5D46",
  moss: "8DB06B",
  lake: "2C7A9B",
  granite: "6E757C",
  snow: "F5F7F4",
  rock: "B5651D",
  ink: "1E2421",
  muted: "5A625E",
  card: "EEF2EE",
  white: "FFFFFF",
};

const FONT_H = "Cambria";
const FONT_B = "Calibri";

// ---------- helpers ----------
function bgSlide(color) {
  const s = pres.addSlide();
  s.background = { color };
  return s;
}

function title(s, text, color = C.ink) {
  s.addText(text, {
    x: 0.5, y: 0.3, w: 9, h: 0.8,
    fontFace: FONT_H, fontSize: 32, bold: true, color,
    align: "right", rtlMode: true, margin: 0, isTextBox: true, valign: "middle",
  });
}

function foot(s, text, color = C.muted) {
  s.addText(text, {
    x: 0.5, y: 5.12, w: 9, h: 0.32,
    fontFace: FONT_B, fontSize: 10, color, align: "right",
    rtlMode: true, margin: 0, isTextBox: true, valign: "bottom",
  });
}

function photo(s, x, y, w, h, label, dark = false) {
  s.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: dark ? "2A3F36" : "DDE3DD" },
    line: { color: dark ? "6E8A7C" : "8A958E", width: 1, dashType: "dash" },
  });
  s.addText(label, {
    x: x + 0.12, y: y + 0.12, w: w - 0.24, h: h - 0.24,
    fontFace: FONT_B, fontSize: 11, italic: true,
    color: dark ? "C9D6CE" : C.muted,
    align: "center", valign: "middle", rtlMode: true, margin: 0, isTextBox: true,
  });
}

function bullets(s, items, opts = {}) {
  const runs = items.map((t, i) => ({
    text: t,
    options: { bullet: { indent: 14 }, breakLine: i < items.length - 1 },
  }));
  s.addText(runs, {
    x: 0.5, y: 1.3, w: 9, h: 3.7,
    fontFace: FONT_B, fontSize: 15, color: C.ink,
    align: "right", rtlMode: true, valign: "top",
    paraSpaceAfter: 6, margin: 0, isTextBox: true,
    ...opts,
  });
}

function card(s, x, y, w, h, head, body, opts = {}) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: opts.fill || C.card },
    line: { color: opts.fill || C.card, width: 0.5 },
  });
  s.addText(head, {
    x: x + 0.18, y: y + 0.14, w: w - 0.36, h: 0.42,
    fontFace: FONT_H, fontSize: opts.headSize || 16, bold: true,
    color: opts.headColor || C.forest, align: "right", rtlMode: true,
    margin: 0, isTextBox: true, valign: "middle",
  });
  s.addText(body, {
    x: x + 0.18, y: y + 0.6, w: w - 0.36, h: h - 0.72,
    fontFace: FONT_B, fontSize: opts.bodySize || 12.5, color: opts.bodyColor || C.ink,
    align: "right", rtlMode: true, valign: "top", margin: 0, isTextBox: true,
  });
}

function stat(s, x, y, w, h, big, label, color = C.forest) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: C.card }, line: { color: C.card, width: 0.5 },
  });
  s.addText(big, {
    x: x + 0.15, y: y + 0.2, w: w - 0.3, h: h * 0.5,
    fontFace: FONT_H, fontSize: 34, bold: true, color,
    align: "center", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText(label, {
    x: x + 0.15, y: y + h * 0.62, w: w - 0.3, h: h * 0.32,
    fontFace: FONT_B, fontSize: 12, color: C.muted,
    align: "center", valign: "top", rtlMode: true, margin: 0, isTextBox: true,
  });
}

function table(s, header, rows, opts = {}) {
  const hdr = header.map((t) => ({
    text: t,
    options: { bold: true, color: C.white, fill: { color: C.forest }, align: "right", valign: "middle", rtlMode: true },
  }));
  const body = rows.map((r, ri) =>
    r.map((t) => ({
      text: t,
      options: { color: C.ink, fill: { color: ri % 2 ? C.white : C.card }, align: "right", valign: "middle", rtlMode: true },
    }))
  );
  s.addTable([hdr, ...body], {
    x: opts.x ?? 0.5, y: opts.y ?? 1.3, w: opts.w ?? 9, colW: opts.colW,
    fontFace: FONT_B, fontSize: opts.fontSize ?? 12,
    border: { type: "solid", color: "D5DCD6", pt: 0.75 },
    margin: 0.05, rowH: opts.rowH,
  });
}

function line(s, x1, y1, x2, y2, color, dash = false) {
  s.addShape(pres.shapes.LINE, {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    flipV: (x2 - x1) * (y2 - y1) < 0,
    line: { color, width: 2, dashType: dash ? "dash" : "solid" },
  });
}

function dot(s, x, y, color, r = 0.09) {
  s.addShape(pres.shapes.OVAL, { x: x - r, y: y - r, w: 2 * r, h: 2 * r, fill: { color }, line: { color: C.white, width: 1 } });
}

// Schematic map of Colorado (not to scale). lon/lat -> inches on a fixed frame.
const MAP = { x0: 0.6, y0: 1.35, w: 5.2, h: 3.5, lonW: -109.05, lonE: -102.04, latN: 41.0, latS: 37.0 };
function P(lon, lat) {
  return {
    x: MAP.x0 + ((lon - MAP.lonW) / (MAP.lonE - MAP.lonW)) * MAP.w,
    y: MAP.y0 + ((MAP.latN - lat) / (MAP.latN - MAP.latS)) * MAP.h,
  };
}

function drawMap(s, showRoute = false) {
  s.addShape(pres.shapes.RECTANGLE, {
    x: MAP.x0, y: MAP.y0, w: MAP.w, h: MAP.h,
    fill: { color: "E6ECE4" }, line: { color: "8A958E", width: 1 },
  });
  s.addText("קולורדו (מתאר סכמטי)", {
    x: MAP.x0 + 0.1, y: MAP.y0 + MAP.h - 0.35, w: 2.4, h: 0.28,
    fontFace: FONT_B, fontSize: 10, italic: true, color: C.muted, margin: 0, isTextBox: true, rtlMode: true, align: "left",
  });
  const cs = P(-104.82, 38.83);
  const sj = P(-107.67, 37.95); // cluster: Ouray / Silverton / Telluride
  const rm = P(-105.6, 40.33);  // RMNP (Bear Lake / Estes side)
  if (showRoute) {
    line(s, cs.x, cs.y, sj.x, sj.y, C.granite, true);
    line(s, sj.x, sj.y, rm.x, rm.y, C.granite, true);
  }
  dot(s, cs.x, cs.y, C.rock);
  dot(s, sj.x, sj.y, C.lake, 0.11);
  dot(s, rm.x, rm.y, C.forest);
  s.addText("Colorado Springs", { x: cs.x + 0.12, y: cs.y - 0.14, w: 1.6, h: 0.28, fontFace: FONT_B, fontSize: 11, bold: true, color: C.ink, margin: 0, isTextBox: true });
  s.addText("Ouray · Silverton · Telluride", { x: sj.x - 0.2, y: sj.y + 0.1, w: 2.3, h: 0.28, fontFace: FONT_B, fontSize: 11, bold: true, color: C.ink, margin: 0, isTextBox: true });
  s.addText("Rocky Mountain NP", { x: rm.x - 1.55, y: rm.y - 0.14, w: 1.4, h: 0.28, fontFace: FONT_B, fontSize: 11, bold: true, color: C.ink, align: "right", margin: 0, isTextBox: true });
  return { cs, sj, rm };
}

function regionKey(s, x, y) {
  const items = [
    [C.rock, "Colorado Springs", "4 ימים"],
    [C.lake, "San Juan Mountains", "5 ימים"],
    [C.forest, "Rocky Mountain NP", "5–6 ימים"],
  ];
  items.forEach(([c, name, days], i) => {
    dot(s, x + 0.12, y + i * 0.6 + 0.15, c, 0.1);
    s.addText([
      { text: name, options: { bold: true, fontSize: 14, breakLine: true } },
      { text: days, options: { fontSize: 12, color: C.muted } },
    ], { x: x + 0.35, y: y + i * 0.6, w: 2.4, h: 0.55, fontFace: FONT_B, color: C.ink, align: "right", rtlMode: true, margin: 0, isTextBox: true, valign: "top" });
  });
}

function sectionSlide(num, name, sub) {
  const s = bgSlide(C.dark);
  s.addText(num, { x: 0.5, y: 1.2, w: 9, h: 1.3, fontFace: FONT_H, fontSize: 80, bold: true, color: C.moss, align: "right", margin: 0, isTextBox: true });
  s.addText(name, { x: 0.5, y: 2.6, w: 9, h: 0.9, fontFace: FONT_H, fontSize: 40, bold: true, color: C.white, align: "right", rtlMode: true, margin: 0, isTextBox: true });
  s.addText(sub, { x: 0.5, y: 3.6, w: 9, h: 0.6, fontFace: FONT_B, fontSize: 18, color: "C9D6CE", align: "right", rtlMode: true, margin: 0, isTextBox: true });
  return s;
}

// ---------- 1. Title ----------
{
  const s = bgSlide(C.dark);
  photo(s, 5.6, 0, 4.4, 5.625, "[תמונה לשילוב: רכס הרי הרוקי בשעת בוקר, צילום נוף רחב של אגם או פסגה מושלגת – צילום אמיתי של האזור, לא תמונת AI]", true);
  s.addText("מסע טבע בקולורדו", { x: 0.5, y: 1.5, w: 4.9, h: 1.1, fontFace: FONT_H, fontSize: 38, bold: true, color: C.white, align: "right", rtlMode: true, margin: 0, isTextBox: true });
  s.addText("Colorado Wilderness Expedition", { x: 0.5, y: 2.6, w: 4.9, h: 0.5, fontFace: FONT_H, fontSize: 18, italic: true, color: C.moss, align: "right", margin: 0, isTextBox: true });
  s.addText("מדריך טבע, גאוגרפיה ותכנון לשלושה אזורים:\nColorado Springs · San Juan Mountains · Rocky Mountain National Park", { x: 0.5, y: 3.3, w: 4.9, h: 0.9, fontFace: FONT_B, fontSize: 14, color: "C9D6CE", align: "right", rtlMode: true, margin: 0, isTextBox: true });
  s.addText("אוגוסט · 14–18 ימים כולל מעברים", { x: 0.5, y: 4.6, w: 4.9, h: 0.4, fontFace: FONT_B, fontSize: 13, bold: true, color: C.white, align: "right", rtlMode: true, margin: 0, isTextBox: true });
}

// ---------- 2. How to read ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "איך לקרוא את המצגת");
  card(s, 0.5, 1.3, 2.85, 2.2, "[מאומת]", "הנתון נבדק מול מקור רשמי או מקור שטח מוכר: NPS, USDA Forest Service, Colorado Parks and Wildlife ואתרי רשויות.", { headColor: C.forest });
  card(s, 3.575, 1.3, 2.85, 2.2, "[טווח]", "מקורות שונים נותנים ערכים שונים (למשל מרחק או הפרש גובה). המצגת מציגה את הטווח ואינה בוחרת ערך אחד.", { headColor: C.lake });
  card(s, 6.65, 1.3, 2.85, 2.2, "[לאימות]", "לא נבדק במחקר זה. לפני הזמנה או יציאה לשטח יש לוודא את הנתון במקור הרשמי.", { headColor: C.rock });
  s.addText("חשוב: הנתונים הונחו לעונת 2026 (למשל כללי Timed Entry של RMNP ותעריפי Pikes Peak). הטיול מתוכנן לאוגוסט של שנה עתידית, ולכן כללי כניסה, סגירות שבילים ותנאי כביש עלולים להשתנות. התחזית המעודכנת ותנאי השטח נבדקים רק קרוב לתאריך היציאה.", {
    x: 0.5, y: 3.8, w: 9, h: 1.1, fontFace: FONT_B, fontSize: 14, color: C.ink, align: "right", rtlMode: true, valign: "top", margin: 0, isTextBox: true,
  });
}

// ---------- 3. Agenda ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "תוכן העניינים");
  const rows = [
    ["01", "היכרות עם קולורדו: גאוגרפיה, אקלים ומערכות אקולוגיות"],
    ["02", "Colorado Springs · Pikes Peak · תוכנית 4 ימים"],
    ["03", "San Juan Mountains · תוכנית 5 ימים"],
    ["04", "Rocky Mountain National Park · תוכנית 5–6 ימים"],
    ["05", "השוואה בין שלושת האזורים"],
    ["06", "סיכום, מפת הביקור, בטיחות והכנה לטיול"],
  ];
  rows.forEach(([n, t], i) => {
    const y = 1.3 + i * 0.6;
    s.addText(n, { x: 8.3, y, w: 1.2, h: 0.45, fontFace: FONT_H, fontSize: 22, bold: true, color: C.moss, align: "right", margin: 0, isTextBox: true, valign: "middle" });
    s.addText(t, { x: 0.5, y, w: 7.6, h: 0.45, fontFace: FONT_B, fontSize: 16, color: C.ink, align: "right", rtlMode: true, margin: 0, isTextBox: true, valign: "middle" });
  });
}

// ---------- 4. Section 01 ----------
sectionSlide("01", "היכרות עם קולורדו", "גאוגרפיה, גובה ומערכות אקולוגיות");

// ---------- 5. Map ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "קולורדו ושלושת האזורים");
  drawMap(s, false);
  regionKey(s, 6.55, 1.5);
  s.addText("מפה סכמטית, לא בקנה מידה. המיקומים לפי קואורדינטות משוערות של היישובים והפארק. לפני תכנון מסלולים יש להשתמש במפת שטח רשמית.", {
    x: 6.55, y: 3.5, w: 3.0, h: 1.3, fontFace: FONT_B, fontSize: 11, italic: true, color: C.muted, align: "right", rtlMode: true, margin: 0, isTextBox: true, valign: "top",
  });
  foot(s, "מקור לגאוגרפיה: NPS (Rocky Mountain NP), San Juan National Forest. קואורדינטות יישובים: ידע כללי, לא נבדק מול GIS.");
}

// ---------- 6. Rockies stats ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "הרי הרוקי בקולורדו: מספרים שמגדירים את המדינה");
  stat(s, 0.5, 1.3, 2.1, 1.7, "14,115", "רגל · Pikes Peak, פסגה [מאומת]", C.forest);
  stat(s, 2.75, 1.3, 2.1, 1.7, "12,183", "רגל · נקודה גבוהה של Trail Ridge Road [מאומת]", C.lake);
  stat(s, 5.0, 1.3, 2.1, 1.7, "11,018", "רגל · Red Mountain Pass על US 550 [מאומת]", C.granite);
  stat(s, 7.25, 1.3, 2.25, 1.7, "9,475", "רגל · Bear Lake, תחנת הכניסה לפארק [מאומת]", C.rock);
  bullets(s, [
    "קו פרשת המים הגדול (Continental Divide) חוצה את קולורדו, והוא מפריד בין נחלים שזורמים לאוקיינוס השקט לאלה שזורמים לאטלנטי.",
    "רוב השטח שבו נטייל נמצא מעל 7,000 רגל. זו הסיבה שההסתגלות לגובה היא נושא מרכזי בתכנון.",
    "הרי הרוקי צעירים יחסית מבחינה גיאולוגית, וצורתם מעוצבת בעיקר על ידי הרמה טקטונית ופעולת קרחונים בתקופת הקרח האחרונה.",
  ], { y: 3.25, h: 1.8, fontSize: 14 });
  foot(s, "מקורות: NPS (Trail Ridge Road, Bear Lake Road), drivepikespeak.com, US 550 / Red Mountain Pass (roadtravelamerica.com). הרקע הגיאולוגי: ידע כללי, לאמת במקור USGS לפני ציטוט.");
}

// ---------- 7. Elevation chart ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "פרופיל גובה: הנקודות שנטייל בהן");
  const labels = ["Bear Lake (RMNP)", "Ouray (town, approx.)", "Red Mountain Pass", "Trail Ridge Road (high point)", "Ice Lake Trail (max)", "Upper Blue Lake", "Pikes Peak (summit)"];
  const values = [9475, 7700, 11018, 12183, 12260, 12392, 14115];
  s.addChart(pres.charts.BAR, [{ name: "גובה (רגל)", labels, values }], {
    x: 0.5, y: 1.2, w: 9, h: 3.8, barDir: "bar",
    chartColors: [C.forest],
    showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0",
    dataLabelFontFace: FONT_B, dataLabelFontSize: 11, dataLabelColor: C.ink,
    catAxisLabelFontFace: FONT_B, catAxisLabelFontSize: 11, catAxisLabelColor: C.ink,
    valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" },
    showLegend: false, showTitle: false, valAxisMinVal: 0, valAxisMaxVal: 15000,
  });
  foot(s, "מקורות: NPS, drivepikespeak.com, San Juan National Forest (Ice Lake: נקודה מרבית 12,260 רגל), SJMA (Upper Blue Lake 12,392 רגל), visitouray.com (Ouray: ערך משוער). 'טווח' = מקורות שונים; הערכים כאן הם הערך הנפוץ.");
}

// ---------- 8. Geography & climate ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "גאוגרפיה ואקלים: למה האזורים שונים כל כך");
  card(s, 0.5, 1.3, 4.35, 1.75, "מבנה הנוף", "מישורים גבוהים ממזרח (High Plains) → Front Range עם הרי הרוקי הקדמיים → רכס הפרשה הרחב → מדרון מערבי ושטחי הרים מרוחקים (San Juan).", { headSize: 15 });
  card(s, 5.15, 1.3, 4.35, 1.75, "הבדלי גובה", "בין עמק נמוך לפסגה הגבוהה יש הבדל של מעל 8,000 רגל. הבדל כזה משנה את הצמחייה, הטמפרטורה והמשקעים בתוך מרחק הליכה קצר.", { headSize: 15 });
  card(s, 0.5, 3.2, 4.35, 1.8, "אקלים יבש ושמשי", "קולורדו יבשה יחסית ושמשית, עם שמש חזקה בגבהים (קרינת UV גבוהה), טווח טמפרטורות יומי גדול ורוחות חזקות בגבהים.", { headSize: 15 });
  card(s, 5.15, 3.2, 4.35, 1.8, "משקעים בהרים", "הרכסים הגבוהים מקבלים את רוב המשקעים בחורף כשלג, ובקיץ מתרחשות סופות רעמים אחר הצהריים. כמות המשקעים מדויקת נבדקת במקור NOAA/NRCS.", { headSize: 15 });
  foot(s, "רקע כללי על מבנה הנוף ותופעות האקלים: מקורות NPS ו-USGS. נתוני משקעים ספציפיים לא נאספו במחקר זה [לאימות].");
}

// ---------- 9. Ecological systems ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "מערכות אקולוגיות עיקריות בקולורדו");
  table(s, ["מערכת", "טווח גובה (בערך)", "צמחייה אופיינית", "בעלי חיים אופייניים"], [
    ["מישורים ומדבריות גבוהות", "נמוך (מתחת ~6,000 רגל)", "דשא גבוה, קקטוסים, שיחים", "אנטילופה, ציפורים, יונקים קטנים"],
    ["Montane (הרי ביניים)", "כ-5,500–8,500 רגל", "פונדרוסה, דאגלס-אשוחית, אספן", "איילה מצויה, דוב שחור, אייל"],
    ["Subalpine (תת-אלפיני)", "כ-8,500–11,500 רגל", "אשוחית אנגלמן, אשוח הרים, אורן לודג'פול", "אייל, איילת, ארנב שלג, ציפור Clark's Nutcracker"],
    ["Alpine Tundra (טונדרה)", "מעל קו העצים (כ-11,500+)", "שיחים זוחלים, חזזיות, פרחי בר קטנים", "כבש הרים, פיקה, מרמוטה"],
  ], { y: 1.3, colW: [2.2, 2.2, 2.6, 2.0], fontSize: 12, rowH: 0.7 });
  foot(s, "טווחי הגובה הם הערכה משוערת ותלויה בחשיפה ובכיוון המדרון. לאימות מול NPS (RMNP Vegetation) ו-USFS. הרשימות הן דוגמאות ואינן ממצה.");
}

// ---------- 10. Altitude effect ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "השפעת הגובה על הטבע");
  card(s, 0.5, 1.3, 2.85, 2.6, "טמפרטורה", "ככל שעולים כ-1,000 מטר, הטמפרטורה יורדת בכ-6.5°C. לכן חם מאוד בעמק ויכול להיות קר בפסגה באותו יום.");
  card(s, 3.575, 1.3, 2.85, 2.6, "חמצן", "האוויר דליל יותר. מי שמגיע מגובה נמוך מרגיש עייפות מהר יותר, והתסמינים של מחלת גבהים עלולים להופיע כבר מעל כ-8,000 רגל.");
  card(s, 6.65, 1.3, 2.85, 2.6, "צמחייה", "העצים מתמעטים וקטנים ככל שעולים. מעל קו העצים נשארת רק צמחייה נמוכה ועמידה לרוחות ולקור.");
  s.addText("השפעה שלישית, פחות מוכרת: הקרינה. באוויר דליל יותר יש פחות סינון אטמוספרי, ולכן בגבהים קרני UV חזקות יותר. מומלצים משקפי שמש, קרם הגנה ובגדים מכסים.", {
    x: 0.5, y: 4.1, w: 9, h: 0.9, fontFace: FONT_B, fontSize: 14, color: C.ink, align: "right", rtlMode: true, valign: "top", margin: 0, isTextBox: true,
  });
  foot(s, "קצב ירידת הטמפרטורה (Lapse Rate) הוא ערך ממוצע כללי. הסיכון למחלת גבהים מתואר ב-NPS ובמקורות רפואיים; ייעוץ פרטני לפני הטיול מומלץ.");
}

// ---------- 11. August alpine summer ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "הקיץ האלפיני באוגוסט");
  bullets(s, [
    "אוגוסט הוא שיא עונת הפריחה בגבהים: פרחי בר בשיא, בעיקר בדשאות ובאזורי הנחלים.",
    "השלג בגבהים נמס בדרך כלל עד סוף הקיץ, אבל שלג מוקדם או שרידי שלג בשטחים מוצלים עדיין אפשריים. נדיר, אך לא מובטח.",
    "סופות רעמים אחר הצהריים הן הסיכון הבולט ביותר בחודש הזה. לכן יוצאים לשבילים מוקדם ויורדים מהרכסים לפני צהריים מאוחרים.",
    "חיות הבר פעילות בבוקר ובערב. בוקר מוקדם הוא זמן טוב גם לצפייה ולצילום.",
  ], { y: 1.3, h: 3.4, fontSize: 15 });
  foot(s, "מקורות: NPS (Weather & Safety), Colorado Parks and Wildlife. תנאי השלג והסופות בשנה הספציפית ייבדקו רק קרוב לתאריך.");
}

// ---------- 12. Section 02 ----------
sectionSlide("02", "Colorado Springs · Pikes Peak","ארבעה ימים בין עיר בשולי ההרים לפסגה של 14,115 רגל");

// ---------- 13. Region profile ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "Colorado Springs: העיר על שולי הרי הרוקי");
  photo(s, 0.5, 1.3, 4.2, 3.6, "[תמונה לשילוב: Garden of the Gods, צילום נוף אמיתי של צוקי הסלע האדומים (סלע משקע) על רקע השמיים]");
  bullets(s, [
    "העיר נמצאת בשולי ה-Front Range, בין המישורים לבין ההרים.",
    "Garden of the Gods: צוקים גבוהים של סלע משקע אדום ומעוגל, תוצאה של שכבות שנחשפו בהרמה ובשחיקה לאורך מיליוני שנים.",
    "North Cheyenne Cañon: קניון נחל עם יער מחטני ופעילות מים. השבילים בו מחברים בין נופים נמוכים לבין אזורים גבוהים יותר.",
    "Manitou Springs: מעיינות מינרליים בשולי ההר, נקודת יציאה נוחה לשביל ולנופים באזור.",
  ], { x: 5.0, y: 1.3, w: 4.5, h: 3.6, fontSize: 13.5 });
  foot(s, "תיאור גאולוגי כללי: NPS/USGS; לאימות מול מקורות Garden of the Gods Park. מיקום מעיינות Manitou: ידע כללי.");
}

// ---------- 14. Pikes Peak ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "Pikes Peak: הפסגה ו-Pikes Peak Highway");
  stat(s, 0.5, 1.3, 2.1, 1.6, "14,115", "רגל · פסגה [מאומת]", C.forest);
  stat(s, 2.75, 1.3, 2.1, 1.6, "19 mi", "אורך הכביש לפסגה [מאומת]", C.lake);
  stat(s, 5.0, 1.3, 2.1, 1.6, "$18", "מבוגר (16+) למעבר, 2026 [מאומת]", C.granite);
  stat(s, 7.25, 1.3, 2.25, 1.6, "$2", "Timed Entry לרכב בקיץ, 2026 [מאומת]", C.rock);
  bullets(s, [
    "הכביש מתחיל באזור יער ונגמר בטונדרה. הגובה והאקלים משתנים מאוד לאורך הדרך.",
    "תעריפים נוספים (2026): ילד (6–15) $8 · רכב עד 5 נוסעים $65 · לבדוק את תעריפי 2027 לפני הטיול.",
    "בפסגה יש Summit Visitor Center. מי שחש עייפות או כאב ראש בגובה צריך לרדת מיד.",
  ], { y: 3.15, h: 1.9, fontSize: 14 });
  foot(s, "מקורות: drivepikespeak.com (Hours & Rates), visitcos.com. התעריפים הם של 2026 בלבד.");
}

// ---------- 15. Forest & water ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "יערות, נחלים ומפלים בקרבת העיר");
  card(s, 0.5, 1.3, 2.85, 2.6, "North Cheyenne Cañon", "קניון יער ונחל. השבילים (כולל Seven Bridges, שנקרא על שם חציות הנחל) עוברים בין סלעים, עצים ומים.", { headSize: 15 });
  card(s, 3.575, 1.3, 2.85, 2.6, "Helen Hunt Falls", "מפל שניתן להגיע אליו מהקניון. מתאים לחלק המשפחתי של היום, בהתאם למצב המים בעונה.", { headSize: 15 });
  card(s, 6.65, 1.3, 2.85, 2.6, "יער מחטני", "עצי פונדרוסה ודאגלס-אשוחית במדרונות הנמוכים, ועצי אספן לאורך הנחלים. בגובה מופיעה צמחייה אופיינית ל-Montane.", { headSize: 15 });
  s.addText("מסלולי הקניון: אורך, הפרש גובה וזמן הליכה לא נאספו במחקר זה. לפני היציאה יש לבדוק במקור הרשמי של Pike National Forest.", {
    x: 0.5, y: 4.2, w: 9, h: 0.7, fontFace: FONT_B, fontSize: 13, italic: true, color: C.muted, align: "right", rtlMode: true, margin: 0, isTextBox: true,
  });
  foot(s, "מקור: Pike National Forest / ידע שטח כללי. מספר החציות של Seven Bridges לא נבדק מול מקור רשמי [לאימות].");
}

// ---------- 16. Lowland vs alpine ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "העמק מול הפסגה: אותו אזור, שני עולמות");
  table(s, ["מאפיין", "בסיס העיר (נמוך)", "פסגת Pikes Peak (גבוה)"], [
    ["גובה", "כ-6,000 רגל [לאימות]", "14,115 רגל [מאומת]"],
    ["צמחייה", "יער פונדרוסה, שיחייה וצוקים", "טונדרה, שיחים זוחלים, חזזיות"],
    ["טמפרטורה באוגוסט", "חמה ביום ונוחה בערב", "קרה מאוד, רוחות חזקות, ללא הבדל עונתי רב"],
    ["סיכון מרכזי", "חום ושמש", "מחלת גבהים, היפותרמיה, ברקים"],
    ["מה רואים", "סלעים אדומים, יער", "נוף רחב של רכסים וטונדרה"],
  ], { y: 1.3, colW: [2.3, 3.2, 3.5], fontSize: 13, rowH: 0.6 });
  foot(s, "הגובה של העיר משתנה לפי השכונה; הערך המוצג הוא הערך הכללי המקובל [לאימות]. שאר הנתונים: NPS, Pikes Peak, ידע כללי.");
}

// ---------- 17. Colorado Springs day plan ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "תוכנית Colorado Springs: 4 ימים");
  table(s, ["יום", "מיקוד", "מרחק", "הפרש גובה", "קושי", "זמן", "מה מיוחד"], [
    ["1", "הגעה והסתגלות · Garden of the Gods", "[לאימות]", "[לאימות]", "קל", "[לאימות]", "צוקי סלע אדום, יום נמוך לפני העליה"],
    ["2", "North Cheyenne Cañon · Seven Bridges", "[לאימות]", "[לאימות]", "בינוני", "[לאימות]", "יער, נחל ומפל; מסלול בבוקר"],
    ["3", "Pikes Peak Highway · פסגה", "19 mi כביש", "עד 14,115 רגל", "מאתגר לגובה", "חצי יום", "לרדת לפני סופה מאוחרת"],
    ["4", "גמישות · Manitou Springs / Helen Hunt Falls", "[לאימות]", "[לאימות]", "קל", "[לאימות]", "יום חיץ לשינויי מזג אוויר"],
  ], { y: 1.3, colW: [0.5, 2.6, 1.0, 1.3, 1.1, 1.0, 1.5], fontSize: 11, rowH: 0.7 });
  foot(s, "מרחקים והפרשי גובה להליכה טרם נאספו ממקור רשמי. ביום 3 הערך הוא של הכביש ולא של מסלול הליכה. כל הערכים [לאימות] לפני השלמת התכנון.");
}

// ---------- 18. Section 03 ----------
sectionSlide("03", "San Juan Mountains", "הרכס המרוחק, הקרחונים והאגמים הטורקיז");

// ---------- 19. Geology ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "גאולוגיה: הר געש וקרחונים");
  bullets(s, [
    "רוב הסלע של ה-San Juan הוא סלע געשי מתקופת השלישוני (Oligocene). הנוף הנוכחי נוצר כשנשחק והתפתח סביב הגעש הקדום.",
    "הקרחונים של תקופת הקרח האחרונה חתכו עמקים רחבים בצורת U, יצרו מעגלי קרח (Cirques) וחפרו את האגמים האלפיניים.",
    "הרכסים החדים והמדרונות התלולים הם שריד של פעילות קרחונית, ולכן שביל אחד יכול לעבור בין עמק רחב לאגם תלוי בלי מעבר מדורג.",
  ], { y: 1.3, h: 3.4, fontSize: 15 });
  foot(s, "רקע גיאולוגי כללי: USGS / San Juan National Forest. ההבחנה המדויקת בין הרכבי הסלע לא נבדקה במחקר זה [לאימות מול USGS].");
}

// ---------- 20. Towns map ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "שלוש עיירות, כביש אחד ומחוז של הרים");
  // Small inset map centered on the San Juan cluster.
  const M = { x: 0.5, y: 1.3, w: 4.6, h: 3.6 };
  s.addShape(pres.shapes.RECTANGLE, { x: M.x, y: M.y, w: M.w, h: M.h, fill: { color: "E6ECE4" }, line: { color: "8A958E", width: 1 } });
  const sjPt = { ouray: { x: 1.9, y: 3.5 }, silverton: { x: 3.4, y: 2.2 }, telluride: { x: 1.2, y: 2.2 } };
  line(s, sjPt.ouray.x, sjPt.ouray.y, sjPt.silverton.x, sjPt.silverton.y, C.rock);
  line(s, sjPt.telluride.x, sjPt.telluride.y, sjPt.ouray.x, sjPt.ouray.y, C.granite, true);
  dot(s, sjPt.ouray.x, sjPt.ouray.y, C.lake, 0.11);
  dot(s, sjPt.silverton.x, sjPt.silverton.y, C.lake, 0.11);
  dot(s, sjPt.telluride.x, sjPt.telluride.y, C.lake, 0.11);
  s.addText("Ouray", { x: sjPt.ouray.x - 0.9, y: sjPt.ouray.y + 0.08, w: 0.8, h: 0.3, fontFace: FONT_B, fontSize: 12, bold: true, color: C.ink, align: "right", margin: 0, isTextBox: true });
  s.addText("Silverton", { x: sjPt.silverton.x + 0.12, y: sjPt.silverton.y - 0.14, w: 1.1, h: 0.3, fontFace: FONT_B, fontSize: 12, bold: true, color: C.ink, margin: 0, isTextBox: true });
  s.addText("Telluride", { x: sjPt.telluride.x - 0.9, y: sjPt.telluride.y - 0.14, w: 0.85, h: 0.3, fontFace: FONT_B, fontSize: 12, bold: true, color: C.ink, align: "right", margin: 0, isTextBox: true });
  s.addText("25 mi · US 550 (Million Dollar Highway)", { x: 2.2, y: 2.65, w: 2.6, h: 0.3, fontFace: FONT_B, fontSize: 10, italic: true, color: C.rock, margin: 0, isTextBox: true });
  s.addText("מפה סכמטית, לא בקנה מידה", { x: M.x + 0.1, y: M.y + M.h - 0.35, w: 3, h: 0.28, fontFace: FONT_B, fontSize: 10, italic: true, color: C.muted, margin: 0, isTextBox: true });
  bullets(s, [
    "Ouray ו-Silverton מחוברות ע\"י US 550, שהוא הקטע הידוע בשם Million Dollar Highway: כ-25 מייל לאורך מעברים גבוהים.",
    "Telluride נמצאת בצד המערבי. הדרך אליה ומשכי הנסיעות בין שלוש העיירות טרם נבדקו [לאימות].",
    "מסלול ה-San Juan Skyway, לולאה של כ-236 מייל, מתואר ב-CDOT כנסיעה של כ-6 שעות.",
  ], { x: 5.4, y: 1.3, w: 4.1, h: 3.6, fontSize: 13.5 });
  foot(s, "מקורות: visitouray.com (25 מייל), CDOT San Juan Skyway (236 מייל, 6 שעות), מיקומים סכמטיים. זמני נסיעה בין Telluride ל-Ouray/Silverton: [לאימות].");
}

// ---------- 21. Lakes ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "האגמים: שלושה מקומות, שלוש חוויות");
  card(s, 0.5, 1.3, 2.85, 2.8, "Ice Lake", "אגם בתוך Ice Lake Basin. נקודה מרבית של השביל 12,260 רגל לפי ה-USFS. אחד המסלולים הפופולריים ביותר באזור.", { headSize: 15 });
  card(s, 3.575, 1.3, 2.85, 2.8, "Lower Blue Lake", "האגם התחתון בשביל Blue Lakes, בגובה 10,920–10,980 רגל (טווח בין מקורות). נקודת יעד מרכזית למשפחה.", { headSize: 15 });
  card(s, 6.65, 1.3, 2.85, 2.8, "Upper Blue Lake", "האגם העליון, בגובה כ-12,392 רגל לפי SJMA. ממשיכים אליו מ-Lower Blue Lake, ומהמעבר של Blue Lakes Pass המשך לגבוה יותר.", { headSize: 15 });
  s.addText("Island Lake: מופיע בשם המסלול 'Ice & Island Lake Trail' אבל הפרטים שלו לא נבדקו במחקר זה. אין לכתוב עליו עובדות עד לאימות במקור של ה-USFS.", {
    x: 0.5, y: 4.3, w: 9, h: 0.6, fontFace: FONT_B, fontSize: 13, italic: true, color: C.rock, align: "right", rtlMode: true, margin: 0, isTextBox: true,
  });
  foot(s, "מקורות: San Juan Mountains Association (sjma.org), San Juan National Forest (Ice Lake). הערכים לגובה Lower Blue Lake משתנים בין מקורות.");
}

// ---------- 22. Ice Lake detail ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "Ice Lake Basin: מסלול בבוקר, נוף בשיא");
  table(s, ["נתון", "ערך", "סטטוס"], [
    ["נקודת התחלה", "9,840 רגל", "[מאומת] SJMA, USFS"],
    ["Lower Ice Lake (כ-2 מייל מנקודת ההתחלה)", "11,510 רגל", "[מאומת] SJMA"],
    ["Ice Lake (נקודת יעד)", "כ-12,000+ רגל", "[טווח] לפי מקורות שונים"],
    ["נקודה מרבית לאורך השביל", "12,260 רגל", "[מאומת] USFS"],
    ["אורך (הליכה הלוך ושוב)", "8.7–8.8 מייל", "[טווח] AllTrails, SJMA ואחרים"],
    ["הפרש גובה מצטבר", "כ-2,400–2,900 רגל", "[טווח] תלוי במקור"],
  ], { y: 1.3, colW: [4.2, 2.2, 2.6], fontSize: 13, rowH: 0.44 });
  s.addText("מסלול בינוני עד מאתגר. בערך 62% מהמדרגים מסווגים אותו כקשה (AllTrails). מומלץ להתחיל מוקדם לפני סופות הרעמים.", {
    x: 0.5, y: 4.75, w: 9, h: 0.35, fontFace: FONT_B, fontSize: 13, color: C.ink, align: "right", rtlMode: true, margin: 0, isTextBox: true,
  });
  foot(s, "מקורות: sjma.org/ice-lake-trip-planning, San Juan National Forest, alltrails.com. הטווחים נשארים כפי שמופיעים במקורות.");
}

// ---------- 23. Blue Lakes vs Lower Blue Lake ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "Blue Lakes · Lower Blue Lake: לא אותו מקום");
  s.addText("Blue Lakes = מערכת השבילים והאגמים. Lower Blue Lake = האגם הראשון במערכת.", {
    x: 0.5, y: 1.15, w: 9, h: 0.4, fontFace: FONT_B, fontSize: 14, bold: true, color: C.forest, align: "right", rtlMode: true, margin: 0, isTextBox: true,
  });
  table(s, ["נקודה", "מרחק הלוך ושוב", "גובה", "מקור"], [
    ["Lower Blue Lake", "6.3–6.5 מייל", "10,920–10,980 רגל", "[טווח] SJMA, Covered Bridge"],
    ["Upper Blue Lake", "~8.2 מייל (לפי hikingwalking)", "12,392 רגל", "[טווח] SJMA, hikingwalking"],
    ["Blue Lakes Pass", "~9 מייל", "[לאימות]", "[לאימות] SJMA"],
    ["הפרש גובה מצטבר", "1,590–2,440 רגל", "תלוי ביעד", "[טווח] בין מקורות"],
  ], { y: 1.7, colW: [2.4, 2.8, 2.2, 1.6], fontSize: 12, rowH: 0.45 });
  s.addText("ההבחנה: בדרך ל-Lower Blue Lake המסלול מתפצל. ענף אחד ממשיך ל-Middle ול-Upper Blue Lake ולמעבר. לכן יעד 'Lower' הוא נקודת חזרה נוחה למשפחה, ו'Upper' דורש כושר ומזג אוויר יציב יותר.", {
    x: 0.5, y: 4.2, w: 9, h: 0.8, fontFace: FONT_B, fontSize: 13, color: C.ink, align: "right", rtlMode: true, valign: "top", margin: 0, isTextBox: true,
  });
  foot(s, "מקורות: sjma.org/blue-lakes, alltrails.com (Lower, Middle and Upper Blue Lakes), onxmaps.com, hikingwalking.com. ערכי הטווח משקפים מקורות שונים; לפני יציאה יש לאמת במפה.");
}

// ---------- 24. Million Dollar Highway ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "Million Dollar Highway: US 550");
  stat(s, 0.5, 1.3, 2.1, 1.5, "25 mi", "בין Ouray ל-Silverton", C.forest);
  stat(s, 2.75, 1.3, 2.1, 1.5, "11,018", "רגל · Red Mountain Pass", C.lake);
  stat(s, 5.0, 1.3, 2.1, 1.5, "5–7", "שעות לולאת Skyway, עם עצירות", C.granite);
  card(s, 7.25, 1.3, 2.25, 1.5, "⚠ סגירה", "דווח על סגירת US 550 בין Silverton ל-Ouray. לא מאומת במקור רשמי.", { fill: "F6E7DA", headColor: C.rock, headSize: 13, bodySize: 11 });
  bullets(s, [
    "הכביש נבנה בהמשך לדרך עפר שהוקמה בסוף המאה ה-19, ומשתרע על מדרונות תלולים עם נופים רחבים.",
    "נסיעה בכביש הזה דורשת ריכוז, במיוחד בגשם ובערפל. מומלץ לתכנן עצירות מוקדמות ולא ללכת למסלולים ארוכים באותו יום.",
  ], { y: 3.1, h: 1.4, fontSize: 14 });
  s.addText("לפני הטיול: לבדוק במקור CDOT (cotrip.org) אם הכביש פתוח, ואם יש הגבלות לרכבים גדולים או לגרירה.", {
    x: 0.5, y: 4.55, w: 9, h: 0.5, fontFace: FONT_B, fontSize: 13, bold: true, color: C.rock, align: "right", rtlMode: true, margin: 0, isTextBox: true,
  });
  foot(s, "מקורות: visitouray.com, roadtravelamerica.com, CDOT San Juan Skyway. מידע הסגירה הגיע מפוסט ברשת חברתית ולא מאומת; נא לבדוק את מצב הכביש בזמן אמת.");
}

// ---------- 25. Flora & fauna San Juan ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "צמחייה ובעלי חיים ב-San Juan");
  photo(s, 0.5, 1.3, 3.6, 3.6, "[תמונה לשילוב: פרחי בר אלפיניים בדשא גבוה, תקריב אמיתי של פרחים באזור הרכס]");
  bullets(s, [
    "יערות מחטניים (אשוחית ואשוח) במדרונות, ואספן לאורך הנחלים.",
    "כרי דשא אלפיניים עם פרחי בר בשיא באוגוסט, בעיקר באזורי ביניים.",
    "בעלי חיים שניתן לראות: אייל מצוי, כבש הרים (בגבהים), מרמוטה ופיקה בשדות סלע. ייתכנו גם דובים שחורים.",
    "בעלי החיים המדויקים לכל מסלול לא נבדקו מול מקור רשמי [לאימות].",
  ], { x: 4.4, y: 1.3, w: 5.1, h: 3.6, fontSize: 14 });
  foot(s, "מקורות: San Juan National Forest, Colorado Parks and Wildlife. הרשימה כללית; מינים מדויקים ופעילות עונתית [לאימות].");
}

// ---------- 26. San Juan zones ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "אזורי צמחייה לפי גובה ב-San Juan");
  table(s, ["אזור", "גובה (בערך)", "מה רואים", "איך זה משפיע על המסלול"], [
    ["יער Montane", "עד כ-9,000 רגל", "אספן, אשוחית, שיחייה", "הצל נעלם בדרך לאגם, החום מורגש"],
    ["Subalpine", "כ-9,000–11,500 רגל", "אשוחית, אשוח, כרי דשא, פרחים", "אזור רוב המסלולים לאגמים"],
    ["Alpine Tundra", "מעל כ-11,500 רגל", "שיחים זוחלים, חזזיות, סלעים", "רוחות, קור והשלכות של סופה"],
  ], { y: 1.3, colW: [2.1, 2.2, 2.7, 2.0], fontSize: 13, rowH: 0.7 });
  s.addText("ההבדל בין האזורים מורגש בצעד. כשהופכים מדרון לאגם בגובה, נוף הטונדרה מתחיל לפני שרואים את האגם, ולכן התכנון צריך לקחת בחשבון את הגובה.", {
    x: 0.5, y: 4.2, w: 9, h: 0.7, fontFace: FONT_B, fontSize: 13, color: C.ink, align: "right", rtlMode: true, margin: 0, isTextBox: true,
  });
  foot(s, "הטווחים הם הערכה לפי מקורות כלליים ותלויים בחשיפה ובשנה. לאימות מול San Juan National Forest.");
}

// ---------- 27. San Juan day plan ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "תוכנית San Juan: 5 ימים");
  table(s, ["יום", "מיקוד", "מרחק", "הפרש גובה", "קושי", "זמן", "מה מיוחד"], [
    ["1", "הגעה לעיירה · נסיעה ב-Million Dollar Highway", "~25 mi כביש", "עד 11,018 רגל", "נסיעה", "חצי יום", "בדיקת סגירה לפני הנסיעה"],
    ["2", "Ice Lake Basin", "8.7–8.8 mi [טווח]", "~2,400–2,900 רגל [טווח]", "בינוני–מאתגר", "6–7 שע׳ [לאימות]", "אגמים ונוף אלפיני"],
    ["3", "Blue Lakes · Lower Blue Lake כיעד", "6.3–6.5 mi [טווח]", "~1,600–2,400 רגל [טווח]", "בינוני", "[לאימות]", "אפשר להמשיך ל-Upper"],
    ["4", "Ouray · העיירה והמסלולים הקצרים", "[לאימות]", "[לאימות]", "קל", "[לאימות]", "יום חיץ ומנוחה"],
    ["5", "Telluride · יום נסיעה ונוף", "[לאימות]", "[לאימות]", "קל", "[לאימות]", "דרך עם מעברים גבוהים"],
  ], { y: 1.3, colW: [0.5, 2.5, 1.2, 1.6, 1.1, 1.1, 1.0], fontSize: 10.5, rowH: 0.62 });
  foot(s, "ימים 1–3 מבוססים על נתונים שנבדקו. ימים 4–5 דורשים מחקר נוסף. ערכי הטווח משקפים מקורות שונים. נתוני השבילים ואפשרויות ההליכה צריכים אישור לפני יציאה.");
}

// ---------- 28. Section 04 ----------
sectionSlide("04", "Rocky Mountain National Park", "הפארק שמסביב לרכס הקונטיננטלי, ושלוש המערכות האקולוגיות שלו");

// ---------- 29. RMNP geography ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "הפארק: מיקום וגאוגרפיה");
  photo(s, 0.5, 1.3, 4.2, 3.6, "[תמונה לשילוב: Bear Lake או Emerald Lake בבוקר, צילום נוף אמיתי של המקום]");
  bullets(s, [
    "הפארק משתרע לאורך הרכס הקונטיננטלי, והוא חלק מ-Front Range ממזרח לקו הפרשה.",
    "כניסות לפארק: Beaver Meadows, Fall River ו-Grand Lake. חלקן נמצאות בצד המזרחי ובצד המערבי.",
    "Trail Ridge Road חוצה את הפארק בכביש גבוה וממשיך דרך הטונדרה.",
    "אזור Bear Lake Road, ליד כניסת Beaver Meadows, מכיל את רוב המסלולים הפופולריים ביותר.",
  ], { x: 5.0, y: 1.3, w: 4.5, h: 3.6, fontSize: 13.5 });
  foot(s, "מקורות: NPS (Rocky Mountain NP, Bear Lake Road Corridor), recreation.gov, estes-park.com.");
}

// ---------- 30. Elevation zone diagram ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "שלוש מערכות אקולוגיות, שני קילומטרים של גובה");
  // Vertical elevation axis: 5,000 ft (bottom) to 12,500 ft (top)
  const yTop = 1.3, yBot = 4.85;
  const yOf = (ft) => yBot - ((ft - 5000) / (12500 - 5000)) * (yBot - yTop);
  const bands = [
    { lo: 5500, hi: 8500, name: "Montane", color: "8DB06B", species: "פונדרוסה, דאגלס-אשוחית, אספן · איילה, דוב שחור" },
    { lo: 8500, hi: 11400, name: "Subalpine", color: "4F8A6B", species: "אשוחית אנגלמן, אשוח הרים, לודג'פול · אייל, איילת" },
    { lo: 11400, hi: 12500, name: "Alpine Tundra", color: "9AA5A8", species: "שיחים זוחלים, חזזיות, פרחי בר · כבש הרים, פיקה, מרמוטה" },
  ];
  bands.forEach((b) => {
    const y1 = yOf(b.hi), y2 = yOf(b.lo);
    s.addShape(pres.shapes.RECTANGLE, { x: 1.2, y: y1, w: 3.2, h: y2 - y1, fill: { color: b.color }, line: { color: C.white, width: 1 } });
    s.addText(b.name, { x: 1.3, y: y1 + 0.05, w: 3, h: 0.3, fontFace: FONT_H, fontSize: 14, bold: true, color: C.white, margin: 0, isTextBox: true });
    s.addText(b.species, { x: 4.6, y: y1 + 0.02, w: 4.9, h: y2 - y1 - 0.04, fontFace: FONT_B, fontSize: 12, color: C.ink, align: "right", rtlMode: true, valign: "middle", margin: 0, isTextBox: true });
  });
  // Elevation axis ticks
  [5000, 7500, 10000, 12500].forEach((ft) => {
    s.addText(ft.toLocaleString("en-US") + " רגל", { x: 0.2, y: yOf(ft) - 0.12, w: 0.95, h: 0.24, fontFace: FONT_B, fontSize: 10, color: C.muted, align: "right", margin: 0, isTextBox: true });
  });
  // Markers for known points
  [9475, 10758, 12183].forEach((ft) => dot(s, 1.2, yOf(ft), C.rock, 0.07));
  s.addText("נקודות מדידה שנבדקו: Bear Lake 9,475 · Milner Pass 10,758 · Trail Ridge Road 12,183 רגל", {
    x: 0.5, y: 4.95, w: 9, h: 0.25, fontFace: FONT_B, fontSize: 10, color: C.muted, align: "right", rtlMode: true, margin: 0, isTextBox: true,
  });
  foot(s, "טווחי הגובה לכל מערכת הם הערכה כללית לפי מקורות NPS ולא מדידה מדויקת. תחומי המערכות תלויים בחשיפה ובקרינה [לאימות מול NPS].", C.muted);
}

// ---------- 31. Trail Ridge Road ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "Trail Ridge Road: הכביש שעובר מעל העצים");
  stat(s, 0.5, 1.3, 2.6, 1.5, "12,183", "רגל · נקודה גבוהה [מאומת]", C.forest);
  stat(s, 3.3, 1.3, 2.6, 1.5, "~8 mi", "דרך טונדרה לפי הפארק [מאומת]", C.lake);
  stat(s, 6.1, 1.3, 3.4, 1.5, "10,758", "רגל · Milner Pass, קו הפרשה [מאומת]", C.granite);
  bullets(s, [
    "הכביש חוצה את הפארק מעל קו העצים. החוויה משתנה מאזור יער לטונדרה תוך נסיעה של כמה דקות.",
    "בתחנת Alpine Visitor Center מתחיל אזור ההליכה הראשון בטונדרה, עם שבילים קצרים ושלטים.",
    "הכביש גבוה ולכן נסיעה בו מתאימה למזג אוויר יציב. בסופה יש סיכון ממשי, וכדאי לשים לב לתחזית לפני היציאה.",
  ], { y: 3.1, h: 1.9, fontSize: 14 });
  foot(s, "מקורות: NPS (Trail Ridge Road), rockymountainnationalpark.com (תיאור ה-8 מייל), Wikipedia (מעמד הכביש: 'הכביש הגבוה ביותר בצפון אמריקה' – לאימות).");
}

// ---------- 32. Bear Lake corridor ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "אזור Bear Lake: מסלולים מרכזיים");
  table(s, ["מסלול", "מרחק (כיוון אחד)", "הפרש גובה (מ-Bear Lake)", "הערה"], [
    ["Bear Lake Loop", "0.6 mi", "71 רגל", "הקל ביותר, מתאים לכל המשפחה"],
    ["Nymph Lake", "0.5 mi", "231 רגל", "אגם יער קטן, נוח לפתיחה"],
    ["Dream Lake", "1.1 mi", "474 רגל", "אגם עם רכסים בצד"],
    ["Emerald Lake", "1.7 mi", "771 רגל", "שיא נוף לחלק הזה של השביל"],
    ["Mills Lake", "2.8 mi", "727 רגל", "מסלול ארוך יותר, מתאים לחלק מהמשפחה"],
    ["Flattop Mountain", "4.2 mi", "2,866 רגל", "מאתגר: לפני המעבר, מזג אוויר"],
  ], { y: 1.3, colW: [2.2, 1.8, 2.3, 2.7], fontSize: 12, rowH: 0.5 });
  foot(s, "מקור: NPS, Exploring the Bear Lake Road Corridor (טבלת מרחקים והפרשי גובה). מרחקים לכיוון אחד; ההליכה הלוך ושוב כפולה. Alberta Falls לא נכלל בטבלה ולכן לא מופיע כאן [לאימות].");
}

// ---------- 33. Lakes & falls RMNP ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "אגמים ונחלים: מה רואים בכל אחד");
  card(s, 0.5, 1.3, 2.85, 2.5, "Dream Lake", "אגם קרחוני בתוך מעגל ההרים. המסלול אליו הוא אחד הנוחים והמוכרים ביותר בפארק.", { headSize: 15 });
  card(s, 3.575, 1.3, 2.85, 2.5, "Emerald Lake", "אגם תלוי מעל Dream Lake, עם נוף לרכסים. מסלול ארוך יותר שדורש כושר בסיסי.", { headSize: 15 });
  card(s, 6.65, 1.3, 2.85, 2.5, "Alberta Falls", "מפל שניתן להגיע אליו בשביל קצר ומתון. זמנים ומרחקים מדויקים טרם נאספו [לאימות].", { headSize: 15 });
  s.addText("Mills Lake, Odessa Lake ו-Bierstadt Lake הם יעדים נוספים, עם מרחקים והפרשי גובה מטבלת NPS (ראו שקופית קודמת). ההבדל בין שביל משפחתי לשביל ארוך ברור מהמספרים.", {
    x: 0.5, y: 4.0, w: 9, h: 0.9, fontFace: FONT_B, fontSize: 13, color: C.ink, align: "right", rtlMode: true, valign: "top", margin: 0, isTextBox: true,
  });
  foot(s, "מקורות: NPS (Bear Lake Road Corridor), alltrails.com. תיאורי האגמים כלליים; מידע על מפלים נוספים לא נבדק [לאימות].");
}

// ---------- 34. Wildlife RMNP ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "בעלי חיים ב-RMNP: איפה מחפשים");
  const animals = [
    ["Elk (אייל)", "מדשאות של Moraine Park ולאורך כבישים. נראים לעיתים קרובות בשעות הערב."],
    ["Moose (איילה)", "ביצות ואזורי נחלים. הם גדולים ויכולים להיות מסוכנים כשהם מוגנים על ידי צאצאים."],
    ["Bighorn Sheep (כבש הרים)", "מדרונות סלע בגבהים. נראים בעיקר בבוקר או בערב."],
    ["Marmots (מרמוטה)", "סלעים וטונדרה. נמצאים ליד השבילים בגבהים."],
    ["Pikas (פיקה)", "שדות סלע בטונדרה. קטנה ומשמיעה קול. לא לגעת ולא להאכיל."],
  ];
  animals.forEach(([name, body], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    card(s, 0.5 + col * 3.075, 1.3 + row * 1.95, 2.85, 1.75, name, body, { headSize: 14, bodySize: 11.5 });
  });
  foot(s, "מקור: NPS (Wildlife), ידע כללי על התנהגות החיות. מרחק בטוח מחיות בר הוא לפי הוראות NPS: לפחות 23 מטר מאיילה וממינים גדולים אחרים [לאימות].");
}

// ---------- 35. RMNP day plan ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "תוכנית RMNP: 6 ימים");
  table(s, ["יום", "מיקוד", "מרחק", "הפרש גובה", "קושי", "מה מיוחד"], [
    ["1", "הגעה, Moraine Park וצפייה בחיות בערב", "[לאימות]", "[לאימות]", "קל", "אייל על המדשאה"],
    ["2", "Bear Lake · Nymph & Dream Lake", "0.5–1.1 mi לכיוון אחד", "231–474 רגל", "קל–בינוני", "נוף אגמים קלאסי"],
    ["3", "Emerald Lake · Alberta Falls", "1.7 mi לכיוון אחד", "771 רגל", "בינוני", "שביל משפחתי עם נוף"],
    ["4", "Mills Lake", "2.8 mi לכיוון אחד", "727 רגל", "בינוני", "אגם בתוך רכס"],
    ["5", "Trail Ridge Road · Alpine Visitor Center", "~8 mi טונדרה (כביש)", "עד 12,183 רגל", "נסיעה + הליכות קצרות", "טונדרה, פיקה, מרמוטה"],
    ["6", "Wild Basin או יום חיץ", "[לאימות]", "[לאימות]", "[לאימות]", "אזור דרום-מערב, לאימות"],
  ], { y: 1.25, colW: [0.5, 2.9, 1.9, 1.5, 1.2, 1.0], fontSize: 10.5, rowH: 0.48 });
  foot(s, "מרחקים לכיוון אחד (NPS). Trail Ridge: rockymountainnationalpark.com. Wild Basin ו-Moraine Park לא נבדקו [לאימות].");
}

// ---------- 36. Comparison ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "השוואה בין שלושת האזורים");
  table(s, ["מאפיין", "Colorado Springs", "San Juan", "RMNP"], [
    ["סוג נוף", "קניונים, צוקים, שולי הרים", "רכסים געשיים וקרחונים", "רכס קונטיננטלי ויער-טונדרה"],
    ["פסגה מרכזית", "Pikes Peak 14,115", "Ice Lake נקודה מרבית 12,260", "Trail Ridge 12,183"],
    ["יערות", "פונדרוסה, דאגלס", "אשוחית, אשוח, אספן", "דאגלס, אשוחית, לודג'פול"],
    ["אגמים", "מועט", "Ice Lake, Blue Lakes", "Dream, Emerald, Mills"],
    ["מפלים ונחלים", "Helen Hunt Falls, נחלים", "נחלים אלפיניים", "Alberta Falls, נחלי הרכס"],
    ["פרחי בר", "נמוך בערך", "שיא באוגוסט", "שיא באוגוסט בגבהים"],
    ["בעלי חיים", "יונקים קטנים, ציפורים", "אייל, מרמוטה, פיקה", "אייל, איילה, כבש הרים, פיקה"],
    ["פראיות ובידוד", "נמוך", "גבוה", "בינוני (יעדים פופולריים)"],
    ["צפיפות מטיילים", "גבוהה", "נמוכה–בינונית", "גבוהה מאוד (בעיקר בקיץ)"],
    ["מסלולים קלים/מאתגרים", "קלים ובינוניים", "בינוני עד מאתגר", "שילוב, כולל קלים"],
    ["סיכוי לשלג באוגוסט", "נמוך מאוד", "נמוך (גבוה מאוד)", "נמוך (בגבהים גבוהים)"],
  ], { y: 1.2, colW: [2.1, 2.3, 2.3, 2.3], fontSize: 10.5, rowH: 0.34 });
  foot(s, "ההשוואה מבוססת על הנתונים שנבדקו במצגת. סעיפי הפראיות, הצפיפות וסיכוי השלג הם הערכה איכותית בלבד [לאימות].");
}

// ---------- 37. What only each region offers ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "מה אי אפשר למצוא באזור אחר");
  card(s, 0.5, 1.3, 2.85, 3.5, "Colorado Springs", "צוקי סלע אדום מול הרי הרוקי, עם גישה מהירה לפסגה של 14,115 רגל דרך כביש.", { headColor: C.rock });
  card(s, 3.575, 1.3, 2.85, 3.5, "San Juan", "נוף געשי-קרחוני רחוק ומבודד. אגמים בגבהים גבוהים ו-Million Dollar Highway שמחבר עיירות היסטוריות.", { headColor: C.lake });
  card(s, 6.65, 1.3, 2.85, 3.5, "RMNP", "כביש שחוצה טונדרה בגובה 12,183 רגל, שלוש מערכות אקולוגיות במרחק קצר, וחיות בר שניתן לראות מהכביש.", { headColor: C.forest });
  foot(s, "מקורות: ראו שקופיות האזורים. ההשוואה איכותית ואינה מדד מדעי.");
}

// ---------- 38. Route & visit order ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "מפת הביקור וסדר האזורים");
  drawMap(s, true);
  // Numbered stops
  const cs = P(-104.82, 38.83), sj = P(-107.67, 37.95), rm = P(-105.6, 40.33);
  [[cs, "1"], [sj, "2"], [rm, "3"]].forEach(([pt, n]) => {
    s.addShape(pres.shapes.OVAL, { x: pt.x + 0.12, y: pt.y - 0.42, w: 0.3, h: 0.3, fill: { color: C.dark }, line: { color: C.white, width: 1 } });
    s.addText(n, { x: pt.x + 0.12, y: pt.y - 0.42, w: 0.3, h: 0.3, fontFace: FONT_H, fontSize: 12, bold: true, color: C.white, align: "center", valign: "middle", margin: 0, isTextBox: true });
  });
  s.addText([
    { text: "1. Colorado Springs (4 ימים)", options: { breakLine: true } },
    { text: "2. San Juan Mountains (5 ימים)", options: { breakLine: true } },
    { text: "3. Rocky Mountain NP (5–6 ימים)", options: { breakLine: true } },
    { text: "הסדר מוצע: מדרום לדרום-מערב ואז לצפון, כדי לחסוך נסיעה חוזרת. מומלץ לאמת זמני נסיעה ב-Google Maps לפני הזמנת לינה.", options: { fontSize: 12, italic: true, color: C.muted } },
  ], { x: 6.55, y: 1.5, w: 3.0, h: 3.2, fontFace: FONT_B, fontSize: 14, color: C.ink, align: "right", rtlMode: true, valign: "top", margin: 0, isTextBox: true, paraSpaceAfter: 10 });
  foot(s, "מפה סכמטית. זמני הנסיעה בין האזורים לא נאספו במחקר זה [לאימות]. הסדר הוא הצעה ולא החלטה סופית.");
}

// ---------- 39. Overall trip table ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "לוח הטיול הכולל: 14–18 ימים");
  table(s, ["שלב", "ימים", "אזור", "מוקד הביקור"], [
    ["1", "4", "Colorado Springs", "Garden of the Gods, North Cheyenne Cañon, Pikes Peak"],
    ["מעבר", "1", "נסיעה", "נסיעה דרום-מערב, כולל מזג אוויר ותחנות"],
    ["2", "5", "San Juan Mountains", "Million Dollar Highway, Ice Lake, Blue Lakes, Ouray"],
    ["מעבר", "1", "נסיעה", "בדיקת מזג אוויר והתארגנות"],
    ["3", "5–6", "Rocky Mountain NP", "Bear Lake, Trail Ridge Road, אגמים ומפלים, חיות בר"],
    ["חיץ", "0–1", "מילואים", "לשינויי מזג אוויר, סגירה או עייפות"],
  ], { y: 1.3, colW: [1.0, 1.0, 2.6, 4.4], fontSize: 13, rowH: 0.52 });
  foot(s, "סה\"כ: 4 + 5 + 5–6 + מעברים וחיץ = 14–18 ימים, בהתאם למשך ההתחלתי של כל אזור. מעברים כלולים בטווח כפי שנדרש.");
}

// ---------- 40. Weather August ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "מזג אוויר טיפוסי באוגוסט");
  stat(s, 0.5, 1.3, 2.1, 1.5, "צהריים", "סופות רעמים: שיא סיכון [כללי]", C.rock);
  stat(s, 2.75, 1.3, 2.1, 1.5, "בוקר", "הכי נוח להליכה ולפסגה [כללי]", C.forest);
  stat(s, 5.0, 1.3, 2.1, 1.5, "בגבהים", "טמפרטורה קרה גם באוגוסט [כללי]", C.lake);
  stat(s, 7.25, 1.3, 2.25, 1.5, "שלג", "אפשרי בגבהים, לא מובטח [כללי]", C.granite);
  bullets(s, [
    "כלל אצבע: לצאת לפני 8:00 בבוקר, ולרדת מהרכסים לפני 13:00–14:00 בזמן סופה מאוחרת.",
    "שכבות בגדים: בגד קל לגשם, מעיל רוח, שכבה מחממת, ותמיד בקבוק מים וכובע.",
  ], { y: 3.1, h: 1.6, fontSize: 14 });
  foot(s, "הערכים הם דפוסים כלליים של מזג האוויר בקולורדו, לא תחזית לתאריך מסוים. לפני היציאה יש לבדוק NWS/NOAA ולעקוב אחרי התחזית לאזור הספציפי.");
}

// ---------- 41. Hazards ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "סכנות טבעיות ואיך מתמודדים");
  const hz = [
    ["סופות רעמים וברקים", "הסכנה הגדולה ביותר אחר הצהריים. ברק יכול להכות על רכס פתוח. יורדים מהגובה ומחפשים מחסה במקום נמוך ויערני."],
    ["מחלת גבהים", "כאב ראש, בחילה, עייפות וקוצר נשימה. הפתרון: ירידה מיידית, ולא טיפוס נוסף."],
    ["היפותרמיה", "קור ורטיבות יחד, במיוחד אחרי גשם או סופה. בגדי שכבות וכיסוי רוח הם הגנה בסיסית."],
    ["חיות בר", "אייל, איילה ודובים שחורים. שומרים מרחק, לא מאכילים ולא מתקרבים לגורים."],
    ["שינויי מזג אוויר", "מזג אוויר בהרים משתנה מהר. תחזית טובה בבוקר לא מבטיחה אחר הצהריים."],
    ["כבישים הרריים", "מדרונות תלולים, מעברים גבוהים ומזג אוויר גרוע. נסיעה בזהירות ובשעות אור."],
  ];
  hz.forEach(([h, b], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    card(s, 0.5 + col * 3.075, 1.3 + row * 1.9, 2.85, 1.75, h, b, { headSize: 13.5, bodySize: 11, headColor: C.rock });
  });
  foot(s, "מקורות: NPS (Safety), Colorado Parks and Wildlife, NOAA. המלצות כלליות; ייעוץ רפואי אישי לפני הטיול מומלץ.");
}

// ---------- 42. Safety & gear ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "כללי בטיחות וציוד בסיסי");
  card(s, 0.5, 1.3, 4.35, 3.6, "כללי בטיחות", "• להודיע למישהו על תוכנית ההליכה\n• לצאת מוקדם, ולהחזיר את הקבוצה לפי זמן\n• לשתות הרבה מים ולאכול בקביעות\n• לא לטפס לפסגה אחרי 12:00 בימים עם סופה\n• לזהות סימני מחלת גבהים בילדים ובמבוגרים\n• לא להסתובב מחוץ לשבילים בטונדרה", { headSize: 15, bodySize: 12.5 });
  card(s, 5.15, 1.3, 4.35, 3.6, "ציוד בסיסי", "• נעלי הליכה עם אחיזה טובה\n• מעיל רוח ומעיל גשם קל\n• שכבה מחממת וכובע\n• משקפי שמש, קרם הגנה SPF גבוה\n• פנס ראש וסוללה נוספת\n• ערכת עזרה ראשונה וחומר לגבהים\n• מפה פיזית או אפליקציה שעובדת בלי אינטרנט", { headSize: 15, bodySize: 12.5 });
  foot(s, "מקורות: NPS (Hiking Safety), USFS (San Juan). רשימה כללית שאינה מחליפה תכנון אישי לפי מסלול ומשתתפים.");
}

// ---------- 43. Photography tips ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "טיפים לצילום טבע ונוף");
  bullets(s, [
    "שעת הזהב: זריחה ושקיעה נותנים אור רך. באזורי הרכס אפשר לצלם גם לפני עלות השמש ואחריה.",
    "צילום בגובה: לעבוד עם פולרייזר (משקף קיטוב) על מים ועננים, ולבדוק את האור לפני שמתחילים.",
    "פרחים ובעלי חיים: לעבוד עם עדשת זום ולשמור מרחק. בעלי חיים בטבע הם מרוחקים ומשתנים כל רגע.",
    "צילום מכביש: לא לעצור על כביש צר. להשתמש בחניונים מסודרים בלבד.",
  ], { y: 1.3, h: 3.5, fontSize: 15 });
  foot(s, "טיפים כלליים לצילום נוף וטבע. כללי חניה וצילום בשמורות NPS מפורטים באתר הפארק.");
}

// ---------- 44. Sources ----------
{
  const s = pres.addSlide();
  s.background = { color: C.snow };
  title(s, "מקורות רשמיים להמשך תכנון");
  table(s, ["מקור", "למה לבדוק", "קישור"], [
    ["National Park Service (RMNP)", "Timed Entry, Bear Lake Road, סגירות שבילים", "nps.gov/romo"],
    ["USDA Forest Service (San Juan NF)", "שבילי Ice Lake ו-Blue Lakes, תנאי שטח", "fs.usda.gov/sanjuan"],
    ["Colorado Parks & Wildlife", "בעלי חיים, כללי ציד וגישה", "cpw.state.co.us"],
    ["CDOT (cotrip.org)", "מצב כבישים: US 550, Trail Ridge", "cotrip.org"],
    ["NOAA / NWS", "תחזית ומזג אוויר באזור", "weather.gov"],
    ["Pikes Peak – America's Mountain", "תעריפים, שעות, הזמנות", "drivepikespeak.com"],
  ], { y: 1.3, colW: [3.2, 3.8, 2.0], fontSize: 12, rowH: 0.52 });
  foot(s, "קישורים מוצגים בשמם הכללי; יש לוודא כתובת מלאה במקור לפני שימוש.");
}

// ---------- 45. Next steps ----------
{
  const s = bgSlide(C.dark);
  s.addText("השלבים הבאים לפני הטיול", { x: 0.5, y: 0.4, w: 9, h: 0.8, fontFace: FONT_H, fontSize: 32, bold: true, color: C.white, align: "right", rtlMode: true, margin: 0, isTextBox: true });
  bullets(s, [
    "לאמת את כל הערכים המסומנים [לאימות] במקור הרשמי (מרחקים, הפרשי גובה, זמני הליכה).",
    "לבדוק את סטטוס US 550 (Million Dollar Highway) ב-CDOT לפני הנסיעה.",
    "לבדוק כללי כניסה ל-RMNP לשנה של הטיול: Timed Entry, Bear Lake Road ומועדי הזמנה.",
    "לחשב זמני נסיעה בין האזורים ולקבוע את סדר הביקור הסופי.",
    "להשלים תכנון יום 4 בקולורדו ויום 4–5 ב-San Juan ויום 6 ב-RMNP.",
  ], { x: 0.5, y: 1.4, w: 9, h: 3.4, fontSize: 15, color: C.white });
  s.addText("[תמונה לשילוב בסיום: נוף רחב של הרי הרוקי עם השמש שוקעת, צילום אמיתי]", { x: 0.5, y: 4.7, w: 9, h: 0.4, fontFace: FONT_B, fontSize: 11, italic: true, color: "C9D6CE", align: "right", rtlMode: true, margin: 0, isTextBox: true });
}

const out = path.join(__dirname, "..", "Colorado_Wilderness_Expedition.pptx");
pres.writeFile({ fileName: out }).then((f) => console.log("written", f));

// "איפה למצוא אותו": תמונת בית הגידול של מין, לפי תיאור בית הגידול ב"צמחיית ישראל וסביבתה",
// חגורות הצומח ואזורי התפוצה. זה מידע כללי מהמקור, לא מדידה בשטח.
import { ZONES, REGIONS } from '../data/regions.js';

const RULES = [
  // [ביטוי, קבוצה, טקסט, אייקון]
  [/חול(?!-)|חוליי|שדות חול|דיונ/, 'soil', 'חול', 'sand'],
  [/חמרה/, 'soil', 'חמרה (חול עם חרסית)', 'sand'],
  [/כורכר/, 'rock', 'כורכר (חול מסולע)', 'rock'],
  [/לס/, 'soil', 'לס – אדמת אבק עמוקה', 'soil'],
  [/רנדזינה/, 'soil', 'רנדזינה – אדמה כהה על קירטון', 'soil'],
  [/גירני|גיר|קירטון|דולומיט/, 'rock', 'סלע גירני / קירטון', 'rock'],
  [/בזלת/, 'rock', 'בזלת', 'rock'],
  [/סלעי|סלעים|אבני|אבניים|מצוק|נקיק|מחשופ/, 'rock', 'סלעים ואבנים', 'rock'],
  [/כבדות|חרסית|חרסיתי/, 'soil', 'קרקע כבדה (חרסית)', 'soil'],
  [/רקבובית|עשירה/, 'soil', 'קרקע עשירה בחומר אורגני', 'soil'],
  [/מוצפות|מוצפת|לחים|לחה|לח |בריכות|ביצ|נחל|שפת/, 'moisture', 'לח, מוצף בחורף', 'water'],
  [/מתייבש|מנוקז|יבש|מדבר|ערבות-שיחים/, 'moisture', 'יבש ומנוקז היטב', 'dry'],
  [/מוצל|חצי מוצל|בסיס עצים|נקיק/, 'light', 'צל או חצי צל', 'shade'],
  [/חורש|יער(?! נטוע)/, 'light', 'צל חלקי תחת העצים', 'shade'],
  [/מוארות|שטופי שמש|פתוח|בתות|ערבות|מדבר|חול/, 'light', 'שמש מלאה, שטח פתוח', 'sun'],
];
const COMPANIONS = [
  [/רותם/, 'plants', 'רותם המדבר'], [/אלון/, 'trees', 'אלון מצוי'], [/אלה|אטלנטית/, 'trees', 'אלה אטלנטית'], [/אורן/, 'trees', 'אורן'],
  [/חרוב/, 'trees', 'חרוב'], [/ער|עצי ער|ערער/, 'trees', 'ער'], [/קידה|סירה|קורנית|אשבל|ינבוט|שיח/, 'plants', 'שיחי בתה'],
  [/תבואה|שדות/, 'plants', 'שדות תבואה ושולי שדות'],
];
// תבניות כלליות לפי סוג בית גידול בתיאור
const TYPES = [
  [/בתות טרגקנטיות/, 'בתה הררית גבוהה (טרגקנטית): שיחיות נמוכות, עגולות וקוצניות בגובה רב', 'rock'],
  [/בתות|בתה/, 'בתה: צמחייה נמוכה של שיחיות ועשבוניים בשטח פתוח', 'rock'],
  [/ערבות-שיחים|ערבה|למחצה/, 'ערבת שיחים של מדבר למחצה: מרחבים פתוחים וגשם מועט', 'dry'],
  [/חולות|חול/, 'חולות: דיונות ושדות חול מיוצבים', 'sand'],
  [/חורש/, 'חורש או יער ים-תיכוני: עצים ושיחים גבוהים', 'shade'],
  [/מדבר/, 'מדבר: ואדיות, מדרונות סלעיים ושטחי חצץ', 'dry'],
];

/** מחזיר קבוצות של תכונות בית הגידול למין */
export function habitatBaseline(sp) {
  const h = sp.h || '';
  const out = { soil: [], rock: [], light: [], moisture: [], plants: [], trees: [] };
  const seen = new Set();
  for (const [re, key, text, icon] of RULES) {
    if (re.test(h) && !seen.has(text)) { seen.add(text); out[key].push({ text, icon }); }
  }
  for (const [re, key, text] of COMPANIONS) {
    if (re.test(h) && !seen.has(text)) { seen.add(text); out[key].push({ text, icon: key === 'trees' ? 'tree' : 'plants' }); }
  }
  // אור ולחות: אם סותרים (שמש ומוצל) משאירים את הראשון הספציפי
  if (out.light.length > 1) out.light = out.light.filter((x) => x.icon === 'shade').length ? out.light.filter((x) => x.icon === 'shade') : out.light.slice(0, 1);
  if (out.moisture.length > 1) out.moisture = out.moisture.slice(0, 1);
  const types = TYPES.filter(([re]) => re.test(h)).slice(0, 2).map(([, text, icon]) => ({ text, icon }));
  const zones = [...(sp.z || '')].map((z) => ZONES[z]).filter(Boolean);
  const top = Object.entries(sp.r || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => REGIONS.find((r) => r.code === c)).filter(Boolean);
  return { ...out, types, zones, regions: top, empty: !h };
}

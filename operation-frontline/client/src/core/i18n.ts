// Interface language (English / Hebrew). Every UI string is written in English in the
// code and passed through t(); Hebrew is looked up here. Unknown strings stay English.
// Proper names (weapon names, callsigns, map name) are intentionally not translated.
export type Lang = 'en' | 'he';

const KEY = 'frontline.lang.v1';
let current: Lang = 'en';
try { const v = localStorage.getItem(KEY); if (v === 'he' || v === 'en') current = v; } catch { /* storage unavailable */ }

export const getLang = (): Lang => current;
export function setLang(l: Lang): void { current = l; try { localStorage.setItem(KEY, l); } catch { /* ignore */ } }

export function applyDocumentLang(): void {
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'he' ? 'rtl' : 'ltr';
}

const HE: Record<string, string> = {
  // ---- navigation / generic
  PLAY: 'משחק', MULTIPLAYER: 'מרובה משתתפים', TRAINING: 'אימון', LOADOUT: 'ציוד', CLASSES: 'מחלקות', SETTINGS: 'הגדרות', PROFILE: 'פרופיל', CREDITS: 'קרדיטים',
  DEPLOY: 'פריסה', 'Choose how you want to fight.': 'בחרו איך אתם רוצים להילחם.',
  'QUICK MATCH': 'משחק מהיר', 'FIND MATCH ▸': 'חפש משחק ◂', 'START TRAINING ▸': 'התחל אימון ◂', 'START TRAINING': 'התחל אימון',
  'Join a public 8v8 Conquest match. Bots hold the line until more players arrive.': 'הצטרפו למשחק כיבוש ציבורי 8 מול 8. בוטים ממלאים את השורות עד שיגיעו שחקנים נוספים.',
  'Fight AI soldiers offline. Practise weapons, movement and capturing objectives.': 'הילחמו בחיילי בינה מלאכותית ללא חיבור לרשת. תרגלו נשקים, תנועה וכיבוש יעדים.',
  CALLSIGN: 'כינוי', CLASS: 'מחלקה', PRIMARY: 'נשק ראשי', RANK: 'דרגה', SIDEARM: 'אקדח',
  'KESTREL CROSSING — CONQUEST 8v8': 'צומת קסטרל — כיבוש 8 מול 8', 'v1.0 — PlayCanvas · Colyseus · TypeScript': 'גרסה 1.0',
  'Public matchmaking, room browser and private matches — up to 16 players.': 'משחק ציבורי, רשימת חדרים ומשחקים פרטיים — עד 16 שחקנים.',
  'Offline conquest against AI. No server connection required.': 'כיבוש לא מקוון נגד בינה מלאכותית. לא צריך שרת.',
  'Weapons and attachments for the selected class.': 'נשקים ואביזרים למחלקה שנבחרה.', 'Four roles, each with unique equipment.': 'ארבעה תפקידים, לכל אחד ציוד ייחודי.',
  'Video, controls, audio and mobile options.': 'וידאו, שליטה, שמע ואפשרויות מובייל.', 'Service record stored on this device.': 'תיק השירות שלך, נשמר במכשיר הזה.',
  'Technology and asset sources.': 'טכנולוגיה ומקורות נכסים.',
  // ---- lobby
  'CREATE PRIVATE MATCH': 'צור משחק פרטי', 'JOIN WITH CODE': 'הצטרף עם קוד', REFRESH: 'רענן', JOIN: 'הצטרף', FULL: 'מלא', SERVER: 'שרת', 'ROOM CODE': 'קוד חדר',
  ROOM: 'חדר', MAP: 'מפה', PLAYERS: 'שחקנים', TEAMS: 'קבוצות', STATUS: 'מצב', 'Contacting server…': 'מתחבר לשרת…',
  'No public rooms yet — Quick Match creates one.': 'אין חדרים ציבוריים עדיין — משחק מהיר ייצור אחד.',
  'Server address (blank = default)': 'כתובת שרת (ריק = ברירת מחדל)', WARMUP: 'חימום', LIVE: 'פעיל', ENDED: 'הסתיים',
  // ---- training
  'ENEMY DIFFICULTY': 'קושי האויב', 'ENEMY SOLDIERS': 'חיילי אויב', 'FRIENDLY SOLDIERS': 'חיילים ידידותיים', TICKETS: 'כרטיסים', 'TIME OF DAY': 'שעת היום',
  'Overcast Day': 'יום מעונן', 'Dusk Assault': 'מתקפת בין ערביים', VEHICLES: 'רכבים', On: 'פועל', Off: 'כבוי',
  Recruit: 'טירון', Regular: 'רגיל', Veteran: 'ותיק', Elite: 'עילית',
  'Tip: set enemy soldiers to 1 and difficulty to Recruit for a relaxed firing range, or 8 Elite for a full battle.': 'טיפ: חייל אויב אחד ברמת טירון נותן מטווח רגוע; 8 חיילי עילית נותנים קרב מלא.',
  // ---- loadout / classes
  'CLASS EQUIPMENT': 'ציוד מחלקה', DAMAGE: 'נזק', 'FIRE RATE': 'קצב אש', RANGE: 'טווח', ACCURACY: 'דיוק', CONTROL: 'שליטה', HANDLING: 'תפעול', MOBILITY: 'ניידות',
  'SELECTED': 'נבחר', 'SELECT ▸': 'בחר ◂', Optic: 'כוונת', Muzzle: 'לוע', Underbarrel: 'אחיזה תחתונה', Magazine: 'מחסנית', Barrel: 'קנה',
  Assault: 'סער', Engineer: 'הנדסה', Support: 'סיוע', Recon: 'סיור',
  'Frontline Combat': 'לחימה בקו הראשון', 'Vehicles & Anti-Armor': 'רכבים ונגד שריון', 'Sustained Fire & Resupply': 'אש מתמשכת ואספקה', 'Long Range & Intel': 'טווח ארוך ומודיעין',
  'Leads the push. Assault rifles, self-sustain and smoke to break into objectives.': 'מוביל את ההתקפה. רובי סער, החלמה עצמית ומסך עשן לפריצה ליעדים.',
  'Keeps friendly armour alive and enemy armour burning. Carbines and SMGs.': 'שומר על השריון שלנו ומשמיד את של האויב. קרבינות ותתי-מקלעים.',
  'Anchors the squad with machine gun fire, ammunition and medical crates.': 'עוגן הצוות: אש מקלע, תחמושת וארגזי רפואה.',
  'Controls sightlines and feeds the team intel with sensors and spotting.': 'שולט בקווי ראייה ומספק לצוות מודיעין בעזרת חיישנים וזיהוי.',
  'Breacher — captures objectives 15% faster and regenerates health sooner.': 'פורץ — כובש יעדים מהר ב-15% ומתחיל להחלים מוקדם יותר.',
  'Mechanic — takes 25% less explosive damage.': 'מכונאי — סופג 25% פחות נזק מפיצוצים.',
  'Quartermaster — carries extra reserve ammunition.': 'אפסנאי — נושא תחמושת רזרבית נוספת.',
  'Spotter — enemies you aim at through a scope are marked for your team.': 'מכוון — אויבים שאתם מכוונים אליהם דרך כוונת מסומנים לכל הצוות.',
  'Combat Stim': 'זריקת קרב', 'Smoke Grenade': 'רימון עשן', 'RPG-9 Launcher': 'משגר RPG-9', 'Repair Torch': 'לפיד תיקון', 'Ammo Crate': 'ארגז תחמושת', 'Medical Crate': 'ארגז רפואה', 'Motion Sensor': 'חיישן תנועה',
  'Inject to restore 75 health over 3 seconds and refill tactical sprint.': 'מחלים 75 חיים תוך 3 שניות ומטעין את הריצה הטקטית.',
  'Thick smoke screen that blocks line of sight for 14 seconds.': 'מסך עשן סמיך החוסם קו ראייה למשך 14 שניות.',
  'Unguided anti-vehicle rocket. Lethal splash against infantry.': 'רקטה לא מונחית נגד רכבים. פיצוץ קטלני גם נגד חיילים.',
  'Hold to repair friendly vehicles or damage enemy ones up close.': 'החזיקו כדי לתקן רכבים ידידותיים או לפגוע באויב מקרוב.',
  'Deploy a crate that resupplies ammunition and gadgets to nearby allies.': 'פורס ארגז שמספק תחמושת וציוד לחברים קרובים.',
  'Deploy a crate that heals nearby allies.': 'פורס ארגז שמרפא חברים קרובים.',
  'Throwable sensor that reveals enemies within 22 m on the team minimap.': 'חיישן להטלה שחושף אויבים עד 22 מטר במפה של הצוות.',
  'Frag Grenade': 'רימון רסס', 'Thrown explosive with a 2.8 second fuse.': 'חומר נפץ להטלה עם פתיל של 2.8 שניות.',
  // ---- weapons
  'Balanced 5.56 assault rifle. Reliable at every range.': 'רובה סער 5.56 מאוזן. אמין בכל טווח.',
  'Hard-hitting 7.62 battle rifle. Slower fire rate, heavier recoil.': 'רובה קרב 7.62 חזק. קצב אש איטי יותר ורתע כבד.',
  'Compact carbine. Snappy handling for crews and close quarters.': 'קרבינה קומפקטית. תגובתית ומושלמת ללחימה מקרוב.',
  '9mm submachine gun. Devastating up close, excellent hip fire.': 'תת-מקלע 9 מ"מ. הרסני מקרוב, מצוין לירי מהמותן.',
  'Belt-fed light machine gun. Sustained suppressive fire; steadier when crouched.': 'מקלע קל עם רצועה. אש מדכאת מתמשכת; יציב יותר בכריעה.',
  'Bolt-action 7.62 rifle. One shot to the head at any range.': 'רובה צלפים 7.62 עם ידית. ירייה אחת לראש מכל טווח.',
  'Semi-automatic sidearm. Fast draw, always dependable.': 'אקדח חצי אוטומטי. שליפה מהירה ואמין תמיד.',
  'Iron Sights': 'כוונת מתכתית', 'Factory sights. Fastest handling.': 'כוונת מהמפעל. התפעול המהיר ביותר.', 'RX-1 Red Dot': 'נקודה אדומה RX-1', '1x reflex sight with a clean sight picture.': 'כוונת רפלקס 1x עם תמונה נקייה.',
  'HX Holographic': 'הולוגרפית HX', '1.5x holographic sight for mid-range fights.': 'כוונת הולוגרפית 1.5x לטווח בינוני.', 'TA-4 Combat Scope': 'כוונת קרב TA-4', '4x magnified optic. Slower to aim.': 'כוונת מגדילה 4x. איטית יותר לכיוון.',
  'LR-8 Marksman Scope': 'כוונת צלף LR-8', '8x long-range scope.': 'כוונת 8x לטווח רחוק.', 'LR-12 Ballistic Scope': 'כוונת בליסטית LR-12', '12x extreme-range scope. Heavy.': 'כוונת 12x לטווח קיצוני. כבדה.',
  'No Muzzle Device': 'בלי התקן לוע', 'Standard crown.': 'סיום קנה רגיל.', 'Sound Suppressor': 'משתיק קול', 'Hides you from the minimap. Reduced range.': 'מסתיר אתכם מהמפה. טווח מופחת.',
  Compensator: 'מפצה רתע', 'Less vertical recoil, slightly wider hip fire.': 'פחות רתע אנכי, ירי מהמותן מעט רחב יותר.', 'Muzzle Brake': 'בולם לוע', 'Tames horizontal recoil.': 'מאלף את הרתע האופקי.',
  'No Grip': 'בלי אחיזה', 'Bare handguard.': 'מגן יד חשוף.', 'Vertical Grip': 'אחיזה אנכית', 'Improved recoil control. Slower ADS.': 'שליטה טובה ברתע. כיוון איטי יותר.',
  'Angled Grip': 'אחיזה משופעת', 'Faster ADS and weapon swap.': 'כיוון והחלפת נשק מהירים יותר.', 'Stubby Grip': 'אחיזה קצרה', 'Tighter hip fire and less bloom.': 'ירי מהמותן מדויק יותר ופחות פיזור.',
  'Standard Magazine': 'מחסנית רגילה', 'Factory magazine.': 'מחסנית מהמפעל.', 'Extended Magazine': 'מחסנית מוארכת', '+40% capacity. Slower reload and ADS.': '+40% קיבולת. טעינה וכיוון איטיים יותר.',
  'Quick-Pull Magazine': 'מחסנית מהירה', '25% faster reloads.': 'טעינה מהירה ב-25%.', 'Standard Barrel': 'קנה רגיל', 'Factory barrel.': 'קנה מהמפעל.',
  'Heavy Barrel': 'קנה כבד', 'Longer effective range, more weight.': 'טווח אפקטיבי ארוך יותר, יותר משקל.', 'CQB Barrel': 'קנה לחימה קרובה', 'Fast handling, shorter range.': 'תפעול מהיר, טווח קצר יותר.',
  // ---- settings
  OPTIC: 'כוונת', MUZZLE: 'לוע', UNDERBARREL: 'אחיזה תחתונה', MAGAZINE: 'מחסנית', BARREL: 'קנה', VIDEO: 'וידאו', CONTROLS: 'שליטה', AUDIO: 'שמע', MOBILE: 'מובייל', 'GRAPHICS QUALITY': 'איכות גרפיקה', RENDERER: 'מנוע רינדור', 'AUTO (WebGPU → WebGL 2)': 'אוטומטי (WebGPU ← WebGL 2)',
  'ADAPTIVE RESOLUTION': 'רזולוציה אדפטיבית', 'FIELD OF VIEW': 'שדה ראייה', 'SHOW FPS': 'הצג FPS', ON: 'פועל', OFF: 'כבוי',
  MINIMAL: 'מינימלי', LOW: 'נמוכה', MEDIUM: 'בינונית', HIGH: 'גבוהה', ULTRA: 'אולטרה',
  'Minimal: no shadows, tiny sky, shortest view distance — for weak phones and old laptops.': 'מינימלי: בלי צללים, שמיים קטנים, טווח ראייה קצר — לטלפונים חלשים ולמחשבים ישנים.',
  'Low: basic shadows, no post-processing.': 'נמוכה: צללים בסיסיים, בלי אפקטים.',
  'Medium: good shadows, bloom, local lights.': 'בינונית: צללים טובים, זוהר ותאורה מקומית.',
  'High: soft cascaded shadows, ambient occlusion, anti-aliasing.': 'גבוהה: צללים רכים, חסימת אור סביבתי והחלקת קצוות.',
  'Ultra: sharpest shadows, full-resolution effects, longest view distance.': 'אולטרה: הצללים החדים ביותר, אפקטים ברזולוציה מלאה וטווח ראייה מרבי.',
  'Quality controls shadows, ambient occlusion, bloom, anti-aliasing, particle density, light count and prop draw distance. Renderer changes apply after a reload.': 'האיכות קובעת צללים, חסימת אור, זוהר, החלקת קצוות, צפיפות חלקיקים, כמות אורות ומרחק ציור חפצים. שינוי מנוע הרינדור חל אחרי טעינה מחדש.',
  'MOUSE SENSITIVITY': 'רגישות עכבר', 'ADS SENSITIVITY': 'רגישות בכיוון', 'INVERT Y': 'היפוך ציר Y', 'TOGGLE CROUCH': 'כריעה בלחיצה (במקום החזקה)', 'TOGGLE AIM': 'כיוון בלחיצה (במקום החזקה)',
  'KEY BINDINGS': 'מיפוי מקשים', 'RESET BINDINGS': 'אפס מקשים', 'PRESS A KEY…': 'לחצו על מקש…', 'RESTORE DEFAULTS': 'שחזר ברירות מחדל',
  'Click a control, then press any keyboard key or mouse button to assign it. If the key is already used, the two controls swap. Esc cancels.': 'לחצו על פעולה ואז על כל מקש במקלדת או כפתור עכבר כדי להקצות אותו. אם המקש כבר בשימוש, שתי הפעולות מתחלפות. Esc מבטל.',
  'MASTER VOLUME': 'עוצמה כללית', EFFECTS: 'אפקטים', MUSIC: 'מוזיקה', 'TOUCH LOOK SENSITIVITY': 'רגישות מבט במגע', 'BUTTON SIZE': 'גודל כפתורים', 'LEFT-HANDED LAYOUT': 'פריסה לשמאליים', 'AUTO FIRE ON TARGET': 'ירי אוטומטי על מטרה',
  LANGUAGE: 'שפה', 'Move Forward': 'התקדמות', 'Move Back': 'נסיגה', 'Strafe Left': 'צעד שמאלה', 'Strafe Right': 'צעד ימינה', 'Jump / Vehicle Brake': 'קפיצה / בלם רכב', 'Crouch / Slide': 'כריעה / החלקה',
  Sprint: 'ריצה', 'Tactical Sprint': 'ריצה טקטית', Reload: 'טעינה', 'Interact / Enter Vehicle': 'פעולה / כניסה לרכב', 'Throw Grenade': 'זריקת רימון', 'Primary Weapon': 'נשק ראשי', Sidearm: 'אקדח',
  'Gadget 1': 'ציוד 1', 'Gadget 2': 'ציוד 2', Scoreboard: 'לוח תוצאות', 'Deploy Screen': 'מסך פריסה', 'Pause Menu': 'תפריט השהיה', Fire: 'ירי', 'Aim Down Sights': 'כיוון בכוונת',
  // ---- profile
  MATCHES: 'משחקים', WINS: 'ניצחונות', KILLS: 'הריגות', DEATHS: 'מוות', 'K/D': 'יחס הריגות/מוות', ASSISTS: 'סיוע', CAPTURES: 'כיבושים', HEADSHOTS: 'ירי לראש', 'BEST SCORE': 'ניקוד שיא', 'TIME PLAYED': 'זמן משחק',
  'XP unlocks weapon attachments. Progress is saved in this browser.': 'נקודות ניסיון פותחות אביזרים לנשקים. ההתקדמות נשמרת בדפדפן הזה.',
  'GAME': 'המשחק', TECHNOLOGY: 'טכנולוגיה', 'THIRD-PARTY ASSETS': 'נכסים של צד שלישי',
  // ---- ranks
  Private: 'טוראי', PRIVATE: 'טוראי', 'LANCE CORPORAL': 'רב-טוראי', CORPORAL: 'רב"ט', SERGEANT: 'סמל', 'STAFF SERGEANT': 'סמל ראשון', LIEUTENANT: 'סגן', CAPTAIN: 'סרן', MAJOR: 'רב-סרן', COLONEL: 'אלוף משנה', COMMANDER: 'מפקד', 'Lance Corporal': 'רב-טוראי', Corporal: 'רב"ט', Sergeant: 'סמל', 'Staff Sergeant': 'סמל ראשון', Lieutenant: 'סגן', Captain: 'סרן', Major: 'רב-סרן', Colonel: 'אלוף משנה', Commander: 'מפקד',
  // ---- deploy / pause / end
  DEPLOYMENT: 'פריסה', 'SWITCH TEAM': 'החלף קבוצה', LEAVE: 'עזוב', PAUSED: 'מושהה', RESUME: 'המשך', 'LOADOUT & SETTINGS': 'ציוד והגדרות', 'LEAVE MATCH': 'עזוב משחק', 'BACK TO BATTLE': 'חזרה לקרב',
  'RETURN TO MENU': 'חזרה לתפריט', 'FINAL SCOREBOARD': 'לוח תוצאות סופי', VICTORY: 'ניצחון', DEFEAT: 'תבוסה', DRAW: 'תיקו', 'XP EARNED': 'ניסיון שהושג', SCORE: 'ניקוד', PING: 'פינג',
  SOLDIER: 'חייל', K: 'ה', D: 'מ', A: 'ס', CAP: 'כבש', HQ: 'מפקדה', 'YOUR TEAM': 'הקבוצה שלכם', 'CONNECTING…': 'מתחבר…', 'LOADING ASSETS': 'טוען נכסים', 'BUILDING BATTLEFIELD': 'בונה את שדה הקרב', INITIALISING: 'מאתחל',
  VANGUARD: 'ואנגארד', IRONCLAD: 'איירונקלאד', NEUTRAL: 'ניטרלי',
  // ---- HUD
  'RELOADING': 'טוען', 'OUT OF AMMO': 'נגמרה התחמושת', 'CONNECTION LOST — RECONNECTING…': 'החיבור אבד — מתחבר מחדש…', 'EXIT VEHICLE': 'יציאה מהרכב', 'DRIVE LTV': 'נהג ברכב', 'RIDE LTV': 'נסע ברכב',
  'ENEMY DOWN': 'אויב נפל', HEADSHOT: 'ירי לראש', ASSIST: 'סיוע', 'OBJECTIVE DEFENDED': 'יעד הוגן', RESUPPLY: 'אספקה', 'TEAMMATE HEALED': 'חבר טופל', 'ENEMY SPOTTED': 'אויב זוהה', REPAIR: 'תיקון', 'VEHICLE DESTROYED': 'רכב הושמד',
  'FRIENDLY VEHICLE DESTROYED': 'רכב שלנו הושמד', 'ENEMY VEHICLE DESTROYED': 'רכב אויב הושמד', 'CONTESTED': 'במחלוקת', Frag: 'רימון', USE: 'פעולה', FIRE: 'ירי', AIM: 'כיוון', JUMP: 'קפיצה', CROUCH: 'כריעה', SPRINT: 'ריצה', RELOAD: 'טעינה', NADE: 'רימון', SWAP: 'החלפה',
  ASSAULT: 'סער', ENGINEER: 'הנדסה', SUPPORT: 'סיוע', RECON: 'סיור', KILLED: 'נהרגתם',
  'Misadventure': 'תאונה', 'Roadkill': 'דריסה', 'Explosion': 'פיצוץ', 'Vehicle Explosion': 'פיצוץ רכב',
  // ---- messages
  'Disconnected from server.': 'התנתקתם מהשרת.', 'Room is full.': 'החדר מלא.',
  'The server did not answer in time.': 'השרת לא ענה בזמן.',
};
// ranks collide with the English word "Private"; handled separately
const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^STARTS (\d+)$/, (m) => `מתחיל בעוד ${m[1]}`],
  [/^MATCH STARTS IN (\d+)$/, (m) => `המשחק מתחיל בעוד ${m[1]}`],
  [/^DEPLOY IN (\d+)$/, (m) => `פריסה בעוד ${m[1]}`],
  [/^NEXT MATCH IN (\d+)$/, (m) => `המשחק הבא בעוד ${m[1]}`],
  [/^CAPTURING ([A-C])$/, (m) => `כובש ${m[1]}`],
  [/^NEUTRALIZING ([A-C])$/, (m) => `מנטרל ${m[1]}`],
  [/^CONTESTED — ([A-C])$/, (m) => `במחלוקת — ${m[1]}`],
  [/^SECURED — ([A-C]) (.+)$/, (m) => `מאובטח — ${m[1]} ${T(m[2])}`],
  [/^WE CAPTURED ([A-C]) — (.+)$/, (m) => `כבשנו את ${m[1]} — ${T(m[2])}`],
  [/^ENEMY CAPTURED ([A-C]) — (.+)$/, (m) => `האויב כבש את ${m[1]} — ${T(m[2])}`],
  [/^WE LOST ([A-C]) — (.+)$/, (m) => `איבדנו את ${m[1]} — ${T(m[2])}`],
  [/^([A-C]) — (.+) NEUTRALIZED$/, (m) => `${m[1]} — ${T(m[2])} נוטרל`],
  [/^OBJECTIVE ([A-C]) CAPTURED$/, (m) => `יעד ${m[1]} נכבש`],
  [/^OBJECTIVE ([A-C]) NEUTRALIZED$/, (m) => `יעד ${m[1]} נוטרל`],
  [/^KILLED BY (.+)$/, (m) => `נהרגתם על ידי ${m[1]}`],
  [/^LOADING ASSETS (\d+)%$/, (m) => `טוען נכסים ${m[1]}%`],
  [/^LVL (\d+)$/, (m) => `רמה ${m[1]}`],
  [/^(.+) · LVL (\d+)$/, (m) => `${T(m[1])} · רמה ${m[2]}`],
  [/^(.+) — LEVEL (\d+)$/, (m) => `${T(m[1])} — רמה ${m[2]}`],
  [/^(\d+) FPS( .*)?$/, (m) => `${m[1]} FPS${m[2] ?? ''}`],
  [/^PRIVATE ROOM CODE: (\w+) — share it with your squad$/, (m) => `קוד חדר פרטי: ${m[1]} — שתפו עם החבורה`],
  [/^Could not join: (.*)$/, (m) => `לא ניתן להצטרף: ${m[1]}`],
  [/^Server unreachable: .*$/, () => 'השרת לא זמין. הפעילו אותו עם "npm run dev:server" או הגדירו כתובת שרת למטה.'],
  [/^Conquest #(\w+)$/, (m) => `כיבוש #${m[1]}`],
  [/^LTV\s+(\d+) KM\/H\s+ARMOR (\d+)%$/, (m) => `LTV  ${m[1]} קמ"ש   שריון ${m[2]}%`],
  [/^(\d+) \/ (\d+) XP$/, (m) => `${m[1]} / ${m[2]} נקודות ניסיון`],
  [/^(\d+) rounds · ([\d.]+)s reload · (\d+(?:\.\d+)?)x optic(.*)$/, (m) => `${m[1]} כדורים · טעינה ${m[2]} שנ' · כוונת ${m[3]}x${m[4] ? ' · מושתק' : ''}`],
  [/^(\d+)h (\d+)m$/, (m) => `${m[1]} שע' ${m[2]} דק'`],
  [/^(.+) ×(\d+)$/, (m) => `${T(m[1])} ×${m[2]}`],
  [/^(\d+) v (\d+) \(\+(\d+) AI\)$/, (m) => `${m[1]} נגד ${m[2]} (+${m[3]} בינה)`],
];
const RANKS_HE: Record<string, string> = { Recruit: 'טירון', Private: 'טוראי' };

function T(s: string): string { return t(s); }

const missing = new Set<string>();
(window as unknown as { __missing?: Set<string> }).__missing = missing;

/** Translate a UI string (identity in English or when no translation exists). */
export function t(s: string): string {
  if (current !== 'he' || !s) return s;
  const direct = HE[s];
  if (direct !== undefined && direct !== '') return direct;
  for (const [re, fn] of PATTERNS) { const m = re.exec(s); if (m) return fn(m); }
  const up = s.toUpperCase();
  if (up !== s && HE[up]) return HE[up];
  if (/[A-Za-z]{3}/.test(s)) missing.add(s);
  return s;
}

/** Rank names (the word "Private" is also used elsewhere, so ranks are looked up on their own). */
export function rankLabel(name: string): string {
  if (current !== 'he') return name;
  return RANKS_HE[name] ?? HE[name] ?? name;
}

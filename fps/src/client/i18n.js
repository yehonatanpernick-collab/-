// Menu language: English (default) or Hebrew. Choice is stored per browser.
// Switching reloads the page, because all menus are built once at boot.
const KEY = 'ih_lang';

export function getLang() {
  try { return localStorage.getItem(KEY) === 'he' ? 'he' : 'en'; } catch (e) { return 'en'; }
}
export function setLang(l) {
  try { localStorage.setItem(KEY, l === 'he' ? 'he' : 'en'); } catch (e) { /* storage unavailable */ }
}
export function applyDir(l) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'he' ? 'rtl' : 'ltr';
}

const S = {
  en: {
    callsign: 'CALLSIGN', quick: 'QUICK MATCH', quickSub: 'Instant action vs AI · offline',
    multi: 'MULTIPLAYER', multiSub: 'Join a dedicated server', players: 'PLAYERS', aiSkill: 'AI SKILL',
    recruit: 'RECRUIT', regular: 'REGULAR', veteran: 'VETERAN', settings: 'SETTINGS', controls: 'CONTROLS',
    lang: 'LANGUAGE · עברית',
    footer: 'Capture and hold objectives A–E. The team holding the majority drains enemy tickets. Walls, floors and whole buildings can be destroyed.',
    settingsTitle: 'SETTINGS', quality: 'Graphics quality', renderScale: 'Render scale', fov: 'Field of view',
    sens: 'Sensitivity', adsSens: 'Aim sensitivity', volume: 'Master volume', invert: 'Invert look',
    showFps: 'Show FPS', touchAim: 'Touch: aim while firing', server: 'Server address', serverPh: 'auto (this host)',
    done: 'DONE', paused: 'PAUSED', resume: 'RESUME', redeploy: 'REDEPLOY', redeploySub: 'Change class / spawn',
    quit: 'QUIT TO MENU', changeLang: 'Language',
    deploy: 'DEPLOY', redeployIn: 'REDEPLOY IN', roundOver: 'ROUND OVER', selectSpawn: 'select a spawn point on the map',
    atHq: 'at HQ', squadMate: 'SQUAD MATE', squad: 'SQUAD', hq: 'HQ', mapTitle: 'CONQUEST',
    victory: 'VICTORY', defeat: 'DEFEAT', winsSuffix: 'WINS', nextRound: 'Next round starting shortly…',
    yourScore: 'YOUR SCORE', kills: 'KILLS', deaths: 'DEATHS', revives: 'REVIVES',
    mvp: 'MVP', second: '2ND', third: '3RD', frag: 'Frag',
    ctlMove: 'move', ctlSprint: 'sprint', ctlJump: 'jump', ctlCrouch: 'crouch / slide while sprinting', ctlHoldCrouch: 'hold crouch',
    ctlFire: 'fire', ctlAim: 'aim', ctlReload: 'reload', ctlWeapons: 'weapons/gadget', ctlGrenade: 'grenade',
    ctlEnter: 'enter tank / hold to revive', ctlSpot: 'spot enemy', ctlScore: 'scoreboard', ctlMenu: 'menu',
    tankCtl: 'Tank:', tankDrive: 'drive', tankTurret: 'turret', tankFire: 'fire', tankZoom: 'zoom', tankCoax: 'coax MG', tankExit: 'exit',
    mobileCtl: 'Mobile: left thumb moves (push up to sprint), right side looks, ◉ fires (drag to aim while firing).',
    loadingWait: 'Loading',
    capture: 'Capture', enemyTeams: 'Teams',
    noServer: 'Run node server.js and open its address',
    serverFound: (j) => `${j.name} · ${j.humans} online · ${j.players}/${j.max} soldiers`,
    noServerHere: 'No server here · run `node server.js` to host one',
    startingMatch: 'Starting match…',
  },
  he: {
    callsign: 'שם קריאה', quick: 'משחק מהיר', quickSub: 'פעולה מיידית נגד בוטים · ללא חיבור',
    multi: 'רב-משתתפים', multiSub: 'הצטרפות לשרת ייעודי', players: 'שחקנים', aiSkill: 'רמת בוטים',
    recruit: 'טירון', regular: 'רגיל', veteran: 'ותיק', settings: 'הגדרות', controls: 'שליטה',
    lang: 'LANGUAGE · English',
    footer: 'כבשו והחזיקו את היעדים A–E. הקבוצה שמחזיקה ברוב היעדים מורידה כרטיסים מהיריבה. קירות, רצפות ובניינים שלמים ניתנים להריסה.',
    settingsTitle: 'הגדרות', quality: 'איכות גרפיקה', renderScale: 'קנה מידה לרינדור', fov: 'שדה ראייה',
    sens: 'רגישות', adsSens: 'רגישות כיוון', volume: 'עוצמת שמע כללית', invert: 'היפוך מבט',
    showFps: 'הצג FPS', touchAim: 'מגע: כיוון בזמן ירי', server: 'כתובת שרת', serverPh: 'אוטומטי (המארח הזה)',
    done: 'סיום', paused: 'הפסקה', resume: 'המשך', redeploy: 'פריסה מחדש', redeploySub: 'שינוי מחלקה / נקודת התחלה',
    quit: 'יציאה לתפריט', changeLang: 'שפה',
    deploy: 'פריסה', redeployIn: 'פריסה מחדש בעוד', roundOver: 'הסיבוב הסתיים', selectSpawn: 'בחרו נקודת התחלה על המפה',
    atHq: 'במפקדה', squadMate: 'חבר מחלקה', squad: 'מחלקה', hq: 'מפקדה', mapTitle: 'כיבוש',
    victory: 'ניצחון', defeat: 'תבוסה', winsSuffix: 'ניצחה', nextRound: 'הסיבוב הבא מתחיל בקרוב…',
    yourScore: 'הניקוד שלך', kills: 'הרג', deaths: 'מוות', revives: 'החייאות',
    mvp: 'MVP', second: 'שני', third: 'שלישי', frag: 'רסיס',
    ctlMove: 'תנועה', ctlSprint: 'ריצה', ctlJump: 'קפיצה', ctlCrouch: 'התכופפות / החלקה בריצה', ctlHoldCrouch: 'החזקת התכופפות',
    ctlFire: 'ירי', ctlAim: 'כיוון', ctlReload: 'טעינה מחדש', ctlWeapons: 'נשק/ציוד', ctlGrenade: 'רימון',
    ctlEnter: 'כניסה לטנק / החזקה להחייאה', ctlSpot: 'סימון אויב', ctlScore: 'לוח תוצאות', ctlMenu: 'תפריט',
    tankCtl: 'טנק:', tankDrive: 'נהיגה', tankTurret: 'צריח', tankFire: 'ירי', tankZoom: 'זום', tankCoax: 'מקלע צמוד', tankExit: 'יציאה',
    mobileCtl: 'מובייל: האגודל השמאלי מזיז (דחיפה למעלה = ריצה), הצד הימני מסובב, ◉ יורה (גררו לכיוון בזמן ירי).',
    loadingWait: 'טוען',
    capture: 'כיבוש', enemyTeams: 'קבוצות',
    noServer: 'הריצו node server.js ופתחו את הכתובת שלו',
    serverFound: (j) => `${j.name} · ${j.humans} מחוברים · ${j.players}/${j.max} חיילים`,
    noServerHere: 'אין שרת כאן · הריצו `node server.js` כדי לארח',
    startingMatch: 'המשחק מתחיל…',
  },
};

let cur = getLang();
export function t(k, ...a) { const v = (S[cur] && S[cur][k]) ?? S.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; }
export function curLang() { return cur; }
export function toggleLang() { setLang(cur === 'he' ? 'en' : 'he'); location.reload(); }
applyDir(cur);

// חיבור ל-Claude: אימות תצפית מצילום, זיהוי חופשי והסבר מורחב על מין.
import { SPECIES } from '../data/species.js';
import { GENERA } from '../data/genera.js';
import { REGIONS, ABUNDANCE, ORGANS, MONTHS, TAGS } from '../data/regions.js';
import { getSettings } from './settings.js';

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (מומלץ – הכי מדויק)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (מהיר וזול יותר)' },
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2 (החזק ביותר, יקר)' },
];

export class AiError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

const REGION_NAME = Object.fromEntries(REGIONS.map((r) => [r.code, r.name]));

// ---- שני מצבי חיבור ----
// 1) מארח (Claude Artifact): הבינה המלאכותית מגיעה דרך claude.use("sample") – בלי מפתח, על חשבון המשתמש.
// 2) עצמאי: SDK של Anthropic עם מפתח API (נטען רק כשצריך).
const HOSTED_BUILD = typeof __HOSTED__ !== 'undefined' && __HOSTED__;
export const isHosted = () => HOSTED_BUILD || !!(typeof window !== 'undefined' && window.claude?.use);

let samplePromise = null;
async function getSample() {
  if (!samplePromise) samplePromise = Promise.resolve(window.claude?.use ? window.claude.use('sample') : null).catch(() => null);
  return samplePromise;
}

let sdk = null;
async function makeClient() {
  const s = getSettings();
  if (typeof __HOSTED__ === 'undefined' && !sdk) sdk = (await import('../vendor/anthropic-sdk.mjs')).default;
  if (!sdk) throw new AiError('הבינה המלאכותית אינה זמינה כאן.');
  if (s.mode === 'proxy') return new sdk({ apiKey: 'via-proxy', baseURL: `${location.origin}/anthropic`, dangerouslyAllowBrowser: true });
  if (!s.apiKey) throw new AiError('צריך להגדיר מפתח API של Anthropic בהגדרות כדי להשתמש בבינה המלאכותית.', 'nokey');
  return new sdk({ apiKey: s.apiKey, dangerouslyAllowBrowser: true });
}

function explainError(err) {
  if (err instanceof AiError) return err;
  const code = err?.code;
  if (code) { // שגיאות של claude.use("sample")
    const map = {
      not_granted: 'לא אישרת ל-Claude לעבוד עם האפליקציה. אשר כשתתבקש ונסה שוב.',
      sampling_disabled: 'Claude אינו זמין בחשבון הזה.',
      rate_limited: 'יותר מדי בקשות או שהגעת למגבלת השימוש. נסה שוב עוד מעט.',
      session_expired: 'צריך להתחבר מחדש ל-Claude.',
      image_rejected: 'אי אפשר לקרוא את התמונה. נסה תמונה אחרת.',
      images_unavailable: 'שליחת תמונות ל-Claude אינה זמינה כאן.',
      refused: 'הבינה המלאכותית סירבה לנתח את התמונה. נסה תמונה אחרת.',
      invalid_json: 'התקבלה תשובה לא תקינה מהבינה המלאכותית. נסה שוב.',
      upstream_error: 'תקלה זמנית בחיבור ל-Claude. נסה שוב.',
      prompt_too_large: 'הבקשה גדולה מדי.',
    };
    if (map[code]) return new AiError(map[code], code === 'not_granted' ? 'nogrant' : 'error');
    return new AiError(`שגיאה (${code}): ${err.message || ''}`);
  }
  const st = err?.status;
  if (st === 401) return new AiError('מפתח ה-API שגוי או לא פעיל. בדקו אותו בהגדרות.', 'nokey');
  if (st === 403) return new AiError('למפתח אין הרשאה למודל הזה. נסו מודל אחר בהגדרות.');
  if (st === 429) return new AiError('יותר מדי בקשות כרגע. חכו דקה ונסו שוב.');
  if (st) return new AiError(`שגיאה מהשרת (${st}): ${err.message}`);
  if (/connection|fetch|network/i.test(err?.message || '')) return new AiError('אין חיבור לשרת הבינה המלאכותית. בדקו את החיבור לאינטרנט.');
  return new AiError(err?.message || String(err));
}

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

// רשימת כל הגאופיטים בישראל – חלק קבוע בהנחיית המערכת (נשמר במטמון בין בקשות).
const CHECKLIST = SPECIES.map((s) => `${s.c}|${s.he}|${s.la}|${Object.keys(s.r).join(' ')}`).join('\n');

const SYSTEM = `You are an expert field botanist specialising in the wild flora of Israel and the southern Levant, with deep knowledge of geophytes (bulbs, corms, tubers, rhizomes) and of the identification keys in Flora Palaestina and "Flora of Israel Online" (flora.org.il).
You work inside a personal citizen-science app: the user is trying to photograph every geophyte in Israel during the year. A species is ticked off ONLY when you confirm, from the photos, that the plant really is that taxon.

Rules for verification:
- Judge only from what is visible in the photos. Never confirm because the user claims it.
- Confirm (matches_target=true with high confidence) only when the diagnostic features that separate the claimed taxon from its look-alikes in Israel are visible, or when the taxon has no realistic look-alike there.
- If only the genus can be determined (e.g. Gagea, Bellevalia, Allium, Colchicum species that need bulb tunics, leaf hairs, anther colour etc.), set identification_rank="genus", keep confidence low, and explain in tips_he exactly what to photograph.
- Use region and month only as supporting evidence: a plant outside its known range or season is possible but needs stronger visual evidence.
- Set looks_like_live_photo=false if the image looks like a photo of a screen or print, a drawing, a herbarium sheet, a stock/AI-generated picture, or a cultivated garden form. Set is_plant_photo=false if no plant is shown.
- confidence is an integer 0–100 for the statement "the photographed plant is the identified taxon".
- identified_code must be a code from the checklist below when the plant is one of them; otherwise an empty string.
- Write every *_he field in clear, friendly Hebrew. Use Hebrew plant names from the checklist.

Checklist of all geophyte taxa of Israel (code|Hebrew name|Latin name|region codes):
${CHECKLIST}

Region codes: ${REGIONS.map((r) => `${r.code}=${r.name}`).join(', ')}.`;

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_plant_photo', 'looks_like_live_photo', 'identified_code', 'identified_hebrew', 'identified_latin',
    'identification_rank', 'matches_target', 'confidence', 'evidence_he', 'concerns_he', 'alternatives', 'tips_he'],
  properties: {
    is_plant_photo: { type: 'boolean' },
    looks_like_live_photo: { type: 'boolean' },
    identified_code: { type: 'string', description: 'Checklist code of the identified taxon, or empty string' },
    identified_hebrew: { type: 'string' },
    identified_latin: { type: 'string' },
    identification_rank: { type: 'string', enum: ['species', 'genus', 'family', 'none'] },
    matches_target: { type: 'boolean', description: 'True only if the plant is the target taxon (false when there is no target)' },
    confidence: { type: 'integer', description: '0-100' },
    evidence_he: { type: 'string', description: 'Visible diagnostic features that support the identification (Hebrew)' },
    concerns_he: { type: 'string', description: 'What is uncertain or contradicts the target, or empty (Hebrew)' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['code', 'hebrew', 'latin', 'why_he'],
        properties: { code: { type: 'string' }, hebrew: { type: 'string' }, latin: { type: 'string' }, why_he: { type: 'string' } },
      },
    },
    tips_he: { type: 'string', description: 'What to photograph to raise certainty (Hebrew), or empty' },
  },
};

function speciesBrief(sp) {
  const g = GENERA[sp.g];
  const regions = Object.entries(sp.r).map(([c, a]) => `${REGION_NAME[c]} (${ABUNDANCE[a]?.name})`).join(', ');
  return [
    `${sp.he} – ${sp.la} (code ${sp.c}), family ${g?.fam || ''}`,
    `Storage organ: ${ORGANS[sp.o]?.name}. Flowering months: ${sp.f.map((m) => MONTHS[m - 1]).join(', ') || 'unknown'}.`,
    `Status: ${[...sp.t].map((t) => TAGS[t]?.name).join(', ') || '—'}. Habitat: ${sp.h || '—'}.`,
    `Distribution in Israel: ${regions || '—'}.`,
    `Identification notes (flora.org.il): ${sp.s || '—'}`,
  ].join('\n');
}

function contextText({ region, lat, lon }) {
  const now = new Date();
  const parts = [`Date of photo: ${now.toISOString().slice(0, 10)} (month: ${MONTHS[now.getMonth()]}).`];
  if (region) parts.push(`Area chosen by the user: ${REGION_NAME[region] || region} (${region}).`);
  if (lat != null) parts.push(`GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}.`);
  return parts.join('\n');
}

async function runJson(content) {
  const sample = await getSample();
  if (sample) {
    const images = content.filter((b) => b.type === 'image').map((b) => b.source.data && b64ToBlob(b.source.data, b.source.media_type));
    const task = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
    const prompt = `${SYSTEM}\n\n---\n${task}\n\nThe ${images.length} attached image(s) are the user's photos of the plant.\nReply with ONLY one JSON object (no prose, no code fence) that follows this JSON Schema exactly:\n${JSON.stringify(RESULT_SCHEMA)}`;
    try {
      const result = await sample.json(prompt, { images, modelTier: 'complex', effort: 'high' });
      if (!result || typeof result !== 'object') throw new AiError('התקבלה תשובה לא תקינה מהבינה המלאכותית. נסו שוב.');
      result.confidence = Math.max(0, Math.min(100, Math.round(Number(result.confidence) || 0)));
      result.alternatives = Array.isArray(result.alternatives) ? result.alternatives : [];
      result.model = 'Claude';
      return result;
    } catch (err) {
      throw explainError(err);
    }
  }
  const s = getSettings();
  const client = await makeClient();
  let resp;
  try {
    resp = await client.beta.messages.create({
      model: s.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    throw explainError(err);
  }
  if (resp.stop_reason === 'refusal') throw new AiError('הבינה המלאכותית סירבה לנתח את התמונה. נסו תמונה אחרת.');
  if (resp.stop_reason === 'max_tokens') throw new AiError('התשובה נקטעה. נסו שוב.');
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    const result = JSON.parse(text);
    result.model = resp.model;
    return result;
  } catch {
    throw new AiError('התקבלה תשובה לא תקינה מהבינה המלאכותית. נסו שוב.');
  }
}

function imageBlocks(images) {
  return images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } }));
}

/** אימות שהצילום הוא אכן המין המבוקש. */
export async function verifyObservation({ species, images, region, lat, lon }) {
  const relatives = SPECIES.filter((s) => s.g === species.g && s.c !== species.c)
    .map((s) => `- ${s.he} (${s.la}, ${s.c}): ${s.s}`).join('\n');
  const text = `TASK: verify whether the photographed plant is the TARGET taxon.

TARGET:
${speciesBrief(species)}

Congeners in Israel that could be confused with it:
${relatives || '(none – the only member of its genus in Israel)'}

${contextText({ region, lat, lon })}
The user sent ${images.length} photo(s) of the same plant.`;
  return runJson([...imageBlocks(images), { type: 'text', text }]);
}

/** זיהוי חופשי – מה הצמח שבתמונה? */
export async function identifyPlant({ images, region, lat, lon }) {
  const regional = region
    ? SPECIES.filter((s) => s.r[region] != null).map((s) => s.c).join(', ')
    : '';
  const text = `TASK: identify the photographed plant. There is no target, so set matches_target=false.
If it is a geophyte from the checklist, give its code; if it is not a geophyte, still name it but leave identified_code empty.
${region ? `Geophytes recorded in this area (codes): ${regional}` : ''}

${contextText({ region, lat, lon })}
The user sent ${images.length} photo(s) of the same plant.`;
  return runJson([...imageBlocks(images), { type: 'text', text }]);
}

/** הסבר מורחב בעברית על המין – זורם (streaming). */
export async function speciesProfile(species, onText) {
  const sample = await getSample();
  const s = getSettings();
  const client = sample ? null : await makeClient();
  const g = GENERA[species.g];
  const prompt = `כתוב פרופיל מעמיק ומעניין בעברית על הגאופיט הבא מצמחיית ישראל, לחובב טבע שרוצה למצוא ולצלם אותו בשטח.

${speciesBrief(species)}
מידע על הסוג: ${g?.about || ''} ${g?.more || ''}

מבנה (כותרות ## בעברית, פסקאות קצרות ונקודות):
## זיהוי בשטח – סימני ההיכר, ומה לצלם כדי שהזיהוי יאושר
## מינים דומים ואיך מבדילים
## מחזור החיים ואיבר האגירה – מתי מופיעים עלים, פריחה ופירות, ומה קורה בתרדמה
## בית גידול ואקולוגיה
## האבקה והפצת זרעים
## תפוצה ונדירות בישראל – איפה ומתי הכי כדאי לחפש
## שמירת טבע – מעמד הגנה ואיומים
## היסטוריה, תרבות ושימושים – כולל אזהרת רעילות אם רלוונטי
## עובדה מפתיעה

הסתמך על הנתונים שלמעלה. אם אינך בטוח בפרט מסוים – כתוב זאת במפורש ואל תמציא. אורך: 400–700 מילים.`;
  if (sample) {
    try {
      const { text } = await sample(prompt, { modelTier: 'default', onText: ({ text }) => onText(text) });
      return text;
    } catch (err) { throw explainError(err); }
  }
  try {
    const stream = client.beta.messages.stream({
      model: s.model,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: prompt }],
    });
    stream.on('text', (_delta, snapshot) => onText(snapshot));
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new AiError('הבינה המלאכותית סירבה לכתוב את ההסבר.');
    return final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  } catch (err) {
    throw explainError(err);
  }
}

/** בדיקת חיבור קצרה מההגדרות. */
export async function testConnection() {
  const sample = await getSample();
  if (sample) {
    try { return (await sample('ענה במילה אחת: שלום', { modelTier: 'quick', cache: false })).text.trim(); } catch (err) { throw explainError(err); }
  }
  const s = getSettings();
  const client = await makeClient();
  try {
    const r = await client.messages.create({
      model: s.model, max_tokens: 2000, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'ענה במילה אחת: שלום' }],
    });
    return r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  } catch (err) {
    throw explainError(err);
  }
}

const REPORTS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reports'],
  properties: { reports: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['code', 'place_he', 'located', 'lat', 'lon', 'accuracy_m', 'year', 'certainty', 'quote'],
    properties: {
      code: { type: 'string', description: 'Checklist code of the species' },
      place_he: { type: 'string', description: 'Place name as written in the text' },
      located: { type: 'boolean', description: 'true only if the place can be placed on a map inside Israel' },
      lat: { type: 'number' }, lon: { type: 'number' },
      accuracy_m: { type: 'integer', description: 'Estimated radius of uncertainty in metres' },
      year: { type: 'integer', description: '0 if unknown' },
      certainty: { type: 'string', enum: ['high', 'medium', 'low'] },
      quote: { type: 'string', description: 'Short quote from the text supporting this report' },
    } } } },
};

/** המרת טקסט חופשי (פוסטים, הודעות) לדיווחי תצפית לא מאומתים. */
export async function extractReports(text) {
  const task = `TASK: extract plant sighting reports from the pasted social-media text below.
- Report only taxa that are in the checklist (use its code). Skip anything else.
- Use the place named in the text to estimate coordinates inside Israel (WGS84). If the place is vague, unknown or outside Israel set located=false and lat=lon=0. Never invent a precise location: set accuracy_m to the realistic radius (e.g. a named trail 500–2000, a town 3000, a nature reserve 2000–5000, a region 15000+).
- year = year of the sighting if stated or clearly implied, else 0. certainty reflects how sure the text is about the species ID.
- quote = a short fragment (max 120 chars) of the original text.
- Return {"reports": []} when nothing qualifies.

TEXT:
"""
${text.slice(0, 12000)}
"""`;
  const sample = await getSample();
  try {
    if (sample) {
      const prompt = `${SYSTEM}\n\n---\n${task}\n\nReply with ONLY one JSON object (no prose, no code fence) that follows this JSON Schema exactly:\n${JSON.stringify(REPORTS_SCHEMA)}`;
      const r = await sample.json(prompt, { modelTier: 'complex', effort: 'medium' });
      return Array.isArray(r?.reports) ? r.reports : [];
    }
    const s = getSettings();
    const client = await makeClient();
    const resp = await client.beta.messages.create({
      model: s.model, max_tokens: 8000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: REPORTS_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: task }] }],
    });
    const out = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(out).reports || [];
  } catch (err) {
    throw explainError(err);
  }
}

const HABITAT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['soil_he', 'rocks_he', 'light_he', 'moisture_he', 'companion_plants_he', 'trees_he', 'where_to_look_he', 'tips_he'],
  properties: {
    soil_he: { type: 'string', description: 'Soil type it prefers (e.g. terra rossa, rendzina, loess, sand, basalt clay) in 1-2 short Hebrew sentences' },
    rocks_he: { type: 'string', description: 'Rock/stone context: limestone outcrops, basalt stones, between boulders, etc., or that it does not depend on rock' },
    light_he: { type: 'string', description: 'Sun / shade preference' },
    moisture_he: { type: 'string', description: 'Dry vs moist, seasonal flooding, drainage' },
    companion_plants_he: { type: 'array', items: { type: 'string' }, description: 'Typical companion plants/vegetation around it (Hebrew common names, max 6)' },
    trees_he: { type: 'array', items: { type: 'string' }, description: 'Typical trees/shrubs around it (Hebrew, max 5), empty array if open habitat' },
    where_to_look_he: { type: 'string', description: '2-3 short Hebrew sentences: concrete habitat types, altitude and landscape positions to search; no invented precise sites' },
    tips_he: { type: 'string', description: 'One practical field tip in Hebrew (season, time of day, how to spot it)' },
  },
};

/** תיאור קצר של בית הגידול: קרקע, סלעים, אור, לחות, צמחים ועצים בסביבה. */
export async function habitatProfile(species) {
  const task = `TASK: describe the ecological niche of this taxon in Israel so a hiker knows where to look for it.
Use ONLY well-established general knowledge about the species / its genus / its vegetation belt; if a detail is uncertain, say it is typical for the genus or leave it general. Never invent precise localities. Keep every field short, clear Hebrew.

TAXON:
${speciesBrief(species)}`;
  const sample = await getSample();
  try {
    if (sample) {
      const prompt = `${SYSTEM}\n\n---\n${task}\n\nReply with ONLY one JSON object (no prose, no code fence) that follows this JSON Schema exactly:\n${JSON.stringify(HABITAT_SCHEMA)}`;
      const r = await sample.json(prompt, { modelTier: 'complex', effort: 'medium' });
      if (!r || typeof r !== 'object') throw new AiError('התקבלה תשובה לא תקינה מהבינה המלאכותית. נסו שוב.');
      return r;
    }
    const s = getSettings();
    const client = await makeClient();
    const resp = await client.beta.messages.create({
      model: s.model, max_tokens: 4000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: HABITAT_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: task }] }],
    });
    return JSON.parse(resp.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  } catch (err) {
    throw explainError(err);
  }
}

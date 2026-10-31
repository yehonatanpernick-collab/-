# סערת שחקים: מדריך הוצאה לחנויות

התיקייה הזו עוטפת את המשחק (`../sky-storm/index.html`) כאפליקציה לאנדרואיד ול-iPhone, בעזרת Capacitor.
האפליקציה עובדת בלי אינטרנט: three.js והגופנים נארזים בתוכה. פרסומות מגיעות מ-Google AdMob.

## מה כבר מוכן
- פרויקט Capacitor (`package.json`, `capacitor.config.json`), ופרויקט אנדרואיד מוכן בתיקייה `android/`.
- סקריפט `build.mjs` שמעתיק את המשחק לתיקייה `www/` ומחליף כל קישור חיצוני בקובץ מקומי.
- אייקון ומסך פתיחה ב-`assets/`.
- פרסומות מתגמלות ("חזרה לקרב" ו"פי 2 מטבעות"), ופרסומת מסך מלא אחת לכל 3 משחקים.
  כרגע הן מוגדרות עם **מזהי בדיקה של Google**.
- בקשת הסכמה לפרטיות (GDPR) ובקשת הרשאת מעקב ב-iOS, לפני שמוצגות פרסומות.
- רטט, עצירה כשיוצאים מהאפליקציה, וכפתור "חזור" באנדרואיד שעוצר את המשחק.
- מדיניות פרטיות לדוגמה (`privacy.html`) וטקסטים לחנות (`store-listing.md`).

## 1. התקנה (פעם אחת, במחשב שלך)
1. התקן [Node.js](https://nodejs.org) גרסה 18 ומעלה.
2. לאנדרואיד: התקן [Android Studio](https://developer.android.com/studio).
3. ל-iPhone: צריך מחשב Mac עם Xcode. אפשר גם שירות בנייה בענן, כמו Codemagic.
4. בתיקייה הזו הרץ:
   ```
   npm install
   npm run build
   ```

## 2. אייקונים ומסכי פתיחה
```
npm run assets
```
הפקודה יוצרת את כל הגדלים לאנדרואיד ול-iOS מתוך `assets/icon-only.png` ו-`assets/splash.png`.

## 3. פרסומות (AdMob)
1. פתח חשבון ב-[AdMob](https://admob.google.com) והוסף שתי אפליקציות: אחת לאנדרואיד ואחת ל-iOS.
2. לכל אפליקציה צור שתי יחידות פרסום: **Rewarded** ו-**Interstitial**.
3. החלף את מזהי הבדיקה בשלושה מקומות:
   - ב-`../sky-storm/index.html`, באובייקט `AD_IDS`: מזהי היחידות.
   - ב-`android/app/src/main/AndroidManifest.xml`: ה-`APPLICATION_ID` של אפליקציית האנדרואיד.
   - ב-iOS, אחרי `npx cap add ios`: בקובץ `ios/App/App/Info.plist` הוסף `GADApplicationIdentifier` עם מזהה אפליקציית ה-iOS,
     את רשימת `SKAdNetworkItems` מהתיעוד של AdMob, ו-`NSUserTrackingUsageDescription`
     (למשל: "כדי להציג לך פרסומות רלוונטיות יותר").
4. **לפני ההחלפה תמיד בודקים עם מזהי הבדיקה.** לחיצה על פרסומות אמיתיות שלך עלולה לגרום לחסימת החשבון.

## 4. בנייה והרצה על טלפון
- אנדרואיד: `npm run android` פותח את Android Studio. חבר טלפון במצב מפתח ולחץ Run.
- iPhone (במק): `npx cap add ios` פעם אחת, ואחר כך `npm run ios`. ב-Xcode בחר Team ולחץ Run.
- אחרי כל שינוי במשחק: `npm run sync`.

## 5. העלאה ל-Google Play (25$ חד-פעמי)
1. פתח חשבון ב-[Play Console](https://play.google.com/console).
2. ב-Android Studio: Build ‏‹ Generate Signed Bundle ‏‹ Android App Bundle. צור מפתח חתימה ו**שמור אותו בגיבוי**.
3. צור אפליקציה חדשה בקונסולה, העלה את הקובץ `.aab` ל-**Internal testing**, ונסה אותו על הטלפון.
4. מלא את הסעיפים הנדרשים:
   - **דף החנות:** הטקסטים מ-`store-listing.md` ו-4 צילומי מסך לפחות.
   - **מדיניות פרטיות:** קישור לדף ציבורי (ראה סעיף 7).
   - **Data safety:** "כן, אוספים נתונים". AdMob אוסף מזהי מכשיר (Advertising ID), נתוני שימוש ואבחון, לצורך פרסום וניתוח.
   - **Ads:** "כן, האפליקציה מכילה פרסומות".
   - **דירוג גיל:** אלימות מצוירת/פנטזיה, בלי דם. בדרך כלל יוצא 7+ / PEGI 7.
   - **קהל יעד:** 13+. קהל של ילדים מחייב כללי פרסום אחרים.
5. כשהכול עובד: מעבר ל-Production ושליחה לבדיקה.

## 6. העלאה ל-App Store (99$ לשנה)
1. הרשמה ל-[Apple Developer Program](https://developer.apple.com/programs/).
2. ב-Xcode: Product ‏‹ Archive ‏‹ Distribute App ‏‹ App Store Connect.
3. ב-[App Store Connect](https://appstoreconnect.apple.com): בדיקה ב-TestFlight.
   אחר כך ממלאים דף חנות, Privacy Nutrition Labels (מזהים ונתוני שימוש לצורך פרסום) ודירוג גיל, ושולחים לבדיקה.

## 7. מדיניות פרטיות
`privacy.html` הוא תבנית. מלא בה את שמך ואת המייל שלך, ופרסם אותה בכתובת ציבורית: GitHub Pages, אתר משלך, או קישור ציבורי.
שתי החנויות דורשות את הקישור.

## לפני שליחה לחנות
- [ ] שינית את `appId` ב-`capacitor.config.json` לשם ייחודי שלך (למשל `com.yourname.skystorm`). **אי אפשר לשנות אחרי ההעלאה הראשונה.**
- [ ] החלפת את כל מזהי AdMob מבדיקה לאמיתיים.
- [ ] בדקת שהשם "סערת שחקים" לא תפוס בחנויות ושאינו סימן מסחרי רשום.
- [ ] שיחקת על לפחות טלפון אנדרואיד זול אחד ואייפון אחד. אם המשחק כבד, בהגדרות יש מצב "ביצועים".
- [ ] מדיניות פרטיות מפורסמת בכתובת ציבורית.
- [ ] צילומי מסך, אייקון ותיאור בעברית ובאנגלית.

## רישיונות
- three.js: רישיון MIT.
- הגופנים Suez One, Karantina ו-Frank Ruhl Libre: רישיון SIL Open Font License. מותר לארוז אותם באפליקציה מסחרית.
- כל הגרפיקה, המודלים והצלילים במשחק נוצרים בקוד ושייכים לך.

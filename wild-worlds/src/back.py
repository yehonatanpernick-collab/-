from lib import *
def pages():
    P=[]
    summ='''
<p>מסע בן ארבעים עמודים הוביל מהפארקים של המערב האמריקאי אל הקרח. כמה חוטים חזרו בכל פרק, ואפשר לאסוף אותם לשרשרת אחת.</p>
<h2>1. הלוחות בונים, הקרח מפסל</h2>
<p>מנוע הרכסים הוא טקטוני: תת-שקיעה (אנדים, קסקייד), התנגשות יבשתית (הימלאיה, אלפים, קווקז) והעתקים (טיטון, האלפים הדרומיים). אבל הצורה שאנו רואים כיום, קרקסים, ארטים, עמקי U ואגמי קרחון, נחצבה בעיקר בידי קרח בעשרות אלפי השנים האחרונות. אין כמעט פארק בספר שנוף שלו אינו חובה לשני השחקנים כאחד.</p>
<h2>2. הגובה מארגן את החיים</h2>
<p>בכל הרים שבדקנו, ירידה של כ-6°C לכל 1,000 מ׳ יוצרת רצועות צמחייה: יער, יער תת-אלפי, טונדרה אלפינית, קרח. הרוחות והמשקעים מוסיפים ממד שני: צל גשם משנה את הנוף בין מערב למזרח באולימפיק, בגלייסר, בקסקייד ובאלפים הדרומיים. השוואה בין מערכות ההרים מראה שהגובה הוא פונקציה גם של קו הרוחב.</p>
<h2>3. מים בצורת שלג וקרח הם תשתית חיים</h2>
<p>קרחונים ושלג אוגרים מים לקיץ ומזינים נהרות, חקלאות ובתי גידול קרים. נסיגת קרחונים באלפים, בהימלאיה, באנדים, בצפון אמריקה ובניו זילנד אינה רק ״אובדן נוף״ אלא שינוי בהידרולוגיה ובמערכות אקולוגיות.</p>
<h2>4. מערכות אקולוגיות הן רשתות</h2>
<p>מן הזאבים של ילוסטון ועד הסקויות של הסיירה ועד פטריות המיקוריזה ביער הגשם, החיים תלויים בקשרים: טורפים, שריפות, מים, פטריות וקרקע. אין ״מרכיב יחיד״ שמסביר מערכת.</p>
<h2>5. האדם בתוך המערכת</h2>
<p>דיכוי שריפות, סכרים, מינים פולשים ושינוי אקלים הם חלק מהמערכת. הפארקים הלאומיים משמשים גם כמעבדות: מדידה ארוכת טווח ושימור מאפשרים להבחין בין שינוי טבעי לשינוי מושרה.</p>
{box("","לקריאה נוספת בהמשך","<p>כל מושג בספר ניתן לבדיקה באתרי המוסדות ברשימת המקורות. המלצה: להתחיל מדפי ״Geology״ ו״Glaciers״ באתרי NPS של כל פארק, ומפורטל ״All About Glaciers״ של NSIDC.</p>")}
'''
    P.append(page(0,"סיכום","סיכום: מה מחבר בין ההרים, הקרח והחיים","Summary",summ,notoc=False,band="סיכום",toc="סיכום",toc_level=1))
    src='''<ul class="src">
<li><b>National Park Service (NPS)</b>: park pages and Geology / Glaciers / Nature &amp; Science sections (Rocky Mountain, Glacier, Yellowstone, Grand Teton, Mount Rainier, Yosemite, Olympic, North Cascades, Sequoia &amp; Kings Canyon, Denali, Great Smoky Mountains, Crater Lake); NPS Visitation Statistics. nps.gov</li>
<li><b>U.S. Geological Survey (USGS)</b>: Yellowstone Volcano Observatory; Cascades Volcano Observatory (Mount Rainier hazards); Glacier National Park Repeat Photography Project; Benchmark Glaciers. usgs.gov</li>
<li><b>NOAA NCEI</b>: Amante, C. &amp; Eakins, B.W. (2009). ETOPO1 1 Arc-Minute Global Relief Model. NOAA Technical Memorandum NESDIS NGDC-24. ngdc.noaa.gov</li>
<li><b>NASA Earth Observatory</b>: Blue Marble (map background). earthobservatory.nasa.gov</li>
<li><b>NSIDC</b> (National Snow and Ice Data Center): “All About Glaciers”; “Cryosphere”. nsidc.org</li>
<li><b>World Glacier Monitoring Service (WGMS)</b> and <b>GLAMOS</b> (Swiss Glacier Monitoring Network): annual glacier mass-balance reports. wgms.ch, glamos.ch</li>
<li><b>UNESCO World Heritage Centre</b>: Waterton-Glacier International Peace Park; Yellowstone; Yosemite; Olympic; Canadian Rocky Mountain Parks; Swiss Alps Jungfrau-Aletsch; Western Caucasus; Sagarmatha; Te Wahipounamu. whc.unesco.org</li>
<li><b>ICIMOD</b> (2019). The Hindu Kush Himalaya Assessment. Wester, P. et al. (eds.), Springer.</li>
<li><b>GNS Science</b> and <b>NIWA</b> (New Zealand): Alpine Fault; End of Summer Snowline Survey. gns.cri.nz, niwa.co.nz</li>
<li><b>Ramsar Convention</b> (2018). Global Wetland Outlook. ramsar.org · <b>CEPF</b>, Caucasus Biodiversity Hotspot profile. cepf.net</li>
<li>Hugonnet, R. et al. (2021). Accelerated global glacier mass loss in the early twenty-first century. <i>Nature</i> 592, 726–731.</li>
<li>Immerzeel, W.W. et al. (2020). Importance and vulnerability of the world's water towers. <i>Nature</i> 577, 364–369.</li>
<li>Mote, P.W. et al. (2018). Dramatic declines in snowpack in the western US. <i>npj Climate and Atmospheric Science</i> 1, 2.</li>
<li>Hewitt, K. (2005). The Karakoram anomaly? Glacier expansion and the 'elevation effect'. <i>Mountain Research and Development</i> 25, 332–340.</li>
<li>Painter, T.H. et al. (2010). Response of Colorado River runoff to dust radiative forcing in snow. <i>PNAS</i> 107, 17125–17130.</li>
<li>Hugelius, G. et al. (2014). Estimated stocks of circumpolar permafrost carbon. <i>Biogeosciences</i> 11, 6573–6593.</li>
<li>Rantanen, M. et al. (2022). The Arctic has warmed nearly four times faster than the globe since 1979. <i>Communications Earth &amp; Environment</i> 3, 168.</li>
<li>Lovejoy, T.E. &amp; Nobre, C. (2018). Amazon tipping point. <i>Science Advances</i> 4, eaat2340. · Gatti, L.V. et al. (2021). Amazonia as a carbon source linked to deforestation and climate change. <i>Nature</i> 595, 388–393.</li>
<li>Yu, H. et al. (2015). The fertilizing role of African dust in the Amazon rainforest. <i>Geophysical Research Letters</i> 42, 1984–1991.</li>
<li>RGI Consortium (2017). Randolph Glacier Inventory 6.0. doi:10.7265/N5-RGI-60.</li>
<li>Zemp, M. et al. (2019). Global glacier mass changes and their contributions to sea-level rise from 1961 to 2016. <i>Nature</i> 568, 382–386.</li>
<li>IPCC (2022). AR6 WGII, Cross-Chapter Paper 5: Mountains. Cambridge University Press.</li>
<li>Christiansen, R.L. (2001). The Quaternary and Pliocene Yellowstone Plateau Volcanic Field. USGS Professional Paper 729-G.</li>
<li>Smith, R.B. &amp; Siegel, L.J. (2000). <i>Windows into the Earth: The Geologic Story of Yellowstone and Grand Teton National Parks</i>. Oxford University Press.</li>
<li>Steven, T.A. &amp; Lipman, P.W. (1976). Calderas of the San Juan Volcanic Field, Southwestern Colorado. USGS Professional Paper 958. · Lipman, P.W. (2007). Incremental assembly and prolonged consolidation of Cordilleran magma chambers. <i>Geosphere</i> 3, 42–70.</li>
<li>Bacon, C.R. (1983). Eruptive history of Mount Mazama and Crater Lake caldera. <i>J. Volcanol. Geotherm. Res.</i> 18, 57–115.</li>
<li>Chronic, H. (1980). <i>Roadside Geology of Colorado</i>. Mountain Press.</li>
<li>Searle, M. (2013). <i>Colliding Continents</i>. Oxford University Press.</li>
<li>Howarth, J.D. et al. (2021). Spatiotemporal clustering of great earthquakes on a transform fault controlled by geometry. <i>Nature Geoscience</i> 14, 314–320.</li>
<li>Körner, C. (2012). <i>Alpine Treelines</i>. Springer.</li>
<li>Whittaker, R.H. (1975). <i>Communities and Ecosystems</i> (2nd ed.). Macmillan.</li>
<li>ter Steege, H. et al. (2013). Hyperdominance in the Amazonian tree flora. <i>Science</i> 342, 1243092.</li>
<li>Cowling, R.M. et al. (1996). Plant diversity in Mediterranean-climate regions. <i>Trends in Ecology &amp; Evolution</i> 11, 362–366.</li>
<li>Ripple, W.J. &amp; Beschta, R.L. (2012). Trophic cascades in Yellowstone: the first 15 years after wolf reintroduction. <i>Biological Conservation</i> 145, 205–213.</li>
<li>Benn, D.I. &amp; Evans, D.J.A. (2010). <i>Glaciers and Glaciation</i> (2nd ed.). Hodder Education. · Cuffey, K.M. &amp; Paterson, W.S.B. (2010). <i>The Physics of Glaciers</i> (4th ed.). Elsevier.</li>
<li>Yu, Z. et al. (2010). Global peatland dynamics since the Last Glacial Maximum. <i>Geophysical Research Letters</i> 37, L13402.</li>
</ul>
<p style="font-size:.9em;margin-top:2mm;color:#4b555c"><b>הערת אימות:</b> בסביבת ההפקה לא ניתן היה לגשת לאתרי המקורות. הרשימה מורכבת ממקורות אמיתיים הידועים לכותב, והנתונים בספר מבוססים עליהם. לפני שימוש לציטוט יש לאמת כל נתון מול גרסתו העדכנית במקור, במיוחד מספרי קרחונים, שטחי קרח, מספרי מבקרים ושיעורי נסיגה.</p>'''
    import re
    def fixli(m):
        t=m.group(1)
        return ('<li dir="ltr" style="text-align:left;list-style:none;margin-bottom:1mm">'+t+'</li>') if not re.search('[\u0590-\u05ff]',t) else m.group(0)
    src=re.sub(r'<li>(.*?)</li>',fixli,src,flags=re.S)
    P.append(page(0,"מקורות","רשימת מקורות מדעיים","Sources",src,notoc=False,band="מקורות",toc="רשימת מקורות",toc_level=1))
    return P

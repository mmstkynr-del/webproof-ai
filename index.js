const VERSION = "production-editorial-5.0";

const MAX_PAGES = 30;
const MAX_ARTICLES = 15;
const MAX_LINKS = 180;
const MAX_HTML_BYTES = 1800000;
const MAX_ARTICLE_TEXT = 50000;

const FETCH_TIMEOUT = 6500;
const AI_TIMEOUT = 8000;

const GEMINI_MODEL = "gemini-3.7-flash";
const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

const USER_AGENT =
  "Mozilla/5.0 (compatible; WebProofAI/5.0; +https://webproof-ai.mmstkynr.workers.dev)";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function html(data) {
  return new Response(data, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/* =========================================================
   URL / FETCH SECURITY
========================================================= */

function safeURL(value) {
  try {
    const u = new URL(value);

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }

    const hostname = u.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".localhost")
    ) {
      return null;
    }

    return u;
  } catch {
    return null;
  }
}

function sameOrigin(a, b) {
  return (
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.port === b.port
  );
}

async function fetchTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   TEXT NORMALIZATION
========================================================= */

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return _;
      }
    });
}

function htmlToText(htmlText) {
  let text = htmlText;

  text = text.replace(
    /<(script|style|noscript|svg|canvas|iframe|nav|footer|header|form|aside|template)[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");

  text = text.replace(/<[^>]+>/g, " ");

  text = decodeEntities(text);

  text = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function normalizeWhitespace(text) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

/* =========================================================
   HTML METADATA
========================================================= */

function extractTitle(htmlText) {
  const match = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

function getMeta(htmlText, name) {
  const regex = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    "i"
  );

  const m = htmlText.match(regex);
  if (m) return decodeEntities(m[1]).trim();

  const reverse = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
    "i"
  );

  const r = htmlText.match(reverse);
  return r ? decodeEntities(r[1]).trim() : "";
}

function getJsonLD(htmlText) {
  const blocks = [];
  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while ((match = regex.exec(htmlText))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {}
  }

  return blocks;
}

/* =========================================================
   ARTICLE DETECTION
========================================================= */

const BAD_PATH_PARTS = [
  "/search",
  "/arama",
  "/tag/",
  "/etiket/",
  "/category/",
  "/kategori/",
  "/author/",
  "/yazar/",
  "/video",
  "/gallery",
  "/galeri",
  "/foto",
  "/fotogaleri",
  "/login",
  "/register",
  "/signup",
  "/feed",
  "/rss",
  "/amp/",
  "/privacy",
  "/contact",
  "/iletisim",
  "/about",
  "/hakkimizda"
];

function isBadPath(url) {
  const path = url.pathname.toLowerCase();

  return BAD_PATH_PARTS.some((x) => path.includes(x));
}

function isArticlePath(url) {
  const path = url.pathname.toLowerCase();

  if (isBadPath(url)) return false;

  const segments = path.split("/").filter(Boolean);

  if (segments.length >= 2) return true;

  if (/\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(path)) return true;

  if (/\d{5,}/.test(path)) return true;

  return false;
}

function extractArticle(htmlText, url) {
  const title = extractTitle(htmlText);

  const jsonLD = getJsonLD(htmlText);

  let jsonArticle = null;

  for (const item of jsonLD) {
    if (!item || typeof item !== "object") continue;

    const types = Array.isArray(item["@type"])
      ? item["@type"]
      : [item["@type"]];

    if (
      types.some((x) =>
        ["Article", "NewsArticle", "ReportageNewsArticle", "Report"].includes(x)
      )
    ) {
      jsonArticle = item;
      break;
    }
  }

  const ogType = getMeta(htmlText, "og:type");
  const description = getMeta(htmlText, "description");

  const articleBlocks = [
    ...htmlText.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)
  ];

  let best = "";

  for (const match of articleBlocks) {
    const text = htmlToText(match[1]);

    if (text.length > best.length) {
      best = text;
    }
  }

  if (!best) {
    const mainMatch = htmlText.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);

    if (mainMatch) {
      best = htmlToText(mainMatch[1]);
    }
  }

  if (!best) {
    const bodyMatch = htmlText.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);

    if (bodyMatch) {
      best = htmlToText(bodyMatch[1]);
    }
  }

  best = normalizeWhitespace(best);

  const datePublished =
    jsonArticle?.datePublished ||
    getMeta(htmlText, "article:published_time") ||
    getMeta(htmlText, "datePublished");

  const author =
    jsonArticle?.author?.name ||
    (typeof jsonArticle?.author === "string"
      ? jsonArticle.author
      : "") ||
    getMeta(htmlText, "author");

  let score = 0;

  if (jsonArticle) score += 5;
  if (articleBlocks.length > 0) score += 4;
  if (ogType.toLowerCase() === "article") score += 4;
  if (datePublished) score += 2;
  if (best.length > 1800) score += 3;
  if (best.length > 5000) score += 2;
  if (isArticlePath(url)) score += 2;

  if (best.length < 700) score -= 4;

  if (title && best.toLowerCase().includes(title.toLowerCase().slice(0, 50))) {
    score += 2;
  }

  if (score < 5) return null;

  const cleanedTitle =
    jsonArticle?.headline ||
    getMeta(htmlText, "og:title") ||
    title ||
    url.pathname.split("/").pop() ||
    url.hostname;

  return {
    url: url.toString(),
    title: decodeEntities(String(cleanedTitle)).trim(),
    text: best.slice(0, MAX_ARTICLE_TEXT),
    datePublished,
    author,
    score,
    description
  };
}

/* =========================================================
   LANGUAGE DETECTION
========================================================= */

function detectLanguage(text) {
  const sample = text.slice(0, 12000).toLocaleLowerCase("tr-TR");

  const trChars = (sample.match(/[çğıöşü]/g) || []).length;

  const trWords = [
    " ve ",
    " bir ",
    " için ",
    " ile ",
    " olan ",
    " olarak ",
    " değil ",
    " daha ",
    " sonra ",
    " tarafından ",
    " açıklama",
    " haber",
    " bugün",
    " dün",
    " yarın",
    " söyledi"
  ];

  const enWords = [
    " the ",
    " and ",
    " for ",
    " with ",
    " that ",
    " this ",
    " from ",
    " said ",
    " will ",
    " have ",
    " has ",
    " was "
  ];

  let trScore = trChars * 2;

  for (const word of trWords) {
    if (sample.includes(word)) trScore += 1;
  }

  let enScore = 0;

  for (const word of enWords) {
    if (sample.includes(word)) enScore += 1;
  }

  if (trScore >= enScore + 2) return "tr";
  if (enScore >= trScore + 2) return "en";

  return "unknown";
}

/* =========================================================
   CASE HELPERS
========================================================= */

function preserveCase(original, replacement) {
  if (!original) return replacement;

  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }

  if (
    original[0] === original[0].toUpperCase() &&
    original.slice(1) === original.slice(1).toLowerCase()
  ) {
    return (
      replacement.charAt(0).toLocaleUpperCase("tr-TR") +
      replacement.slice(1)
    );
  }

  return replacement;
}

/* =========================================================
   LARGE TURKISH OBJECTIVE SPELLING DICTIONARY
========================================================= */

const TR_WORD_ERRORS = {
  "yanlız": "yalnız",
  "yalnış": "yanlış",
  "yanlızca": "yalnızca",
  "yanliz": "yalnız",
  "yanlis": "yanlış",
  "yalniz": "yalnız",
  "herkez": "herkes",
  "malesef": "maalesef",
  "orjinal": "orijinal",
  "süpriz": "sürpriz",
  "labaratuvar": "laboratuvar",
  "şarz": "şarj",
  "traş": "tıraş",
  "kirbit": "kibrit",
  "kiprit": "kibrit",
  "eşortman": "eşofman",
  "eşşek": "eşek",
  "şöför": "şoför",
  "şöförü": "şoförü",
  "profosyonel": "profesyonel",
  "profesyonelce": "profesyonelce",
  "mütevazi": "mütevazı",
  "mütevazi": "mütevazı",
  "mütevazi": "mütevazı",
  "enflasyonist": "enflasyonist",
  "entellektüel": "entelektüel",
  "entelektüel": "entelektüel",
  "entellektüel": "entelektüel",
  "inisiyatif": "inisiyatif",
  "insiyatif": "inisiyatif",
  "inisiyatif": "inisiyatif",
  "tesbit": "tespit",
  "tespit": "tespit",
  "müsade": "müsaade",
  "müdahele": "müdahale",
  "müdahale": "müdahale",
  "muhattap": "muhatap",
  "muhattabı": "muhatabı",
  "muhatap": "muhatap",
  "farketmek": "fark etmek",
  "farketmez": "fark etmez",
  "farkediyor": "fark ediyor",
  "farketmiş": "fark etmiş",
  "haketmek": "hak etmek",
  "hakeder": "hak eder",
  "haketti": "hak etti",
  "hakettiği": "hak ettiği",
  "arzeder": "arz eder",
  "arzederiz": "arz ederiz",
  "terketmek": "terk etmek",
  "terketti": "terk etti",
  "terketmiş": "terk etmiş",
  "kaydetmek": "kaydetmek",
  "kaydetti": "kaydetti",
  "kaydediyor": "kaydediyor",
  "seyretmek": "seyretmek",
  "seyretti": "seyretti",
  "hissetmek": "hissetmek",
  "hissetti": "hissetti",
  "zannetmek": "zannetmek",
  "zannetti": "zannetti",
  "reddetmek": "reddetmek",
  "reddetti": "reddetti",
  "şuan": "şu an",
  "şuanda": "şu anda",
  "birşey": "bir şey",
  "birsey": "bir şey",
  "herhangi": "herhangi",
  "her hangi": "herhangi",
  "hiçbir": "hiçbir",
  "hiç bir": "hiçbir",
  "bir çok": "birçok",
  "birçok": "birçok",
  "bir takım": "bir takım",
  "pekçok": "pek çok",
  "pek çok": "pek çok",
  "birazcık": "birazcık",
  "birazcik": "birazcık",
  "birdenbire": "birdenbire",
  "birden bire": "birdenbire",
  "bugünki": "bugünkü",
  "dünki": "dünkü",
  "yarınki": "yarınki",
  "bugünkü": "bugünkü",
  "şimdiki": "şimdiki",
  "halbuki": "hâlbuki",
  "oysa ki": "oysaki",
  "mademki": "mademki",
  "sanki": "sanki",
  "çünkü": "çünkü",
  "meğerki": "meğerki",
  "illa ki": "illaki",
  "belki de": "belki de",
  "pekala": "pekâlâ",
  "hala": "hâlâ",
  "aşşağı": "aşağı",
  "aşagı": "aşağı",
  "aşaği": "aşağı",
  "yanısıra": "yanı sıra",
  "yanısıra": "yanı sıra",
  "yanı sıra": "yanı sıra",
  "ön yargı": "önyargı",
  "öncelikle": "öncelikle",
  "öz güven": "özgüven",
  "öz güvenli": "özgüvenli",
  "öz güveni": "özgüveni",
  "öz güvenle": "özgüvenle",
  "özveri": "özveri",
  "öz veri": "özveri",
  "sözkonusu": "söz konusu",
  "söz konusu": "söz konusu",
  "yüz yüze": "yüz yüze",
  "yüzyüze": "yüz yüze",
  "art arda": "art arda",
  "ardarda": "art arda",
  "peşpeşe": "peş peşe",
  "peş peşe": "peş peşe",
  "iç içe": "iç içe",
  "içiçe": "iç içe",
  "yan yana": "yan yana",
  "yanyana": "yan yana",
  "başbaşa": "baş başa",
  "baş başa": "baş başa",
  "omuz omuza": "omuz omuza",
  "omuzomuza": "omuz omuza",
  "el ele": "el ele",
  "elele": "el ele",
  "göz göze": "göz göze",
  "gözgöze": "göz göze",
  "arka arkaya": "arka arkaya",
  "arkaarkaya": "arka arkaya",
  "sık sık": "sık sık",
  "sıksık": "sık sık",
  "bire bir": "bire bir",
  "birebir": "birebir",
  "artık": "artık",
  "şöyleki": "şöyle ki",
  "öyleki": "öyle ki",
  "demekki": "demek ki",
  "oysa": "oysa",
  "yanlışlıkla": "yanlışlıkla",
  "yanlışlıklaa": "yanlışlıkla",
  "milyonlarca": "milyonlarca",
  "milyar": "milyar",
  "trilyon": "trilyon",
  "döviz": "döviz",
  "doviz": "döviz",
  "ekonomi": "ekonomi",
  "ekonomik": "ekonomik",
  "enflasyon": "enflasyon",
  "istihdam": "istihdam",
  "istihkam": "istihkâm",
  "meclis": "Meclis",
  "hükümet": "hükümet",
  "hükumet": "hükümet",
  "cumhurbaşkanı": "Cumhurbaşkanı",
  "cumhurbaskani": "Cumhurbaşkanı",
  "milletvekili": "milletvekili",
  "bakanlık": "bakanlık",
  "başbakanlık": "Başbakanlık",
  "üniversite": "üniversite",
  "ünüversite": "üniversite",
  "üniverste": "üniversite",
  "laboratuar": "laboratuvar",
  "labaratuar": "laboratuvar",
  "doktor": "doktor",
  "doktoru": "doktoru",
  "herşey": "her şey",
  "hiçkimse": "hiç kimse",
  "hiçkimseyi": "hiç kimseyi",
  "hiçkimsenin": "hiç kimsenin",
  "pekçok": "pek çok",
  "birkaç": "birkaç",
  "bir kaç": "birkaç",
  "biraz": "biraz",
  "bir az": "biraz",
  "sıra dışı": "sıradışı",
  "sıradışı": "sıradışı",
  "olağanüstü": "olağanüstü",
  "olağan üstü": "olağanüstü"
};

/*
 * Bazı kelimeler bağlama göre hem doğru hem yanlış olabilir.
 * Bu nedenle bunları otomatik hata olarak değil, AI adayları olarak
 * değerlendireceğiz.
 */
const TR_AMBIGUOUS_PATTERNS = [
  {
    regex: /\bdeğilmi\b/giu,
    correction: "değil mi",
    reason: "Soru eki ayrı yazılır."
  },
  {
    regex: /\bgelirmisin\b/giu,
    correction: "gelir misin",
    reason: "Soru eki ayrı yazılır."
  },
  {
    regex: /\byaparmısın\b/giu,
    correction: "yapar mısın",
    reason: "Soru eki ayrı yazılır."
  },
  {
    regex: /\bgelecekmi\b/giu,
    correction: "gelecek mi",
    reason: "Soru eki ayrı yazılır."
  },
  {
    regex: /\bvarmı\b/giu,
    correction: "var mı",
    reason: "Soru eki ayrı yazılır."
  },
  {
    regex: /\byokmu\b/giu,
    correction: "yok mu",
    reason: "Soru eki ayrı yazılır."
  },
  {
    regex: /\bkimmi\b/giu,
    correction: "kim mi",
    reason: "Soru eki ayrı yazılır."
  }
];

/* =========================================================
   ENGLISH OBJECTIVE SPELLING DICTIONARY
========================================================= */

const EN_WORD_ERRORS = {
  "recieve": "receive",
  "recieved": "received",
  "recieving": "receiving",
  "seperate": "separate",
  "seperately": "separately",
  "definately": "definitely",
  "definitly": "definitely",
  "occured": "occurred",
  "occuring": "occurring",
  "accomodate": "accommodate",
  "accomodation": "accommodation",
  "wierd": "weird",
  "untill": "until",
  "wich": "which",
  "teh": "the",
  "beleive": "believe",
  "belived": "believed",
  "begining": "beginning",
  "enviroment": "environment",
  "goverment": "government",
  "govermental": "governmental",
  "succesful": "successful",
  "succesfully": "successfully",
  "tommorow": "tomorrow",
  "tomatos": "tomatoes",
  "potatos": "potatoes",
  "adress": "address",
  "addres": "address",
  "acheive": "achieve",
  "acheived": "achieved",
  "arguement": "argument",
  "calender": "calendar",
  "comming": "coming",
  "commited": "committed",
  "commitee": "committee",
  "concious": "conscious",
  "curiousity": "curiosity",
  "embarass": "embarrass",
  "embarassed": "embarrassed",
  "existance": "existence",
  "experiance": "experience",
  "finaly": "finally",
  "freind": "friend",
  "grammer": "grammar",
  "happend": "happened",
  "independant": "independent",
  "knowlege": "knowledge",
  "liason": "liaison",
  "maintainance": "maintenance",
  "neccessary": "necessary",
  "noticable": "noticeable",
  "occassion": "occasion",
  "posession": "possession",
  "prefered": "preferred",
  "priviledge": "privilege",
  "publically": "publicly",
  "realy": "really",
  "recomend": "recommend",
  "recomendation": "recommendation",
  "refered": "referred",
  "responsability": "responsibility",
  "restarant": "restaurant",
  "rythm": "rhythm",
  "suprise": "surprise",
  "thier": "their",
  "treshold": "threshold",
  "truely": "truly",
  "usefull": "useful",
  "writting": "writing",
  "adressess": "addresses",
  "analisis": "analysis",
  "analyses": "analyses",
  "apparant": "apparent",
  "arguements": "arguments",
  "basicly": "basically",
  "buisness": "business",
  "businesss": "business",
  "comming": "coming",
  "completly": "completely",
  "dissapear": "disappear",
  "dissapoint": "disappoint",
  "efficent": "efficient",
  "exagerate": "exaggerate",
  "gaurd": "guard",
  "heigth": "height",
  "immediatly": "immediately",
  "lable": "label",
  "occurence": "occurrence",
  "persue": "pursue",
  "succes": "success",
  "tommorrow": "tomorrow"
};

/* =========================================================
   PROTECTED TOKENS
========================================================= */

function isProtectedToken(token) {
  if (!token) return true;

  if (/^https?:\/\//i.test(token)) return true;
  if (/^www\./i.test(token)) return true;
  if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(token)) return true;

  if (
    /^(?:\d{1,4}[./-]){1,2}\d{1,4}$/.test(token) ||
    /^\d+(?:[.,]\d+)?%?$/.test(token)
  ) {
    return true;
  }

  if (/^[A-ZÇĞİÖŞÜ]{2,6}$/.test(token)) return true;

  return false;
}

/* =========================================================
   DETERMINISTIC WORD SCANNER
========================================================= */

function scanDictionary(text, dictionary, language) {
  const findings = [];

  for (const [wrong, right] of Object.entries(dictionary)) {
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`,
      "giu"
    );

    let match;

    while ((match = regex.exec(text))) {
      const original = match[2];

      if (isProtectedToken(original)) continue;

      const correction = preserveCase(original, right);

      if (original.toLocaleLowerCase("tr-TR") === correction.toLocaleLowerCase("tr-TR")) {
        continue;
      }

      const start = match.index + match[1].length;

      findings.push({
        original,
        correction,
        type: "spelling",
        confidence: 1,
        reason:
          language === "tr"
            ? "Türkçe objektif yazım kuralı / doğrulanmış hata sözlüğü."
            : "İngilizce objektif yazım kuralı / doğrulanmış hata sözlüğü.",
        start,
        end: start + original.length,
        source: "deterministic"
      });
    }
  }

  return findings;
}

/* =========================================================
   REPEATED CHARACTER DETECTOR
   Only obvious cases are accepted.
========================================================= */

function scanObviousRepeatedCharacters(text, language) {
  const findings = [];

  /*
   * 3+ repeated letters are almost always accidental in normal prose.
   * We deliberately don't flag 2 repeated letters because words like
   * "hissetmek", "success", "committee" are legitimate.
   */
  const regex = /\b(\p{L})\1\1+\b/giu;

  let match;

  while ((match = regex.exec(text))) {
    const original = match[0];

    if (isProtectedToken(original)) continue;

    const lower = original.toLocaleLowerCase(
      language === "tr" ? "tr-TR" : "en-US"
    );

    /*
     * Avoid known legitimate long-character cases.
     */
    const legitimate = [
      "aaa",
      "bbb",
      "ccc",
      "ddd",
      "eee",
      "fff",
      "ggg",
      "xxx"
    ];

    if (legitimate.includes(lower)) continue;

    const first = match[1];

    const correction = original.replace(
      new RegExp(`${first}{3,}`, "iu"),
      first + first
    );

    if (correction === original) continue;

    findings.push({
      original,
      correction,
      type: "spelling",
      confidence: 0.96,
      reason: "Aynı harfin olağandışı biçimde üç veya daha fazla kez tekrarlanması.",
      start: match.index,
      end: match.index + original.length,
      source: "deterministic"
    });
  }

  return findings;
}

/* =========================================================
   OBVIOUS SPACE / WORD COMBINATION SCANNER
========================================================= */

function scanTurkishCompoundPatterns(text) {
  const findings = [];

  const patterns = [
    ["bir şey", "birşey"],
    ["her şey", "herşey"],
    ["şu an", "şuan"],
    ["şu anda", "şuanda"],
    ["yanı sıra", "yanısıra"],
    ["yüz yüze", "yüzyüze"],
    ["art arda", "ardarda"],
    ["peş peşe", "peşpeşe"],
    ["iç içe", "içiçe"],
    ["yan yana", "yanyana"],
    ["baş başa", "başbaşa"],
    ["omuz omuza", "omuzomuza"],
    ["el ele", "elele"],
    ["göz göze", "gözgöze"],
    ["arka arkaya", "arkaarkaya"],
    ["sık sık", "sıksık"]
  ];

  for (const [correct, wrong] of patterns) {
    const regex = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\p{L}\\p{N}])`,
      "giu"
    );

    let match;

    while ((match = regex.exec(text))) {
      const original = match[2];

      findings.push({
        original,
        correction: preserveCase(original, correct),
        type: "word-spacing",
        confidence: 0.99,
        reason: "Türkçe sözcüklerin doğru yazım biçimine aykırı birleşik/ayrı kullanım.",
        start: match.index + match[1].length,
        end: match.index + match[1].length + original.length,
        source: "deterministic"
      });
    }
  }

  return findings;
}

/* =========================================================
   TURKISH QUESTION SUFFIX
========================================================= */

function scanTurkishQuestionSuffix(text) {
  const findings = [];

  const regex =
    /\b([\p{L}]+)(mı|mi|mu|mü)(sın|sin|sun|sün|yım|yim|yum|yüm|dır|dir|dur|dür|?)\b/giu;

  let match;

  while ((match = regex.exec(text))) {
    const whole = match[0];

    if (whole.length < 4) continue;

    /*
     * Only handle obvious fused forms.
     * We don't attempt full Turkish morphology here.
     */
    const base = match[1];
    const question = match[2];
    const suffix = match[3] || "";

    const knownBad =
      /\b(?:değilmi|varmı|yokmu|gelecekmi|geldimi|oldu mu|olacakmı|olurmu)\b/iu.test(
        whole
      );

    if (!knownBad) continue;

    let correction = `${base} ${question}`;

    if (suffix) correction += ` ${suffix}`;

    findings.push({
      original: whole,
      correction,
      type: "grammar",
      confidence: 0.98,
      reason: "Türkçede soru eki ayrı yazılır.",
      start: match.index,
      end: match.index + whole.length,
      source: "deterministic"
    });
  }

  return findings;
}

/* =========================================================
   PUNCTUATION ENGINE
========================================================= */

function scanObviousPunctuation(text) {
  const findings = [];

  /*
   * We intentionally limit this engine to objectively wrong cases.
   * It does NOT flag generic spaces before commas/periods because
   * those caused false positives in the previous version.
   */

  const patterns = [
    {
      regex: /([!?.,;:])\1{2,}/g,
      correction: "$1",
      reason: "Aynı noktalama işaretinin gereksiz biçimde art arda tekrarlanması."
    },
    {
      regex: / {2,}([,.;:!?])/g,
      correction: "$1",
      reason: "Noktalama işaretinden önce gereksiz boşluk bulunuyor."
    }
  ];

  for (const p of patterns) {
    let match;

    while ((match = p.regex.exec(text))) {
      const original = match[0];

      findings.push({
        original,
        correction: original.replace(p.regex, p.correction),
        type: "punctuation",
        confidence: 0.97,
        reason: p.reason,
        start: match.index,
        end: match.index + original.length,
        source: "deterministic"
      });
    }
  }

  return findings;
}

/* =========================================================
   CAPITALIZATION ENGINE
========================================================= */

function scanTurkishCapitalization(text) {
  const findings = [];

  /*
   * Sentence starts that are clearly lowercase.
   * We don't touch names or abbreviations.
   */
  const regex = /(^|[.!?]\s+)([a-zçğıöşü])([\p{L}]*)/gu;

  let match;

  while ((match = regex.exec(text))) {
    const original = match[2] + match[3];

    if (!original) continue;

    /*
     * URLs / email / abbreviations are protected by surrounding
     * structure and normal prose checks.
     */
    const correction =
      original.charAt(0).toLocaleUpperCase("tr-TR") + original.slice(1);

    if (original === correction) continue;

    findings.push({
      original,
      correction,
      type: "capitalization",
      confidence: 0.94,
      reason: "Cümle başlangıcında büyük harf kullanılması gerekir.",
      start: match.index + match[1].length,
      end:
        match.index +
        match[1].length +
        original.length,
      source: "deterministic"
    });
  }

  return findings;
}

/* =========================================================
   AMBIGUOUS TURKISH PATTERN SCANNER
========================================================= */

function scanAmbiguousPatterns(text) {
  const findings = [];

  for (const item of TR_AMBIGUOUS_PATTERNS) {
    let match;

    while ((match = item.regex.exec(text))) {
      const original = match[0];

      findings.push({
        original,
        correction: item.correction,
        type: "grammar",
        confidence: 0.91,
        reason: item.reason,
        start: match.index,
        end: match.index + original.length,
        source: "deterministic-ambiguous"
      });
    }
  }

  return findings;
}

/* =========================================================
   WORD TOKENIZATION
========================================================= */

function tokenize(text) {
  return text.match(
    /https?:\/\/[^\s]+|www\.[^\s]+|[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|\d+(?:[.,]\d+)?%?|[^\s]+/gu
  ) || [];
}

/* =========================================================
   STATISTICS
========================================================= */

function calculateTextStats(text) {
  const words = tokenize(text).filter((x) => /\p{L}/u.test(x));

  const sentences = text
    .split(/[.!?]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  return {
    characters: text.length,
    words: words.length,
    sentences: sentences.length
  };
}

/* =========================================================
   DEDUPLICATION
========================================================= */

function dedupeFindings(findings) {
  const map = new Map();

  for (const item of findings) {
    if (!item.original || !item.correction) continue;

    const key = [
      item.original.toLocaleLowerCase("tr-TR"),
      item.correction.toLocaleLowerCase("tr-TR"),
      item.type,
      item.start
    ].join("|");

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.start - b.start);
}

/* =========================================================
   DETERMINISTIC MASTER ENGINE
========================================================= */

function deterministicProofread(text, language) {
  let findings = [];

  if (language === "tr") {
    findings.push(...scanDictionary(text, TR_WORD_ERRORS, "tr"));
    findings.push(...scanTurkishCompoundPatterns(text));
    findings.push(...scanTurkishQuestionSuffix(text));
    findings.push(...scanTurkishCapitalization(text));
    findings.push(...scanAmbiguousPatterns(text));
  }

  if (language === "en") {
    findings.push(...scanDictionary(text, EN_WORD_ERRORS, "en"));
  }

  findings.push(...scanObviousRepeatedCharacters(text, language));
  findings.push(...scanObviousPunctuation(text));

  findings = dedupeFindings(findings);

  return findings.map((item) => ({
    original: item.original,
    correction: item.correction,
    type: item.type,
    confidence: item.confidence,
    reason: item.reason,
    start: item.start,
    end: item.end,
    source: item.source
  }));
}

/* =========================================================
   AI TEXT CHUNKING
========================================================= */

function splitIntoChunks(text, maxChars = 5000) {
  const chunks = [];

  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);

      if (paragraphBreak > start + 2500) {
        end = paragraphBreak;
      } else {
        const sentenceBreak = Math.max(
          text.lastIndexOf(". ", end),
          text.lastIndexOf("! ", end),
          text.lastIndexOf("? ", end)
        );

        if (sentenceBreak > start + 2500) {
          end = sentenceBreak + 1;
        }
      }
    }

    chunks.push({
      text: text.slice(start, end),
      offset: start
    });

    start = end;
  }

  return chunks;
}

/* =========================================================
   AI OUTPUT VALIDATION
========================================================= */

function validateAIItem(item, sourceText) {
  if (!item || typeof item !== "object") return null;

  const original = String(item.original || "").trim();
  const correction = String(item.correction || "").trim();
  const reason = String(item.reason || "").trim();

  const confidence = Number(item.confidence);

  if (!original || !correction) return null;

  if (!Number.isFinite(confidence) || confidence < 0.9) {
    return null;
  }

  if (original === correction) return null;

  if (original.length > 160 || correction.length > 160) {
    return null;
  }

  if (!sourceText.includes(original)) {
    return null;
  }

  /*
   * AI must not return giant rewritten passages.
   */
  if (correction.length > original.length * 4 && correction.length > 30) {
    return null;
  }

  return {
    original,
    correction,
    type: String(item.type || "grammar"),
    confidence: Math.min(confidence, 1),
    reason: reason || "Bağlamsal dil denetimi.",
    source: "ai"
  };
}

function validateAIResponse(payload, sourceText) {
  let items = [];

  if (Array.isArray(payload)) {
    items = payload;
  } else if (Array.isArray(payload?.errors)) {
    items = payload.errors;
  } else if (Array.isArray(payload?.findings)) {
    items = payload.findings;
  }

  const validated = [];

  for (const item of items) {
    const v = validateAIItem(item, sourceText);

    if (v) {
      v.start = sourceText.indexOf(v.original);
      v.end = v.start + v.original.length;
      validated.push(v);
    }
  }

  return dedupeFindings(validated);
}

/* =========================================================
   GEMINI
========================================================= */

async function callGemini(env, text, language) {
  if (!env.GEMINI_API_KEY) {
    return {
      success: false,
      status: null,
      error: "GEMINI_API_KEY yok."
    };
  }

  const prompt = `
You are an expert professional copy editor.

Analyze the following ${language === "tr" ? "Turkish" : "English"} news text.

Your task is NOT to rewrite the article.

Only identify OBJECTIVE:
- spelling errors
- grammar errors
- incorrect word separation
- incorrect word joining
- objectively wrong punctuation
- objectively wrong capitalization
- clearly incorrect word usage

DO NOT flag:
- style preferences
- alternative wording
- political opinions
- names
- brands
- organizations
- URLs
- dates
- numbers
- abbreviations
- dialect choices
- journalistic style
- intentional quotations
- headline style unless objectively incorrect

VERY IMPORTANT:
"original" MUST be an EXACT substring copied from the supplied text.
"correction" must be the SMALLEST possible correction.
Do not return rewritten sentences.
Only return errors with confidence >= 0.90.

Return ONLY valid JSON in this exact structure:

{
  "errors": [
    {
      "original": "...",
      "correction": "...",
      "type": "spelling|grammar|word-spacing|punctuation|capitalization|word-usage",
      "confidence": 0.95,
      "reason": "short objective explanation"
    }
  ]
}

TEXT:
${text}
`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        GEMINI_MODEL +
        ":generateContent?key=" +
        encodeURIComponent(env.GEMINI_API_KEY),
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const raw = await response.text();

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: raw.slice(0, 3000)
      };
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return {
        success: false,
        status: response.status,
        error: "Gemini JSON response parse edilemedi."
      };
    }

    const output =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || "";

    if (!output) {
      return {
        success: false,
        status: response.status,
        error: "Gemini boş cevap verdi."
      };
    }

    let parsed;

    try {
      parsed = JSON.parse(output);
    } catch {
      const match = output.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          success: false,
          status: response.status,
          error: "Gemini geçerli JSON döndürmedi."
        };
      }

      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return {
          success: false,
          status: response.status,
          error: "Gemini JSON parse hatası."
        };
      }
    }

    return {
      success: true,
      status: response.status,
      errors: validateAIResponse(parsed, text)
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error:
        error?.name === "AbortError"
          ? "Gemini timeout."
          : String(error?.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   NVIDIA
========================================================= */

function extractNvidiaJSON(text) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);

  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {}
  }

  return null;
}

async function callNvidia(env, text, language) {
  if (!env.NVIDIA_API_KEY) {
    return {
      success: false,
      status: null,
      error: "NVIDIA_API_KEY yok."
    };
  }

  const prompt = `
You are a strict professional ${language === "tr" ? "Turkish" : "English"} news copy editor.

Find only objective spelling, grammar, word-spacing, punctuation or capitalization errors.

Never rewrite stylistically.
Never invent an error.
Never modify names, brands, URLs, dates, numbers or quotations unless objectively incorrect.

Every "original" value MUST be copied EXACTLY from the text.

Return JSON only:

{
  "errors": [
    {
      "original": "...",
      "correction": "...",
      "type": "spelling|grammar|word-spacing|punctuation|capitalization|word-usage",
      "confidence": 0.95,
      "reason": "short objective explanation"
    }
  ]
}

TEXT:
${text}
`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);

  try {
    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.NVIDIA_API_KEY}`
        },
        body: JSON.stringify({
          model: NVIDIA_MODEL,
          messages: [
            {
              role: "system",
              content: "Return only valid JSON."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0,
          max_tokens: 1800,
          stream: false
        })
      }
    );

    const raw = await response.text();

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: raw.slice(0, 3000)
      };
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return {
        success: false,
        status: response.status,
        error: "NVIDIA JSON response parse edilemedi."
      };
    }

    const output =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      "";

    if (!output) {
      return {
        success: false,
        status: response.status,
        error: "NVIDIA boş cevap verdi."
      };
    }

    const parsed = extractNvidiaJSON(output);

    if (!parsed) {
      return {
        success: false,
        status: response.status,
        error: "NVIDIA geçerli JSON döndürmedi."
      };
    }

    return {
      success: true,
      status: response.status,
      errors: validateAIResponse(parsed, text)
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error:
        error?.name === "AbortError"
          ? "NVIDIA timeout."
          : String(error?.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   ARTICLE ANALYSIS
========================================================= */

async function analyzeArticle(article, env) {
  const language = detectLanguage(article.text);
  const stats = calculateTextStats(article.text);

  /*
   * STEP 1
   * Every word / deterministic rule is checked immediately.
   */
  const deterministic = deterministicProofread(
    article.text,
    language === "unknown" ? "tr" : language
  );

  /*
   * STEP 2
   * AI is NOT called when deterministic engine has already
   * found objective errors.
   *
   * This keeps obvious errors extremely fast.
   */
  if (deterministic.length > 0) {
    return {
      ...article,
      language,
      stats,
      errors: deterministic,
      ai: {
        used: false,
        reason: "Deterministic engine found objective errors."
      }
    };
  }

  /*
   * STEP 3
   * No obvious deterministic error.
   * Now the article is sent to AI for contextual/nuisance checking.
   *
   * Long articles are divided into chunks so errors later in the
   * article are not missed.
   */

  const chunks = splitIntoChunks(article.text, 5000);

  const aiErrors = [];

  /*
   * To stay fast and avoid unnecessary API pressure,
   * analyze only a controlled number of chunks.
   */
  const maxChunks = Math.min(chunks.length, 8);

  let geminiUsed = false;
  let nvidiaUsed = false;
  let geminiFailures = 0;
  let nvidiaFailures = 0;

  for (let i = 0; i < maxChunks; i++) {
    const chunk = chunks[i];

    /*
     * First AI: Gemini.
     */
    const gemini = await callGemini(
      env,
      chunk.text,
      language === "unknown" ? "tr" : language
    );

    if (gemini.success) {
      geminiUsed = true;

      for (const item of gemini.errors || []) {
        aiErrors.push({
          ...item,
          start:
            item.start == null
              ? chunk.offset + chunk.text.indexOf(item.original)
              : chunk.offset + item.start,
          end:
            item.end == null
              ? chunk.offset +
                chunk.text.indexOf(item.original) +
                item.original.length
              : chunk.offset + item.end
        });
      }

      continue;
    }

    geminiFailures++;

    /*
     * Gemini unavailable -> NVIDIA fallback.
     */
    const nvidia = await callNvidia(
      env,
      chunk.text,
      language === "unknown" ? "tr" : language
    );

    if (nvidia.success) {
      nvidiaUsed = true;

      for (const item of nvidia.errors || []) {
        aiErrors.push({
          ...item,
          start:
            item.start == null
              ? chunk.offset + chunk.text.indexOf(item.original)
              : chunk.offset + item.start,
          end:
            item.end == null
              ? chunk.offset +
                chunk.text.indexOf(item.original) +
                item.original.length
              : chunk.offset + item.end
        });
      }
    } else {
      nvidiaFailures++;
    }
  }

  /*
   * Final safety validation.
   */
  const finalErrors = [];

  for (const item of aiErrors) {
    const absoluteOriginal = article.text.slice(item.start, item.end);

    if (absoluteOriginal !== item.original) {
      continue;
    }

    finalErrors.push({
      original: item.original,
      correction: item.correction,
      type: item.type,
      confidence: item.confidence,
      reason: item.reason,
      start: item.start,
      end: item.end,
      source: item.source
    });
  }

  return {
    ...article,
    language,
    stats,
    errors: dedupeFindings(finalErrors),
    ai: {
      used: true,
      geminiUsed,
      nvidiaUsed,
      geminiFailures,
      nvidiaFailures,
      chunksAnalyzed: maxChunks
    }
  };
}

/* =========================================================
   CRAWLER
========================================================= */

async function crawl(startURL, env) {
  const root = safeURL(startURL);

  if (!root) {
    throw new Error("Geçerli bir HTTP/HTTPS URL girin.");
  }

  const queue = [root.toString()];
  const queued = new Set(queue);
  const visited = new Set();

  const articles = [];
  const articleURLs = new Set();

  let pages = 0;
  let fetchErrors = 0;

  while (
    queue.length > 0 &&
    pages < MAX_PAGES &&
    articles.length < MAX_ARTICLES
  ) {
    const current = queue.shift();

    if (visited.has(current)) continue;

    visited.add(current);
    pages++;

    const url = safeURL(current);

    if (!url || !sameOrigin(root, url)) {
      continue;
    }

    let response;

    try {
      response = await fetchTimeout(current);
    } catch {
      fetchErrors++;
      continue;
    }

    if (!response.ok) {
      fetchErrors++;
      continue;
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      continue;
    }

    let htmlText;

    try {
      htmlText = await response.text();
    } catch {
      fetchErrors++;
      continue;
    }

    if (htmlText.length > MAX_HTML_BYTES) {
      htmlText = htmlText.slice(0, MAX_HTML_BYTES);
    }

    const article = extractArticle(htmlText, url);

    if (
      article &&
      article.url &&
      !articleURLs.has(article.url)
    ) {
      articleURLs.add(article.url);
      articles.push(article);
    }

    /*
     * Discover internal links.
     */
    const linkRegex =
      /<a[^>]+href=["']([^"'#]+)["']/gi;

    let match;

    while (
      (match = linkRegex.exec(htmlText)) &&
      queue.length < MAX_LINKS
    ) {
      const raw = decodeEntities(match[1]).trim();

      if (!raw) continue;

      try {
        const child = new URL(raw, current);

        if (
          (child.protocol !== "http:" &&
            child.protocol !== "https:") ||
          !sameOrigin(root, child)
        ) {
          continue;
        }

        child.hash = "";

        if (isBadPath(child)) continue;

        const normalized = child.toString();

        if (!queued.has(normalized) && !visited.has(normalized)) {
          queued.add(normalized);

          /*
           * Article-like URLs go to the front of queue.
           */
          if (isArticlePath(child)) {
            queue.unshift(normalized);
          } else {
            queue.push(normalized);
          }
        }
      } catch {}
    }
  }

  /*
   * Analyze articles sequentially to protect Worker subrequest
   * limits and keep the system predictable.
   */
  const analyzed = [];

  for (const article of articles) {
    const result = await analyzeArticle(article, env);
    analyzed.push(result);
  }

  const totalErrors = analyzed.reduce(
    (sum, item) => sum + item.errors.length,
    0
  );

  return {
    ok: true,
    version: VERSION,
    source: root.toString(),
    scannedAt: new Date().toISOString(),
    pages,
    fetchErrors,
    articlesFound: analyzed.length,
    totalErrors,
    articles: analyzed
  };
}

/* =========================================================
   AI TEST
========================================================= */

async function aiTest(env) {
  const testText =
    "Bu bir test metnidir. Herkez bu testi görebilir.";

  const deterministic = deterministicProofread(
    testText,
    "tr"
  );

  const result = {
    ok: true,
    deterministic,
    gemini: {
      configured: Boolean(env.GEMINI_API_KEY),
      success: false,
      status: null,
      error: null
    },
    nvidia: {
      configured: Boolean(env.NVIDIA_API_KEY),
      success: false,
      status: null,
      error: null
    }
  };

  if (env.GEMINI_API_KEY) {
    const gemini = await callGemini(
      env,
      testText,
      "tr"
    );

    result.gemini = {
      configured: true,
      success: gemini.success,
      status: gemini.status,
      errors: gemini.errors || [],
      error: gemini.error || null
    };
  }

  if (env.NVIDIA_API_KEY) {
    const nvidia = await callNvidia(
      env,
      testText,
      "tr"
    );

    result.nvidia = {
      configured: true,
      success: nvidia.success,
      status: nvidia.status,
      errors: nvidia.errors || [],
      error: nvidia.error || null
    };
  }

  return result;
}

/* =========================================================
   FRONTEND
========================================================= */

const FRONTEND = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebProof AI</title>

<style>
*{box-sizing:border-box}
body{
  margin:0;
  font-family:Inter,Arial,sans-serif;
  background:#0b1020;
  color:#f5f7fb;
}
.container{
  max-width:1100px;
  margin:0 auto;
  padding:28px 18px 60px;
}
header{
  margin-bottom:24px;
}
h1{
  margin:0 0 8px;
  font-size:34px;
}
.subtitle{
  color:#aeb7cc;
  line-height:1.5;
}
.panel{
  background:#131a2d;
  border:1px solid #27314a;
  border-radius:16px;
  padding:18px;
  margin-bottom:18px;
}
.row{
  display:flex;
  gap:10px;
}
input{
  flex:1;
  min-width:0;
  background:#0b1020;
  color:white;
  border:1px solid #33405e;
  border-radius:10px;
  padding:14px;
  font-size:16px;
}
button{
  border:0;
  border-radius:10px;
  padding:14px 20px;
  cursor:pointer;
  font-weight:700;
  font-size:15px;
}
#scanBtn{
  background:#fff;
  color:#111827;
}
.stats{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:10px;
}
.stat{
  background:#0d1426;
  border:1px solid #27314a;
  border-radius:12px;
  padding:14px;
}
.stat b{
  display:block;
  font-size:25px;
  margin-bottom:4px;
}
.stat span{
  color:#9ca8c1;
  font-size:13px;
}
.article{
  border:1px solid #2a3550;
  border-radius:14px;
  margin-top:15px;
  overflow:hidden;
}
.articleHead{
  padding:15px;
  background:#10182b;
}
.articleTitle{
  font-weight:700;
  font-size:18px;
}
.articleUrl{
  display:block;
  margin-top:7px;
  color:#8fb7ff;
  word-break:break-all;
  font-size:13px;
}
.articleBody{
  padding:15px;
}
.error{
  border-left:4px solid #ff4d4d;
  background:#24131a;
  padding:13px;
  margin:10px 0;
  border-radius:8px;
}
.errorTitle{
  font-weight:800;
  margin-bottom:7px;
}
.original{
  color:#ff9b9b;
  font-weight:700;
}
.correction{
  color:#8ff0aa;
  font-weight:700;
}
.meta{
  color:#adb8cc;
  font-size:13px;
  margin-top:7px;
  line-height:1.5;
}
.ok{
  padding:14px;
  border-radius:10px;
  background:#10231a;
  color:#8ff0aa;
}
.loading{
  color:#aeb7cc;
}
.small{
  color:#8894ab;
  font-size:13px;
  margin-top:12px;
}
@media(max-width:700px){
  .row{flex-direction:column}
  .stats{grid-template-columns:repeat(2,1fr)}
  h1{font-size:27px}
}
</style>
</head>

<body>

<div class="container">

<header>
<h1>WebProof AI</h1>
<div class="subtitle">
Gerçek web taraması + deterministik dil denetimi +
bağlamsal yapay zekâ doğrulaması
</div>
</header>

<div class="panel">

<div class="row">
<input id="url" type="url"
placeholder="https://www.ornekhaber.com">
<button id="scanBtn" onclick="scan()">Siteyi Tara</button>
</div>

<div class="small">
Önce kod tabanlı objektif denetim yapılır.
Nüans gerektiren durumlarda yapay zekâ devreye girer.
</div>

</div>

<div id="stats"></div>
<div id="result"></div>

</div>

<script>

async function scan(){

  const input=document.getElementById("url");
  const button=document.getElementById("scanBtn");
  const result=document.getElementById("result");
  const stats=document.getElementById("stats");

  const url=input.value.trim();

  if(!url){
    result.innerHTML='<div class="panel">Lütfen bir site adresi girin.</div>';
    return;
  }

  button.disabled=true;
  button.textContent="Taranıyor...";

  stats.innerHTML="";
  result.innerHTML=
    '<div class="panel loading">Gerçek web taraması başlatıldı. Sayfalar ve haberler analiz ediliyor...</div>';

  try{

    const response=await fetch(
      "/api/scan?url="+encodeURIComponent(url)
    );

    const data=await response.json();

    if(!response.ok || !data.ok){
      throw new Error(data.error || "Tarama başarısız.");
    }

    stats.innerHTML=
      '<div class="stats">'+
      stat(data.pages,"Sayfa")+
      stat(data.articlesFound,"Haber")+
      stat(data.totalErrors,"Hata")+
      stat(data.fetchErrors,"Fetch hatası")+
      '</div>';

    renderArticles(data.articles || []);

  }catch(error){

    result.innerHTML=
      '<div class="panel">'+
      '<b>Tarama hatası:</b> '+
      escapeHtml(error.message)+
      '</div>';

  }finally{

    button.disabled=false;
    button.textContent="Siteyi Tara";
  }
}

function stat(value,label){
  return '<div class="stat"><b>'+
    escapeHtml(String(value))+
    '</b><span>'+
    escapeHtml(label)+
    '</span></div>';
}

function renderArticles(articles){

  const result=document.getElementById("result");

  if(!articles.length){
    result.innerHTML=
      '<div class="panel">'+
      'Gerçek haber içeriği tespit edilemedi.'+
      '</div>';
    return;
  }

  let html="";

  for(const article of articles){

    html+='<div class="panel article">';

    html+='<div class="articleHead">';

    html+='<div class="articleTitle">'+
      escapeHtml(article.title || "Başlıksız haber")+
      '</div>';

    html+='<a class="articleUrl" href="'+
      escapeAttr(article.url)+
      '" target="_blank" rel="noopener noreferrer">'+
      escapeHtml(article.url)+
      '</a>';

    html+='</div>';

    html+='<div class="articleBody">';

    if(article.errors && article.errors.length){

      for(const error of article.errors){

        html+='<div class="error">';

        html+='<div class="errorTitle">'+
          '🔴 Bu haberde doğrulanmış hata bulundu'+
          '</div>';

        html+='<div>'+
          '<span class="original">'+
          escapeHtml(error.original)+
          '</span>'+
          ' → '+
          '<span class="correction">'+
          escapeHtml(error.correction)+
          '</span>'+
          '</div>';

        html+='<div class="meta">'+
          'Tür: '+escapeHtml(error.type)+
          '<br>'+
          'Güven: '+Math.round(Number(error.confidence)*100)+'%'+
          '<br>'+
          escapeHtml(error.reason)+
          '<br><br>'+
          '<b>Kaynak haber:</b> '+
          '<a href="'+escapeAttr(article.url)+
          '" target="_blank" rel="noopener noreferrer">'+
          escapeHtml(article.url)+
          '</a>'+
          '</div>';

        html+='</div>';
      }

    }else{

      html+=
        '<div class="ok">'+
        '✓ Bu haberde doğrulanmış objektif hata bulunmadı.'+
        '</div>';

    }

    const ai=article.ai || {};

    html+='<div class="small">'+
      'Dil: '+escapeHtml(article.language || "unknown")+
      ' · Kelime: '+escapeHtml(String(article.stats?.words || 0))+
      ' · Cümle: '+escapeHtml(String(article.stats?.sentences || 0))+
      ' · AI: '+(ai.used ? "kullanıldı" : "gerekmedi")+
      '</div>';

    html+='</div>';
    html+='</div>';
  }

  result.innerHTML=html;
}

function escapeHtml(value){

  return String(value)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function escapeAttr(value){
  return escapeHtml(value);
}

</script>

</body>
</html>`;

/* =========================================================
   WORKER
========================================================= */

export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "Content-Type"
        }
      });
    }

    if (url.pathname === "/api/status") {

      return json({
        ok: true,
        service: "WebProof AI",
        version: VERSION,

        ai: {
          gemini: Boolean(env.GEMINI_API_KEY),
          nvidia: Boolean(env.NVIDIA_API_KEY),
          primary: "gemini"
        },

        models: {
          gemini: GEMINI_MODEL,
          nvidia: NVIDIA_MODEL
        },

        architecture: {
          deterministic: true,
          fullTextWordScanning: true,
          turkishRuleEngine: true,
          englishRuleEngine: true,
          ambiguousAIAnalysis: true,
          aiFallback: true,
          exactSubstringValidation: true,
          sourceURLEvidence: true,
          falsePositiveFiltering: true
        },

        limits: {
          maxPages: MAX_PAGES,
          maxArticles: MAX_ARTICLES,
          maxLinks: MAX_LINKS,
          maxArticleCharacters: MAX_ARTICLE_TEXT
        },

        capabilities: [
          "real-web-crawling",
          "article-detection",
          "full-article-text-analysis",
          "Turkish-objective-spelling",
          "Turkish-word-spacing",
          "Turkish-question-suffix",
          "Turkish-capitalization",
          "Turkish-punctuation",
          "English-spelling",
          "repeated-character-detection",
          "deterministic-proofreading",
          "AI-contextual-analysis",
          "Gemini",
          "NVIDIA",
          "exact-substring-validation",
          "exact-source-URL",
          "false-positive-filtering"
        ]
      });
    }

    if (url.pathname === "/api/ai-test") {
      return json(await aiTest(env));
    }

    if (url.pathname === "/api/scan") {

      const target = url.searchParams.get("url");

      if (!target) {
        return json(
          {
            ok: false,
            error: "url parametresi gerekli."
          },
          400
        );
      }

      try {

        const result = await crawl(target, env);

        return json(result);

      } catch (error) {

        return json(
          {
            ok: false,
            error: String(error?.message || error)
          },
          500
        );
      }
    }

    return html(FRONTEND);
  }
};

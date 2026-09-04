const VERSION = "production-editorial-5.1";

const MAX_PAGES = 30;
const MAX_ARTICLES = 15;
const MAX_LINKS = 180;
const MAX_HTML_BYTES = 1800000;
const MAX_ARTICLE_TEXT = 50000;

const FETCH_TIMEOUT = 6000;
const AI_TIMEOUT = 7000;

const GEMINI_MODEL = "gemini-3.7-flash";
const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

const USER_AGENT =
  "Mozilla/5.0 (compatible; WebProofAI/5.1; +https://webproof-ai.mmstkynr.workers.dev)";


/* =========================================================
   RESPONSE
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
   URL
========================================================= */

function safeURL(value) {
  try {
    const u = new URL(value);

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }

    const host = u.hostname.toLowerCase();

    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".localhost")
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


/* =========================================================
   FETCH
========================================================= */

async function fetchTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      redirect: "follow",
      signal: controller.signal,
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
   HTML -> TEXT
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

function htmlToText(source) {
  let text = source;

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

  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


/* =========================================================
   META
========================================================= */

function extractTitle(source) {
  const m = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  return m
    ? decodeEntities(m[1]).replace(/\s+/g, " ").trim()
    : "";
}

function getMeta(source, name) {
  const a = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    "i"
  );

  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
    "i"
  );

  const x = source.match(a);
  if (x) return decodeEntities(x[1]).trim();

  const y = source.match(b);
  return y ? decodeEntities(y[1]).trim() : "";
}

function getJSONLD(source) {
  const result = [];

  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let m;

  while ((m = regex.exec(source))) {
    try {
      const parsed = JSON.parse(m[1].trim());

      if (Array.isArray(parsed)) {
        result.push(...parsed);
      } else {
        result.push(parsed);
      }
    } catch {}
  }

  return result;
}


/* =========================================================
   ARTICLE DETECTION
========================================================= */

const BAD_PATHS = [
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
  "/privacy",
  "/contact",
  "/iletisim",
  "/about",
  "/hakkimizda"
];

function isBadPath(url) {
  const p = url.pathname.toLowerCase();

  return BAD_PATHS.some((x) => p.includes(x));
}

function isArticlePath(url) {
  const p = url.pathname.toLowerCase();

  if (isBadPath(url)) return false;

  const segments = p.split("/").filter(Boolean);

  if (segments.length >= 2) return true;

  if (/\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(p)) return true;

  if (/\d{5,}/.test(p)) return true;

  return false;
}

function extractArticle(source, url) {
  const title = extractTitle(source);
  const jsonld = getJSONLD(source);

  let articleLD = null;

  for (const item of jsonld) {
    if (!item || typeof item !== "object") continue;

    const types = Array.isArray(item["@type"])
      ? item["@type"]
      : [item["@type"]];

    if (
      types.some((type) =>
        [
          "Article",
          "NewsArticle",
          "Report",
          "ReportageNewsArticle"
        ].includes(type)
      )
    ) {
      articleLD = item;
      break;
    }
  }

  const ogType = getMeta(source, "og:type");

  const blocks = [
    ...source.matchAll(
      /<article\b[^>]*>([\s\S]*?)<\/article>/gi
    )
  ];

  let best = "";

  for (const block of blocks) {
    const text = htmlToText(block[1]);

    if (text.length > best.length) {
      best = text;
    }
  }

  if (!best) {
    const main = source.match(
      /<main\b[^>]*>([\s\S]*?)<\/main>/i
    );

    if (main) {
      best = htmlToText(main[1]);
    }
  }

  if (!best) {
    const body = source.match(
      /<body\b[^>]*>([\s\S]*?)<\/body>/i
    );

    if (body) {
      best = htmlToText(body[1]);
    }
  }

  best = best
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const datePublished =
    articleLD?.datePublished ||
    getMeta(source, "article:published_time") ||
    getMeta(source, "datePublished");

  let score = 0;

  if (articleLD) score += 6;
  if (blocks.length) score += 5;
  if (ogType.toLowerCase() === "article") score += 4;
  if (datePublished) score += 2;
  if (best.length >= 1500) score += 3;
  if (best.length >= 5000) score += 2;
  if (isArticlePath(url)) score += 2;

  if (best.length < 700) score -= 5;

  if (score < 5) return null;

  const articleTitle =
    articleLD?.headline ||
    getMeta(source, "og:title") ||
    title ||
    url.pathname.split("/").pop() ||
    url.hostname;

  return {
    url: url.toString(),
    title: decodeEntities(String(articleTitle)).trim(),
    text: best.slice(0, MAX_ARTICLE_TEXT),
    datePublished,
    score
  };
}


/* =========================================================
   LANGUAGE
========================================================= */

function detectLanguage(text) {
  const sample = text
    .slice(0, 15000)
    .toLocaleLowerCase("tr-TR");

  let tr = 0;
  let en = 0;

  const trChars = sample.match(/[çğıöşü]/g) || [];
  tr += trChars.length * 2;

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
    " bugün ",
    " dün ",
    " yarın ",
    " söyledi ",
    " açıklama ",
    " hükümet ",
    " başkan ",
    " haber "
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
    " was ",
    " government ",
    " president ",
    " news "
  ];

  for (const word of trWords) {
    if (sample.includes(word)) tr++;
  }

  for (const word of enWords) {
    if (sample.includes(word)) en++;
  }

  if (tr >= en + 2) return "tr";
  if (en >= tr + 2) return "en";

  return "unknown";
}


/* =========================================================
   CASE
========================================================= */

function preserveCase(original, replacement) {
  if (original === original.toUpperCase()) {
    return replacement.toLocaleUpperCase("tr-TR");
  }

  if (
    original.length > 0 &&
    original[0] ===
      original[0].toLocaleUpperCase("tr-TR") &&
    original.slice(1) ===
      original.slice(1).toLocaleLowerCase("tr-TR")
  ) {
    return (
      replacement.charAt(0).toLocaleUpperCase("tr-TR") +
      replacement.slice(1)
    );
  }

  return replacement;
}


/* =========================================================
   TURKISH OBJECTIVE SPELLING
   NO DUPLICATE KEYS
========================================================= */

const TR_WORD_ERRORS = Object.freeze({
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
  "labaratuar": "laboratuvar",
  "şarz": "şarj",
  "traş": "tıraş",
  "kirbit": "kibrit",
  "kiprit": "kibrit",
  "eşortman": "eşofman",
  "eşşek": "eşek",
  "şöför": "şoför",
  "profosyonel": "profesyonel",
  "entellektüel": "entelektüel",
  "insiyatif": "inisiyatif",
  "tesbit": "tespit",
  "müsade": "müsaade",
  "müdahele": "müdahale",
  "muhattap": "muhatap",
  "muhattabı": "muhatabı",

  "şuan": "şu an",
  "şuanda": "şu anda",

  "birşey": "bir şey",
  "birsey": "bir şey",
  "herşey": "her şey",
  "hiçkimse": "hiç kimse",

  "hiç bir": "hiçbir",
  "her hangi": "herhangi",
  "bir çok": "birçok",
  "pekçok": "pek çok",
  "bir kaç": "birkaç",

  "bugünki": "bugünkü",
  "dünki": "dünkü",

  "yanısıra": "yanı sıra",

  "sözkonusu": "söz konusu",

  "yüzyüze": "yüz yüze",
  "ardarda": "art arda",
  "peşpeşe": "peş peşe",
  "içiçe": "iç içe",
  "yanyana": "yan yana",
  "başbaşa": "baş başa",
  "omuzomuza": "omuz omuza",
  "elele": "el ele",
  "gözgöze": "göz göze",
  "arkaarkaya": "arka arkaya",
  "sıksık": "sık sık",

  "şöyleki": "şöyle ki",
  "öyleki": "öyle ki",
  "demekki": "demek ki",

  "hükumet": "hükümet",
  "cumhurbaskani": "Cumhurbaşkanı",
  "ünüversite": "üniversite",
  "üniverste": "üniversite",

  "yanlışlıklaa": "yanlışlıkla",
  "bir az": "biraz"
});


/* =========================================================
   ENGLISH OBJECTIVE SPELLING
========================================================= */

const EN_WORD_ERRORS = Object.freeze({
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
  "tommorrow": "tomorrow",

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

  "analisis": "analysis",
  "apparant": "apparent",
  "basicly": "basically",

  "buisness": "business",
  "businesss": "business",

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
  "succes": "success"
});


/* =========================================================
   PROTECTED TOKENS
========================================================= */

function isProtectedToken(token) {
  if (!token) return true;

  if (/^https?:\/\//i.test(token)) return true;
  if (/^www\./i.test(token)) return true;

  if (
    /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(token)
  ) {
    return true;
  }

  if (
    /^\d+(?:[.,]\d+)?%?$/.test(token) ||
    /^\d{1,4}[./-]\d{1,4}[./-]\d{1,4}$/.test(token)
  ) {
    return true;
  }

  return false;
}


/* =========================================================
   DICTIONARY SCANNER
========================================================= */

function scanDictionary(text, dictionary, language) {
  const findings = [];

  for (const [wrong, right] of Object.entries(dictionary)) {
    const escaped = wrong.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const regex = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`,
      "giu"
    );

    let match;

    while ((match = regex.exec(text))) {
      const original = match[2];

      if (isProtectedToken(original)) continue;

      const correction = preserveCase(original, right);

      if (original === correction) continue;

      const start =
        match.index + match[1].length;

      findings.push({
        original,
        correction,
        type: "spelling",
        confidence: 1,
        reason:
          language === "tr"
            ? "Kesin Türkçe yazım hatası."
            : "Kesin İngilizce yazım hatası.",
        start,
        end: start + original.length,
        source: "deterministic"
      });
    }
  }

  return findings;
}


/* =========================================================
   TURKISH HIGH-CONFIDENCE RULES
========================================================= */

function scanTurkishRules(text) {
  const findings = [];

  const rules = [
    {
      regex: /\bdeğilmi\b/giu,
      correction: "değil mi",
      reason: "Türkçede soru eki 'mi' ayrı yazılır."
    },
    {
      regex: /\bvarmı\b/giu,
      correction: "var mı",
      reason: "Türkçede soru eki 'mı' ayrı yazılır."
    },
    {
      regex: /\byokmu\b/giu,
      correction: "yok mu",
      reason: "Türkçede soru eki 'mu' ayrı yazılır."
    },
    {
      regex: /\bgelecekmi\b/giu,
      correction: "gelecek mi",
      reason: "Türkçede soru eki 'mi' ayrı yazılır."
    },
    {
      regex: /\bgeldimi\b/giu,
      correction: "geldi mi",
      reason: "Türkçede soru eki 'mi' ayrı yazılır."
    },
    {
      regex: /\bolacakmı\b/giu,
      correction: "olacak mı",
      reason: "Türkçede soru eki 'mı' ayrı yazılır."
    },
    {
      regex: /\bolurmu\b/giu,
      correction: "olur mu",
      reason: "Türkçede soru eki 'mu' ayrı yazılır."
    }
  ];

  for (const rule of rules) {
    let match;

    while ((match = rule.regex.exec(text))) {
      findings.push({
        original: match[0],
        correction: rule.correction,
        type: "grammar",
        confidence: 0.99,
        reason: rule.reason,
        start: match.index,
        end: match.index + match[0].length,
        source: "deterministic"
      });
    }
  }

  return findings;
}


/* =========================================================
   REPEATED CHARACTER DETECTOR
========================================================= */

function scanRepeatedCharacters(text) {
  const findings = [];

  const regex = /\b(\p{L})\1\1+\b/giu;

  let match;

  while ((match = regex.exec(text))) {
    const original = match[0];

    if (isProtectedToken(original)) continue;

    const correction = original.replace(
      /(\p{L})\1\1+/u,
      "$1$1"
    );

    if (correction === original) continue;

    findings.push({
      original,
      correction,
      type: "spelling",
      confidence: 0.96,
      reason:
        "Aynı harfin olağandışı biçimde art arda tekrarlanması.",
      start: match.index,
      end: match.index + original.length,
      source: "deterministic"
    });
  }

  return findings;
}


/* =========================================================
   PUNCTUATION
========================================================= */

function scanPunctuation(text) {
  const findings = [];

  const rules = [
    {
      regex: /([!?.,;:])\1{2,}/g,
      reason:
        "Aynı noktalama işaretinin gereksiz biçimde art arda tekrarlanması.",
      replace: (x) => x[0]
    },
    {
      regex: / {2,}([,.;:!?])/g,
      reason:
        "Noktalama işaretinden önce gereksiz boşluk bulunuyor.",
      replace: (x) => x.trimStart()
    }
  ];

  for (const rule of rules) {
    let match;

    while ((match = rule.regex.exec(text))) {
      const original = match[0];
      const correction = rule.replace(original);

      if (original === correction) continue;

      findings.push({
        original,
        correction,
        type: "punctuation",
        confidence: 0.98,
        reason: rule.reason,
        start: match.index,
        end: match.index + original.length,
        source: "deterministic"
      });
    }
  }

  return findings;
}


/* =========================================================
   CAPITALIZATION
========================================================= */

function scanSentenceCapitalization(text, language) {
  if (language !== "tr" && language !== "en") {
    return [];
  }

  const findings = [];

  const locale =
    language === "tr" ? "tr-TR" : "en-US";

  const regex =
    /(^|[.!?]\s+)([\p{Ll}])([\p{L}]*)/gu;

  let match;

  while ((match = regex.exec(text))) {
    const original = match[2] + match[3];

    if (!original) continue;

    const correction =
      original.charAt(0).toLocaleUpperCase(locale) +
      original.slice(1);

    if (original === correction) continue;

    findings.push({
      original,
      correction,
      type: "capitalization",
      confidence: 0.95,
      reason:
        "Cümle başlangıcında büyük harf kullanılması gerekir.",
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
   MASTER DETERMINISTIC ENGINE
========================================================= */

function deterministicProofread(text, language) {
  let findings = [];

  if (language === "tr") {
    findings.push(
      ...scanDictionary(text, TR_WORD_ERRORS, "tr")
    );

    findings.push(
      ...scanTurkishRules(text)
    );
  }

  if (language === "en") {
    findings.push(
      ...scanDictionary(text, EN_WORD_ERRORS, "en")
    );
  }

  findings.push(
    ...scanRepeatedCharacters(text)
  );

  findings.push(
    ...scanPunctuation(text)
  );

  findings.push(
    ...scanSentenceCapitalization(text, language)
  );

  return dedupeFindings(findings);
}


/* =========================================================
   CHUNKING
========================================================= */

function splitIntoChunks(text, maxChars = 4500) {
  const chunks = [];

  let start = 0;

  while (start < text.length) {
    let end = Math.min(
      start + maxChars,
      text.length
    );

    if (end < text.length) {
      const paragraph =
        text.lastIndexOf("\n\n", end);

      if (paragraph > start + 2200) {
        end = paragraph;
      } else {
        const sentence = Math.max(
          text.lastIndexOf(". ", end),
          text.lastIndexOf("! ", end),
          text.lastIndexOf("? ", end)
        );

        if (sentence > start + 2200) {
          end = sentence + 1;
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

  return Array.from(map.values()).sort(
    (a, b) => (a.start || 0) - (b.start || 0)
  );
}


/* =========================================================
   AI VALIDATION
========================================================= */

function validateAIItem(item, sourceText) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const original =
    String(item.original || "").trim();

  const correction =
    String(item.correction || "").trim();

  const reason =
    String(item.reason || "").trim();

  const confidence =
    Number(item.confidence);

  if (!original || !correction) {
    return null;
  }

  if (
    !Number.isFinite(confidence) ||
    confidence < 0.90
  ) {
    return null;
  }

  if (original === correction) {
    return null;
  }

  if (
    original.length > 160 ||
    correction.length > 160
  ) {
    return null;
  }

  if (!sourceText.includes(original)) {
    return null;
  }

  if (
    correction.length > original.length * 4 &&
    correction.length > 30
  ) {
    return null;
  }

  const start = sourceText.indexOf(original);

  return {
    original,
    correction,
    type: String(item.type || "grammar"),
    confidence: Math.min(confidence, 1),
    reason:
      reason ||
      "Bağlamsal dil denetimi.",
    start,
    end: start + original.length,
    source: "ai"
  };
}

function validateAIResponse(data, text) {
  let items = [];

  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(data?.errors)) {
    items = data.errors;
  } else if (Array.isArray(data?.findings)) {
    items = data.findings;
  }

  const result = [];

  for (const item of items) {
    const valid =
      validateAIItem(item, text);

    if (valid) {
      result.push(valid);
    }
  }

  return dedupeFindings(result);
}


/* =========================================================
   GEMINI
========================================================= */

async function callGemini(
  env,
  text,
  language
) {
  if (!env.GEMINI_API_KEY) {
    return {
      success: false,
      status: null,
      error: "GEMINI_API_KEY yok."
    };
  }

  const languageName =
    language === "tr"
      ? "Turkish"
      : "English";

  const prompt = `
You are a professional ${languageName} news copy editor.

Analyze the text below.

Find ONLY objective errors:
- spelling
- grammar
- word separation
- word joining
- objectively incorrect punctuation
- objectively incorrect capitalization
- clearly incorrect word usage

DO NOT flag:
- style
- optional wording
- political content
- names
- people
- organizations
- brands
- URLs
- dates
- numbers
- abbreviations
- quotations
- dialect
- journalistic preference

IMPORTANT:

The value "original" MUST be copied exactly from the supplied text.

The value "correction" must be the smallest possible correction.

Do not rewrite complete sentences.

Only return errors with confidence >= 0.90.

Return ONLY JSON:

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

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    AI_TIMEOUT
  );

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        GEMINI_MODEL +
        ":generateContent?key=" +
        encodeURIComponent(
          env.GEMINI_API_KEY
        ),
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type":
            "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType:
              "application/json"
          }
        })
      }
    );

    const raw =
      await response.text();

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
        error:
          "Gemini JSON parse edilemedi."
      };
    }

    const output =
      data?.candidates?.[0]?.content?.parts
        ?.map((x) => x.text || "")
        .join("") || "";

    if (!output) {
      return {
        success: false,
        status: response.status,
        error:
          "Gemini boş cevap verdi."
      };
    }

    let parsed;

    try {
      parsed = JSON.parse(output);
    } catch {
      const match =
        output.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          success: false,
          status: response.status,
          error:
            "Gemini geçerli JSON üretmedi."
        };
      }

      try {
        parsed = JSON.parse(
          match[0]
        );
      } catch {
        return {
          success: false,
          status: response.status,
          error:
            "Gemini JSON parse hatası."
        };
      }
    }

    return {
      success: true,
      status: response.status,
      errors:
        validateAIResponse(
          parsed,
          text
        )
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error:
        error?.name === "AbortError"
          ? "Gemini timeout."
          : String(
              error?.message || error
            )
    };
  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
   NVIDIA
========================================================= */

function parseNvidiaJSON(text) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const match =
    cleaned.match(/\{[\s\S]*\}/);

  if (!match) return null;

  try {
    return JSON.parse(
      match[0]
    );
  } catch {
    return null;
  }
}

async function callNvidia(
  env,
  text,
  language
) {
  if (!env.NVIDIA_API_KEY) {
    return {
      success: false,
      status: null,
      error: "NVIDIA_API_KEY yok."
    };
  }

  const prompt = `
You are a strict professional ${language === "tr" ? "Turkish" : "English"} news copy editor.

Identify ONLY objective spelling, grammar, word-spacing, punctuation and capitalization errors.

Do not rewrite.
Do not make stylistic suggestions.
Do not flag names, brands, organizations, URLs, dates, numbers or quotations unless objectively wrong.

Every "original" MUST be an exact substring from the text.

Return ONLY JSON:

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

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    AI_TIMEOUT
  );

  try {
    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type":
            "application/json",
          authorization:
            `Bearer ${env.NVIDIA_API_KEY}`
        },
        body: JSON.stringify({
          model: NVIDIA_MODEL,
          messages: [
            {
              role: "system",
              content:
                "Return only valid JSON."
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

    const raw =
      await response.text();

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
        error:
          "NVIDIA JSON parse edilemedi."
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
        error:
          "NVIDIA boş cevap verdi."
      };
    }

    const parsed =
      parseNvidiaJSON(output);

    if (!parsed) {
      return {
        success: false,
        status: response.status,
        error:
          "NVIDIA geçerli JSON üretmedi."
      };
    }

    return {
      success: true,
      status: response.status,
      errors:
        validateAIResponse(
          parsed,
          text
        )
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error:
        error?.name === "AbortError"
          ? "NVIDIA timeout."
          : String(
              error?.message || error
            )
    };
  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
   ARTICLE ANALYSIS
========================================================= */

async function analyzeArticle(
  article,
  env
) {
  const language =
    detectLanguage(article.text);

  const words =
    article.text.match(
      /[\p{L}\p{M}]+/gu
    ) || [];

  const sentences =
    article.text
      .split(/[.!?]+/)
      .map((x) => x.trim())
      .filter(Boolean);

  /*
   * FIRST PASS:
   * Entire article is scanned by deterministic engine.
   */
  const deterministic =
    deterministicProofread(
      article.text,
      language
    );

  /*
   * If an absolutely obvious error exists,
   * return it immediately.
   *
   * No AI is needed for a certain spelling error.
   */
  if (deterministic.length) {
    return {
      ...article,
      language,
      stats: {
        characters: article.text.length,
        words: words.length,
        sentences: sentences.length
      },
      errors: deterministic,
      ai: {
        used: false,
        reason:
          "Kesin hata deterministik motor tarafından bulundu."
      }
    };
  }

  /*
   * SECOND PASS:
   * The complete article is divided into chunks.
   * This is where contextual/nuisance errors are sent to AI.
   */
  const chunks =
    splitIntoChunks(
      article.text,
      4500
    );

  /*
   * Cloudflare Free subrequest budget must be respected.
   *
   * We therefore use at most 4 AI chunks per article.
   * The deterministic engine has already scanned ALL text.
   */
  const maxChunks =
    Math.min(chunks.length, 4);

  const aiErrors = [];

  let geminiUsed = false;
  let nvidiaUsed = false;

  let geminiFailures = 0;
  let nvidiaFailures = 0;

  for (
    let i = 0;
    i < maxChunks;
    i++
  ) {
    const chunk = chunks[i];

    const gemini =
      await callGemini(
        env,
        chunk.text,
        language === "en"
          ? "en"
          : "tr"
      );

    if (gemini.success) {
      geminiUsed = true;

      for (
        const item of
          gemini.errors || []
      ) {
        const local =
          chunk.text.indexOf(
            item.original
          );

        if (local < 0) continue;

        aiErrors.push({
          ...item,
          start:
            chunk.offset + local,
          end:
            chunk.offset +
            local +
            item.original.length
        });
      }

      continue;
    }

    geminiFailures++;

    /*
     * Gemini unavailable -> NVIDIA fallback.
     */
    const nvidia =
      await callNvidia(
        env,
        chunk.text,
        language === "en"
          ? "en"
          : "tr"
      );

    if (nvidia.success) {
      nvidiaUsed = true;

      for (
        const item of
          nvidia.errors || []
      ) {
        const local =
          chunk.text.indexOf(
            item.original
          );

        if (local < 0) continue;

        aiErrors.push({
          ...item,
          start:
            chunk.offset + local,
          end:
            chunk.offset +
            local +
            item.original.length
        });
      }
    } else {
      nvidiaFailures++;
    }
  }

  /*
   * Final exact-source validation.
   */
  const finalErrors = [];

  for (
    const item of aiErrors
  ) {
    const actual =
      article.text.slice(
        item.start,
        item.end
      );

    if (
      actual !==
      item.original
    ) {
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
      source: "ai"
    });
  }

  return {
    ...article,
    language,
    stats: {
      characters: article.text.length,
      words: words.length,
      sentences: sentences.length
    },
    errors:
      dedupeFindings(
        finalErrors
      ),
    ai: {
      used: true,
      geminiUsed,
      nvidiaUsed,
      geminiFailures,
      nvidiaFailures,
      chunksAnalyzed: maxChunks,
      chunksTotal: chunks.length
    }
  };
}


/* =========================================================
   CRAWLER
========================================================= */

async function crawl(
  startURL,
  env
) {
  const root =
    safeURL(startURL);

  if (!root) {
    throw new Error(
      "Geçerli bir HTTP/HTTPS adresi girin."
    );
  }

  const queue = [
    root.toString()
  ];

  const queued =
    new Set(queue);

  const visited =
    new Set();

  const articles = [];

  const articleURLs =
    new Set();

  let pages = 0;
  let fetchErrors = 0;

  while (
    queue.length &&
    pages < MAX_PAGES &&
    articles.length < MAX_ARTICLES
  ) {
    const current =
      queue.shift();

    if (
      visited.has(current)
    ) {
      continue;
    }

    visited.add(current);
    pages++;

    const currentURL =
      safeURL(current);

    if (
      !currentURL ||
      !sameOrigin(
        root,
        currentURL
      )
    ) {
      continue;
    }

    let response;

    try {
      response =
        await fetchTimeout(
          current
        );
    } catch {
      fetchErrors++;
      continue;
    }

    if (!response.ok) {
      fetchErrors++;
      continue;
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes(
        "text/html"
      )
    ) {
      continue;
    }

    let source;

    try {
      source =
        await response.text();
    } catch {
      fetchErrors++;
      continue;
    }

    if (
      source.length >
      MAX_HTML_BYTES
    ) {
      source =
        source.slice(
          0,
          MAX_HTML_BYTES
        );
    }

    const article =
      extractArticle(
        source,
        currentURL
      );

    if (
      article &&
      !articleURLs.has(
        article.url
      )
    ) {
      articleURLs.add(
        article.url
      );

      articles.push(
        article
      );
    }

    /*
     * Link discovery.
     */
    const linkRegex =
      /<a[^>]+href=["']([^"'#]+)["']/gi;

    let match;

    while (
      (match =
        linkRegex.exec(
          source
        )) &&
      queue.length <
        MAX_LINKS
    ) {
      const raw =
        decodeEntities(
          match[1]
        ).trim();

      if (!raw) continue;

      try {
        const child =
          new URL(
            raw,
            current
          );

        if (
          child.protocol !==
            "http:" &&
          child.protocol !==
            "https:"
        ) {
          continue;
        }

        if (
          !sameOrigin(
            root,
            child
          )
        ) {
          continue;
        }

        if (
          isBadPath(child)
        ) {
          continue;
        }

        child.hash = "";

        const normalized =
          child.toString();

        if (
          queued.has(
            normalized
          ) ||
          visited.has(
            normalized
          )
        ) {
          continue;
        }

        queued.add(
          normalized
        );

        /*
         * Article-like URLs are prioritized.
         */
        if (
          isArticlePath(
            child
          )
        ) {
          queue.unshift(
            normalized
          );
        } else {
          queue.push(
            normalized
          );
        }
      } catch {}
    }
  }

  /*
   * Analyze each real article.
   */
  const analyzed = [];

  for (
    const article of articles
  ) {
    analyzed.push(
      await analyzeArticle(
        article,
        env
      )
    );
  }

  const totalErrors =
    analyzed.reduce(
      (sum, article) =>
        sum +
        article.errors.length,
      0
    );

  return {
    ok: true,
    version: VERSION,
    source: root.toString(),
    scannedAt:
      new Date().toISOString(),
    pages,
    fetchErrors,
    articlesFound:
      analyzed.length,
    totalErrors,
    articles:
      analyzed
  };
}


/* =========================================================
   AI TEST
========================================================= */

async function aiTest(env) {
  const testText =
    "Bu bir test metnidir. Herkez bu testi görebilir.";

  const deterministic =
    deterministicProofread(
      testText,
      "tr"
    );

  const result = {
    ok: true,

    deterministic,

    gemini: {
      configured:
        Boolean(
          env.GEMINI_API_KEY
        ),
      success: false,
      status: null,
      errors: [],
      error: null
    },

    nvidia: {
      configured:
        Boolean(
          env.NVIDIA_API_KEY
        ),
      success: false,
      status: null,
      errors: [],
      error: null
    }
  };

  if (
    env.GEMINI_API_KEY
  ) {
    const gemini =
      await callGemini(
        env,
        testText,
        "tr"
      );

    result.gemini = {
      configured: true,
      success:
        gemini.success,
      status:
        gemini.status,
      errors:
        gemini.errors || [],
      error:
        gemini.error || null
    };
  }

  if (
    env.NVIDIA_API_KEY
  ) {
    const nvidia =
      await callNvidia(
        env,
        testText,
        "tr"
      );

    result.nvidia = {
      configured: true,
      success:
        nvidia.success,
      status:
        nvidia.status,
      errors:
        nvidia.errors || [],
      error:
        nvidia.error || null
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

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>WebProof AI</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:#0b1020;
  color:#f5f7fb;
  font-family:Arial,Helvetica,sans-serif;
}

.container{
  max-width:1100px;
  margin:auto;
  padding:28px 18px 60px;
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
  margin-top:18px;
}

.row{
  display:flex;
  gap:10px;
}

input{
  flex:1;
  min-width:0;
  background:#0b1020;
  color:#fff;
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

button:disabled{
  opacity:.6;
  cursor:wait;
}

.stats{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:10px;
  margin-top:18px;
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
  padding:0;
  overflow:hidden;
}

.articleHead{
  padding:15px;
  background:#10182b;
}

.articleTitle{
  font-size:18px;
  font-weight:700;
}

.articleUrl{
  display:block;
  margin-top:8px;
  color:#8fb7ff;
  word-break:break-all;
  font-size:13px;
}

.articleBody{
  padding:15px;
}

.error{
  background:#24131a;
  border-left:4px solid #ff4d4d;
  border-radius:8px;
  padding:13px;
  margin:10px 0;
}

.errorTitle{
  font-weight:800;
  margin-bottom:8px;
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
  line-height:1.5;
  margin-top:8px;
}

.ok{
  background:#10231a;
  color:#8ff0aa;
  padding:14px;
  border-radius:9px;
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

  .row{
    flex-direction:column;
  }

  .stats{
    grid-template-columns:repeat(2,1fr);
  }

  h1{
    font-size:28px;
  }

}

</style>

</head>

<body>

<div class="container">

<header>

<h1>WebProof AI</h1>

<div class="subtitle">
Gerçek web taraması + tam metin deterministik
denetim + bağlamsal yapay zekâ analizi
</div>

</header>

<div class="panel">

<div class="row">

<input
  id="url"
  type="url"
  placeholder="https://www.ornekhaber.com"
>

<button
  id="scanBtn"
  onclick="scan()"
>
Siteyi Tara
</button>

</div>

<div class="small">
Önce haber metninin tamamı kod tabanlı objektif
kurallarla taranır. Nüans gerektiren durumlarda
AI devreye girer.
</div>

</div>

<div id="stats"></div>

<div id="result"></div>

</div>

<script>

async function scan(){

  const input =
    document.getElementById("url");

  const button =
    document.getElementById("scanBtn");

  const result =
    document.getElementById("result");

  const stats =
    document.getElementById("stats");

  const target =
    input.value.trim();

  if(!target){

    result.innerHTML =
      '<div class="panel">Lütfen bir site adresi girin.</div>';

    return;
  }

  button.disabled = true;
  button.textContent = "Taranıyor...";

  stats.innerHTML = "";

  result.innerHTML =
    '<div class="panel loading">' +
    'Site gerçek zamanlı olarak taranıyor. ' +
    'Haber metinleri çıkarılıyor ve binlerce kelime denetleniyor...' +
    '</div>';

  try{

    const response =
      await fetch(
        "/api/scan?url=" +
        encodeURIComponent(target)
      );

    const data =
      await response.json();

    if(
      !response.ok ||
      !data.ok
    ){
      throw new Error(
        data.error ||
        "Tarama başarısız."
      );
    }

    stats.innerHTML =
      '<div class="stats">' +
      stat(data.pages,"Taranan sayfa") +
      stat(data.articlesFound,"Bulunan haber") +
      stat(data.totalErrors,"Toplam hata") +
      stat(data.fetchErrors,"Fetch hatası") +
      '</div>';

    renderArticles(
      data.articles || []
    );

  }catch(error){

    result.innerHTML =
      '<div class="panel">' +
      '<b>Tarama hatası:</b> ' +
      escapeHtml(
        error.message
      ) +
      '</div>';

  }finally{

    button.disabled = false;
    button.textContent =
      "Siteyi Tara";
  }
}

function stat(
  value,
  label
){

  return (
    '<div class="stat">' +
    '<b>' +
    escapeHtml(
      String(value)
    ) +
    '</b>' +
    '<span>' +
    escapeHtml(label) +
    '</span>' +
    '</div>'
  );
}

function renderArticles(
  articles
){

  const result =
    document.getElementById(
      "result"
    );

  if(!articles.length){

    result.innerHTML =
      '<div class="panel">' +
      'Gerçek haber içeriği tespit edilemedi.' +
      '</div>';

    return;
  }

  let output = "";

  for(
    const article of articles
  ){

    output +=
      '<div class="panel article">';

    output +=
      '<div class="articleHead">';

    output +=
      '<div class="articleTitle">' +
      escapeHtml(
        article.title ||
        "Başlıksız haber"
      ) +
      '</div>';

    output +=
      '<a class="articleUrl" ' +
      'href="' +
      escapeAttr(
        article.url
      ) +
      '" target="_blank" ' +
      'rel="noopener noreferrer">' +
      escapeHtml(
        article.url
      ) +
      '</a>';

    output +=
      '</div>';

    output +=
      '<div class="articleBody">';

    if(
      article.errors &&
      article.errors.length
    ){

      for(
        const error of
          article.errors
      ){

        output +=
          '<div class="error">';

        output +=
          '<div class="errorTitle">' +
          '🔴 Bu haberde doğrulanmış hata bulundu' +
          '</div>';

        output +=
          '<div>' +
          '<span class="original">' +
          escapeHtml(
            error.original
          ) +
          '</span>' +
          ' → ' +
          '<span class="correction">' +
          escapeHtml(
            error.correction
          ) +
          '</span>' +
          '</div>';

        output +=
          '<div class="meta">' +
          'Tür: ' +
          escapeHtml(
            error.type
          ) +
          '<br>' +
          'Güven: ' +
          Math.round(
            Number(
              error.confidence
            ) * 100
          ) +
          '%' +
          '<br>' +
          escapeHtml(
            error.reason
          ) +
          '<br><br>' +
          '<b>Kaynak haber:</b> ' +
          '<a href="' +
          escapeAttr(
            article.url
          ) +
          '" target="_blank" ' +
          'rel="noopener noreferrer">' +
          escapeHtml(
            article.url
          ) +
          '</a>' +
          '</div>';

        output +=
          '</div>';
      }

    }else{

      output +=
        '<div class="ok">' +
        '✓ Bu haberde doğrulanmış objektif hata bulunmadı.' +
        '</div>';

    }

    const ai =
      article.ai || {};

    output +=
      '<div class="small">' +
      'Dil: ' +
      escapeHtml(
        article.language ||
        "unknown"
      ) +
      ' · Kelime: ' +
      escapeHtml(
        String(
          article.stats?.words ||
          0
        )
      ) +
      ' · Karakter: ' +
      escapeHtml(
        String(
          article.stats?.characters ||
          0
        )
      ) +
      ' · AI: ' +
      (
        ai.used
          ? "kullanıldı"
          : "gerekmedi"
      ) +
      '</div>';

    output +=
      '</div>';

    output +=
      '</div>';
  }

  result.innerHTML =
    output;
}

function escapeHtml(
  value
){

  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

function escapeAttr(
  value
){
  return escapeHtml(value);
}

</script>

</body>

</html>`;


/* =========================================================
   WORKER
========================================================= */

export default {

  async fetch(
    request,
    env
  ){

    const url =
      new URL(request.url);

    if(
      request.method ===
      "OPTIONS"
    ){

      return new Response(
        null,
        {
          headers:{
            "access-control-allow-origin":"*",
            "access-control-allow-methods":
              "GET,POST,OPTIONS",
            "access-control-allow-headers":
              "Content-Type"
          }
        }
      );
    }


    /* STATUS */

    if(
      url.pathname ===
      "/api/status"
    ){

      return json({
        ok:true,

        service:
          "WebProof AI",

        version:
          VERSION,

        ai:{
          gemini:
            Boolean(
              env.GEMINI_API_KEY
            ),

          nvidia:
            Boolean(
              env.NVIDIA_API_KEY
            ),

          primary:
            "gemini"
        },

        models:{
          gemini:
            GEMINI_MODEL,

          nvidia:
            NVIDIA_MODEL
        },

        architecture:{

          realWebCrawling:true,

          articleDetection:true,

          fullArticleScanning:true,

          deterministicEngine:true,

          TurkishRules:true,

          EnglishRules:true,

          AIContextAnalysis:true,

          AIFallback:true,

          exactSubstringValidation:true,

          exactSourceURL:true,

          falsePositiveFiltering:true
        },

        limits:{
          maxPages:
            MAX_PAGES,

          maxArticles:
            MAX_ARTICLES,

          maxLinks:
            MAX_LINKS,

          maxArticleCharacters:
            MAX_ARTICLE_TEXT
        },

        capabilities:[

          "real-web-crawling",

          "article-detection",

          "full-text-analysis",

          "Turkish-proofreading",

          "English-proofreading",

          "Turkish-spelling-rules",

          "Turkish-question-suffix",

          "word-spacing",

          "punctuation",

          "capitalization",

          "English-spelling",

          "repeated-character-detection",

          "Gemini-context-analysis",

          "NVIDIA-fallback",

          "exact-source-validation",

          "exact-source-URL",

          "false-positive-filtering"
        ]
      });
    }


    /* AI TEST */

    if(
      url.pathname ===
      "/api/ai-test"
    ){

      return json(
        await aiTest(env)
      );
    }


    /* SCAN */

    if(
      url.pathname ===
      "/api/scan"
    ){

      const target =
        url.searchParams.get(
          "url"
        );

      if(!target){

        return json(
          {
            ok:false,
            error:
              "url parametresi gerekli."
          },
          400
        );
      }

      try{

        const result =
          await crawl(
            target,
            env
          );

        return json(
          result
        );

      }catch(error){

        return json(
          {
            ok:false,
            error:
              String(
                error?.message ||
                error
              )
          },
          500
        );
      }
    }


    return html(
      FRONTEND
    );
  }
};

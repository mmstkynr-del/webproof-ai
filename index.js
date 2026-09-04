const VERSION = "production-agent-6.0";

const CONFIG = {
  MAX_PAGES: 20,
  MAX_ARTICLES: 12,
  MAX_LINKS: 160,
  MAX_ARTICLE_CHARS: 50000,
  MAX_AI_CHARS: 10000,
  PAGE_TIMEOUT: 5000,
  AI_TIMEOUT: 7000,
  MAX_AI_ARTICLES: 6,
  USER_AGENT: "WebProofAI/6.0 (+https://webproof-ai.mmstkynr.workers.dev)"
};

const GEMINI_MODEL = "gemini-3.7-flash";
const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

/* =========================================================
   BASIC HELPERS
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function page(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeURL(value) {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol)) return null;

    const h = u.hostname.toLowerCase();

    if (
      h === "localhost" ||
      h.endsWith(".localhost") ||
      h === "metadata.google.internal" ||
      h === "0.0.0.0" ||
      h === "::1"
    ) {
      return null;
    }

    if (
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^169\.254\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
    ) {
      return null;
    }

    return u;
  } catch {
    return null;
  }
}

function sameOrigin(a, b) {
  return a.origin === b.origin;
}

async function fetchTimeout(url, options = {}, timeout = CONFIG.PAGE_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "follow"
    });
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   HTML / TEXT
========================================================= */

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
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

function stripHTML(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

function getMeta(html, name) {
  const r1 = new RegExp(
    `<meta[^>]+(?:name|property)=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );

  const r2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escapeRegExp(name)}["']`,
    "i"
  );

  const m = html.match(r1) || html.match(r2);
  return m ? decodeEntities(m[1]).trim() : "";
}

function getJsonLD(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let m;

  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      blocks.push(parsed);
    } catch {}
  }

  return blocks;
}

function flattenJSONLD(value) {
  const out = [];

  function walk(x) {
    if (!x) return;

    if (Array.isArray(x)) {
      for (const item of x) walk(item);
      return;
    }

    if (typeof x === "object") {
      out.push(x);

      if (x["@graph"]) walk(x["@graph"]);
      if (x.item) walk(x.item);
    }
  }

  walk(value);
  return out;
}

/* =========================================================
   ARTICLE DETECTION
========================================================= */

function rejectedPath(pathname) {
  const p = pathname.toLowerCase();

  const bad = [
    "/search",
    "/arama",
    "/tag/",
    "/etiket/",
    "/kategori/",
    "/category/",
    "/author/",
    "/yazar/",
    "/video/",
    "/galeri/",
    "/gallery/",
    "/foto/",
    "/fotogaleri/",
    "/login",
    "/register",
    "/uyelik",
    "/feed",
    "/rss",
    "/podcast"
  ];

  return bad.some(x => p.includes(x));
}

function looksLikeArticleURL(url, origin) {
  if (!sameOrigin(url, origin)) return false;

  if (url.pathname === "/" || url.pathname === "") {
    return false;
  }

  if (rejectedPath(url.pathname)) {
    return false;
  }

  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.length < 1) {
    return false;
  }

  return true;
}

function extractArticle(url, html) {
  const title = extractTitle(html);

  const canonical =
    getMeta(html, "og:url") ||
    getMeta(html, "twitter:url") ||
    url.href;

  const ogType = getMeta(html, "og:type").toLowerCase();

  const jsonObjects = getJsonLD(html).flatMap(flattenJSONLD);

  const articleSchemas = jsonObjects.filter(x => {
    const type = Array.isArray(x["@type"])
      ? x["@type"].join(" ").toLowerCase()
      : String(x["@type"] || "").toLowerCase();

    return (
      type.includes("article") ||
      type.includes("newsarticle") ||
      type.includes("reportage")
    );
  });

  const articleSchema = articleSchemas[0] || null;

  const datePublished =
    articleSchema?.datePublished ||
    getMeta(html, "article:published_time") ||
    getMeta(html, "date");

  const author =
    articleSchema?.author?.name ||
    (typeof articleSchema?.author === "string"
      ? articleSchema.author
      : "") ||
    getMeta(html, "author");

  const articleBody =
    articleSchema?.articleBody ||
    articleSchema?.text ||
    "";

  const articleTagMatches = [
    ...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)
  ];

  const candidates = [];

  if (articleBody) {
    candidates.push(stripHTML(articleBody));
  }

  for (const m of articleTagMatches) {
    candidates.push(stripHTML(m[1]));
  }

  const mainMatch = html.match(
    /<main\b[^>]*>([\s\S]*?)<\/main>/i
  );

  if (mainMatch) {
    candidates.push(stripHTML(mainMatch[1]));
  }

  candidates.push(stripHTML(html));

  let best = "";

  for (const candidate of candidates) {
    if (candidate.length > best.length) {
      best = candidate;
    }
  }

  /*
    IMPORTANT:
    Homepage and generic pages must NOT become articles.
    Require article evidence.
  */

  const hasArticleEvidence =
    articleSchemas.length > 0 ||
    /<article\b/i.test(html) ||
    ogType === "article" ||
    !!datePublished;

  const paragraphCount =
    (html.match(/<p\b/gi) || []).length;

  const longEnough =
    best.length >= 900;

  const pathLooksArticle =
    url.pathname.split("/").filter(Boolean).length >= 2 ||
    /-\d{3,}(?:\/)?$/i.test(url.pathname);

  if (
    !hasArticleEvidence ||
    !longEnough ||
    paragraphCount < 3 ||
    !pathLooksArticle
  ) {
    return null;
  }

  const cleanText = best
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONFIG.MAX_ARTICLE_CHARS);

  if (cleanText.length < 900) {
    return null;
  }

  return {
    url: canonical.startsWith("http")
      ? canonical
      : url.href,
    title: title || articleSchema?.headline || url.pathname,
    author,
    datePublished,
    text: cleanText,
    words: countWords(cleanText),
    chars: cleanText.length
  };
}

/* =========================================================
   LANGUAGE
========================================================= */

function detectLanguage(text) {
  const tr = [
    " ve ",
    " bir ",
    " için ",
    " olan ",
    " olarak ",
    " bu ",
    " şu ",
    " daha ",
    " ancak ",
    " tarafından ",
    " açıklamasında ",
    " söyledi ",
    " gündem "
  ];

  const en = [
    " the ",
    " and ",
    " for ",
    " with ",
    " from ",
    " this ",
    " that ",
    " said ",
    " government ",
    " people "
  ];

  const lower = ` ${text.toLowerCase()} `;

  const trScore = tr.reduce(
    (n, x) => n + (lower.includes(x) ? 1 : 0),
    0
  );

  const enScore = en.reduce(
    (n, x) => n + (lower.includes(x) ? 1 : 0),
    0
  );

  return trScore >= enScore ? "tr" : "en";
}

function countWords(text) {
  return (text.match(/[\p{L}\p{N}]+/gu) || []).length;
}

/* =========================================================
   DETERMINISTIC EDITORIAL ENGINE
========================================================= */

/*
  IMPORTANT:
  These are high-confidence objective errors only.
  Context-sensitive rules are NOT placed here.
*/

const TR_RULES = [
  ["herkez", "herkes"],
  ["yanlız", "yalnız"],
  ["yalnış", "yanlış"],
  ["yanlışca", "yanlışça"],
  ["yanlızca", "yalnızca"],
  ["yalniz", "yalnız"],
  ["yanliz", "yalnız"],
  ["yanlis", "yanlış"],
  ["her hangi", "herhangi"],
  ["hiç bir", "hiçbir"],
  ["birşey", "bir şey"],
  ["herşey", "her şey"],
  ["hiçbirşey", "hiçbir şey"],
  ["bir çok", "birçok"],
  ["bir kaç", "birkaç"],
  ["pekçok", "pek çok"],
  ["yanısıra", "yanı sıra"],
  ["gözardı", "göz ardı"],
  ["yanyana", "yan yana"],
  ["ardarda", "art arda"],
  ["artarda", "art arda"],
  ["üstüste", "üst üste"],
  ["altalta", "alt alta"],
  ["peşpeşe", "peş peşe"],
  ["başbaşa", "baş başa"],
  ["omuzomuza", "omuz omuza"],
  ["şuan", "şu an"],
  ["şuanda", "şu anda"],
  ["şöför", "şoför"],
  ["egsoz", "egzoz"],
  ["eksoz", "egzoz"],
  ["mütevazi", "mütevazı"],
  ["entellektüel", "entelektüel"],
  ["laboratuar", "laboratuvar"],
  ["labaratuvar", "laboratuvar"],
  ["şarz", "şarj"],
  ["traş", "tıraş"],
  ["klavuz", "kılavuz"],
  ["ünvan", "unvan"],
  ["döküman", "doküman"],
  ["antreman", "antrenman"],
  ["muhattap", "muhatap"],
  ["müsade", "müsaade"],
  ["malesef", "maalesef"],
  ["orjinal", "orijinal"],
  ["süpriz", "sürpriz"],
  ["proğram", "program"],
  ["meyva", "meyve"],
  ["enstiti", "enstitü"],
  ["kordinasyon", "koordinasyon"],
  ["karekter", "karakter"],
  ["kareografi", "koreografi"],
  ["fasülye", "fasulye"],
  ["kiprik", "kirpik"],
  ["kirbit", "kibrit"],
  ["lavoba", "lavabo"],
  ["lavobo", "lavabo"],
  ["çünki", "çünkü"],
  ["çukulata", "çikolata"],
  ["çikolta", "çikolata"],
  ["tesbit", "tespit"],
  ["farketmek", "fark etmek"],
  ["farkettim", "fark ettim"],
  ["farketti", "fark etti"],
  ["farkettik", "fark ettik"],
  ["haketmek", "hak etmek"],
  ["hakediyor", "hak ediyor"],
  ["hakketti", "hak etti"],
  ["hisetmek", "hissetmek"],
  ["redetmek", "reddetmek"],
  ["terketmek", "terk etmek"],
  ["ön görü", "öngörü"],
  ["ön yargı", "önyargı"]
];

const EN_RULES = [
  ["recieve", "receive"],
  ["seperate", "separate"],
  ["definately", "definitely"],
  ["occured", "occurred"],
  ["accomodate", "accommodate"],
  ["wierd", "weird"],
  ["untill", "until"],
  ["wich", "which"],
  ["teh", "the"],
  ["beleive", "believe"],
  ["begining", "beginning"],
  ["enviroment", "environment"],
  ["goverment", "government"],
  ["succesful", "successful"],
  ["tommorow", "tomorrow"],
  ["comming", "coming"],
  ["occassion", "occasion"],
  ["occurence", "occurrence"],
  ["refered", "referred"],
  ["prefered", "preferred"],
  ["adress", "address"],
  ["arguement", "argument"],
  ["calender", "calendar"],
  ["concious", "conscious"],
  ["embarass", "embarrass"],
  ["existance", "existence"],
  ["experiance", "experience"],
  ["finaly", "finally"],
  ["freind", "friend"],
  ["grammer", "grammar"],
  ["heigth", "height"],
  ["independant", "independent"],
  ["knowlege", "knowledge"],
  ["liason", "liaison"],
  ["maintainance", "maintenance"],
  ["neccessary", "necessary"],
  ["noticable", "noticeable"],
  ["occassionally", "occasionally"],
  ["posession", "possession"],
  ["priviledge", "privilege"],
  ["publically", "publicly"],
  ["reccomend", "recommend"],
  ["recomend", "recommend"],
  ["responsability", "responsibility"],
  ["rythm", "rhythm"],
  ["suprise", "surprise"],
  ["truely", "truly"],
  ["wich", "which"],
  ["writting", "writing"],
  ["adress", "address"],
  ["becuase", "because"],
  ["beleive", "believe"],
  ["buisness", "business"],
  ["buisnesses", "businesses"],
  ["definate", "definite"],
  ["dependant", "dependent"],
  ["dissapear", "disappear"],
  ["dissapoint", "disappoint"],
  ["embarassed", "embarrassed"],
  ["excellant", "excellent"],
  ["govermental", "governmental"],
  ["independance", "independence"],
  ["knowlegeable", "knowledgeable"],
  ["mispell", "misspell"],
  ["neccessarily", "necessarily"],
  ["occured", "occurred"],
  ["recieve", "receive"],
  ["seperately", "separately"],
  ["succesfully", "successfully"],
  ["tommorow", "tomorrow"],
  ["untill", "until"],
  ["wierd", "weird"]
];

const ALL_RULES = new Map([
  ...TR_RULES,
  ...EN_RULES
]);

const RULE_KEYS = [...ALL_RULES.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp);

const RULE_REGEX =
  RULE_KEYS.length
    ? new RegExp(
        `(?<![\\p{L}\\p{M}])(${RULE_KEYS.join("|")})(?![\\p{L}\\p{M}])`,
        "giu"
      )
    : null;

/*
  Contextual cases are NOT reported as deterministic errors.
  They are candidates for AI.
*/

function ambiguousCandidates(text) {
  const candidates = [];

  /*
    Turkish question particle fused to previous word.
    This is intentionally only a candidate.
    We do NOT call it a confirmed error here.
  */
  const questionRegex =
    /\b[\p{L}]{3,}(?:d[ıiuü]n|yor|ecek|acak|malı|meli|miş|mış|muş|müş)(m[ıiuü])\b/giu;

  let m;

  while ((m = questionRegex.exec(text))) {
    candidates.push({
      original: m[0],
      type: "contextual",
      reason: "Türkçe soru eki/edatı ayrımı bağlama bağlıdır; AI tarafından incelenmeli.",
      start: m.index,
      end: m.index + m[0].length
    });

    if (candidates.length >= 20) break;
  }

  return candidates;
}

function preserveCase(original, correction) {
  if (
    original === original.toUpperCase() &&
    /[A-ZÇĞİÖŞÜ]/i.test(original)
  ) {
    return correction.toUpperCase();
  }

  if (
    original.length > 0 &&
    original[0] === original[0].toUpperCase()
  ) {
    return correction.charAt(0).toUpperCase() + correction.slice(1);
  }

  return correction;
}

function deterministicProofread(text, language) {
  const errors = [];

  if (!RULE_REGEX) {
    return errors;
  }

  RULE_REGEX.lastIndex = 0;

  let m;

  while ((m = RULE_REGEX.exec(text))) {
    const original = m[1];
    const correction = ALL_RULES.get(original.toLowerCase());

    if (!correction) continue;

    errors.push({
      original,
      correction: preserveCase(original, correction),
      type: "spelling",
      confidence: 1,
      reason:
        language === "tr"
          ? "Kesin ve yüksek güvenli Türkçe yazım/kelime hatası."
          : "Kesin ve yüksek güvenli İngilizce yazım hatası.",
      start: m.index,
      end: m.index + original.length,
      source: "deterministic"
    });

    if (errors.length >= 50) break;
  }

  return errors;
}

/* =========================================================
   AI VALIDATION
========================================================= */

function cleanAIJSON(raw) {
  if (!raw) return null;

  let text = raw.trim();

  text = text
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateAI(data, sourceText) {
  if (!data || !Array.isArray(data.errors)) {
    return [];
  }

  const result = [];

  for (const item of data.errors) {
    if (!item || typeof item !== "object") continue;

    const original = String(item.original || "").trim();
    const correction = String(item.correction || "").trim();
    const confidence = Number(item.confidence || 0);

    if (!original || !correction) continue;

    if (confidence < 0.9) continue;

    if (original.length > 180 || correction.length > 180) continue;

    const index = sourceText.indexOf(original);

    if (index < 0) continue;

    if (original === correction) continue;

    result.push({
      original,
      correction,
      type: String(item.type || "contextual"),
      confidence,
      reason: String(item.reason || "Bağlamsal dil hatası."),
      start: index,
      end: index + original.length,
      source: "ai"
    });

    if (result.length >= 20) break;
  }

  return result;
}

async function callGemini(text, language, env) {
  if (!env.GEMINI_API_KEY) {
    return {
      success: false,
      status: null,
      error: "GEMINI_API_KEY yok."
    };
  }

  const prompt = `
You are the contextual proofreading specialist of WebProof AI.

Language: ${language}

Analyze the supplied news article text.

Only report OBJECTIVE language errors:
- spelling
- grammar
- punctuation when objectively wrong
- incorrect word usage
- Turkish contextual rules such as de/da, ki, question particle when clearly wrong

Do NOT report:
- style preferences
- headline style
- journalistic choices
- names
- brands
- URLs
- dates
- numbers
- abbreviations unless objectively wrong
- alternative wording
- subjective improvements

Every "original" value MUST be an exact substring of the supplied text.

Return JSON only:

{
  "errors": [
    {
      "original": "exact text",
      "correction": "smallest correction",
      "type": "spelling|grammar|punctuation|word_usage|contextual",
      "confidence": 0.95,
      "reason": "short objective explanation"
    }
  ]
}

If there are no objective errors:

{"errors":[]}

ARTICLE:
${text}
`;

  try {
    const response = await fetchTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json"
          }
        })
      },
      CONFIG.AI_TIMEOUT
    );

    const raw = await response.text();

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: raw.slice(0, 1200)
      };
    }

    const body = JSON.parse(raw);

    const output =
      body?.candidates?.[0]?.content?.parts
        ?.map(x => x.text || "")
        .join("") || "";

    const parsed = cleanAIJSON(output);

    return {
      success: true,
      status: response.status,
      errors: parsed
        ? parsed
        : { errors: [] }
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error: error?.name === "AbortError"
        ? "Gemini timeout."
        : String(error)
    };
  }
}

async function callNVIDIA(text, language, env) {
  if (!env.NVIDIA_API_KEY) {
    return {
      success: false,
      status: null,
      error: "NVIDIA_API_KEY yok."
    };
  }

  const prompt = `
You are the secondary contextual proofreading specialist.

Language: ${language}

Find only objective spelling, grammar, punctuation and word-usage errors.
Ignore style, names, brands, URLs, dates and subjective rewriting.

Every original MUST be an exact substring.

Return JSON only:
{
  "errors": [
    {
      "original": "exact substring",
      "correction": "minimal correction",
      "type": "spelling|grammar|punctuation|word_usage|contextual",
      "confidence": 0.95,
      "reason": "objective reason"
    }
  ]
}

TEXT:
${text}
`;

  try {
    const response = await fetchTimeout(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.NVIDIA_API_KEY}`
        },
        body: JSON.stringify({
          model: NVIDIA_MODEL,
          messages: [
            {
              role: "system",
              content: "Return valid JSON only."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0,
          max_tokens: 1400,
          stream: false
        })
      },
      CONFIG.AI_TIMEOUT
    );

    const raw = await response.text();

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: raw.slice(0, 1200)
      };
    }

    const body = JSON.parse(raw);

    const output =
      body?.choices?.[0]?.message?.content || "";

    const parsed = cleanAIJSON(output);

    return {
      success: true,
      status: response.status,
      errors: parsed || { errors: [] }
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error:
        error?.name === "AbortError"
          ? "NVIDIA timeout."
          : String(error)
    };
  }
}

/* =========================================================
   AGENT ORCHESTRATOR
========================================================= */

async function editorialAgent(article, env, allowAI) {
  const language = detectLanguage(article.text);

  /*
    STEP 1
    Deterministic engine scans the WHOLE article.
  */

  const deterministic = deterministicProofread(
    article.text,
    language
  );

  /*
    STEP 2
    Contextual candidates are separated.
  */

  const candidates =
    language === "tr"
      ? ambiguousCandidates(article.text)
      : [];

  /*
    STEP 3
    If an objective error already exists,
    do not waste AI calls.
  */

  if (deterministic.length > 0) {
    return {
      ...article,
      language,
      deterministic,
      ai: {
        used: false,
        reason: "Kesin hata kod motoru tarafından bulundu."
      },
      contextualCandidates: candidates,
      errors: deterministic
    };
  }

  /*
    STEP 4
    Only clean/ambiguous articles are candidates for AI.
  */

  if (!allowAI) {
    return {
      ...article,
      language,
      deterministic: [],
      contextualCandidates: candidates,
      ai: {
        used: false,
        reason: "AI bütçesi nedeniyle AI analizi yapılmadı."
      },
      errors: []
    };
  }

  const aiText =
    article.text.length > CONFIG.MAX_AI_CHARS
      ? article.text.slice(0, CONFIG.MAX_AI_CHARS)
      : article.text;

  let gemini = await callGemini(
    aiText,
    language,
    env
  );

  let aiErrors = [];

  if (gemini.success) {
    aiErrors = validateAI(
      gemini.errors,
      aiText
    );
  }

  /*
    Gemini unavailable -> NVIDIA fallback.
  */

  let nvidia = null;

  if (!gemini.success) {
    nvidia = await callNVIDIA(
      aiText,
      language,
      env
    );

    if (nvidia.success) {
      aiErrors = validateAI(
        nvidia.errors,
        aiText
      );
    }
  }

  return {
    ...article,
    language,
    deterministic: [],
    contextualCandidates: candidates,
    ai: {
      used: true,
      provider:
        gemini.success
          ? "gemini"
          : nvidia?.success
            ? "nvidia"
            : "unavailable",
      gemini: {
        success: gemini.success,
        status: gemini.status,
        error: gemini.error || null
      },
      nvidia: nvidia
        ? {
            success: nvidia.success,
            status: nvidia.status,
            error: nvidia.error || null
          }
        : null
    },
    errors: aiErrors
  };
}

/* =========================================================
   LINK DISCOVERY
========================================================= */

function extractLinks(html, baseURL) {
  const links = [];
  const seen = new Set();

  const re = /<a\b[^>]+href=["']([^"']+)["']/gi;

  let m;

  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], baseURL);

      u.hash = "";

      if (
        !["http:", "https:"].includes(u.protocol)
      ) {
        continue;
      }

      if (!sameOrigin(u, baseURL)) {
        continue;
      }

      if (rejectedPath(u.pathname)) {
        continue;
      }

      if (u.pathname === "/" || !u.pathname) {
        continue;
      }

      const href = u.href;

      if (!seen.has(href)) {
        seen.add(href);
        links.push(href);
      }
    } catch {}
  }

  return links.slice(0, CONFIG.MAX_LINKS);
}

/* =========================================================
   REAL WEB CRAWLER
========================================================= */

async function fetchPage(url) {
  try {
    const response = await fetchTimeout(
      url,
      {
        headers: {
          "user-agent": CONFIG.USER_AGENT,
          accept: "text/html,application/xhtml+xml"
        }
      },
      CONFIG.PAGE_TIMEOUT
    );

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url
      };
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return {
        ok: false,
        status: response.status,
        url,
        reason: "not-html"
      };
    }

    const text = await response.text();

    if (!text || text.length < 100) {
      return {
        ok: false,
        status: response.status,
        url,
        reason: "empty"
      };
    }

    return {
      ok: true,
      status: response.status,
      url,
      html: text
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      url,
      reason:
        error?.name === "AbortError"
          ? "timeout"
          : String(error)
    };
  }
}

async function crawlSite(inputURL) {
  const root = safeURL(inputURL);

  if (!root) {
    throw new Error("Geçerli bir HTTP/HTTPS adresi girin.");
  }

  /*
    Real crawler.
    Pages are fetched concurrently in batches.
  */

  const queue = [root.href];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];
  const articles = new Map();

  let fetchErrors = 0;

  while (
    queue.length > 0 &&
    visited.size < CONFIG.MAX_PAGES &&
    articles.size < CONFIG.MAX_ARTICLES
  ) {
    const batch = [];

    while (
      queue.length > 0 &&
      batch.length < 6 &&
      visited.size + batch.length < CONFIG.MAX_PAGES
    ) {
      const next = queue.shift();

      if (!next || visited.has(next)) continue;

      visited.add(next);
      batch.push(next);
    }

    if (!batch.length) break;

    const responses = await Promise.all(
      batch.map(fetchPage)
    );

    for (const result of responses) {
      if (!result.ok) {
        fetchErrors++;
        continue;
      }

      pages.push({
        url: result.url,
        status: result.status
      });

      const current = safeURL(result.url);

      if (!current) continue;

      /*
        Homepage is deliberately excluded from article detection.
      */

      if (current.pathname !== "/") {
        const article = extractArticle(
          current,
          result.html
        );

        if (article) {
          const normalized = safeURL(article.url);

          if (normalized && sameOrigin(normalized, root)) {
            const canonical = normalized.href;

            if (!articles.has(canonical)) {
              articles.set(canonical, {
                ...article,
                url: canonical
              });
            }
          }
        }
      }

      const links = extractLinks(
        result.html,
        current
      );

      for (const link of links) {
        if (queue.length >= CONFIG.MAX_LINKS) break;

        if (!queued.has(link)) {
          queued.add(link);
          queue.push(link);
        }
      }
    }
  }

  return {
    root: root.href,
    pages,
    articles: [...articles.values()].slice(
      0,
      CONFIG.MAX_ARTICLES
    ),
    fetchErrors
  };
}

/* =========================================================
   AI TEST
========================================================= */

async function aiTest(env) {
  const sample =
    "Bu bir deneme metnidir. Herkez bugün toplantıya katılacak.";

  const deterministic =
    deterministicProofread(
      sample,
      "tr"
    );

  const gemini = await callGemini(
    sample,
    "tr",
    env
  );

  let nvidia = null;

  if (!gemini.success) {
    nvidia = await callNVIDIA(
      sample,
      "tr",
      env
    );
  }

  return {
    ok: true,
    deterministic,
    gemini: {
      configured: !!env.GEMINI_API_KEY,
      success: gemini.success,
      status: gemini.status,
      error: gemini.error || null
    },
    nvidia: nvidia
      ? {
          configured: !!env.NVIDIA_API_KEY,
          success: nvidia.success,
          status: nvidia.status,
          error: nvidia.error || null
        }
      : {
          configured: !!env.NVIDIA_API_KEY,
          success: false,
          status: null,
          error: "Gemini başarılı olduğu için NVIDIA fallback çağrılmadı."
        }
  };
}

/* =========================================================
   FRONTEND
========================================================= */

const APP_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebProof AI</title>

<style>
body{
  margin:0;
  background:#0b1020;
  color:#eef2ff;
  font-family:Inter,Arial,sans-serif;
}
main{
  max-width:1100px;
  margin:auto;
  padding:30px 18px 80px;
}
h1{
  margin:0 0 8px;
  font-size:32px;
}
.sub{
  color:#aab4d0;
  margin-bottom:22px;
}
.box{
  background:#121a2e;
  border:1px solid #263452;
  border-radius:16px;
  padding:18px;
  margin-bottom:18px;
}
input{
  width:100%;
  box-sizing:border-box;
  padding:15px;
  border-radius:10px;
  border:1px solid #34415f;
  background:#0b1020;
  color:white;
  font-size:16px;
}
button{
  margin-top:12px;
  width:100%;
  padding:14px;
  border:0;
  border-radius:10px;
  background:#4f7cff;
  color:white;
  font-weight:700;
  font-size:16px;
  cursor:pointer;
}
button:disabled{
  opacity:.5;
}
.stats{
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:10px;
}
.stat{
  background:#0e1629;
  border-radius:12px;
  padding:14px;
}
.num{
  font-size:25px;
  font-weight:800;
}
.label{
  color:#8793af;
  font-size:12px;
}
.article{
  background:#111a2d;
  border:1px solid #283655;
  border-radius:15px;
  padding:18px;
  margin-top:14px;
}
.article h3{
  margin:0 0 8px;
}
.article a{
  color:#8eaeff;
  word-break:break-all;
}
.error{
  border-left:4px solid #ff4d67;
  background:#1a1725;
  padding:13px;
  margin-top:12px;
  border-radius:8px;
}
.good{
  color:#73e2a0;
  margin-top:12px;
}
.meta{
  color:#8996b2;
  font-size:13px;
  margin-top:10px;
}
.badge{
  display:inline-block;
  padding:4px 8px;
  border-radius:7px;
  background:#273452;
  font-size:12px;
  margin-bottom:7px;
}
pre{
  white-space:pre-wrap;
  word-break:break-word;
}
@media(max-width:700px){
  .stats{
    grid-template-columns:repeat(2,1fr);
  }
}
</style>
</head>

<body>
<main>

<div class="box">
<h1>WebProof AI</h1>
<div class="sub">
Gerçek web taraması + tam metin deterministik denetim + bağlamsal yapay zekâ analizi
</div>

<input id="url"
value="https://www.gercekgundem.com/"
placeholder="https://ornek-site.com">

<button id="scan">Siteyi Tara</button>

<div class="sub" style="margin-top:12px">
Önce haber metninin tamamı kod tabanlı objektif kurallarla taranır.
Kesin hata bulunursa doğrudan raporlanır. Nüans gerektiren durumlarda AI devreye girer.
</div>
</div>

<div id="output"></div>

</main>

<script>
const btn=document.getElementById("scan");
const urlInput=document.getElementById("url");
const output=document.getElementById("output");

btn.onclick=async()=>{
  const url=urlInput.value.trim();

  if(!url){
    alert("Bir site adresi girin.");
    return;
  }

  btn.disabled=true;
  btn.textContent="Gerçek tarama yapılıyor...";
  output.innerHTML='<div class="box">Web sayfaları eşzamanlı olarak indiriliyor, haberler ayrıştırılıyor ve tam metin denetleniyor...</div>';

  try{
    const response=await fetch(
      "/api/scan?url="+encodeURIComponent(url)
    );

    const data=await response.json();

    if(!response.ok || !data.ok){
      throw new Error(data.error || "Tarama başarısız.");
    }

    let html="";

    html+=\`
      <div class="box">
        <div class="stats">
          <div class="stat">
            <div class="num">\${data.pages}</div>
            <div class="label">Taranan sayfa</div>
          </div>

          <div class="stat">
            <div class="num">\${data.articleCount}</div>
            <div class="label">Bulunan haber</div>
          </div>

          <div class="stat">
            <div class="num">\${data.totalWords}</div>
            <div class="label">Taranan kelime</div>
          </div>

          <div class="stat">
            <div class="num">\${data.totalErrors}</div>
            <div class="label">Toplam hata</div>
          </div>

          <div class="stat">
            <div class="num">\${data.fetchErrors}</div>
            <div class="label">Fetch hatası</div>
          </div>
        </div>
      </div>
    \`;

    if(!data.articles.length){
      html+='<div class="box">Gerçek haber metni bulunamadı. Site yapısı bu tarama için uygun olmayabilir.</div>';
    }

    for(const article of data.articles){

      html+=\`
        <div class="article">
          <h3>\${escapeHTML(article.title)}</h3>

          <div>
            <a href="\${escapeAttr(article.url)}" target="_blank" rel="noopener">
              \${escapeHTML(article.url)}
            </a>
          </div>
      \`;

      if(article.errors.length){

        for(const e of article.errors){

          const sourceLabel=
            e.source==="deterministic"
              ? "Kod tarafından doğrulandı"
              : "AI + exact substring doğrulaması";

          html+=\`
            <div class="error">
              <div class="badge">\${sourceLabel}</div>

              <div>
                🔴 <b>Bu haberde doğrulanmış hata bulundu</b>
              </div>

              <div style="margin-top:9px">
                <b>\${escapeHTML(e.original)}</b>
                → 
                <b>\${escapeHTML(e.correction)}</b>
              </div>

              <div class="meta">
                Tür: \${escapeHTML(e.type)}
                · Güven: \${Math.round(e.confidence*100)}%
              </div>

              <div style="margin-top:8px">
                \${escapeHTML(e.reason)}
              </div>

              <div class="meta">
                Kaynak haber:
                <a href="\${escapeAttr(article.url)}" target="_blank" rel="noopener">
                  \${escapeHTML(article.url)}
                </a>
              </div>
            </div>
          \`;
        }

      }else{

        if(article.ai.provider==="unavailable"){
          html+=\`
            <div class="good">
              ✓ Kod tabanlı objektif taramada hata bulunmadı.
              AI analizi ise şu anda kullanılamıyor.
            </div>
          \`;
        }else{
          html+=\`
            <div class="good">
              ✓ Bu haberde doğrulanmış objektif hata bulunmadı.
            </div>
          \`;
        }

      }

      html+=\`
        <div class="meta">
          Dil: \${article.language}
          · Kelime: \${article.words}
          · Karakter: \${article.chars}
          · AI: \${article.ai.used ? article.ai.provider : "gerekmedi"}
        </div>

        </div>
      \`;
    }

    output.innerHTML=html;

  }catch(error){

    output.innerHTML=\`
      <div class="box">
        <b>Tarama hatası:</b>
        \${escapeHTML(error.message)}
      </div>
    \`;

  }finally{
    btn.disabled=false;
    btn.textContent="Siteyi Tara";
  }
};

function escapeHTML(value){
  return String(value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function escapeAttr(value){
  return escapeHTML(value);
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

    if (url.pathname === "/api/status") {

      return json({
        ok: true,
        service: "WebProof AI",
        version: VERSION,

        architecture: {
          realWebCrawling: true,
          concurrentCrawler: true,
          articleDetection: true,
          fullArticleScanning: true,

          deterministicEngine: true,
          TurkishRules: true,
          EnglishRules: true,

          contextualCandidateDetection: true,

          aiContextAnalysis: true,
          aiFallback: true,

          exactSubstringValidation: true,
          exactSourceURL: true,

          agentOrchestrator: true,

          homepageAsArticle: false,
          fakePunctuationRule: false
        },

        ai: {
          gemini: !!env.GEMINI_API_KEY,
          nvidia: !!env.NVIDIA_API_KEY,
          primary: "gemini"
        },

        models: {
          gemini: GEMINI_MODEL,
          nvidia: NVIDIA_MODEL
        },

        limits: {
          maxPages: CONFIG.MAX_PAGES,
          maxArticles: CONFIG.MAX_ARTICLES,
          maxLinks: CONFIG.MAX_LINKS,
          maxArticleCharacters: CONFIG.MAX_ARTICLE_CHARS,
          maxAIArticles: CONFIG.MAX_AI_ARTICLES
        },

        deterministicRuleCount: ALL_RULES.size
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

        const crawl = await crawlSite(target);

        /*
          AI budget:
          deterministic errors are handled without AI.
          Only first N clean articles are sent to AI.
        */

        let aiCount = 0;

        const analyzed = [];

        for (const article of crawl.articles) {

          const needsAI =
            aiCount < CONFIG.MAX_AI_ARTICLES;

          const result =
            await editorialAgent(
              article,
              env,
              needsAI
            );

          if (needsAI) {
            aiCount++;
          }

          analyzed.push(result);
        }

        const totalWords =
          analyzed.reduce(
            (n, a) => n + a.words,
            0
          );

        const totalErrors =
          analyzed.reduce(
            (n, a) => n + a.errors.length,
            0
          );

        return json({
          ok: true,
          service: "WebProof AI",
          version: VERSION,

          root: crawl.root,

          pages: crawl.pages.length,
          articleCount: analyzed.length,

          totalWords,
          totalErrors,

          fetchErrors: crawl.fetchErrors,

          architecture: {
            crawler: "real-fetch",
            articleDetection: "schema + article + metadata + text",
            deterministicFirst: true,
            contextualAI: true,
            agentOrchestrator: true
          },

          articles: analyzed.map(a => ({
            title: a.title,
            url: a.url,
            language: a.language,
            words: a.words,
            chars: a.chars,

            errors: a.errors,

            contextualCandidates:
              a.contextualCandidates,

            ai: a.ai
          }))
        });

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

    return page(APP_HTML);
  }
};

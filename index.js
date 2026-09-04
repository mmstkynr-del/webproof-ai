const MAX_DISCOVERY_PAGES = 20;
const MAX_ARTICLES = 10;
const MAX_LINKS = 300;
const MAX_HTML_BYTES = 1500000;
const MAX_ARTICLE_TEXT = 12000;

const FETCH_TIMEOUT = 7000;
const AI_TIMEOUT = 18000;
const AI_CHUNK_SIZE = 3500;
const MIN_AI_CONFIDENCE = 0.90;

const GEMINI_MODEL = "gemini-3.7-flash";

const NVIDIA_MODEL =
  "nvidia/nemotron-3.5-lightning-30b-a3b";

const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function html(data, status = 200) {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function normalizeUrl(value, base) {
  try {
    const u = new URL(value, base);

    if (!["http:", "https:"].includes(u.protocol)) {
      return null;
    }

    u.hash = "";

    return u.href;
  } catch {
    return null;
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return "";
      }
    });
}

function htmlToCleanText(source) {
  let text = String(source || "");

  text = text.replace(
    /<(script|style|noscript|template|svg|canvas|iframe|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  text = text.replace(
    /<\/(p|div|section|article|main|li|h1|h2|h3|h4|h5|h6|blockquote|br)>/gi,
    "\n"
  );

  text = text.replace(/<[^>]+>/g, " ");

  text = decodeEntities(text);

  text = text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

async function fetchWithTimeout(
  url,
  options = {},
  timeout = FETCH_TIMEOUT
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent":
          "WebProofAI/3.0",
        "accept":
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function isBadPath(url) {
  try {
    const p =
      new URL(url).pathname.toLowerCase();

    const blocked = [
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
      "/giris",
      "/register",
      "/kayit"
    ];

    return blocked.some(x => p.includes(x));
  } catch {
    return true;
  }
}

function articleScore(url, rawHtml, text) {
  let score = 0;

  const lower =
    String(rawHtml || "").toLowerCase();

  if (/<article\b/i.test(rawHtml)) {
    score += 30;
  }

  if (
    /"@type"\s*:\s*"(newsarticle|article|reportage|report)"/i.test(
      rawHtml
    )
  ) {
    score += 30;
  }

  if (
    /datePublished|article:published_time|published_time/i.test(
      rawHtml
    )
  ) {
    score += 20;
  }

  if (
    /og:type["']?\s*content=["']article/i.test(
      lower
    )
  ) {
    score += 20;
  }

  if (text.length >= 1000) {
    score += 10;
  }

  if (text.length >= 2500) {
    score += 10;
  }

  const path =
    new URL(url).pathname;

  if (
    path
      .split("/")
      .filter(Boolean)
      .length >= 2
  ) {
    score += 10;
  }

  if (isBadPath(url)) {
    score -= 50;
  }

  return score;
}

function extractMainText(rawHtml) {
  const articleMatches = [
    ...String(rawHtml || "").matchAll(
      /<article\b[^>]*>([\s\S]*?)<\/article>/gi
    )
  ];

  if (articleMatches.length) {
    return articleMatches
      .map(x => htmlToCleanText(x[1]))
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  const mainMatches = [
    ...String(rawHtml || "").matchAll(
      /<main\b[^>]*>([\s\S]*?)<\/main>/gi
    )
  ];

  if (mainMatches.length) {
    return mainMatches
      .map(x => htmlToCleanText(x[1]))
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  return htmlToCleanText(rawHtml);
}

function extractTitle(rawHtml) {
  const match =
    String(rawHtml || "").match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  if (!match) {
    return "Başlıksız haber";
  }

  return decodeEntities(match[1])
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguage(text) {
  const turkishChars =
    (String(text || "").match(
      /[çğıöşüÇĞİÖŞÜ]/g
    ) || []).length;

  const letters =
    (String(text || "").match(
      /[A-Za-zÇĞİÖŞÜçğıöşü]/g
    ) || []).length;

  if (!letters) {
    return "unknown";
  }

  return turkishChars / letters > 0.002
    ? "tr"
    : "en";
}

const TURKISH_RULES = {
  "yanlız": "yalnız",
  "yalnış": "yanlış",
  "yanlızca": "yalnızca",
  "herkez": "herkes",
  "birşey": "bir şey",
  "hiç bir": "hiçbir",
  "her hangi": "herhangi",
  "malesef": "maalesef",
  "orjinal": "orijinal",
  "süpriz": "sürpriz",
  "labaratuvar": "laboratuvar",
  "şarz": "şarj",
  "traş": "tıraş"
};

const ENGLISH_RULES = {
  "recieve": "receive",
  "seperate": "separate",
  "definately": "definitely",
  "occured": "occurred",
  "accomodate": "accommodate",
  "wierd": "weird",
  "untill": "until",
  "wich": "which",
  "teh": "the"
};

function preserveCase(original, correction) {
  if (
    original &&
    original === original.toUpperCase()
  ) {
    return correction.toUpperCase();
  }

  if (
    original &&
    original[0] === original[0].toUpperCase()
  ) {
    return (
      correction.charAt(0).toUpperCase() +
      correction.slice(1)
    );
  }

  return correction;
}

function deterministicErrors(text, language) {
  const rules =
    language === "tr"
      ? TURKISH_RULES
      : ENGLISH_RULES;

  const errors = [];

  for (
    const [wrong, correct]
    of Object.entries(rules)
  ) {
    const escaped =
      wrong.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const regex =
      new RegExp(
        `(^|[^\\p{L}])(${escaped})(?=$|[^\\p{L}])`,
        "giu"
      );

    let match;

    while (
      (match = regex.exec(text)) !== null
    ) {
      errors.push({
        original: match[2],
        correction:
          preserveCase(
            match[2],
            correct
          ),
        type: "spelling",
        confidence: 1,
        reason:
          "Objektif yazım hatası."
      });
    }
  }

  return errors;
}

const PROOFREAD_SCHEMA = {
  type: "object",
  properties: {
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: {
            type: "string"
          },
          correction: {
            type: "string"
          },
          type: {
            type: "string",
            enum: [
              "spelling",
              "grammar",
              "punctuation",
              "word_usage"
            ]
          },
          confidence: {
            type: "number"
          },
          reason: {
            type: "string"
          }
        },
        required: [
          "original",
          "correction",
          "type",
          "confidence",
          "reason"
        ]
      }
    }
  },
  required: ["errors"]
};

const PROOFREAD_SYSTEM = `
You are WebProof AI, a professional editorial verification engine.

Analyze the supplied text and report ONLY objectively verifiable errors.

Allowed:
- spelling errors
- grammar errors
- punctuation errors
- objectively incorrect word usage

Do NOT report:
- style preferences
- alternative wording
- rewriting suggestions
- journalistic style choices
- dialect differences
- names
- surnames
- organizations
- brands
- URLs
- numbers
- dates
- quotations

unless there is clear objective evidence of an actual error.

Rules:

1. original MUST be an exact substring of the supplied text.
2. correction MUST be the smallest possible correction.
3. Never rewrite an entire sentence.
4. Never invent an error.
5. Confidence MUST be at least 0.90.
6. If uncertain, do not report it.
7. Return JSON only.
`;

function splitIntoChunks(
  text,
  size = AI_CHUNK_SIZE
) {
  if (text.length <= size) {
    return [text];
  }

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end =
      Math.min(
        start + size,
        text.length
      );

    if (end < text.length) {
      const boundary =
        text.lastIndexOf(
          ". ",
          end
        );

      if (
        boundary >
        start + 1000
      ) {
        end =
          boundary + 1;
      }
    }

    const chunk =
      text
        .slice(start, end)
        .trim();

    if (chunk) {
      chunks.push(chunk);
    }

    start = end;
  }

  return chunks;
}

function validateAIResult(
  result,
  sourceText
) {
  if (
    !result ||
    !Array.isArray(result.errors)
  ) {
    return [];
  }

  const output = [];

  for (const e of result.errors) {
    if (!e) continue;

    const original =
      typeof e.original === "string"
        ? e.original.trim()
        : "";

    const correction =
      typeof e.correction === "string"
        ? e.correction.trim()
        : "";

    const confidence =
      Number(e.confidence);

    const reason =
      typeof e.reason === "string"
        ? e.reason.trim()
        : "";

    if (!original || !correction) {
      continue;
    }

    if (original === correction) {
      continue;
    }

    if (
      !Number.isFinite(confidence) ||
      confidence < MIN_AI_CONFIDENCE
    ) {
      continue;
    }

    if (!sourceText.includes(original)) {
      continue;
    }

    if (
      original.length > 120 ||
      correction.length > 120
    ) {
      continue;
    }

    if (
      /(^|\s)[.,;:!?](?=\s|$)/
        .test(original)
    ) {
      continue;
    }

    output.push({
      original,
      correction,
      type:
        e.type || "grammar",
      confidence,
      reason:
        reason ||
        "Bağlamsal dil kontrolü."
    });
  }

  return output;
}

async function callGemini(
  env,
  text,
  language
) {
  if (!env.GEMINI_API_KEY) {
    return {
      success: false,
      error:
        "GEMINI_API_KEY yok."
    };
  }

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(GEMINI_MODEL) +
    ":generateContent?key=" +
    encodeURIComponent(
      env.GEMINI_API_KEY
    );

  const body = {
    systemInstruction: {
      parts: [
        {
          text: PROOFREAD_SYSTEM
        }
      ]
    },

    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Language: ${language}\n\nTEXT:\n${text}`
          }
        ]
      }
    ],

    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1200,
      responseMimeType:
        "application/json",
      responseSchema:
        PROOFREAD_SCHEMA
    }
  };

  try {
    const response =
      await fetchWithTimeout(
        endpoint,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify(body)
        },
        AI_TIMEOUT
      );

    const raw =
      await response.text();

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error:
          raw.slice(0, 3000)
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
          "Gemini JSON parse hatası."
      };
    }

    const parts =
      data
        ?.candidates?.[0]
        ?.content?.parts || [];

    const output =
      parts
        .map(x => x.text || "")
        .join("")
        .trim();

    if (!output) {
      return {
        success: false,
        status: response.status,
        error:
          "Gemini boş yanıt döndürdü."
      };
    }

    let parsed;

    try {
      parsed =
        JSON.parse(output);
    } catch {
      return {
        success: false,
        status: response.status,
        error:
          "Gemini yanıtı JSON olarak çözülemedi.",
        raw:
          output.slice(0, 1000)
      };
    }

    return {
      success: true,
      status: response.status,

      errors:
        validateAIResult(
          parsed,
          text
        )
    };

  } catch (error) {
    return {
      success: false,
      error:
        error?.name === "AbortError"
          ? "Gemini timeout."
          : String(
              error?.message || error
            )
    };
  }
}

function extractJSON(text) {
  const cleaned =
    String(text || "")
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

  if (
    cleaned.startsWith("{") &&
    cleaned.endsWith("}")
  ) {
    return cleaned;
  }

  const start =
    cleaned.indexOf("{");

  const end =
    cleaned.lastIndexOf("}");

  if (
    start >= 0 &&
    end > start
  ) {
    return cleaned.slice(
      start,
      end + 1
    );
  }

  return cleaned;
}

async function callNvidia(
  env,
  text,
  language
) {
  if (!env.NVIDIA_API_KEY) {
    return {
      success: false,
      error:
        "NVIDIA_API_KEY yok."
    };
  }

  const body = {
    model: NVIDIA_MODEL,

    messages: [
      {
        role: "system",
        content:
          PROOFREAD_SYSTEM
      },

      {
        role: "user",
        content:
          `Language: ${language}\n\nTEXT:\n${text}`
      }
    ],

    temperature: 0,
    top_p: 0.9,
    max_tokens: 1200,
    stream: false
  };

  try {
    const response =
      await fetchWithTimeout(
        NVIDIA_ENDPOINT,
        {
          method: "POST",

          headers: {
            authorization:
              `Bearer ${env.NVIDIA_API_KEY}`,

            "content-type":
              "application/json",

            accept:
              "application/json"
          },

          body:
            JSON.stringify(body)
        },
        AI_TIMEOUT
      );

    const raw =
      await response.text();

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error:
          raw.slice(0, 3000)
      };
    }

    let data;

    try {
      data =
        JSON.parse(raw);
    } catch {
      return {
        success: false,
        status: response.status,
        error:
          "NVIDIA JSON parse hatası."
      };
    }

    const output =
      data
        ?.choices?.[0]
        ?.message?.content
        ?.trim();

    if (!output) {
      return {
        success: false,
        status: response.status,
        error:
          "NVIDIA boş yanıt döndürdü."
      };
    }

    let parsed;

    try {
      parsed =
        JSON.parse(
          extractJSON(output)
        );
    } catch {
      return {
        success: false,
        status: response.status,
        error:
          "NVIDIA yanıtı JSON olarak çözülemedi.",
        raw:
          output.slice(0, 1000)
      };
    }

    return {
      success: true,
      status: response.status,

      errors:
        validateAIResult(
          parsed,
          text
        )
    };

  } catch (error) {
    return {
      success: false,
      error:
        error?.name === "AbortError"
          ? "NVIDIA timeout."
          : String(
              error?.message || error
            )
    };
  }
}

function dedupeErrors(errors) {
  const map =
    new Map();

  for (const e of errors) {
    const key =
      `${e.original}|||${e.correction}`;

    if (!map.has(key)) {
      map.set(key, e);
    }
  }

  return [...map.values()];
}

async function aiTest(env) {
  const testText =
    "Bu bir deneme metnidir. Herkez burada.";

  const result = {
    ok: true
  };

  if (env.GEMINI_API_KEY) {
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
        gemini.status || null,
      errors:
        gemini.errors || [],
      error:
        gemini.error || null
    };
  } else {
    result.gemini = {
      configured: false,
      success: false,
      error:
        "GEMINI_API_KEY yok."
    };
  }

  if (env.NVIDIA_API_KEY) {
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
        nvidia.status || null,
      errors:
        nvidia.errors || [],
      error:
        nvidia.error || null
    };
  } else {
    result.nvidia = {
      configured: false,
      success: false,
      error:
        "NVIDIA_API_KEY yok."
    };
  }

  return result;
}

async function crawlWebsite(
  startUrl
) {
  const origin =
    new URL(startUrl).origin;

  const queue = [
    startUrl
  ];

  const visited =
    new Set();

  const pages = [];
  const articles = [];

  while (
    queue.length &&
    visited.size <
      MAX_DISCOVERY_PAGES &&
    articles.length <
      MAX_ARTICLES
  ) {
    const current =
      queue.shift();

    if (
      visited.has(current)
    ) {
      continue;
    }

    visited.add(current);

    let response;

    try {
      response =
        await fetchWithTimeout(
          current
        );
    } catch {
      continue;
    }

    if (!response.ok) {
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

    const raw =
      await response.text();

    if (
      raw.length >
      MAX_HTML_BYTES
    ) {
      continue;
    }

    const text =
      extractMainText(raw);

    const score =
      articleScore(
        current,
        raw,
        text
      );

    pages.push({
      url: current,
      score
    });

    const path =
      new URL(current)
        .pathname;

    const isHomepage =
      path === "/" ||
      path === "";

    if (
      !isHomepage &&
      score >= 50 &&
      text.length >= 800 &&
      !isBadPath(current)
    ) {
      articles.push({
        url: current,

        title:
          extractTitle(raw),

        text:
          text.slice(
            0,
            MAX_ARTICLE_TEXT
          ),

        language:
          detectLanguage(text),

        score
      });
    }

    const links = [
      ...raw.matchAll(
        /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi
      )
    ];

    for (const match of links) {
      if (
        queue.length >=
        MAX_LINKS
      ) {
        break;
      }

      const next =
        normalizeUrl(
          match[1],
          current
        );

      if (!next) {
        continue;
      }

      if (
        !sameOrigin(
          next,
          origin
        )
      ) {
        continue;
      }

      if (
        visited.has(next)
      ) {
        continue;
      }

      queue.push(next);
    }
  }

  return {
    pages,
    articles
  };
}

async function analyzeArticle(
  env,
  article
) {
  const deterministic =
    deterministicErrors(
      article.text,
      article.language
    );

  const chunks =
    splitIntoChunks(
      article.text
    );

  const aiErrors = [];

  let provider =
    "none";

  let geminiFailures = 0;

  for (
    const chunk of chunks
  ) {
    if (
      env.GEMINI_API_KEY
    ) {
      const result =
        await callGemini(
          env,
          chunk,
          article.language
        );

      if (result.success) {
        provider = "gemini";

        aiErrors.push(
          ...(result.errors || [])
        );
      } else {
        geminiFailures++;
      }
    }
  }

  if (
    !env.GEMINI_API_KEY ||
    geminiFailures > 0
  ) {
    for (
      const chunk of chunks
    ) {
      if (
        !env.NVIDIA_API_KEY
      ) {
        break;
      }

      const result =
        await callNvidia(
          env,
          chunk,
          article.language
        );

      if (result.success) {
        provider =
          provider === "gemini"
            ? "gemini+nvidia"
            : "nvidia";

        aiErrors.push(
          ...(result.errors || [])
        );
      }
    }
  }

  return {
    url: article.url,
    title: article.title,
    language: article.language,
    articleScore: article.score,

    errors:
      dedupeErrors([
        ...deterministic,
        ...aiErrors
      ]),

    ai: {
      provider,
      gemini:
        Boolean(
          env.GEMINI_API_KEY
        ),
      nvidia:
        Boolean(
          env.NVIDIA_API_KEY
        )
    }
  };
}

const FRONTEND = `
<!doctype html>
<html lang="tr">

<head>

<meta charset="utf-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1">

<title>WebProof AI</title>

<style>

body {
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  background:#f5f6f8;

  margin:0;

  color:#171717;
}

main {
  max-width:1000px;

  margin:auto;

  padding:30px 18px;
}

h1 {
  margin-bottom:5px;
}

.sub {
  color:#666;

  margin-bottom:25px;
}

input {
  width:100%;

  box-sizing:border-box;

  padding:15px;

  border:
    1px solid #ccc;

  border-radius:10px;

  font-size:16px;
}

button {
  margin-top:12px;

  padding:13px 20px;

  border:0;

  border-radius:9px;

  cursor:pointer;

  font-weight:700;
}

.card {
  background:white;

  border-radius:12px;

  padding:18px;

  margin-top:15px;

  box-shadow:
    0 2px 10px
    rgba(0,0,0,.06);
}

.error {
  border-left:
    5px solid #d00;

  padding:12px;

  margin-top:10px;

  background:#fff7f7;
}

.source {
  margin-top:10px;

  font-size:14px;
}

.source a {
  word-break:break-all;
}

.ok {
  color:#087a35;

  font-weight:700;
}

.bad {
  color:#b00020;

  font-weight:700;
}

.stats {
  display:flex;

  gap:10px;

  flex-wrap:wrap;

  margin-top:20px;
}

.stat {
  background:white;

  padding:15px;

  border-radius:10px;

  min-width:130px;
}

.small {
  color:#666;

  font-size:13px;
}

</style>

</head>

<body>

<main>

<h1>WebProof AI</h1>

<div class="sub">
Gerçek web taraması +
editoryal doğrulama +
Gemini + NVIDIA ikinci görüş
</div>

<input
id="url"
placeholder="https://ornek-site.com"
/>

<button
onclick="scan()">
Siteyi Tara
</button>

<div id="status"></div>

<div id="results"></div>

</main>

<script>

async function scan() {

  const url =
    document
      .getElementById("url")
      .value
      .trim();

  if (!url) {
    alert(
      "Bir web sitesi adresi gir."
    );

    return;
  }

  document
    .getElementById("status")
    .innerHTML =
      "<div class='card'>" +
      "Tarama yapılıyor..." +
      "</div>";

  document
    .getElementById("results")
    .innerHTML = "";

  try {

    const response =
      await fetch(
        "/api/scan?url=" +
        encodeURIComponent(url)
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        "Tarama başarısız."
      );
    }

    document
      .getElementById("status")
      .innerHTML =
        "<div class='card'>" +
        "<b>Tarama tamamlandı.</b>" +
        "</div>";

    document
      .getElementById("results")
      .innerHTML =

      "<div class='stats'>" +

      "<div class='stat'>" +
      "<b>" +
      data.pages +
      "</b><br>" +
      "<span class='small'>" +
      "Taranan sayfa" +
      "</span>" +
      "</div>" +

      "<div class='stat'>" +
      "<b>" +
      data.articles.length +
      "</b><br>" +
      "<span class='small'>" +
      "Bulunan haber" +
      "</span>" +
      "</div>" +

      "<div class='stat'>" +
      "<b>" +
      data.totalErrors +
      "</b><br>" +
      "<span class='small'>" +
      "Toplam hata" +
      "</span>" +
      "</div>" +

      "</div>" +

      data.articles
        .map(article => {

          let body = "";

          if (
            !article.errors.length
          ) {

            body =
              "<div class='ok'>" +
              "✓ Bu haberde " +
              "raporlanabilir objektif " +
              "yazım/dilbilgisi hatası " +
              "bulunmadı." +
              "</div>";

          } else {

            body =
              "<div class='bad'>" +
              "🔴 Bu haberde doğrulanmış " +
              "hata bulundu" +
              "</div>" +

              article.errors
                .map(e =>

                  "<div class='error'>" +

                  "<b>" +
                  escapeHtml(
                    e.original
                  ) +
                  " → " +
                  escapeHtml(
                    e.correction
                  ) +
                  "</b>" +

                  "<br>" +

                  escapeHtml(
                    e.reason || ""
                  ) +

                  "<br>" +

                  "<span class='small'>" +
                  "Güven: " +
                  Math.round(
                    e.confidence * 100
                  ) +
                  "%" +
                  "</span>" +

                  "</div>"

                )
                .join("");
          }

          return (

            "<div class='card'>" +

            "<h2>" +
            escapeHtml(
              article.title
            ) +
            "</h2>" +

            body +

            "<div class='source'>" +
            "<b>Kaynak haber:</b> " +

            "<a href='" +
            escapeAttr(
              article.url
            ) +
            "' target='_blank' " +
            "rel='noopener'>" +

            escapeHtml(
              article.url
            ) +

            "</a>" +

            "</div>" +

            "<div class='small'>" +
            "AI: " +
            escapeHtml(
              article.ai?.provider ||
              "none"
            ) +
            "</div>" +

            "</div>"
          );

        })
        .join("");

  } catch (error) {

    document
      .getElementById("status")
      .innerHTML =
        "<div class='card bad'>" +
        "Tarama hatası: " +
        escapeHtml(
          error.message
        ) +
        "</div>";
  }
}

function escapeHtml(value) {

  return String(
    value || ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

function escapeAttr(value) {
  return escapeHtml(value);
}

</script>

</body>

</html>
`;

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(request.url);

    if (
      url.pathname ===
      "/api/status"
    ) {

      return json({

        ok: true,

        service:
          "WebProof AI",

        version:
          "production-editorial-3.1",

        ai: {

          gemini:
            Boolean(
              env.GEMINI_API_KEY
            ),

          nvidia:
            Boolean(
              env.NVIDIA_API_KEY
            ),

          primary:
            env.GEMINI_API_KEY
              ? "gemini"
              : env.NVIDIA_API_KEY
                ? "nvidia"
                : "none"
        },

        models: {

          gemini:
            GEMINI_MODEL,

          nvidia:
            NVIDIA_MODEL
        },

        capabilities: [
          "website-crawling",
          "article-detection",
          "Turkish-proofreading",
          "English-proofreading",
          "Gemini-contextual-validation",
          "NVIDIA-secondary-validation",
          "URL-level-evidence",
          "false-positive-filtering",
          "exact-substring-validation",
          "confidence-thresholding"
        ]
      });
    }

    if (
      url.pathname ===
      "/api/ai-test"
    ) {

      return json(
        await aiTest(env)
      );
    }

    if (
      url.pathname ===
      "/api/scan"
    ) {

      const target =
        url.searchParams.get(
          "url"
        );

      if (!target) {

        return json(
          {
            ok: false,
            error:
              "url parametresi gerekli."
          },
          400
        );
      }

      const normalized =
        normalizeUrl(target);

      if (!normalized) {

        return json(
          {
            ok: false,
            error:
              "Geçersiz URL."
          },
          400
        );
      }

      try {

        const crawl =
          await crawlWebsite(
            normalized
          );

        const results = [];

        for (
          const article
          of crawl.articles
        ) {

          results.push(
            await analyzeArticle(
              env,
              article
            )
          );
        }

        const totalErrors =
          results.reduce(
            (
              total,
              article
            ) =>
              total +
              article.errors.length,
            0
          );

        return json({

          ok: true,

          pages:
            crawl.pages.length,

          articles:
            results,

          totalErrors

        });

      } catch (error) {

        return json(
          {
            ok: false,

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

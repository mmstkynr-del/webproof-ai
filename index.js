const VERSION = "production-editorial-4.0";

const MAX_PAGES = 18;
const MAX_ARTICLES = 8;
const MAX_LINKS = 120;

const MAX_HTML_BYTES = 1500000;
const MAX_ARTICLE_TEXT = 14000;

const FETCH_TIMEOUT = 6000;
const AI_TIMEOUT = 9000;

const GEMINI_MODEL = "gemini-3.7-flash";

const NVIDIA_MODEL =
  "nvidia/nemotron-3.5-lightning-30b-a3b";

const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const MIN_AI_CONFIDENCE = 0.90;

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
  "traş": "tıraş",
  "yalniz": "yalnız",
  "yanliz": "yalnız",
  "yanlis": "yanlış",
  "herkez": "herkes",
  "birsey": "bir şey"
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
  "teh": "the",
  "beleive": "believe",
  "begining": "beginning",
  "enviroment": "environment",
  "goverment": "government",
  "succesful": "successful",
  "tommorow": "tomorrow"
};

const PROOFREAD_SYSTEM = `
You are WebProof AI, an objective professional proofreading verifier.

Analyze only the supplied article text.

Report ONLY objectively verifiable:
- spelling errors
- grammar errors
- punctuation errors
- objectively incorrect word usage

DO NOT report:
- style preferences
- rewriting suggestions
- better wording
- journalistic style choices
- dialect differences
- names
- surnames
- organizations
- brands
- URLs
- dates
- numbers
- quotations

unless there is clear objective evidence of an actual error.

For every reported error:

original MUST be an exact substring from the text.

correction MUST be the smallest possible correction.

Never rewrite a sentence.

Never invent an error.

Confidence must be >= 0.90.

If uncertain, return no error.

Return JSON only:

{
  "errors": [
    {
      "original": "...",
      "correction": "...",
      "type": "spelling|grammar|punctuation|word_usage",
      "confidence": 0.95,
      "reason": "..."
    }
  ]
}
`;

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control":
          "no-store"
      }
    }
  );
}

function html(data, status = 200) {
  return new Response(
    data,
    {
      status,
      headers: {
        "content-type":
          "text/html; charset=utf-8",
        "cache-control":
          "no-store"
      }
    }
  );
}

function safeURL(value, base) {
  try {
    const u =
      new URL(value, base);

    if (
      u.protocol !== "http:" &&
      u.protocol !== "https:"
    ) {
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
    return (
      new URL(a).origin ===
      new URL(b).origin
    );
  } catch {
    return false;
  }
}

async function fetchTimeout(
  url,
  options = {},
  timeout = FETCH_TIMEOUT
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {
    return await fetch(
      url,
      {
        ...options,

        signal:
          controller.signal,

        headers: {
          "user-agent":
            "WebProofAI/4.0",
          "accept":
            "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          ...(options.headers || {})
        }
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(text) {
  return String(text || "")
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&#(\d+);/g,
      (_, n) => {
        try {
          return String.fromCodePoint(
            Number(n)
          );
        } catch {
          return "";
        }
      }
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) => {
        try {
          return String.fromCodePoint(
            parseInt(n, 16)
          );
        } catch {
          return "";
        }
      }
    );
}

function htmlToText(source) {
  let text =
    String(source || "");

  text = text.replace(
    /<(script|style|noscript|template|svg|canvas|iframe|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  text = text.replace(
    /<\/(p|div|section|article|main|li|h1|h2|h3|h4|h5|h6|blockquote|br|tr)>/gi,
    "\n"
  );

  text =
    text.replace(
      /<[^>]+>/g,
      " "
    );

  text =
    decodeEntities(text);

  text =
    text
      .replace(
        /[\u200B-\u200D\uFEFF]/g,
        ""
      )
      .replace(
        /\r/g,
        ""
      )
      .replace(
        /[ \t]+/g,
        " "
      )
      .replace(
        /\n[ \t]+/g,
        "\n"
      )
      .replace(
        /[ \t]+\n/g,
        "\n"
      )
      .replace(
        /\n{3,}/g,
        "\n\n"
      )
      .trim();

  return text;
}

function extractTitle(htmlText) {
  const title =
    String(htmlText || "")
      .match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      );

  if (!title) {
    return "";
  }

  return decodeEntities(
    title[1]
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function getMeta(
  raw,
  name
) {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      "i"
    )
  ];

  for (const p of patterns) {
    const m =
      raw.match(p);

    if (m) {
      return decodeEntities(
        m[1]
      ).trim();
    }
  }

  return "";
}

function getJsonLD(raw) {
  const scripts = [
    ...String(raw || "").matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )
  ];

  const values = [];

  for (const match of scripts) {
    try {
      const parsed =
        JSON.parse(
          match[1]
            .trim()
        );

      if (
        Array.isArray(parsed)
      ) {
        values.push(
          ...parsed
        );
      } else {
        values.push(parsed);
      }
    } catch {
    }
  }

  return values;
}

function isArticlePath(url) {
  try {
    const u =
      new URL(url);

    const p =
      u.pathname
        .toLowerCase();

    if (
      p === "/" ||
      p === ""
    ) {
      return false;
    }

    const bad = [
      "/search",
      "/arama",
      "/tag/",
      "/etiket/",
      "/category/",
      "/kategori/",
      "/author/",
      "/yazar/",
      "/video/",
      "/videos/",
      "/gallery/",
      "/galeri/",
      "/foto/",
      "/fotogaleri/",
      "/login",
      "/giris",
      "/register",
      "/kayit",
      "/feed",
      "/rss",
      ".xml",
      ".json"
    ];

    if (
      bad.some(
        x => p.includes(x)
      )
    ) {
      return false;
    }

    const segments =
      p
        .split("/")
        .filter(Boolean);

    return (
      segments.length >= 1
    );
  } catch {
    return false;
  }
}

function extractArticle(raw, url) {
  const jsonld =
    getJsonLD(raw);

  let isNews =
    false;

  let datePublished =
    "";

  for (const item of jsonld) {
    if (!item) continue;

    const types =
      Array.isArray(
        item["@type"]
      )
        ? item["@type"]
        : [item["@type"]];

    if (
      types.some(
        t =>
          [
            "NewsArticle",
            "Article",
            "Reportage"
          ].includes(t)
      )
    ) {
      isNews = true;

      datePublished =
        item.datePublished ||
        "";
    }
  }

  const ogType =
    getMeta(
      raw,
      "og:type"
    ).toLowerCase();

  const articleMeta =
    Boolean(
      getMeta(
        raw,
        "article:published_time"
      )
    );

  const hasArticleTag =
    /<article\b/i.test(
      raw
    );

  const candidates = [];

  const articles = [
    ...raw.matchAll(
      /<article\b[^>]*>([\s\S]*?)<\/article>/gi
    )
  ];

  for (const m of articles) {
    candidates.push(
      htmlToText(
        m[1]
      )
    );
  }

  const mains = [
    ...raw.matchAll(
      /<main\b[^>]*>([\s\S]*?)<\/main>/gi
    )
  ];

  for (const m of mains) {
    candidates.push(
      htmlToText(
        m[1]
      )
    );
  }

  const sections = [
    ...raw.matchAll(
      /<(div|section)[^>]+(?:class|id)=["'][^"']*(?:article|story|content|post|news|body)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi
    )
  ];

  for (const m of sections) {
    candidates.push(
      htmlToText(
        m[2]
      )
    );
  }

  const best =
    candidates
      .filter(
        x =>
          x &&
          x.length >= 500
      )
      .sort(
        (a, b) =>
          b.length -
          a.length
      )[0] || "";

  const text =
    best ||
    htmlToText(raw);

  let score = 0;

  if (hasArticleTag) {
    score += 35;
  }

  if (isNews) {
    score += 35;
  }

  if (ogType === "article") {
    score += 20;
  }

  if (articleMeta) {
    score += 20;
  }

  if (datePublished) {
    score += 20;
  }

  if (
    text.length >= 1000
  ) {
    score += 10;
  }

  if (
    text.length >= 2500
  ) {
    score += 10;
  }

  if (
    isArticlePath(url)
  ) {
    score += 10;
  }

  const likelyArticle =
    score >= 50 &&
    text.length >= 800 &&
    (
      hasArticleTag ||
      isNews ||
      ogType === "article" ||
      articleMeta ||
      datePublished
    );

  return {
    likelyArticle,
    score,
    text:
      text.slice(
        0,
        MAX_ARTICLE_TEXT
      ),
    title:
      extractTitle(raw),
    datePublished
  };
}

function detectLanguage(
  text
) {
  const s =
    String(text || "");

  const tr =
    (
      s.match(
        /[çğıöşüÇĞİÖŞÜ]/g
      ) || []
    ).length;

  const letters =
    (
      s.match(
        /[A-Za-zÇĞİÖŞÜçğıöşü]/g
      ) || []
    ).length;

  if (!letters) {
    return "unknown";
  }

  return (
    tr / letters > 0.002
  )
    ? "tr"
    : "en";
}

function preserveCase(
  original,
  correction
) {
  if (
    original ===
    original.toUpperCase()
  ) {
    return correction.toUpperCase();
  }

  if (
    original[0] &&
    original[0] ===
      original[0].toUpperCase()
  ) {
    return (
      correction
        .charAt(0)
        .toUpperCase() +
      correction.slice(1)
    );
  }

  return correction;
}

function deterministicProofread(
  text,
  language
) {
  const rules =
    language === "tr"
      ? TURKISH_RULES
      : ENGLISH_RULES;

  const errors = [];

  for (
    const [
      wrong,
      correction
    ]
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
      (match =
        regex.exec(text)) !==
      null
    ) {
      errors.push({
        original:
          match[2],

        correction:
          preserveCase(
            match[2],
            correction
          ),

        type:
          "spelling",

        confidence:
          1,

        reason:
          "Kod tabanlı objektif yazım kontrolü."
      });
    }
  }

  return errors;
}

function validateAI(
  data,
  source
) {
  if (
    !data ||
    !Array.isArray(
      data.errors
    )
  ) {
    return [];
  }

  const valid = [];

  for (
    const e of data.errors
  ) {
    if (!e) continue;

    const original =
      typeof e.original ===
      "string"
        ? e.original.trim()
        : "";

    const correction =
      typeof e.correction ===
      "string"
        ? e.correction.trim()
        : "";

    const confidence =
      Number(
        e.confidence
      );

    if (
      !original ||
      !correction
    ) {
      continue;
    }

    if (
      original ===
      correction
    ) {
      continue;
    }

    if (
      confidence <
      MIN_AI_CONFIDENCE
    ) {
      continue;
    }

    if (
      !source.includes(
        original
      )
    ) {
      continue;
    }

    if (
      original.length >
        120 ||
      correction.length >
        120
    ) {
      continue;
    }

    valid.push({
      original,
      correction,
      type:
        e.type ||
        "grammar",
      confidence,
      reason:
        e.reason ||
        "Bağlamsal AI doğrulaması."
    });
  }

  return valid;
}

async function callGemini(
  env,
  text,
  language
) {
  if (
    !env.GEMINI_API_KEY
  ) {
    return {
      success: false,
      error:
        "GEMINI_API_KEY yok."
    };
  }

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(
      GEMINI_MODEL
    ) +
    ":generateContent?key=" +
    encodeURIComponent(
      env.GEMINI_API_KEY
    );

  const body = {
    systemInstruction: {
      parts: [
        {
          text:
            PROOFREAD_SYSTEM
        }
      ]
    },

    contents: [
      {
        role: "user",

        parts: [
          {
            text:
              `Language: ${language}\n\nARTICLE:\n${text}`
          }
        ]
      }
    ],

    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1000,
      responseMimeType:
        "application/json",

      responseSchema: {
        type: "object",

        properties: {
          errors: {
            type: "array",

            items: {
              type:
                "object",

              properties: {
                original: {
                  type:
                    "string"
                },

                correction: {
                  type:
                    "string"
                },

                type: {
                  type:
                    "string"
                },

                confidence: {
                  type:
                    "number"
                },

                reason: {
                  type:
                    "string"
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

        required: [
          "errors"
        ]
      }
    }
  };

  try {
    const response =
      await fetchTimeout(
        endpoint,
        {
          method:
            "POST",

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
        status:
          response.status,
        error:
          raw.slice(
            0,
            2000
          )
      };
    }

    const data =
      JSON.parse(raw);

    const output =
      data
        ?.candidates?.[0]
        ?.content?.parts
        ?.map(
          x => x.text || ""
        )
        .join("")
        .trim();

    if (!output) {
      return {
        success: false,
        status:
          response.status,
        error:
          "Gemini boş yanıt."
      };
    }

    const parsed =
      JSON.parse(
        output
      );

    return {
      success: true,
      status:
        response.status,
      errors:
        validateAI(
          parsed,
          text
        )
    };

  } catch (error) {
    return {
      success: false,

      error:
        error?.name ===
        "AbortError"
          ? "Gemini timeout."
          : String(
              error?.message ||
              error
            )
    };
  }
}

function extractNvidiaJSON(
  text
) {
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

  const start =
    cleaned.indexOf(
      "{"
    );

  const end =
    cleaned.lastIndexOf(
      "}"
    );

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
  if (
    !env.NVIDIA_API_KEY
  ) {
    return {
      success: false,
      error:
        "NVIDIA_API_KEY yok."
    };
  }

  const body = {
    model:
      NVIDIA_MODEL,

    messages: [
      {
        role:
          "system",

        content:
          PROOFREAD_SYSTEM
      },

      {
        role:
          "user",

        content:
          `Language: ${language}\n\nARTICLE:\n${text}`
      }
    ],

    temperature:
      0,

    top_p:
      0.9,

    max_tokens:
      800,

    stream:
      false
  };

  try {
    const response =
      await fetchTimeout(
        NVIDIA_ENDPOINT,
        {
          method:
            "POST",

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
        status:
          response.status,
        error:
          raw.slice(
            0,
            2000
          )
      };
    }

    const data =
      JSON.parse(raw);

    const output =
      data
        ?.choices?.[0]
        ?.message?.content
        ?.trim();

    if (!output) {
      return {
        success: false,
        status:
          response.status,
        error:
          "NVIDIA boş yanıt."
      };
    }

    const parsed =
      JSON.parse(
        extractNvidiaJSON(
          output
        )
      );

    return {
      success: true,
      status:
        response.status,

      errors:
        validateAI(
          parsed,
          text
        )
    };

  } catch (error) {
    return {
      success: false,

      error:
        error?.name ===
        "AbortError"
          ? "NVIDIA timeout."
          : String(
              error?.message ||
              error
            )
    };
  }
}

function dedupe(
  errors
) {
  const map =
    new Map();

  for (
    const e of errors
  ) {
    const key =
      `${e.original}|||${e.correction}`;

    if (
      !map.has(key)
    ) {
      map.set(
        key,
        e
      );
    }
  }

  return [
    ...map.values()
  ];
}

async function analyzeArticle(
  env,
  article
) {
  const language =
    detectLanguage(
      article.text
    );

  const deterministic =
    deterministicProofread(
      article.text,
      language
    );

  let aiErrors = [];

  let aiProvider =
    "code";

  let gemini = null;
  let nvidia = null;

  /*
   * Kod motoru açıkça bir hata bulduysa
   * bunu doğrudan raporla.
   *
   * AI'ı sadece karmaşık durumlarda
   * devreye sok.
   */

  if (
    deterministic.length === 0
  ) {

    gemini =
      await callGemini(
        env,
        article.text.slice(
          0,
          5000
        ),
        language
      );

    if (
      gemini.success
    ) {

      aiProvider =
        "gemini";

      aiErrors.push(
        ...(gemini.errors ||
          [])
      );

    } else {

      /*
       * Gemini 403 gibi erişim
       * problemi verirse NVIDIA
       * ikinci görüş olarak denenir.
       */

      nvidia =
        await callNvidia(
          env,
          article.text.slice(
            0,
            5000
          ),
          language
        );

      if (
        nvidia.success
      ) {

        aiProvider =
          "nvidia";

        aiErrors.push(
          ...(nvidia.errors ||
            [])
        );

      } else {

        aiProvider =
          "code-only";
      }
    }
  }

  const errors =
    dedupe([
      ...deterministic,
      ...aiErrors
    ]);

  return {
    url:
      article.url,

    title:
      article.title ||
      "Başlıksız haber",

    language,

    articleScore:
      article.score,

    datePublished:
      article.datePublished ||
      null,

    errors,

    ai: {
      provider:
        aiProvider,

      gemini:
        gemini
          ? {
              success:
                gemini.success,
              status:
                gemini.status ||
                null,
              error:
                gemini.error ||
                null
            }
          : null,

      nvidia:
        nvidia
          ? {
              success:
                nvidia.success,
              status:
                nvidia.status ||
                null,
              error:
                nvidia.error ||
                null
            }
          : null
    }
  };
}

async function crawl(
  startUrl
) {
  const origin =
    new URL(
      startUrl
    ).origin;

  const queue =
    [startUrl];

  const visited =
    new Set();

  const articles =
    [];

  while (
    queue.length &&
    visited.size <
      MAX_PAGES &&
    articles.length <
      MAX_ARTICLES
  ) {

    const current =
      queue.shift();

    if (
      visited.has(
        current
      )
    ) {
      continue;
    }

    visited.add(
      current
    );

    let response;

    try {
      response =
        await fetchTimeout(
          current
        );
    } catch {
      continue;
    }

    if (
      !response.ok
    ) {
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

    const article =
      extractArticle(
        raw,
        current
      );

    if (
      article.likelyArticle
    ) {

      articles.push({
        url:
          current,

        title:
          article.title,

        text:
          article.text,

        score:
          article.score,

        datePublished:
          article.datePublished
      });

      /*
       * Bu sayfanın içindeki linkleri
       * yine keşfet ama gereksiz yere
       * sonsuza gitme.
       */
    }

    const links = [
      ...raw.matchAll(
        /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi
      )
    ];

    for (
      const match of links
    ) {

      if (
        queue.length >=
        MAX_LINKS
      ) {
        break;
      }

      const next =
        safeURL(
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
        visited.has(
          next
        )
      ) {
        continue;
      }

      if (
        !isArticlePath(
          next
        )
      ) {
        continue;
      }

      queue.push(
        next
      );
    }
  }

  return {
    pages:
      visited.size,

    articles
  };
}

async function aiTest(
  env
) {
  const text =
    "Bu bir deneme metnidir. Herkez burada.";

  const result = {
    ok: true,

    deterministic:
      deterministicProofread(
        text,
        "tr"
      ),

    gemini: null,

    nvidia: null
  };

  if (
    env.GEMINI_API_KEY
  ) {

    const g =
      await callGemini(
        env,
        text,
        "tr"
      );

    result.gemini = {
      configured:
        true,

      success:
        g.success,

      status:
        g.status ||
        null,

      errors:
        g.errors ||
        [],

      error:
        g.error ||
        null
    };

  } else {

    result.gemini = {
      configured:
        false,

      success:
        false,

      error:
        "GEMINI_API_KEY yok."
    };
  }

  if (
    env.NVIDIA_API_KEY
  ) {

    const n =
      await callNvidia(
        env,
        text,
        "tr"
      );

    result.nvidia = {
      configured:
        true,

      success:
        n.success,

      status:
        n.status ||
        null,

      errors:
        n.errors ||
        [],

      error:
        n.error ||
        null
    };

  } else {

    result.nvidia = {
      configured:
        false,

      success:
        false,

      error:
        "NVIDIA_API_KEY yok."
    };
  }

  return result;
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
  margin:0;
  background:#f4f6f8;
  color:#171717;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

main {
  max-width:1050px;
  margin:auto;
  padding:30px 18px;
}

h1 {
  margin-bottom:5px;
}

.subtitle {
  color:#666;
  margin-bottom:25px;
}

.search {
  display:flex;
  gap:10px;
}

input {
  flex:1;
  padding:15px;
  border:1px solid #ccc;
  border-radius:10px;
  font-size:16px;
}

button {
  padding:15px 20px;
  border:0;
  border-radius:10px;
  cursor:pointer;
  font-weight:700;
}

.card {
  background:white;
  margin-top:16px;
  padding:18px;
  border-radius:12px;
  box-shadow:
    0 2px 10px
    rgba(0,0,0,.06);
}

.stats {
  display:flex;
  flex-wrap:wrap;
  gap:10px;
}

.stat {
  background:white;
  padding:15px;
  border-radius:10px;
  min-width:130px;
}

.error {
  margin-top:12px;
  padding:13px;
  border-left:5px solid #d00000;
  background:#fff7f7;
}

.ok {
  color:#087a35;
  font-weight:700;
}

.bad {
  color:#b00020;
  font-weight:700;
}

.source {
  margin-top:14px;
  padding-top:10px;
  border-top:1px solid #eee;
}

.source a {
  word-break:break-all;
}

.meta {
  color:#777;
  font-size:13px;
  margin-top:8px;
}

</style>

</head>

<body>

<main>

<h1>WebProof AI</h1>

<div class="subtitle">
Gerçek web taraması • haber tespiti •
kod tabanlı yazım kontrolü • AI doğrulaması
</div>

<div class="search">

<input
id="url"
placeholder="https://www.bbc.com"
/>

<button
onclick="scan()">
Siteyi Tara
</button>

</div>

<div
id="status">
</div>

<div
id="results">
</div>

</main>

<script>

async function scan() {

  const url =
    document
      .getElementById(
        "url"
      )
      .value
      .trim();

  if (!url) {
    alert(
      "Web sitesi adresi gir."
    );

    return;
  }

  document
    .getElementById(
      "status"
    )
    .innerHTML =
      "<div class='card'>" +
      "Gerçek web taraması başlatıldı..." +
      "</div>";

  document
    .getElementById(
      "results"
    )
    .innerHTML = "";

  try {

    const response =
      await fetch(
        "/api/scan?url=" +
        encodeURIComponent(
          url
        )
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
      .getElementById(
        "status"
      )
      .innerHTML =
        "<div class='card'>" +
        "<b>Tarama tamamlandı.</b>" +
        "</div>";

    let html =

      "<div class='stats'>" +

      "<div class='stat'>" +
      "<b>" +
      data.pages +
      "</b><br>" +
      "Taranan sayfa" +
      "</div>" +

      "<div class='stat'>" +
      "<b>" +
      data.articles.length +
      "</b><br>" +
      "Tespit edilen haber" +
      "</div>" +

      "<div class='stat'>" +
      "<b>" +
      data.totalErrors +
      "</b><br>" +
      "Doğrulanmış hata" +
      "</div>" +

      "</div>";

    for (
      const article
      of data.articles
    ) {

      html +=
        "<div class='card'>" +

        "<h2>" +
        escapeHTML(
          article.title
        ) +
        "</h2>";

      if (
        article.errors.length
      ) {

        html +=
          "<div class='bad'>" +
          "🔴 Bu haberde doğrulanmış hata bulundu" +
          "</div>";

        for (
          const error
          of article.errors
        ) {

          html +=
            "<div class='error'>" +

            "<b>" +
            escapeHTML(
              error.original
            ) +
            " → " +
            escapeHTML(
              error.correction
            ) +
            "</b>" +

            "<br>" +

            escapeHTML(
              error.reason ||
              ""
            ) +

            "<br>" +

            "<span class='meta'>" +
            "Tür: " +
            escapeHTML(
              error.type ||
              "unknown"
            ) +

            " • Güven: " +

            Math.round(
              Number(
                error.confidence ||
                0
              ) * 100
            ) +

            "%" +

            "</span>" +

            "</div>";
        }

      } else {

        html +=
          "<div class='ok'>" +
          "✓ Bu haberde doğrulanmış objektif hata bulunmadı." +
          "</div>";
      }

      html +=

        "<div class='source'>" +

        "<b>Kaynak haber:</b><br>" +

        "<a href='" +
        escapeHTML(
          article.url
        ) +
        "' target='_blank' rel='noopener'>" +

        escapeHTML(
          article.url
        ) +

        "</a>" +

        "</div>" +

        "<div class='meta'>" +

        "Dil: " +
        escapeHTML(
          article.language
        ) +

        " • AI: " +

        escapeHTML(
          article.ai?.provider ||
          "code"
        ) +

        "</div>" +

        "</div>";
    }

    document
      .getElementById(
        "results"
      )
      .innerHTML =
        html;

  } catch (
    error
  ) {

    document
      .getElementById(
        "status"
      )
      .innerHTML =
        "<div class='card bad'>" +
        "Tarama hatası: " +
        escapeHTML(
          error.message
        ) +
        "</div>";
  }
}

function escapeHTML(
  value
) {
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
      new URL(
        request.url
      );

    if (
      url.pathname ===
      "/api/status"
    ) {

      return json({

        ok: true,

        service:
          "WebProof AI",

        version:
          VERSION,

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
                : "code"
        },

        models: {

          gemini:
            GEMINI_MODEL,

          nvidia:
            NVIDIA_MODEL
        },

        architecture: {

          deterministic:
            true,

          aiFallback:
            true,

          exactSubstringValidation:
            true,

          sourceURLEvidence:
            true
        },

        limits: {

          maxPages:
            MAX_PAGES,

          maxArticles:
            MAX_ARTICLES
        },

        capabilities: [

          "real-web-crawling",

          "article-detection",

          "Turkish-proofreading",

          "English-proofreading",

          "deterministic-spelling-engine",

          "AI-contextual-verification",

          "Gemini",

          "NVIDIA",

          "exact-source-URL",

          "false-positive-filtering"

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
        safeURL(
          target
        );

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

        const crawlResult =
          await crawl(
            normalized
          );

        const results = [];

        for (
          const article
          of crawlResult.articles
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
            crawlResult.pages,

          articles:
            results,

          totalErrors

        });

      } catch (
        error
      ) {

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

/* ============================================================
   WEBPROOF AI
   PRODUCTION EDITORIAL PROOFREADING ENGINE
   ============================================================ */

const CONFIG = {
  MAX_DISCOVERY_PAGES: 20,
  MAX_ARTICLES: 10,
  MAX_LINKS: 300,

  MAX_HTML_BYTES: 1500000,
  MAX_ARTICLE_TEXT: 12000,

  AI_CHUNK_SIZE: 3500,
  AI_TIMEOUT: 18000,
  AI_CONCURRENCY: 2,

  MIN_AI_CONFIDENCE: 0.90,

  GEMINI_MODEL: "gemini-3.7-flash",

  NVIDIA_MODEL:
    "nvidia/nemotron-3.5-lightning-30b-a3b",

  NVIDIA_ENDPOINT:
    "https://integrate.api.nvidia.com/v1/chat/completions"
};


/* ============================================================
   ENTRY
   ============================================================ */

export default {
  async fetch(request, env) {

    const url =
      new URL(request.url);

    try {

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {
        return new Response(
          FRONTEND_HTML,
          {
            headers: {
              "content-type":
                "text/html; charset=UTF-8"
            }
          }
        );
      }


      if (
        request.method === "GET" &&
        url.pathname === "/api/status"
      ) {

        return json({
          ok: true,

          service:
            "WebProof AI",

          version:
            "production-editorial-2.0",

          ai: {
            gemini:
              !!env.GEMINI_API_KEY,

            nvidia:
              !!env.NVIDIA_API_KEY,

            primary:
              env.GEMINI_API_KEY
                ? "gemini"
                : env.NVIDIA_API_KEY
                  ? "nvidia"
                  : "none"
          },

          models: {
            gemini:
              CONFIG.GEMINI_MODEL,

            nvidia:
              CONFIG.NVIDIA_MODEL
          },

          capabilities: [
            "real-web-crawling",
            "real-article-detection",
            "Turkish-proofreading",
            "English-proofreading",
            "AI-contextual-proofreading",
            "strict-source-validation",
            "URL-level-evidence",
            "false-positive-protection"
          ]
        });
      }


      if (
        request.method === "GET" &&
        url.pathname === "/api/ai-test"
      ) {
        return await aiTest(env);
      }


      if (
        request.method === "POST" &&
        url.pathname === "/api/scan"
      ) {

        const body =
          await request.json();

        if (
          !body ||
          !body.url
        ) {
          return json(
            {
              ok: false,
              error:
                "URL gerekli."
            },
            400
          );
        }

        const result =
          await scanWebsite(
            body.url,
            env
          );

        return json(result);
      }


      return new Response(
        "Not Found",
        {
          status: 404
        }
      );

    } catch (error) {

      return json(
        {
          ok: false,

          error:
            error?.message ||
            String(error)
        },
        500
      );
    }
  }
};


/* ============================================================
   JSON
   ============================================================ */

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,

      headers: {
        "content-type":
          "application/json; charset=UTF-8",

        "cache-control":
          "no-store"
      }
    }
  );
}


/* ============================================================
   TIMEOUT FETCH
   ============================================================ */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = 8000
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
          controller.signal
      }
    );

  } finally {

    clearTimeout(timer);
  }
}


/* ============================================================
   NORMALIZE URL
   ============================================================ */

function normalizeUrl(
  input,
  base = null
) {

  try {

    const u =
      new URL(
        input,
        base || undefined
      );

    u.hash = "";

    const tracking = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "referrer"
    ];

    for (
      const key of tracking
    ) {
      u.searchParams.delete(
        key
      );
    }

    return u.href;

  } catch {

    return null;
  }
}


function sameOrigin(
  a,
  b
) {

  try {

    return (
      new URL(a).origin ===
      new URL(b).origin
    );

  } catch {

    return false;
  }
}


/* ============================================================
   HTML ENTITY DECODER
   ============================================================ */

function decodeHtmlEntities(
  text
) {

  return String(
    text || ""
  )
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
      /&apos;/gi,
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
      /&#x([0-9a-f]+);/gi,
      (_, h) => {

        try {

          return String.fromCodePoint(
            parseInt(
              h,
              16
            )
          );

        } catch {

          return _;
        }
      }
    )
    .replace(
      /&#([0-9]+);/g,
      (_, n) => {

        try {

          return String.fromCodePoint(
            parseInt(
              n,
              10
            )
          );

        } catch {

          return _;
        }
      }
    );
}


/* ============================================================
   HTML -> CLEAN TEXT
   ============================================================ */

function htmlToCleanText(
  html
) {

  let text =
    String(
      html || ""
    );


  /*
     Remove non-content blocks.
  */

  text =
    text.replace(
      /<(script|style|noscript|template|svg|canvas|iframe|video|audio|form|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );


  /*
     Block boundaries.
     IMPORTANT:
     We do NOT insert spaces around every HTML tag.
     This prevents:
       "s ,"
       "a ."
       ".B"
       ".g"
     type false positives.
  */

  text =
    text.replace(
      /<(br|hr|\/p|\/div|\/section|\/article|\/li|\/h[1-6]|\/blockquote|\/tr)[^>]*>/gi,
      "\n"
    );


  /*
     Remove remaining HTML.
  */

  text =
    text.replace(
      /<[^>]+>/g,
      ""
    );


  text =
    decodeHtmlEntities(
      text
    );


  /*
     Invisible characters.
  */

  text =
    text
      .replace(
        /\u00a0/g,
        " "
      )
      .replace(
        /\u200b/g,
        ""
      )
      .replace(
        /\u200c/g,
        ""
      )
      .replace(
        /\u200d/g,
        ""
      )
      .replace(
        /\ufeff/g,
        ""
      );


  /*
     Whitespace normalization.
  */

  text =
    text
      .replace(
        /[ \t]+/g,
        " "
      )
      .replace(
        /[ \t]+\n/g,
        "\n"
      )
      .replace(
        /\n[ \t]+/g,
        "\n"
      )
      .replace(
        /\n{3,}/g,
        "\n\n"
      )
      .trim();


  return text;
}


/* ============================================================
   TITLE
   ============================================================ */

function getTitle(
  html
) {

  const title =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )?.[1] || "";

  return htmlToCleanText(
    title
  );
}


/* ============================================================
   META
   ============================================================ */

function getMeta(
  html,
  name
) {

  const escaped =
    String(name)
      .replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

  const a =
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
      "i"
    );

  const b =
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["']`,
      "i"
    );

  return (
    html.match(a)?.[1] ||
    html.match(b)?.[1] ||
    ""
  );
}


/* ============================================================
   LANGUAGE
   ============================================================ */

function detectLanguage(
  html,
  text
) {

  const lang =
    html.match(
      /<html[^>]+lang=["']([^"']+)["']/i
    )?.[1];

  if (lang) {

    const l =
      lang.toLowerCase();

    if (
      l.startsWith("tr")
    ) {
      return "tr";
    }

    if (
      l.startsWith("en")
    ) {
      return "en";
    }
  }


  const sample =
    text
      .toLowerCase()
      .slice(
        0,
        7000
      );


  const trWords = [
    " ve ",
    " bir ",
    " için ",
    " olan ",
    " olarak ",
    " tarafından ",
    " haber ",
    " açıklama ",
    " bugün ",
    " söyledi ",
    " dedi ",
    " ancak ",
    " daha "
  ];


  const enWords = [
    " the ",
    " and ",
    " of ",
    " to ",
    " in ",
    " for ",
    " said ",
    " with ",
    " from ",
    " news ",
    " that ",
    " this "
  ];


  const trScore =
    trWords.filter(
      x =>
        sample.includes(x)
    ).length;


  const enScore =
    enWords.filter(
      x =>
        sample.includes(x)
    ).length;


  return (
    trScore >= enScore
      ? "tr"
      : "en"
  );
}


/* ============================================================
   ARTICLE URL FILTER
   ============================================================ */

function pathLooksLikeArticle(
  url
) {

  try {

    const u =
      new URL(url);

    const path =
      u.pathname
        .toLowerCase()
        .replace(
          /\/+/g,
          "/"
        );


    if (
      path === "/" ||
      path === "/turkce/" ||
      path === "/tr/" ||
      path === "/en/" ||
      path === "/news/" ||
      path === "/haber/"
    ) {
      return false;
    }


    const bad =
      [
        /\/category\//,
        /\/kategori\//,
        /\/tag\//,
        /\/etiket\//,
        /\/author\//,
        /\/yazar\//,
        /\/search/,
        /\/arama/,
        /\/video\/?$/,
        /\/galeri\/?$/,
        /\/fotogaleri/,
        /\/podcast/,
        /\/live\/?$/
      ];


    return !bad.some(
      re =>
        re.test(path)
    );

  } catch {

    return false;
  }
}


/* ============================================================
   ARTICLE SIGNALS
   ============================================================ */

function getArticleSignals(
  html,
  url
) {

  return {

    articleTag:
      /<article\b/i.test(
        html
      ),

    jsonLdArticle:
      /"@type"\s*:\s*"(?:NewsArticle|Article|ReportageNewsArticle)"/i.test(
        html
      ),

    datePublished:
      /datePublished/i.test(
        html
      ),

    ogArticle:
      /article:published_time/i.test(
        html
      ),

    headline:
      /"headline"\s*:/i.test(
        html
      ),

    author:
      /"author"\s*:/i.test(
        html
      ),

    articleSection:
      /"articleSection"\s*:/i.test(
        html
      ),

    path:
      pathLooksLikeArticle(
        url
      )
  };
}


/* ============================================================
   ARTICLE SCORE
   ============================================================ */

function scoreArticle(
  html,
  text,
  url
) {

  const s =
    getArticleSignals(
      html,
      url
    );

  let score = 0;

  if (
    s.articleTag
  ) score += 30;

  if (
    s.jsonLdArticle
  ) score += 35;

  if (
    s.datePublished
  ) score += 15;

  if (
    s.ogArticle
  ) score += 10;

  if (
    s.headline
  ) score += 10;

  if (
    s.author
  ) score += 5;

  if (
    s.articleSection
  ) score += 5;

  if (
    s.path
  ) score += 10;


  if (
    text.length >= 1200
  ) score += 15;

  if (
    text.length >= 2500
  ) score += 10;


  return {
    score,
    signals: s
  };
}


/* ============================================================
   ARTICLE DETECTION
   ============================================================ */

function isLikelyArticle(
  html,
  text,
  url
) {

  if (
    !pathLooksLikeArticle(
      url
    )
  ) {
    return false;
  }


  if (
    text.length < 900
  ) {
    return false;
  }


  const result =
    scoreArticle(
      html,
      text,
      url
    );


  const strongSignal =
    result.signals.jsonLdArticle ||
    result.signals.articleTag ||
    result.signals.datePublished ||
    result.signals.ogArticle;


  if (
    !strongSignal
  ) {
    return false;
  }


  return (
    result.score >= 55
  );
}


/* ============================================================
   MAIN ARTICLE TEXT
   ============================================================ */

function extractMainText(
  html
) {

  const candidates = [];


  const articles =
    html.match(
      /<article\b[^>]*>[\s\S]*?<\/article>/gi
    ) || [];


  for (
    const block of articles
  ) {

    const text =
      htmlToCleanText(
        block
      );

    if (
      text.length >= 500
    ) {
      candidates.push(
        text
      );
    }
  }


  const mains =
    html.match(
      /<main\b[^>]*>[\s\S]*?<\/main>/gi
    ) || [];


  for (
    const block of mains
  ) {

    const text =
      htmlToCleanText(
        block
      );

    if (
      text.length >= 500
    ) {
      candidates.push(
        text
      );
    }
  }


  /*
     Paragraph based fallback.
  */

  const paragraphs = [];

  const pRe =
    /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

  let match;

  while (
    (match = pRe.exec(html))
  ) {

    const p =
      htmlToCleanText(
        match[1]
      );

    if (
      p.length >= 50
    ) {
      paragraphs.push(
        p
      );
    }
  }


  if (
    paragraphs.length
  ) {

    candidates.push(
      paragraphs.join(
        "\n"
      )
    );
  }


  if (
    !candidates.length
  ) {

    candidates.push(
      htmlToCleanText(
        html
      )
    );
  }


  candidates.sort(
    (a, b) =>
      b.length -
      a.length
  );


  let text =
    candidates[0] || "";


  const noise =
    [
      /^menu$/i,
      /^search$/i,
      /^giriş yap$/i,
      /^abonelik$/i,
      /^paylaş$/i,
      /^reklam$/i,
      /^cookie/i,
      /^privacy/i,
      /^terms/i
    ];


  text =
    text
      .split(/\n+/)
      .map(
        x =>
          x.trim()
      )
      .filter(
        x =>
          x &&
          !noise.some(
            re =>
              re.test(x)
          )
      )
      .join("\n");


  return text.slice(
    0,
    CONFIG.MAX_ARTICLE_TEXT
  );
}


/* ============================================================
   LINKS
   ============================================================ */

function extractLinks(
  html,
  baseUrl
) {

  const links = [];

  const re =
    /<a\b[^>]+href=["']([^"']+)["']/gi;

  let match;

  while (
    (match = re.exec(html))
  ) {

    const url =
      normalizeUrl(
        match[1],
        baseUrl
      );

    if (!url) continue;

    if (
      sameOrigin(
        url,
        baseUrl
      )
    ) {
      links.push(url);
    }
  }


  return [
    ...new Set(
      links
    )
  ];
}


/* ============================================================
   ROBOTS
   ============================================================ */

async function canCrawl(
  url
) {

  try {

    const u =
      new URL(url);

    const robotsUrl =
      `${u.origin}/robots.txt`;


    const response =
      await fetchWithTimeout(
        robotsUrl,
        {
          headers: {
            "user-agent":
              "WebProofAI/2.0"
          }
        },
        5000
      );


    if (
      !response.ok
    ) {
      return true;
    }


    const robots =
      await response.text();


    const lines =
      robots
        .split(/\r?\n/)
        .map(
          x =>
            x.trim()
        );


    let applies =
      false;


    for (
      const line of lines
    ) {

      const lower =
        line.toLowerCase();


      if (
        lower.startsWith(
          "user-agent:"
        )
      ) {

        const agent =
          lower
            .split(":")
            .slice(1)
            .join(":")
            .trim();


        applies =
          agent === "*" ||
          agent.includes(
            "webproof"
          );
      }


      if (
        applies &&
        lower.startsWith(
          "disallow:"
        )
      ) {

        const path =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();


        if (
          path &&
          u.pathname.startsWith(
            path
          )
        ) {
          return false;
        }
      }
    }


    return true;

  } catch {

    return true;
  }
}


/* ============================================================
   CRAWLER
   ============================================================ */

async function crawlWebsite(
  startUrl
) {

  const queue = [
    normalizeUrl(
      startUrl
    )
  ];

  const visited =
    new Set();

  const pages = [];

  const origin =
    new URL(
      startUrl
    ).origin;


  while (
    queue.length &&
    pages.length <
      CONFIG.MAX_DISCOVERY_PAGES
  ) {

    const current =
      queue.shift();


    if (!current) continue;

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


    if (
      !sameOrigin(
        current,
        origin
      )
    ) {
      continue;
    }


    if (
      !(await canCrawl(
        current
      ))
    ) {
      continue;
    }


    try {

      const response =
        await fetchWithTimeout(
          current,
          {
            headers: {
              "user-agent":
                "WebProofAI/2.0",
              "accept":
                "text/html,application/xhtml+xml"
            },
            redirect:
              "follow"
          },
          7000
        );


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


      const buffer =
        await response.arrayBuffer();


      if (
        buffer.byteLength >
        CONFIG.MAX_HTML_BYTES
      ) {
        continue;
      }


      const html =
        new TextDecoder(
          "utf-8",
          {
            fatal: false
          }
        ).decode(
          buffer
        );


      const title =
        getTitle(
          html
        );


      const text =
        extractMainText(
          html
        );


      const language =
        detectLanguage(
          html,
          text
        );


      const score =
        scoreArticle(
          html,
          text,
          current
        );


      const isArticle =
        isLikelyArticle(
          html,
          text,
          current
        );


      pages.push({

        url:
          current,

        title:
          title,

        language:
          language,

        text:
          text,

        isArticle:
          isArticle,

        articleScore:
          score.score,

        signals:
          score.signals,

        status:
          response.status
      });


      const links =
        extractLinks(
          html,
          current
        );


      for (
        const link of links
      ) {

        if (
          !visited.has(
            link
          ) &&
          queue.length <
            CONFIG.MAX_LINKS
        ) {

          queue.push(
            link
          );
        }
      }


    } catch {

      /*
         One broken page must never
         stop the entire crawl.
      */

    }
  }


  return {
    pages,
    visitedCount:
      visited.size
  };
}


/* ============================================================
   NORMALIZE PROOFREADING TEXT
   ============================================================ */

function normalizeProofreadingText(
  text
) {

  return String(
    text || ""
  )
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /\r/g,
      "\n"
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
}


/* ============================================================
   CHUNKING
   ============================================================ */

function splitIntoChunks(
  text,
  maxChars
) {

  const normalized =
    normalizeProofreadingText(
      text
    );


  if (
    normalized.length <=
    maxChars
  ) {
    return [
      normalized
    ];
  }


  const sentences =
    normalized.split(
      /(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜÂÎÛ0-9"“‘])/u
    );


  const chunks = [];

  let current = "";


  for (
    const sentence of sentences
  ) {

    if (
      current &&
      current.length +
        sentence.length +
        1 >
        maxChars
    ) {

      chunks.push(
        current.trim()
      );

      current = "";
    }


    current +=
      (
        current
          ? " "
          : ""
      ) +
      sentence;
  }


  if (
    current.trim()
  ) {

    chunks.push(
      current.trim()
    );
  }


  /*
     Safe fallback.
  */

  if (
    !chunks.length
  ) {

    for (
      let i = 0;
      i < normalized.length;
      i += maxChars
    ) {

      chunks.push(
        normalized.slice(
          i,
          i + maxChars
        )
      );
    }
  }


  return chunks;
}


/* ============================================================
   AI JSON SCHEMA
   ============================================================ */

const PROOFREAD_SCHEMA = {

  type:
    "object",

  properties: {

    errors: {

      type:
        "array",

      maxItems:
        8,

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
              "string",

            enum: [
              "yazım",
              "dilbilgisi",
              "noktalama",
              "spelling",
              "grammar",
              "punctuation"
            ]
          },

          confidence: {

            type:
              "number",

            minimum:
              0,

            maximum:
              1
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
};


/* ============================================================
   AI PROMPT
   ============================================================ */

function buildProofreadPrompt(
  language,
  title,
  chunk
) {

  const lang =
    language === "tr"
      ? "TÜRKÇE"
      : "ENGLISH";


  return `
You are WebProof AI, a professional newsroom proofreading system.

Your task is NOT rewriting.

Your task is to find ONLY objectively verifiable language errors.

LANGUAGE:
${lang}

ARTICLE TITLE:
${title || "(untitled)"}

TEXT:
<<<TEXT>>>
${chunk}
<<<END TEXT>>>

STRICT RULES:

1. Report only objectively verifiable errors.
2. If uncertain, report nothing.
3. Do not report style preferences.
4. Do not rewrite sentences for elegance.
5. Do not change journalistic tone.
6. Do not change political terminology merely because another term sounds better.
7. Do not alter names of people, places, institutions, organizations, brands or products unless clearly misspelled.
8. Do not alter URLs, emails, usernames, hashtags, numbers or dates.
9. Do not invent missing words.
10. Do not infer facts not contained in the text.
11. Do not flag valid alternative expressions.
12. "original" MUST be copied exactly from the supplied text.
13. "correction" must contain ONLY the smallest necessary correction.
14. Do not report formatting or HTML extraction artifacts.
15. Do not report spaces caused by HTML extraction.
16. Do not report errors caused by line wrapping.
17. For Turkish, follow contemporary standard Turkish spelling and grammar.
18. For English, follow standard professional written English.
19. Confidence must be at least 0.90.
20. If there are no objectively verifiable errors, return an empty errors array.
21. Return ONLY JSON.

Example of a valid finding:

{
  "errors": [
    {
      "original": "yanlız",
      "correction": "yalnız",
      "type": "yazım",
      "confidence": 0.99,
      "reason": "Kelimenin standart Türkçe yazımı 'yalnız'dır."
    }
  ]
}

If no certain error exists:

{
  "errors": []
}
`;
}


/* ============================================================
   PARSE AI JSON
   ============================================================ */

function parseAIJson(
  text
) {

  let cleaned =
    String(
      text || ""
    )
      .trim()
      .replace(
        /^```json/i,
        ""
      )
      .replace(
        /^```/,
        ""
      )
      .replace(
        /```$/,
        ""
      )
      .trim();


  try {

    return JSON.parse(
      cleaned
    );

  } catch {}


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

    try {

      return JSON.parse(
        cleaned.slice(
          start,
          end + 1
        )
      );

    } catch {}
  }


  throw new Error(
    "AI geçerli JSON döndürmedi."
  );
}


/* ============================================================
   VALIDATE AI FINDINGS
   ============================================================ */

function validateAIResults(
  result,
  chunk
) {

  if (
    !result ||
    !Array.isArray(
      result.errors
    )
  ) {
    return [];
  }


  const accepted = [];


  for (
    const item of result.errors
  ) {

    if (!item) continue;


    const original =
      String(
        item.original || ""
      ).trim();


    const correction =
      String(
        item.correction || ""
      ).trim();


    const reason =
      String(
        item.reason || ""
      ).trim();


    const confidence =
      Number(
        item.confidence
      );


    if (!original) continue;

    if (!correction) continue;

    if (
      !Number.isFinite(
        confidence
      )
    ) {
      continue;
    }


    if (
      confidence <
      CONFIG.MIN_AI_CONFIDENCE
    ) {
      continue;
    }


    /*
       HARD ANTI-HALLUCINATION CHECK.
    */

    if (
      !chunk.includes(
        original
      )
    ) {
      continue;
    }


    if (
      original ===
      correction
    ) {
      continue;
    }


    /*
       Reject suspiciously large rewrites.
    */

    if (
      correction.length >
        original.length * 4 &&
      correction.length > 80
    ) {
      continue;
    }


    /*
       Reject HTML/extraction artifacts.
    */

    if (
      /(^|\s)[,.!?;:](\s|$)/u.test(
        original
      )
    ) {
      continue;
    }


    if (
      original.length <= 2 &&
      /[,.!?;:]/.test(
        original
      )
    ) {
      continue;
    }


    accepted.push({

      original,

      correction,

      type:
        item.type ||
        "yazım",

      confidence:
        Math.max(
          0,
          Math.min(
            1,
            confidence
          )
        ),

      reason:
        reason ||
        "Objektif dil hatası.",

      source:
        "ai"
    });
  }


  return accepted;
}


/* ============================================================
   CONSERVATIVE RULE ENGINE
   ============================================================ */

function ruleBasedProofread(
  text,
  language
) {

  const errors = [];


  /*
     ONLY extremely high-confidence lexical errors.
     No generic punctuation regex.
  */

  const rules =
    language === "tr"

      ? [

          ["yanlız", "yalnız"],
          ["yalnış", "yanlış"],
          ["yanlızca", "yalnızca"],
          ["herkez", "herkes"],
          ["birşey", "bir şey"],
          ["hiç bir", "hiçbir"],
          ["her hangi", "herhangi"],
          ["malesef", "maalesef"],
          ["orjinal", "orijinal"],
          ["süpriz", "sürpriz"],
          ["labaratuvar", "laboratuvar"],
          ["şarz", "şarj"],
          ["traş", "tıraş"]

        ]

      : [

          ["recieve", "receive"],
          ["seperate", "separate"],
          ["definately", "definitely"],
          ["occured", "occurred"],
          ["accomodate", "accommodate"],
          ["wierd", "weird"],
          ["untill", "until"],
          ["wich", "which"],
          ["teh", "the"]
        ];


  for (
    const [
      wrong,
      right
    ] of rules
  ) {

    const re =
      new RegExp(
        `\\b${escapeRegex(
          wrong
        )}\\b`,
        "giu"
      );


    let match;


    while (
      (match =
        re.exec(text))
    ) {

      errors.push({

        original:
          match[0],

        correction:
          right,

        type:
          language === "tr"
            ? "yazım"
            : "spelling",

        confidence:
          0.995,

        reason:
          language === "tr"
            ? "Standart Türkçe yazımına göre doğrulanabilir kelime hatası."
            : "Standard English spelling error.",

        source:
          "rule"
      });
    }
  }


  return errors;
}


function escapeRegex(
  value
) {

  return String(
    value
  ).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


/* ============================================================
   GEMINI
   ============================================================ */

async function callGemini(
  env,
  language,
  title,
  chunk
) {

  if (
    !env.GEMINI_API_KEY
  ) {
    throw new Error(
      "GEMINI_API_KEY tanımlı değil."
    );
  }


  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(
      CONFIG.GEMINI_MODEL
    ) +
    ":generateContent";


  const response =
    await fetchWithTimeout(
      endpoint,
      {

        method:
          "POST",

        headers: {

          "content-type":
            "application/json",

          "x-goog-api-key":
            env.GEMINI_API_KEY
        },

        body:
          JSON.stringify({

            contents: [

              {

                role:
                  "user",

                parts: [

                  {

                    text:
                      buildProofreadPrompt(
                        language,
                        title,
                        chunk
                      )
                  }
                ]
              }
            ],

            generationConfig: {

              temperature:
                0,

              maxOutputTokens:
                1200,

              responseMimeType:
                "application/json",

              responseSchema:
                PROOFREAD_SCHEMA
            }
          })
      },

      CONFIG.AI_TIMEOUT
    );


  const raw =
    await response.text();


  if (
    !response.ok
  ) {

    throw new Error(
      `Gemini HTTP ${response.status}: ${raw.slice(
        0,
        1000
      )}`
    );
  }


  let data;


  try {

    data =
      JSON.parse(
        raw
      );

  } catch {

    throw new Error(
      "Gemini JSON parse hatası."
    );
  }


  const text =
    data
      ?.candidates?.[0]
      ?.content?.parts
      ?.map(
        x =>
          x.text || ""
      )
      .join("") ||
    "";


  if (!text) {

    throw new Error(
      "Gemini boş cevap döndürdü."
    );
  }


  return parseAIJson(
    text
  );
}


/* ============================================================
   NVIDIA
   ============================================================ */

async function callNvidia(
  env,
  language,
  title,
  chunk
) {

  if (
    !env.NVIDIA_API_KEY
  ) {

    throw new Error(
      "NVIDIA_API_KEY tanımlı değil."
    );
  }


  const response =
    await fetchWithTimeout(
      CONFIG.NVIDIA_ENDPOINT,
      {

        method:
          "POST",

        headers: {

          "content-type":
            "application/json",

          "authorization":
            `Bearer ${env.NVIDIA_API_KEY}`
        },

        body:
          JSON.stringify({

            model:
              CONFIG.NVIDIA_MODEL,

            messages: [

              {

                role:
                  "system",

                content:
                  "You are WebProof AI, a strict professional editorial proofreading engine. Return only valid JSON."
              },

              {

                role:
                  "user",

                content:
                  buildProofreadPrompt(
                    language,
                    title,
                    chunk
                  )
              }
            ],

            temperature:
              0,

            top_p:
              0.9,

            max_tokens:
              1200,

            stream:
              false

          })
      },

      CONFIG.AI_TIMEOUT
    );


  const raw =
    await response.text();


  if (
    !response.ok
  ) {

    throw new Error(
      `NVIDIA HTTP ${response.status}: ${raw.slice(
        0,
        1200
      )}`
    );
  }


  let data;


  try {

    data =
      JSON.parse(
        raw
      );

  } catch {

    throw new Error(
      "NVIDIA JSON parse hatası."
    );
  }


  const content =
    data
      ?.choices?.[0]
      ?.message
      ?.content;


  if (!content) {

    throw new Error(
      "NVIDIA boş cevap döndürdü."
    );
  }


  return parseAIJson(
    content
  );
}


/* ============================================================
   NVIDIA CONNECTION TEST
   ============================================================ */

async function testNvidia(
  env
) {

  if (
    !env.NVIDIA_API_KEY
  ) {

    return {

      success:
        false,

      error:
        "NVIDIA_API_KEY yok."
    };
  }


  try {

    const response =
      await fetchWithTimeout(
        CONFIG.NVIDIA_ENDPOINT,
        {

          method:
            "POST",

          headers: {

            "content-type":
              "application/json",

            "authorization":
              `Bearer ${env.NVIDIA_API_KEY}`
          },

          body:
            JSON.stringify({

              model:
                CONFIG.NVIDIA_MODEL,

              messages: [

                {

                  role:
                    "user",

                  content:
                    'Return exactly this JSON: {"ok":true}'
                }
              ],

              temperature:
                0,

              top_p:
                0.9,

              max_tokens:
                50,

              stream:
                false

            })
        },

        10000
      );


    const raw =
      await response.text();


    return {

      success:
        response.ok,

      status:
        response.status,

      response:
        raw.slice(
          0,
          1000
        )

    };


  } catch (error) {

    return {

      success:
        false,

      error:
        error?.message ||
        String(error)
    };
  }
}


/* ============================================================
   AI TEST
   ============================================================ */

async function aiTest(
  env
) {

  const result = {

    ok:
      true,

    gemini:
      null,

    nvidia:
      null
  };


  /*
     GEMINI
  */

  if (
    env.GEMINI_API_KEY
  ) {

    try {

      const endpoint =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(
          CONFIG.GEMINI_MODEL
        ) +
        ":generateContent";


      const response =
        await fetchWithTimeout(
          endpoint,
          {

            method:
              "POST",

            headers: {

              "content-type":
                "application/json",

              "x-goog-api-key":
                env.GEMINI_API_KEY
            },

            body:
              JSON.stringify({

                contents: [

                  {

                    role:
                      "user",

                    parts: [

                      {

                        text:
                          'Return exactly this JSON: {"ok":true}'
                      }
                    ]
                  }
                ],

                generationConfig: {

                  temperature:
                    0,

                  maxOutputTokens:
                    50,

                  responseMimeType:
                    "application/json"
                }

              })
          },

          10000
        );


      const raw =
        await response.text();


      result.gemini = {

        success:
          response.ok,

        status:
          response.status,

        response:
          raw.slice(
            0,
            1000
          )
      };


    } catch (error) {

      result.gemini = {

        success:
          false,

        error:
          error?.message ||
          String(error)
      };
    }


  } else {

    result.gemini = {

      success:
        false,

      error:
        "GEMINI_API_KEY yok."
    };
  }


  /*
     NVIDIA
  */

  result.nvidia =
    await testNvidia(
      env
    );


  return json(
    result
  );
}


/* ============================================================
   AI ARTICLE ANALYSIS
   ============================================================ */

async function analyzeArticle(
  article,
  env
) {

  const text =
    normalizeProofreadingText(
      article.text
    );


  const chunks =
    splitIntoChunks(
      text,
      CONFIG.AI_CHUNK_SIZE
    );


  const allAI =
    [];


  let geminiSuccess =
    false;

  let nvidiaSuccess =
    false;


  let geminiError =
    null;

  let nvidiaError =
    null;


  for (
    const chunk of chunks
  ) {

    let aiResult =
      null;


    /*
       Gemini primary.
    */

    if (
      env.GEMINI_API_KEY
    ) {

      try {

        aiResult =
          await callGemini(
            env,
            article.language,
            article.title,
            chunk
          );


        allAI.push(
          ...validateAIResults(
            aiResult,
            chunk
          )
        );


        geminiSuccess =
          true;


      } catch (error) {

        geminiError =
          error?.message ||
          String(error);
      }
    }


    /*
       NVIDIA fallback.
    */

    if (
      !aiResult &&
      env.NVIDIA_API_KEY
    ) {

      try {

        aiResult =
          await callNvidia(
            env,
            article.language,
            article.title,
            chunk
          );


        allAI.push(
          ...validateAIResults(
            aiResult,
            chunk
          )
        );


        nvidiaSuccess =
          true;


      } catch (error) {

        nvidiaError =
          error?.message ||
          String(error);
      }
    }
  }


  /*
     Conservative deterministic layer.
  */

  const ruleErrors =
    ruleBasedProofread(
      text,
      article.language
    );


  const merged =
    deduplicateErrors(
      [
        ...ruleErrors,
        ...allAI
      ]
    );


  /*
     Final source validation.
  */

  const finalErrors =
    merged.filter(
      error =>
        text.includes(
          error.original
        )
    );


  return {

    ...article,

    errors:
      finalErrors.map(
        error => ({

          ...error,

          pageUrl:
            article.url,

          pageTitle:
            article.title
        })
      ),

    ai: {

      chunks:
        chunks.length,

      gemini:
        geminiSuccess
          ? "success"
          : env.GEMINI_API_KEY
            ? "failed"
            : "not-configured",

      nvidia:
        nvidiaSuccess
          ? "success"
          : env.NVIDIA_API_KEY
            ? "failed"
            : "not-configured",

      geminiError,

      nvidiaError
    }
  };
}


/* ============================================================
   DEDUPLICATION
   ============================================================ */

function deduplicateErrors(
  errors
) {

  const map =
    new Map();


  for (
    const error of errors
  ) {

    const key =
      `${error.original}=>${error.correction}`;


    const previous =
      map.get(
        key
      );


    if (
      !previous ||
      error.confidence >
        previous.confidence
    ) {

      map.set(
        key,
        error
      );
    }
  }


  return [
    ...map.values()
  ];
}


/* ============================================================
   CONCURRENCY
   ============================================================ */

async function mapWithConcurrency(
  items,
  concurrency,
  worker
) {

  const results =
    new Array(
      items.length
    );


  let index =
    0;


  async function runner() {

    while (true) {

      const current =
        index++;


      if (
        current >=
        items.length
      ) {
        return;
      }


      try {

        results[current] =
          await worker(
            items[current],
            current
          );

      } catch (error) {

        results[current] = {

          ok:
            false,

          error:
            error?.message ||
            String(error)
        };
      }
    }
  }


  const runners =
    Array.from(
      {
        length:
          Math.min(
            concurrency,
            items.length
          )
      },
      runner
    );


  await Promise.all(
    runners
  );


  return results;
}


/* ============================================================
   MAIN SCAN
   ============================================================ */

async function scanWebsite(
  inputUrl,
  env
) {

  const startUrl =
    normalizeUrl(
      inputUrl
    );


  if (!startUrl) {

    throw new Error(
      "Geçerli bir URL girin."
    );
  }


  const crawl =
    await crawlWebsite(
      startUrl
    );


  const articlePages =
    crawl.pages
      .filter(
        page =>
          page.isArticle
      )
      .sort(
        (a, b) =>
          b.articleScore -
          a.articleScore
      )
      .slice(
        0,
        CONFIG.MAX_ARTICLES
      );


  const analyzed =
    await mapWithConcurrency(
      articlePages,
      CONFIG.AI_CONCURRENCY,

      async article => {

        return await analyzeArticle(
          article,
          env
        );
      }
    );


  const articles =
    analyzed.filter(
      article =>
        article &&
        article.errors
    );


  const allErrors =
    articles.flatMap(
      article =>
        article.errors
    );


  const aiStats = {

    articles:
      articles.length,

    geminiSuccess:
      articles.filter(
        article =>
          article.ai?.gemini ===
          "success"
      ).length,

    nvidiaSuccess:
      articles.filter(
        article =>
          article.ai?.nvidia ===
          "success"
      ).length,

    failures:
      articles.filter(
        article =>
          article.ai?.gemini ===
            "failed" &&
          article.ai?.nvidia !==
            "success"
      ).length
  };


  return {

    ok:
      true,

    scannedUrl:
      startUrl,

    scannedPages:
      crawl.pages.length,

    discoveredLinks:
      crawl.visitedCount,

    articlesFound:
      articles.length,

    totalErrors:
      allErrors.length,

    ai:
      aiStats,

    articles:
      articles.map(
        article => ({

          url:
            article.url,

          title:
            article.title,

          language:
            article.language,

          status:
            article.status,

          articleScore:
            article.articleScore,

          errors:
            article.errors,

          ai:
            article.ai
        })
      ),

    generatedAt:
      new Date().toISOString()
  };
}


/* ============================================================
   FRONTEND
   ============================================================ */

const FRONTEND_HTML = `<!DOCTYPE html>

<html lang="tr">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
/>

<title>
WebProof AI
</title>


<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  background:
    #0b1020;

  color:
    #f5f7fb;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.container {

  width:
    min(1100px, calc(100% - 28px));

  margin:
    auto;

  padding:
    38px 0 80px;
}

h1 {

  margin:
    0 0 8px;

  font-size:
    clamp(32px, 7vw, 56px);

  letter-spacing:
    -1.5px;
}

.subtitle {

  color:
    #aeb8ce;

  line-height:
    1.6;
}

.panel {

  background:
    #121a2e;

  border:
    1px solid #26324d;

  border-radius:
    18px;

  padding:
    20px;

  margin-top:
    22px;
}

.input-row {

  display:
    flex;

  gap:
    10px;
}

input {

  flex:
    1;

  min-width:
    0;

  padding:
    15px;

  border-radius:
    11px;

  border:
    1px solid #33415f;

  background:
    #080d19;

  color:
    white;

  font-size:
    15px;
}

button {

  border:
    0;

  border-radius:
    11px;

  padding:
    0 22px;

  background:
    #4f7cff;

  color:
    white;

  font-weight:
    800;

  cursor:
    pointer;
}

button:disabled {

  opacity:
    .5;

  cursor:
    wait;
}

.status {

  margin-top:
    14px;

  color:
    #aeb8ce;

  line-height:
    1.6;
}

.stats {

  display:
    grid;

  grid-template-columns:
    repeat(4, 1fr);

  gap:
    10px;

  margin:
    20px 0;
}

.stat {

  background:
    #121a2e;

  border:
    1px solid #26324d;

  border-radius:
    14px;

  padding:
    16px;
}

.stat-number {

  font-size:
    28px;

  font-weight:
    800;
}

.stat-label {

  margin-top:
    5px;

  color:
    #8995ad;

  font-size:
    12px;
}

.article {

  background:
    #121a2e;

  border:
    1px solid #26324d;

  border-radius:
    16px;

  margin-bottom:
    15px;

  overflow:
    hidden;
}

.article-head {

  padding:
    18px;

  border-bottom:
    1px solid #26324d;
}

.article-title {

  font-size:
    18px;

  font-weight:
    800;
}

.article-url {

  margin-top:
    8px;

  color:
    #7da0ff;

  font-size:
    12px;

  word-break:
    break-all;
}

.badge {

  display:
    inline-block;

  margin-top:
    9px;

  padding:
    5px 9px;

  border-radius:
    999px;

  background:
    #1e2942;

  color:
    #b9c7e4;

  font-size:
    11px;
}

.error {

  padding:
    17px 18px;

  border-bottom:
    1px solid #26324d;
}

.error-title {

  color:
    #ff7373;

  font-weight:
    850;

  margin-bottom:
    10px;
}

.diff {

  font-size:
    17px;

  margin-bottom:
    9px;
}

.wrong {

  text-decoration:
    line-through;

  opacity:
    .75;
}

.correct {

  font-weight:
    850;
}

.reason {

  color:
    #9aa8c1;

  font-size:
    13px;

  line-height:
    1.5;
}

.confidence {

  color:
    #7dd3a8;

  font-size:
    12px;

  margin-top:
    8px;
}

.source {

  margin-top:
    10px;

  padding:
    11px;

  border-radius:
    9px;

  background:
    #080d19;

  font-size:
    12px;

  word-break:
    break-all;
}

.source a {

  color:
    #7da0ff;
}

.success {

  padding:
    20px;

  color:
    #7dd3a8;
}

.failure {

  color:
    #ff8e8e;
}


@media(max-width:700px) {

  .input-row {

    flex-direction:
      column;
  }

  button {

    height:
      48px;
  }

  .stats {

    grid-template-columns:
      repeat(2, 1fr);
  }
}

</style>

</head>


<body>

<div class="container">


<h1>
WebProof AI
</h1>


<div class="subtitle">

Gerçek web taraması · gerçek haber çıkarımı ·
AI destekli Türkçe ve İngilizce editoryal doğrulama

</div>


<div class="panel">

<div class="input-row">

<input
  id="url"
  type="url"
  placeholder="https://www.ornek-site.com"
/>

<button
  id="scan"
  onclick="scanSite()"
>
Siteyi Tara
</button>

</div>


<div
  id="status"
  class="status"
>
Sistem hazır.
</div>

</div>


<div
  id="stats"
  class="stats"
  style="display:none"
></div>


<div
  id="results"
></div>


</div>


<script>

async function scanSite() {

  const url =
    document
      .getElementById("url")
      .value
      .trim();

  const button =
    document
      .getElementById("scan");

  const status =
    document
      .getElementById("status");

  const results =
    document
      .getElementById("results");

  const stats =
    document
      .getElementById("stats");


  if (!url) {

    status.textContent =
      "Lütfen bir URL girin.";

    return;
  }


  button.disabled =
    true;

  results.innerHTML =
    "";

  stats.style.display =
    "none";


  status.textContent =
    "Site taranıyor, gerçek haber sayfaları belirleniyor ve AI editoryal analiz yapıyor...";


  const start =
    performance.now();


  try {

    const response =
      await fetch(
        "/api/scan",
        {

          method:
            "POST",

          headers: {

            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              url
            })
        }
      );


    const data =
      await response.json();


    if (!data.ok) {

      throw new Error(
        data.error ||
        "Tarama başarısız."
      );
    }


    const seconds =
      (
        performance.now() -
        start
      ) / 1000;


    stats.style.display =
      "grid";


    stats.innerHTML = \`

      <div class="stat">

        <div class="stat-number">
          \${data.scannedPages}
        </div>

        <div class="stat-label">
          Taranan sayfa
        </div>

      </div>


      <div class="stat">

        <div class="stat-number">
          \${data.discoveredLinks}
        </div>

        <div class="stat-label">
          Bulunan link
        </div>

      </div>


      <div class="stat">

        <div class="stat-number">
          \${data.articlesFound}
        </div>

        <div class="stat-label">
          Gerçek haber
        </div>

      </div>


      <div class="stat">

        <div class="stat-number">
          \${data.totalErrors}
        </div>

        <div class="stat-label">
          Doğrulanmış hata
        </div>

      </div>

    \`;


    status.innerHTML =
      "Tarama tamamlandı. " +
      data.articlesFound +
      " gerçek haber analiz edildi, " +
      data.totalErrors +
      " doğrulanmış hata bulundu. " +
      seconds.toFixed(1) +
      " saniye.";


    status.innerHTML +=
      "<br>Gemini: " +
      data.ai.geminiSuccess +
      " başarılı · NVIDIA: " +
      data.ai.nvidiaSuccess +
      " başarılı";


    if (
      !data.articles.length
    ) {

      results.innerHTML = \`

        <div class="panel">

          <div class="success">

            Gerçek haber formatında
            analiz edilebilecek sayfa bulunamadı.

          </div>

        </div>

      \`;

      return;
    }


    results.innerHTML =
      data.articles
        .map(
          renderArticle
        )
        .join("");


  } catch (error) {

    status.innerHTML =
      '<span class="failure">' +
      escapeHtml(
        error.message
      ) +
      '</span>';


  } finally {

    button.disabled =
      false;
  }
}


/* ============================================================
   RENDER ARTICLE
   ============================================================ */

function renderArticle(
  article
) {

  const errors =
    article.errors ||
    [];


  let body;


  if (
    !errors.length
  ) {

    const ai =
      article.ai?.gemini ===
        "success"

        ? "Gemini AI ✓"

        : article.ai?.nvidia ===
            "success"

          ? "NVIDIA AI ✓"

          : "AI bağlantısı başarısız";


    body = \`

      <div class="success">

        ✓ Bu haberde
        raporlanabilir objektif
        yazım/dilbilgisi hatası bulunmadı.

        <div class="badge">
          \${ai}
        </div>

      </div>

    \`;

  } else {

    body =
      errors
        .map(
          error => \`

            <div class="error">

              <div class="error-title">
                🔴 Bu haberde doğrulanmış hata bulundu
              </div>


              <div class="diff">

                <span class="wrong">
                  \${escapeHtml(
                    error.original
                  )}
                </span>

                →

                <span class="correct">
                  \${escapeHtml(
                    error.correction
                  )}
                </span>

              </div>


              <div class="reason">
                \${escapeHtml(
                  error.reason
                )}
              </div>


              <div class="confidence">

                Güven:
                \${(
                  Number(
                    error.confidence
                  ) * 100
                ).toFixed(1)}%

                ·

                Kaynak:
                \${escapeHtml(
                  error.source
                )}

              </div>


              <div class="source">

                <strong>
                  Kaynak haber:
                </strong>

                <br>

                <a
                  href="\${escapeAttr(
                    article.url
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  \${escapeHtml(
                    article.url
                  )}
                </a>

              </div>

            </div>

          \`
        )
        .join("");
  }


  return \`

    <div class="article">


      <div class="article-head">

        <div class="article-title">

          \${escapeHtml(
            article.title ||
            "Başlıksız haber"
          )}

        </div>


        <div class="article-url">

          \${escapeHtml(
            article.url
          )}

        </div>


        <div class="badge">

          \${escapeHtml(
            article.language
          )}

          · Article score:
          \${article.articleScore}

          ·

          \${article.ai?.gemini ===
            "success"

            ? "Gemini AI ✓"

            : article.ai?.nvidia ===
                "success"

              ? "NVIDIA AI ✓"

              : "AI ✕"}

        </div>

      </div>


      \${body}


    </div>

  \`;
}


/* ============================================================
   HTML ESCAPE
   ============================================================ */

function escapeHtml(
  value
) {

  return String(
    value || ""
  )
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
) {

  return escapeHtml(
    value
  );
}

</script>

</body>

</html>`;

/* ============================================================
   WEBPROOF AI — PRODUCTION EDITORIAL ENGINE
   ------------------------------------------------------------
   Real website crawling
   Real article extraction
   Turkish + English proofreading
   Gemini primary AI editor
   NVIDIA secondary opinion
   Strict validation
   URL-level evidence
   False-positive protection
   Cloudflare Worker compatible
   ============================================================ */

const CONFIG = {
  MAX_DISCOVERY_PAGES: 20,
  MAX_ARTICLES: 10,
  MAX_LINKS: 300,

  MAX_HTML_BYTES: 1_500_000,
  MAX_ARTICLE_TEXT: 12_000,

  AI_CHUNK_SIZE: 3_500,
  AI_TIMEOUT: 18_000,
  AI_CONCURRENCY: 2,

  MIN_AI_CONFIDENCE: 0.90,

  GEMINI_MODEL: "gemini-3.7-flash",

  NVIDIA_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b",
  NVIDIA_ENDPOINT:
    "https://integrate.api.nvidia.com/v1/chat/completions",

  MAX_AI_ERRORS_PER_CHUNK: 8
};

/* ============================================================
   CLOUDFLARE ENTRY
   ============================================================ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return new Response(FRONTEND_HTML, {
          headers: {
            "content-type": "text/html; charset=UTF-8"
          }
        });
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        return json({
          ok: true,
          service: "WebProof AI",
          version: "production-editorial-1.0",
          ai: {
            gemini: !!env.GEMINI_API_KEY,
            nvidia: !!env.NVIDIA_API_KEY,
            primary: env.GEMINI_API_KEY
              ? "gemini"
              : env.NVIDIA_API_KEY
                ? "nvidia"
                : "none"
          },
          models: {
            gemini: CONFIG.GEMINI_MODEL,
            nvidia: CONFIG.NVIDIA_MODEL
          },
          capabilities: [
            "website-crawling",
            "article-detection",
            "Turkish-proofreading",
            "English-proofreading",
            "AI-contextual-validation",
            "URL-level-evidence",
            "false-positive-filtering"
          ]
        });
      }

      if (request.method === "GET" && url.pathname === "/api/ai-test") {
        return await aiTest(env);
      }

      if (request.method === "POST" && url.pathname === "/api/scan") {
        const body = await request.json();

        if (!body || !body.url) {
          return json(
            {
              ok: false,
              error: "URL gerekli."
            },
            400
          );
        }

        const result = await scanWebsite(
          body.url,
          env,
          ctx
        );

        return json(result);
      }

      return new Response("Not Found", { status: 404 });

    } catch (error) {
      return json(
        {
          ok: false,
          error: error?.message || String(error)
        },
        500
      );
    }
  }
};

/* ============================================================
   BASIC HELPERS
   ============================================================ */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store"
      }
    }
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(arr) {
  return [...new Set(arr)];
}

function safeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\u200c/g, "")
    .replace(/\u200d/g, "")
    .replace(/\ufeff/g, "");
}

/* ============================================================
   FETCH WITH TIMEOUT
   ============================================================ */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = 8000
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
   URL NORMALIZATION
   ============================================================ */

function normalizeUrl(input, base = null) {
  try {
    const u = new URL(input, base || undefined);

    u.hash = "";

    // tracking parameters
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

    for (const key of tracking) {
      u.searchParams.delete(key);
    }

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

/* ============================================================
   ROBOTS
   ============================================================ */

async function canCrawl(url) {
  try {
    const u = new URL(url);

    const robotsUrl =
      `${u.origin}/robots.txt`;

    const response =
      await fetchWithTimeout(
        robotsUrl,
        {
          headers: {
            "user-agent":
              "WebProofAI/1.0 (+https://webproof.ai)"
          }
        },
        5000
      );

    if (!response.ok) {
      return true;
    }

    const robots =
      await response.text();

    const lines =
      robots
        .split(/\r?\n/)
        .map(x => x.trim());

    let applies = false;

    for (const line of lines) {
      const lower =
        line.toLowerCase();

      if (lower.startsWith("user-agent:")) {
        const agent =
          lower
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        applies =
          agent === "*" ||
          agent.includes("webproof");
      }

      if (
        applies &&
        lower.startsWith("disallow:")
      ) {
        const path =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        if (!path) continue;

        if (
          u.pathname.startsWith(path)
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
   HTML CLEANING
   ============================================================ */

function htmlToCleanText(html) {
  let text = String(html || "");

  /*
     VERY IMPORTANT:
     Do NOT convert every HTML tag into a space.
     That was the source of:
       "s ," / "a ." / ".B"
     type false positives.
  */

  text = text
    .replace(
      /<(script|style|noscript|template|svg|canvas|iframe|video|audio|form|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );

  // block-level boundaries
  text = text
    .replace(
      /<(br|\/p|\/div|\/section|\/article|\/li|\/h[1-6]|\/blockquote|\/tr)[^>]*>/gi,
      "\n"
    );

  // remove remaining tags WITHOUT inserting spaces
  text = text.replace(/<[^>]+>/g, "");

  // decode common entities
  text = decodeHtmlEntities(text);

  // normalize invisible chars
  text = safeText(text);

  // whitespace
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(
          parseInt(h, 16)
        );
      } catch {
        return _;
      }
    })
    .replace(/&#([0-9]+);/g, (_, n) => {
      try {
        return String.fromCodePoint(
          parseInt(n, 10)
        );
      } catch {
        return _;
      }
    });
}

/* ============================================================
   METADATA EXTRACTION
   ============================================================ */

function getMeta(html, name) {
  const re =
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escapeRegex(name)}["'][^>]+content=["']([^"']*)["']`,
      "i"
    );

  const re2 =
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escapeRegex(name)}["']`,
      "i"
    );

  return (
    html.match(re)?.[1] ||
    html.match(re2)?.[1] ||
    ""
  );
}

function getTitle(html) {
  const title =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )?.[1] || "";

  return htmlToCleanText(title);
}

function escapeRegex(str) {
  return String(str)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ============================================================
   LANGUAGE DETECTION
   ============================================================ */

function detectLanguage(html, text) {
  const htmlLang =
    html.match(
      /<html[^>]+lang=["']([^"']+)["']/i
    )?.[1];

  if (htmlLang) {
    const l =
      htmlLang.toLowerCase();

    if (l.startsWith("tr")) return "tr";
    if (l.startsWith("en")) return "en";
  }

  const sample =
    text
      .toLowerCase()
      .slice(0, 6000);

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
    " dedi "
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
    " news "
  ];

  const trScore =
    trWords.filter(x =>
      sample.includes(x)
    ).length;

  const enScore =
    enWords.filter(x =>
      sample.includes(x)
    ).length;

  return trScore >= enScore
    ? "tr"
    : "en";
}

/* ============================================================
   ARTICLE DETECTION
   ============================================================ */

function pathLooksLikeArticle(url) {
  try {
    const u = new URL(url);
    const path =
      u.pathname.toLowerCase();

    if (
      path === "/" ||
      path === "" ||
      path === "/turkce/" ||
      path === "/tr/" ||
      path === "/en/"
    ) {
      return false;
    }

    const badPatterns = [
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

    if (
      badPatterns.some(re =>
        re.test(path)
      )
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function getArticleSignals(html, url) {
  const signals = {
    articleTag: /<article\b/i.test(html),
    jsonLdArticle:
      /"@type"\s*:\s*"(?:NewsArticle|Article|ReportageNewsArticle)"/i.test(
        html
      ),
    datePublished:
      /datePublished/i.test(html),
    ogArticle:
      /article:published_time/i.test(html),
    headline:
      /"headline"\s*:/i.test(html),
    author:
      /"author"\s*:/i.test(html),
    articleSection:
      /"articleSection"\s*:/i.test(html),
    path:
      pathLooksLikeArticle(url)
  };

  return signals;
}

function scoreArticle(html, text, url) {
  const s =
    getArticleSignals(
      html,
      url
    );

  let score = 0;

  if (s.articleTag) score += 30;
  if (s.jsonLdArticle) score += 35;
  if (s.datePublished) score += 15;
  if (s.ogArticle) score += 10;
  if (s.headline) score += 10;
  if (s.author) score += 5;
  if (s.articleSection) score += 5;
  if (s.path) score += 10;

  const length =
    text.length;

  if (length >= 1200) score += 15;
  if (length >= 2500) score += 10;

  return {
    score,
    signals: s
  };
}

function isLikelyArticle(
  html,
  text,
  url
) {
  if (!pathLooksLikeArticle(url)) {
    return false;
  }

  const result =
    scoreArticle(
      html,
      text,
      url
    );

  /*
     Require real article evidence.
  */

  const strongSignal =
    result.signals.jsonLdArticle ||
    result.signals.articleTag ||
    result.signals.datePublished ||
    result.signals.ogArticle;

  if (!strongSignal) {
    return false;
  }

  if (text.length < 900) {
    return false;
  }

  return result.score >= 55;
}

/* ============================================================
   ARTICLE TEXT EXTRACTION
   ============================================================ */

function extractMainText(html) {
  const candidates = [];

  const articleMatches =
    html.match(
      /<article\b[^>]*>([\s\S]*?)<\/article>/gi
    ) || [];

  for (const block of articleMatches) {
    candidates.push(
      htmlToCleanText(block)
    );
  }

  const mainMatches =
    html.match(
      /<main\b[^>]*>([\s\S]*?)<\/main>/gi
    ) || [];

  for (const block of mainMatches) {
    candidates.push(
      htmlToCleanText(block)
    );
  }

  // paragraph extraction
  const paragraphs = [];

  const pRe =
    /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

  let match;

  while (
    (match = pRe.exec(html))
  ) {
    const p =
      htmlToCleanText(match[1]);

    if (p.length >= 50) {
      paragraphs.push(p);
    }
  }

  if (paragraphs.length) {
    candidates.push(
      paragraphs.join("\n")
    );
  }

  if (!candidates.length) {
    candidates.push(
      htmlToCleanText(html)
    );
  }

  candidates.sort(
    (a, b) => b.length - a.length
  );

  let text =
    candidates[0] || "";

  /*
     Remove obvious navigation/noise lines.
  */

  const noisePatterns = [
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
      .map(x => x.trim())
      .filter(x =>
        x &&
        !noisePatterns.some(
          re => re.test(x)
        )
      )
      .join("\n");

  return text.slice(
    0,
    CONFIG.MAX_ARTICLE_TEXT
  );
}

/* ============================================================
   LINK DISCOVERY
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
    const normalized =
      normalizeUrl(
        match[1],
        baseUrl
      );

    if (!normalized) continue;

    if (
      sameOrigin(
        normalized,
        baseUrl
      )
    ) {
      links.push(normalized);
    }
  }

  return unique(links);
}

/* ============================================================
   DISCOVERY
   ============================================================ */

async function crawlWebsite(
  startUrl
) {
  const queue = [
    normalizeUrl(startUrl)
  ];

  const visited = new Set();

  const pages = [];

  const origin =
    new URL(startUrl).origin;

  while (
    queue.length &&
    pages.length <
      CONFIG.MAX_DISCOVERY_PAGES
  ) {
    const current =
      queue.shift();

    if (!current) continue;
    if (visited.has(current)) continue;

    visited.add(current);

    if (
      !sameOrigin(
        current,
        origin
      )
    ) {
      continue;
    }

    if (
      !(await canCrawl(current))
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
                "WebProofAI/1.0",
              "accept":
                "text/html,application/xhtml+xml"
            },
            redirect: "follow"
          },
          7000
        );

      const contentType =
        response.headers.get(
          "content-type"
        ) || "";

      if (
        !contentType.includes("text/html")
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
          { fatal: false }
        ).decode(buffer);

      const title =
        getTitle(html);

      const text =
        extractMainText(html);

      const language =
        detectLanguage(
          html,
          text
        );

      const article =
        isLikelyArticle(
          html,
          text,
          current
        );

      const score =
        scoreArticle(
          html,
          text,
          current
        );

      pages.push({
        url: current,
        title,
        language,
        text,
        isArticle: article,
        articleScore: score.score,
        signals: score.signals,
        status: response.status
      });

      const discovered =
        extractLinks(
          html,
          current
        );

      for (const link of discovered) {
        if (
          !visited.has(link) &&
          queue.length <
            CONFIG.MAX_LINKS
        ) {
          queue.push(link);
        }
      }

    } catch {
      // Individual page failure must not kill the whole scan.
    }
  }

  return {
    pages,
    visitedCount: visited.size
  };
}

/* ============================================================
   TEXT NORMALIZATION FOR AI
   ============================================================ */

function normalizeForProofreading(text) {
  return safeText(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ============================================================
   SENTENCE CHUNKING
   ============================================================ */

function splitIntoChunks(
  text,
  maxChars
) {
  const normalized =
    normalizeForProofreading(
      text
    );

  if (
    normalized.length <= maxChars
  ) {
    return [normalized];
  }

  const sentences =
    normalized.split(
      /(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜÂÎÛ0-9"“‘])/u
    );

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
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
      (current ? " " : "") +
      sentence;
  }

  if (current.trim()) {
    chunks.push(
      current.trim()
    );
  }

  // fallback
  if (!chunks.length) {
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
   STRICT PROOFREADING SCHEMA
   ============================================================ */

const PROOFREAD_SCHEMA = {
  type: "object",
  properties: {
    errors: {
      type: "array",
      maxItems:
        CONFIG.MAX_AI_ERRORS_PER_CHUNK,
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
              "yazım",
              "dilbilgisi",
              "noktalama",
              "spelling",
              "grammar",
              "punctuation"
            ]
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1
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
You are WebProof AI, a professional editorial proofreading engine.

TASK:
Detect ONLY objectively verifiable language errors in the supplied news text.

LANGUAGE:
${lang}

ARTICLE TITLE:
${title || "(untitled)"}

TEXT:
<<<TEXT>>>
${chunk}
<<<END TEXT>>>

STRICT EDITORIAL RULES:

1. Report a finding ONLY if the original text is objectively wrong.
2. Do not report stylistic preferences.
3. Do not rewrite sentences merely to make them sound better.
4. Do not change journalistic tone.
5. Do not change political terminology merely because you prefer another expression.
6. Do not change names of people, places, organizations, brands, products or institutions unless the spelling is clearly objectively wrong.
7. Do not modify URLs, email addresses, hashtags, usernames, numbers, dates or quotations unless there is an undeniable language error outside the protected token.
8. Preserve quoted speech unless there is an objective spelling/punctuation error that is clearly attributable to the article itself.
9. Do not invent an error.
10. Do not infer missing context.
11. Do not flag a phrase simply because another formulation is possible.
12. The "original" value MUST be copied exactly from the supplied text.
13. The correction must be the smallest necessary correction.
14. Prefer no result over a doubtful result.
15. Minimum confidence for a reportable error is 0.90.
16. Ignore HTML/extraction artifacts.
17. Do not report whitespace artifacts caused by formatting.
18. Turkish rules must follow contemporary standard Turkish usage.
19. English rules must follow standard professional written English.
20. Return ONLY the JSON object matching the schema.

IMPORTANT:
If there are no objectively verifiable errors, return:
{"errors":[]}
`;
}

/* ============================================================
   GEMINI API
   ============================================================ */

async function callGemini(
  env,
  language,
  title,
  chunk
) {
  if (!env.GEMINI_API_KEY) {
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

  const prompt =
    buildProofreadPrompt(
      language,
      title,
      chunk
    );

  const response =
    await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-goog-api-key":
            env.GEMINI_API_KEY
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
            maxOutputTokens: 1200,
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

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${raw.slice(
        0,
        700
      )}`
    );
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "Gemini JSON response parse edilemedi."
    );
  }

  const text =
    data?.candidates?.[0]
      ?.content?.parts
      ?.map(x => x.text || "")
      .join("") || "";

  if (!text) {
    throw new Error(
      "Gemini boş cevap döndürdü."
    );
  }

  return parseAIJson(text);
}

/* ============================================================
   NVIDIA API
   ============================================================ */

async function callNvidia(
  env,
  language,
  title,
  chunk
) {
  if (!env.NVIDIA_API_KEY) {
    throw new Error(
      "NVIDIA_API_KEY tanımlı değil."
    );
  }

  const prompt =
    buildProofreadPrompt(
      language,
      title,
      chunk
    );

  const response =
    await fetchWithTimeout(
      CONFIG.NVIDIA_ENDPOINT,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          authorization:
            `Bearer ${env.NVIDIA_API_KEY}`
        },
        body: JSON.stringify({
          model:
            CONFIG.NVIDIA_MODEL,

          messages: [
            {
              role: "system",
              content:
                "You are a strict professional proofreading engine. Return only valid JSON."
            },
            {
              role: "user",
              content: prompt
            }
          ],

          temperature: 0,
          top_p: 0.9,
          max_tokens: 1200,
          stream: false,

          /*
             Disable extended reasoning for low-latency
             proofreading. This is intentionally not a
             long reasoning task.
          */
          extra_body: {
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        })
      },
      CONFIG.AI_TIMEOUT
    );

  const raw =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `NVIDIA HTTP ${response.status}: ${raw.slice(
        0,
        700
      )}`
    );
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "NVIDIA JSON parse edilemedi."
    );
  }

  const content =
    data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(
      "NVIDIA boş cevap döndürdü."
    );
  }

  return parseAIJson(content);
}

/* ============================================================
   JSON EXTRACTION
   ============================================================ */

function parseAIJson(text) {
  let cleaned =
    String(text || "")
      .trim()
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start =
    cleaned.indexOf("{");

  const end =
    cleaned.lastIndexOf("}");

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
   AI RESULT VALIDATION
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

  for (const item of result.errors) {
    if (!item) continue;

    const original =
      safeText(item.original).trim();

    const correction =
      safeText(item.correction).trim();

    const reason =
      safeText(item.reason).trim();

    const confidence =
      Number(item.confidence);

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
       Most important anti-hallucination test.
    */

    if (
      !chunk.includes(original)
    ) {
      continue;
    }

    if (
      original === correction
    ) {
      continue;
    }

    /*
       Do not allow huge rewrites.
       WebProof is proofreading, not rewriting.
    */

    if (
      correction.length >
        original.length * 4 &&
      correction.length > 80
    ) {
      continue;
    }

    /*
       Reject obvious extraction artifacts.
    */

    if (
      /(^|\s)[,.!?;:](\s|$)/u.test(
        original
      )
    ) {
      continue;
    }

    if (
      /[,.!?;:]\s*$/.test(
        original
      ) &&
      original.length <= 2
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
        clamp(
          confidence,
          0,
          1
        ),
      reason:
        reason ||
        "Objektif dil hatası.",
      source: "ai"
    });
  }

  return accepted;
}

/* ============================================================
   SECOND VALIDATION PASS
   ============================================================ */

function deduplicateErrors(
  errors
) {
  const map =
    new Map();

  for (const error of errors) {
    const key =
      `${error.original}=>${error.correction}`;

    const old =
      map.get(key);

    if (
      !old ||
      error.confidence >
        old.confidence
    ) {
      map.set(
        key,
        error
      );
    }
  }

  return [...map.values()];
}

/* ============================================================
   CONSERVATIVE RULE ENGINE
   ------------------------------------------------------------
   ONLY objective, low-risk lexical errors.
   No dangerous generic punctuation regex.
   ============================================================ */

function ruleBasedProofread(
  text,
  language
) {
  const errors = [];

  if (language === "tr") {
    const rules = [
      ["yanlız", "yalnız"],
      ["yalnış", "yanlış"],
      ["herkez", "herkes"],
      ["bir çok", "birçok"],
      ["birşey", "bir şey"],
      ["hiç bir", "hiçbir"],
      ["her hangi", "herhangi"],
      ["şarz", "şarj"],
      ["traş", "tıraş"],
      ["yanlızca", "yalnızca"],
      ["malesef", "maalesef"],
      ["orjinal", "orijinal"],
      ["süpriz", "sürpriz"],
      ["labaratuvar", "laboratuvar"],
      ["profesyonel", "profesyonel"]
    ];

    for (
      const [wrong, right]
      of rules
    ) {
      const re =
        new RegExp(
          `\\b${escapeRegex(
            wrong
          )}\\b`,
          "giu"
        );

      let m;

      while (
        (m = re.exec(text))
      ) {
        errors.push({
          original:
            m[0],
          correction:
            right,
          type:
            "yazım",
          confidence:
            0.995,
          reason:
            "Standart Türkçe yazımına göre doğrulanabilir kelime hatası.",
          source:
            "rule"
        });
      }
    }
  }

  if (language === "en") {
    const rules = [
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
      const [wrong, right]
      of rules
    ) {
      const re =
        new RegExp(
          `\\b${wrong}\\b`,
          "giu"
        );

      let m;

      while (
        (m = re.exec(text))
      ) {
        errors.push({
          original:
            m[0],
          correction:
            right,
          type:
            "spelling",
          confidence:
            0.995,
          reason:
            "Standard English spelling error.",
          source:
            "rule"
        });
      }
    }
  }

  return errors;
}

/* ============================================================
   ARTICLE AI ANALYSIS
   ============================================================ */

async function analyzeArticle(
  article,
  env
) {
  const text =
    normalizeForProofreading(
      article.text
    );

  const chunks =
    splitIntoChunks(
      text,
      CONFIG.AI_CHUNK_SIZE
    );

  const allErrors = [];

  let geminiSuccess =
    false;

  let nvidiaSuccess =
    false;

  let geminiError = null;

  let nvidiaError = null;

  /*
     Primary AI:
     Gemini
  */

  for (const chunk of chunks) {
    let result = null;

    if (env.GEMINI_API_KEY) {
      try {
        result =
          await callGemini(
            env,
            article.language,
            article.title,
            chunk
          );

        const validated =
          validateAIResults(
            result,
            chunk
          );

        allErrors.push(
          ...validated
        );

        geminiSuccess = true;

      } catch (error) {
        geminiError =
          error?.message ||
          String(error);
      }
    }

    /*
       If Gemini is unavailable/fails,
       NVIDIA is used as fallback.
    */

    if (
      !result &&
      env.NVIDIA_API_KEY
    ) {
      try {
        result =
          await callNvidia(
            env,
            article.language,
            article.title,
            chunk
          );

        const validated =
          validateAIResults(
            result,
            chunk
          );

        allErrors.push(
          ...validated
        );

        nvidiaSuccess = true;

      } catch (error) {
        nvidiaError =
          error?.message ||
          String(error);
      }
    }
  }

  /*
     Deterministic rules are used only
     as high-confidence guardrails.
  */

  const ruleErrors =
    ruleBasedProofread(
      text,
      article.language
    );

  /*
     Merge AI + deterministic.
  */

  const merged =
    deduplicateErrors([
      ...ruleErrors,
      ...allErrors
    ]);

  /*
     Final exact-source validation.
  */

  const finalErrors =
    merged.filter(error =>
      text.includes(
        error.original
      )
    );

  return {
    ...article,

    errors:
      finalErrors.map(error => ({
        ...error,
        pageUrl:
          article.url,
        pageTitle:
          article.title
      })),

    ai: {
      attempted:
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
   CONTROLLED CONCURRENCY
   ============================================================ */

async function mapWithConcurrency(
  items,
  concurrency,
  worker
) {
  const results =
    new Array(items.length);

  let index = 0;

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
          ok: false,
          error:
            error?.message ||
            String(error)
        };
      }
    }
  }

  const workers =
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
    workers
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
        p => p.isArticle
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
    analyzed
      .filter(
        x =>
          x &&
          x.errors
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
        a =>
          a.ai?.gemini ===
          "success"
      ).length,

    nvidiaSuccess:
      articles.filter(
        a =>
          a.ai?.nvidia ===
          "success"
      ).length,

    failures:
      articles.filter(
        a =>
          a.ai?.gemini ===
            "failed" &&
          a.ai?.nvidia !==
            "success"
      ).length
  };

  return {
    ok: true,

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

    ai: aiStats,

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
   AI CONNECTIVITY TEST
   ============================================================ */

async function aiTest(env) {
  const result = {
    ok: true,
    gemini: null,
    nvidia: null
  };

  /*
     GEMINI TEST
  */

  if (env.GEMINI_API_KEY) {
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
            method: "POST",
            headers: {
              "content-type":
                "application/json",
              "x-goog-api-key":
                env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text:
                        'Return exactly this JSON: {"ok":true}'
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: 50,
                responseMimeType:
                  "application/json"
              }
            })
          },
          8000
        );

      const raw =
        await response.text();

      result.gemini = {
        success:
          response.ok,
        status:
          response.status,
        response:
          raw.slice(0, 500)
      };

    } catch (error) {
      result.gemini = {
        success: false,
        error:
          error?.message ||
          String(error)
      };
    }
  } else {
    result.gemini = {
      success: false,
      error:
        "GEMINI_API_KEY yok."
    };
  }

  /*
     NVIDIA TEST
  */

  if (env.NVIDIA_API_KEY) {
    try {
      const response =
        await fetchWithTimeout(
          CONFIG.NVIDIA_ENDPOINT,
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
              authorization:
                `Bearer ${env.NVIDIA_API_KEY}`
            },
            body: JSON.stringify({
              model:
                CONFIG.NVIDIA_MODEL,

              messages: [
                {
                  role: "user",
                  content:
                    'Return exactly this JSON: {"ok":true}'
                }
              ],

              temperature: 0,
              max_tokens: 50,
              stream: false,

              extra_body: {
                chat_template_kwargs: {
                  enable_thinking: false
                }
              }
            })
          },
          8000
        );

      const raw =
        await response.text();

      result.nvidia = {
        success:
          response.ok,
        status:
          response.status,
        response:
          raw.slice(0, 500)
      };

    } catch (error) {
      result.nvidia = {
        success: false,
        error:
          error?.message ||
          String(error)
      };
    }
  } else {
    result.nvidia = {
      success: false,
      error:
        "NVIDIA_API_KEY yok."
    };
  }

  return json(result);
}

/* ============================================================
   FRONTEND
   ============================================================ */

const FRONTEND_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">

<title>WebProof AI — AI Editorial Proofreading</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  background:
    #0b1020;
  color:
    #f5f7fb;
}

.container {
  width:
    min(1100px, calc(100% - 28px));
  margin:
    0 auto;
  padding:
    38px 0 80px;
}

.hero {
  margin-bottom:
    28px;
}

h1 {
  margin: 0 0 8px;
  font-size:
    clamp(30px, 6vw, 54px);
  letter-spacing:
    -1.5px;
}

.subtitle {
  color:
    #aeb8ce;
  font-size:
    16px;
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
  margin-bottom:
    20px;
}

.input-row {
  display:
    flex;
  gap:
    10px;
}

input {
  flex: 1;
  min-width: 0;
  background:
    #080d19;
  border:
    1px solid #33415f;
  color:
    white;
  padding:
    15px;
  border-radius:
    11px;
  font-size:
    15px;
}

button {
  border: 0;
  border-radius:
    11px;
  padding:
    0 20px;
  background:
    #4f7cff;
  color:
    white;
  font-weight:
    700;
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
  color:
    #8995ad;
  font-size:
    12px;
  margin-top:
    5px;
}

.article {
  border:
    1px solid #26324d;
  background:
    #121a2e;
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
    750;
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
  margin-top:
    8px;
}

.error {
  padding:
    16px 18px;
  border-bottom:
    1px solid #26324d;
}

.error:last-child {
  border-bottom:
    0;
}

.error-title {
  color:
    #ff7373;
  font-weight:
    800;
  margin-bottom:
    10px;
}

.diff {
  font-size:
    17px;
  margin-bottom:
    8px;
}

.wrong {
  text-decoration:
    line-through;
  opacity:
    .7;
}

.correct {
  font-weight:
    800;
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
    7px;
}

.source {
  margin-top:
    10px;
  padding:
    10px;
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

  <div class="hero">
    <h1>WebProof AI</h1>

    <div class="subtitle">
      Gerçek web taraması · gerçek haber çıkarımı ·
      yapay zekâ destekli Türkçe/İngilizce editoryal denetim
    </div>
  </div>

  <div class="panel">

    <div class="input-row">

      <input
        id="url"
        type="url"
        placeholder="https://www.ornek-site.com"
        value="https://www.bbc.com/turkce/"
      >

      <button
        id="scan"
        onclick="scan()"
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

async function scan() {

  const input =
    document.getElementById("url");

  const button =
    document.getElementById("scan");

  const status =
    document.getElementById("status");

  const results =
    document.getElementById("results");

  const stats =
    document.getElementById("stats");

  const url =
    input.value.trim();

  if (!url) {
    status.textContent =
      "Lütfen bir web sitesi URL'si girin.";
    return;
  }

  button.disabled =
    true;

  results.innerHTML =
    "";

  stats.style.display =
    "none";

  status.textContent =
    "Site taranıyor ve gerçek haber sayfaları belirleniyor...";

  const started =
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

    const elapsed =
      (
        performance.now() -
        started
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
      " haber analiz edildi, " +
      data.totalErrors +
      " doğrulanmış hata bulundu. " +
      "Süre: " +
      elapsed.toFixed(1) +
      " sn.";

    if (
      data.ai
    ) {
      status.innerHTML +=
        "<br>Gemini: " +
        data.ai.geminiSuccess +
        " başarılı · NVIDIA: " +
        data.ai.nvidiaSuccess +
        " başarılı";
    }

    if (
      !data.articles.length
    ) {
      results.innerHTML =
        '<div class="panel success">' +
        'Gerçek haber formatında analiz edilebilecek sayfa bulunamadı.' +
        '</div>';

      return;
    }

    results.innerHTML =
      data.articles
        .map(
          article =>
            renderArticle(
              article
            )
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

function renderArticle(
  article
) {

  const errors =
    article.errors ||
    [];

  let body = "";

  if (!errors.length) {

    const aiState =
      article.ai?.gemini ===
        "success"
        ? "Gemini AI ✓"
        : article.ai?.nvidia ===
            "success"
          ? "NVIDIA AI ✓"
          : "AI başarısız";

    body =
      \`
      <div class="success">
        ✓ Bu haberde raporlanabilir
        bir yazım/dilbilgisi hatası bulunmadı.
        <div class="badge">
          \${aiState}
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
                · Kaynak:
                \${escapeHtml(
                  error.source
                )}
              </div>

              <div class="source">
                <strong>
                  Kaynak haber:
                </strong><br>
                <a
                  href="\${escapeAttr(
                    article.url
                  )}"
                  target="_blank"
                  rel="noopener"
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

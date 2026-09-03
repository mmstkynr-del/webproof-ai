export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    // =========================================================
    // STATUS
    // =========================================================

    if (
      url.pathname === "/api/status" &&
      request.method === "GET"
    ) {
      return json({
        ok: true,
        service: "WebProof AI",
        status: "online",

        crawler: "real-web-crawler",

        ruleEngine: "enabled",

        ai: env.NVIDIA_API_KEY
          ? "connected"
          : "missing-api-key",

        model:
          "nvidia/nemotron-3.5-lightning-30b-a3b",

        taskEngine: "enabled",

        storage: "temporary-memory"
      });
    }

    // =========================================================
    // TASKS
    // =========================================================

    if (
      url.pathname === "/api/tasks" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        if (!body?.url) {
          return json({
            ok: false,
            error: "url gerekli"
          }, 400);
        }

        const validation =
          validateTargetUrl(body.url);

        if (!validation.ok) {
          return json({
            ok: false,
            error: validation.error
          }, 400);
        }

        const task = {
          id: crypto.randomUUID(),

          url: validation.url,

          type:
            body.type ||
            "website",

          condition:
            body.condition ||
            null,

          keyword:
            body.keyword ||
            null,

          threshold:
            body.threshold ??
            null,

          notify:
            body.notify ||
            "none",

          status: "active",

          createdAt:
            new Date().toISOString(),

          lastCheckedAt:
            null,

          lastResult:
            null
        };

        temporaryTasks.push(task);

        return json({
          ok: true,
          message:
            "Takip görevi oluşturuldu",
          task
        });

      } catch (error) {
        return json({
          ok: false,
          error:
            error.message ||
            "Görev oluşturulamadı"
        }, 400);
      }
    }

    if (
      url.pathname === "/api/tasks" &&
      request.method === "GET"
    ) {
      return json({
        ok: true,
        count:
          temporaryTasks.length,
        tasks:
          temporaryTasks
      });
    }

    if (
      url.pathname.startsWith("/api/tasks/") &&
      request.method === "DELETE"
    ) {
      const taskId =
        url.pathname
          .split("/")
          .pop();

      const index =
        temporaryTasks.findIndex(
          task =>
            task.id === taskId
        );

      if (index === -1) {
        return json({
          ok: false,
          error:
            "Görev bulunamadı"
        }, 404);
      }

      const deleted =
        temporaryTasks.splice(
          index,
          1
        )[0];

      return json({
        ok: true,
        message:
          "Görev silindi",
        task:
          deleted
      });
    }

    // =========================================================
    // REAL WEBSITE SCAN
    // =========================================================

    if (
      url.pathname === "/api/scan" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        if (!body?.url) {
          return json({
            ok: false,
            error:
              "url gerekli"
          }, 400);
        }

        const validation =
          validateTargetUrl(
            body.url
          );

        if (!validation.ok) {
          return json({
            ok: false,
            error:
              validation.error
          }, 400);
        }

        const targetUrl =
          validation.url;

        const MAX_PAGES = 10;

        const MAX_ARTICLES_FOR_AI = 5;

        const MAX_LINKS = 300;

        const startUrl =
          normalizeUrl(
            targetUrl
          );

        const start =
          new URL(startUrl);

        const domain =
          start.hostname;

        const queue = [];

        const queued =
          new Set();

        const visited =
          new Set();

        const pages = [];

        let linksFound = 0;

        let articleCandidates = 0;

        let articlePages = 0;

        let aiAnalyzed = 0;

        let ruleErrors = 0;

        let aiErrors = 0;

        let totalErrors = 0;

        let totalCharacters = 0;

        let aiSkipped = 0;

        addQueue(
          startUrl,
          100
        );

        // =====================================================
        // CRAWLER
        // =====================================================

        while (
          queue.length > 0 &&
          pages.length < MAX_PAGES
        ) {
          queue.sort(
            (a, b) =>
              b.score -
              a.score
          );

          const item =
            queue.shift();

          const pageUrl =
            item.url;

          if (
            visited.has(pageUrl)
          ) {
            continue;
          }

          visited.add(pageUrl);

          let fetched;

          try {
            fetched =
              await fetchPage(
                pageUrl
              );
          } catch (error) {
            pages.push({
              url:
                pageUrl,

              type:
                "unknown",

              score:
                item.score,

              status:
                "fetch-error",

              chars: 0,

              title:
                "",

              ruleAnalysis:
                null,

              ai:
                null,

              error:
                error.message
            });

            continue;
          }

          const html =
            fetched.html;

          const status =
            fetched.status;

          if (!html) {
            pages.push({
              url:
                pageUrl,

              type:
                "non-html",

              score:
                item.score,

              status,

              chars: 0,

              title:
                "",

              ruleAnalysis:
                null,

              ai:
                null
            });

            continue;
          }

          const title =
            extractTitle(
              html
            );

          // ===================================================
          // BETTER CONTENT EXTRACTION
          // ===================================================

          const text =
            extractMainText(
              html
            );

          const chars =
            text.length;

          totalCharacters +=
            chars;

          // ===================================================
          // LINKS
          // ===================================================

          const links =
            extractLinks(
              html,
              pageUrl,
              domain,
              MAX_LINKS
            );

          linksFound +=
            links.length;

          for (
            const link of links
          ) {
            if (
              !visited.has(
                link.url
              ) &&
              !queued.has(
                link.url
              )
            ) {
              addQueue(
                link.url,
                link.score
              );
            }
          }

          // ===================================================
          // ARTICLE DETECTION
          // ===================================================

          const articleScore =
            scoreArticleUrl(
              pageUrl
            );

          const hasArticleStructure =
            hasArticleStructureInHTML(
              html
            );

          const looksLikeArticle =
            articleScore >= 40 ||
            (
              articleScore >= 20 &&
              hasArticleStructure
            );

          if (
            looksLikeArticle
          ) {
            articleCandidates++;
          }

          // ===================================================
          // RULE ENGINE
          // ===================================================

          let ruleAnalysis = {
            errors: [],
            suspicious: []
          };

          if (
            looksLikeArticle &&
            text.length > 100
          ) {
            ruleAnalysis =
              ruleBasedProofread(
                text
              );
          }

          ruleErrors +=
            ruleAnalysis.errors.length;

          // ===================================================
          // PAGE
          // ===================================================

          const pageInfo = {
            url:
              pageUrl,

            type:
              looksLikeArticle
                ? "article"
                : "page",

            score:
              articleScore,

            status,

            chars,

            title,

            ruleAnalysis,

            ai:
              null
          };

          pages.push(
            pageInfo
          );

          if (
            looksLikeArticle
          ) {
            articlePages++;
          }
        }

        // =====================================================
        // AI SECOND OPINION
        // =====================================================

        const articleList =
          pages
            .filter(
              page =>
                page.type ===
                "article"
            )
            .slice(
              0,
              MAX_ARTICLES_FOR_AI
            );

        for (
          const page of articleList
        ) {
          try {
            const fetched =
              await fetchPage(
                page.url
              );

            const text =
              extractMainText(
                fetched.html
              );

            // -------------------------------------------------
            // IMPORTANT:
            //
            // We don't ask AI to blindly rewrite everything.
            // We give it:
            //
            // 1. article text
            // 2. deterministic rule findings
            // 3. suspicious fragments
            //
            // AI acts as second opinion.
            // -------------------------------------------------

            if (
              !env.NVIDIA_API_KEY
            ) {
              aiSkipped++;

              page.ai = {
                ok: false,
                errors: [],
                status:
                  "missing-api-key",
                message:
                  "NVIDIA_API_KEY Worker Secret olarak eklenmemiş."
              };

              continue;
            }

            const aiResult =
              await analyzeWithNvidia(
                page.title,
                text,
                page.ruleAnalysis,
                env
              );

            page.ai =
              aiResult;

            if (
              aiResult.ok
            ) {
              aiAnalyzed++;

              aiErrors +=
                aiResult.errors.length;
            }

          } catch (error) {
            page.ai = {
              ok: false,
              errors: [],
              status:
                "ai-error",
              error:
                error.message
            };
          }
        }

        totalErrors =
          ruleErrors +
          aiErrors;

        // =====================================================
        // FINAL RESPONSE
        // =====================================================

        return json({
          ok: true,

          target:
            targetUrl,

          domain,

          crawler:
            "real-web-crawler",

          ruleEngine:
            "enabled",

          ai:
            env.NVIDIA_API_KEY
              ? "connected"
              : "missing-api-key",

          model:
            "nvidia/nemotron-3.5-lightning-30b-a3b",

          pagesScanned:
            pages.length,

          pagesLimit:
            MAX_PAGES,

          linksFound,

          articleCandidates,

          articlePages,

          aiAnalyzed,

          aiLimit:
            MAX_ARTICLES_FOR_AI,

          aiSkipped,

          ruleErrors,

          aiErrors,

          totalErrors,

          totalCharacters,

          readyForAI:
            Boolean(
              env.NVIDIA_API_KEY
            ),

          pages
        });

        function addQueue(
          url,
          score
        ) {
          if (
            queued.has(url) ||
            visited.has(url)
          ) {
            return;
          }

          if (
            queue.length >=
            MAX_LINKS
          ) {
            return;
          }

          queued.add(url);

          queue.push({
            url,
            score
          });
        }

      } catch (error) {
        return json({
          ok: false,
          error:
            error.message ||
            "Tarama sırasında hata oluştu"
        }, 500);
      }
    }

    // =========================================================
    // FRONTEND
    // =========================================================

    return new Response(
      frontendHTML(),
      {
        headers: {
          "content-type":
            "text/html; charset=UTF-8"
        }
      }
    );
  }
};


// =============================================================
// TEMPORARY TASK STORAGE
// =============================================================

const temporaryTasks = [];


// =============================================================
// URL SECURITY
// =============================================================

function validateTargetUrl(
  value
) {
  try {
    const parsed =
      new URL(value);

    if (
      parsed.protocol !==
        "http:" &&
      parsed.protocol !==
        "https:"
    ) {
      return {
        ok: false,
        error:
          "Sadece HTTP ve HTTPS adresleri destekleniyor"
      };
    }

    const hostname =
      parsed.hostname.toLowerCase();

    const blocked = [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "metadata.google.internal",
      "metadata.google",
      "169.254.169.254"
    ];

    if (
      blocked.includes(
        hostname
      ) ||
      hostname.endsWith(
        ".localhost"
      ) ||
      hostname.endsWith(
        ".internal"
      )
    ) {
      return {
        ok: false,
        error:
          "Bu hedef adres güvenlik nedeniyle engellendi"
      };
    }

    return {
      ok: true,
      url:
        parsed.toString()
    };

  } catch {
    return {
      ok: false,
      error:
        "Geçerli bir URL girin"
    };
  }
}


// =============================================================
// NORMALIZE URL
// =============================================================

function normalizeUrl(
  value
) {
  const u =
    new URL(value);

  const removeParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid"
  ];

  for (
    const param of
    removeParams
  ) {
    u.searchParams.delete(
      param
    );
  }

  u.hash = "";

  return u.toString();
}


// =============================================================
// FETCH
// =============================================================

async function fetchPage(
  pageUrl
) {
  const response =
    await fetch(
      pageUrl,
      {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; WebProofAI/1.0)",

          "Accept":
            "text/html,application/xhtml+xml"
        },

        redirect:
          "follow"
      }
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
    return {
      status:
        response.status,

      html:
        ""
    };
  }

  return {
    status:
      response.status,

    html:
      await response.text()
  };
}


// =============================================================
// TITLE
// =============================================================

function extractTitle(
  html
) {
  const match =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  if (!match) {
    return "";
  }

  return decodeEntities(
    match[1]
      .replace(
        /\s+/g,
        " "
      )
      .trim()
  );
}


// =============================================================
// MAIN CONTENT EXTRACTION
// =============================================================

function extractMainText(
  html
) {
  if (!html) {
    return "";
  }

  let content =
    html;

  // Remove elements that almost
  // never belong to article body.

  content =
    content.replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    );

  content =
    content.replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    );

  content =
    content.replace(
      /<noscript[\s\S]*?<\/noscript>/gi,
      " "
    );

  content =
    content.replace(
      /<svg[\s\S]*?<\/svg>/gi,
      " "
    );

  content =
    content.replace(
      /<!--[\s\S]*?-->/g,
      " "
    );

  content =
    content.replace(
      /<nav[\s\S]*?<\/nav>/gi,
      " "
    );

  content =
    content.replace(
      /<footer[\s\S]*?<\/footer>/gi,
      " "
    );

  content =
    content.replace(
      /<header[\s\S]*?<\/header>/gi,
      " "
    );

  content =
    content.replace(
      /<aside[\s\S]*?<\/aside>/gi,
      " "
    );

  // Prefer article/main containers.

  const articleMatch =
    content.match(
      /<article\b[^>]*>([\s\S]*?)<\/article>/i
    );

  const mainMatch =
    content.match(
      /<main\b[^>]*>([\s\S]*?)<\/main>/i
    );

  if (
    articleMatch &&
    articleMatch[1].length >
      500
  ) {
    content =
      articleMatch[1];
  } else if (
    mainMatch &&
    mainMatch[1].length >
      500
  ) {
    content =
      mainMatch[1];
  }

  // Remove remaining HTML.

  content =
    content.replace(
      /<[^>]+>/g,
      " "
    );

  content =
    decodeEntities(
      content
    );

  // Normalize whitespace.

  content =
    content.replace(
      /\s+/g,
      " "
    );

  return content.trim();
}


// =============================================================
// HTML ENTITIES
// =============================================================

function decodeEntities(
  text
) {
  return text
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
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&#x2F;/gi,
      "/"
    );
}


// =============================================================
// LINKS
// =============================================================

function extractLinks(
  html,
  baseUrl,
  domain,
  maxLinks
) {
  const results =
    [];

  const seen =
    new Set();

  const regex =
    /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match =
      regex.exec(html)) !==
      null &&
    results.length <
      maxLinks
  ) {
    try {
      const raw =
        match[1].trim();

      if (
        !raw ||
        raw.startsWith("#") ||
        raw.startsWith(
          "javascript:"
        ) ||
        raw.startsWith(
          "mailto:"
        ) ||
        raw.startsWith(
          "tel:"
        )
      ) {
        continue;
      }

      const absolute =
        new URL(
          raw,
          baseUrl
        );

      if (
        absolute.protocol !==
          "http:" &&
        absolute.protocol !==
          "https:"
      ) {
        continue;
      }

      if (
        absolute.hostname.toLowerCase() !==
        domain.toLowerCase()
      ) {
        continue;
      }

      const normalized =
        normalizeUrl(
          absolute.toString()
        );

      if (
        seen.has(
          normalized
        )
      ) {
        continue;
      }

      seen.add(
        normalized
      );

      results.push({
        url:
          normalized,

        score:
          scoreArticleUrl(
            normalized
          )
      });

    } catch {
      // Ignore invalid URLs.
    }
  }

  return results;
}


// =============================================================
// ARTICLE URL SCORE
// =============================================================

function scoreArticleUrl(
  pageUrl
) {
  try {
    const path =
      new URL(
        pageUrl
      )
        .pathname
        .toLowerCase();

    let score = 0;

    const strong = [
      "/turkce/articles/",
      "/turkce/article/",
      "/haber/",
      "/haberler/",
      "/news/",
      "/article/",
      "/articles/",
      "/story/",
      "/stories/"
    ];

    const medium = [
      "/gundem/",
      "/ekonomi/",
      "/siyaset/",
      "/dunya/",
      "/spor/",
      "/kultur/",
      "/teknoloji/",
      "/yasam/"
    ];

    for (
      const p of strong
    ) {
      if (
        path.includes(p)
      ) {
        score += 50;
      }
    }

    for (
      const p of medium
    ) {
      if (
        path.includes(p)
      ) {
        score += 20;
      }
    }

    if (
      /\/20\d{2}\//.test(
        path
      )
    ) {
      score += 20;
    }

    const parts =
      path
        .split("/")
        .filter(
          Boolean
        );

    const last =
      parts[
        parts.length - 1
      ] || "";

    if (
      last.length > 45
    ) {
      score += 20;
    }

    const exclusions = [
      "/topics/",
      "/topic/",
      "/languages",
      "/about",
      "/contact",
      "/search",
      "/login",
      "/register",
      "/account",
      "/live",
      "/video",
      "/audio",
      "/podcast"
    ];

    for (
      const exclusion of
      exclusions
    ) {
      if (
        path.includes(
          exclusion
        )
      ) {
        score -= 50;
      }
    }

    return score;

  } catch {
    return 0;
  }
}


// =============================================================
// ARTICLE STRUCTURE
// =============================================================

function hasArticleStructureInHTML(
  html
) {
  if (!html) {
    return false;
  }

  return (
    /<article\b/i.test(
      html
    ) ||
    /<main\b/i.test(
      html
    ) ||
    /application\/ld\+json/i.test(
      html
    )
  );
}


// =============================================================
// RULE-BASED PROOFREADING
// =============================================================
//
// This engine intentionally focuses on things that are
// objectively suspicious.
//
// It does NOT try to understand meaning.
// That is AI's job.
//
// =============================================================

function ruleBasedProofread(
  text
) {
  const errors = [];

  const suspicious = [];

  function addError(
    original,
    correction,
    type,
    reason
  ) {
    if (
      !original ||
      !correction ||
      original === correction
    ) {
      return;
    }

    if (
      errors.some(
        e =>
          e.original ===
          original &&
          e.correction ===
          correction
      )
    ) {
      return;
    }

    errors.push({
      original,
      correction,
      type,
      confidence: 0.99,
      source:
        "rule-engine",
      reason
    });
  }

  // -----------------------------------------------------------
  // Multiple spaces
  // -----------------------------------------------------------

  if (
    / {2,}/.test(text)
  ) {
    addError(
      "  ",
      " ",
      "yazım",
      "Ardışık birden fazla boşluk bulundu."
    );
  }

  // -----------------------------------------------------------
  // Space before punctuation
  // -----------------------------------------------------------

  if (
    /\s+[,.!?;:]/.test(
      text
    )
  ) {
    addError(
      " ,",
      ",",
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk bulundu."
    );

    addError(
      " .",
      ".",
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk bulundu."
    );

    addError(
      " !",
      "!",
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk bulundu."
    );

    addError(
      " ?",
      "?",
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk bulundu."
    );

    addError(
      " ;",
      ";",
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk bulundu."
    );

    addError(
      " :",
      ":",
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk bulundu."
    );
  }

  // -----------------------------------------------------------
  // Duplicate punctuation
  // -----------------------------------------------------------

  const duplicatePatterns = [
    ["..", "."],
    [",,", ","],
    ["!!", "!"],
    ["??", "?"],
    [";;", ";"],
    ["::", ":"]
  ];

  for (
    const [
      original,
      correction
    ] of duplicatePatterns
  ) {
    if (
      text.includes(
        original
      )
    ) {
      addError(
        original,
        correction,
        "noktalama",
        "Ardışık tekrar eden noktalama işareti bulundu."
      );
    }
  }

  // -----------------------------------------------------------
  // Missing space after punctuation
  // -----------------------------------------------------------

  const missingSpace =
    text.match(
      /[.!?;:][A-Za-zÇĞİÖŞÜçğıöşü]/g
    );

  if (
    missingSpace
  ) {
    for (
      const match of
      missingSpace.slice(
        0,
        20
      )
    ) {
      const punctuation =
        match[0];

      const corrected =
        punctuation[0] +
        " " +
        punctuation[1];

      addError(
        punctuation,
        corrected,
        "noktalama",
        "Noktalama işaretinden sonra boşluk eksik olabilir."
      );

      suspicious.push({
        original:
          punctuation,
        reason:
          "Noktalama sonrası boşluk kontrolü gerekiyor."
      });
    }
  }

  // -----------------------------------------------------------
  // Obvious Turkish keyboard / spelling patterns
  // -----------------------------------------------------------

  const obvious = [
    [
      /\bbir\s+çok\b/gi,
      "birçok",
      "bir çok",
      "Türkçede 'birçok' bitişik yazılır."
    ],

    [
      /\bhiç\s+bir\b/gi,
      "hiçbir",
      "hiç bir",
      "Türkçede 'hiçbir' bitişik yazılır."
    ],

    [
      /\bher\s+hangi\b/gi,
      "herhangi",
      "her hangi",
      "Türkçede 'herhangi' bitişik yazılır."
    ],

    [
      /\bşu\s+an\b/gi,
      "şu an",
      "şuan",
      "Doğru kullanım 'şu an'dır."
    ],

    [
      /\bşuan\b/gi,
      "şu an",
      "şuan",
      "Doğru kullanım 'şu an'dır."
    ],

    [
      /\byalnış\b/gi,
      "yanlış",
      "yalnış",
      "Yaygın bir yazım hatası."
    ],

    [
      /\byanlız\b/gi,
      "yalnız",
      "yanlız",
      "Yaygın bir yazım hatası."
    ],

    [
      /\bherkez\b/gi,
      "herkes",
      "herkez",
      "Yaygın bir yazım hatası."
    ],

    [
      /\bbirşey\b/gi,
      "bir şey",
      "birşey",
      "Doğru kullanım 'bir şey'dir."
    ],

    [
      /\bhiçbirşey\b/gi,
      "hiçbir şey",
      "hiçbirşey",
      "Doğru kullanım 'hiçbir şey'dir."
    ],

    [
      /\bpekçok\b/gi,
      "pek çok",
      "pekçok",
      "Doğru kullanım 'pek çok'tur."
    ]
  ];

  for (
    const rule of
    obvious
  ) {
    const [
      pattern,
      correction,
      original,
      reason
    ] = rule;

    if (
      pattern.test(text)
    ) {
      addError(
        original,
        correction,
        "yazım",
        reason
      );
    }

    pattern.lastIndex = 0;
  }

  return {
    errors,
    suspicious:
      suspicious.slice(
        0,
        30
      )
  };
}


// =============================================================
// NVIDIA SECOND OPINION
// =============================================================

async function analyzeWithNvidia(
  title,
  text,
  ruleAnalysis,
  env
) {
  const articleText =
    text.slice(
      0,
      12000
    );

  const ruleFindings =
    JSON.stringify(
      ruleAnalysis.errors
        .slice(
          0,
          30
        )
    );

  const suspicious =
    JSON.stringify(
      ruleAnalysis.suspicious
        .slice(
          0,
          30
        )
    );

  const systemPrompt = `
Sen WebProof AI'ın ikinci görüş veren
profesyonel Türkçe editör yapay zekâsısın.

İlk aşamada metin bir kural motoru tarafından
kontrol edildi.

Senin görevin:

1. Kural motorunun bulduğu hataların gerçekten
   hata olup olmadığını kontrol etmek.

2. Kural motorunun yakalayamadığı ancak bağlama
   göre açıkça hata olduğu anlaşılan yazım,
   noktalama veya dilbilgisi hatalarını bulmak.

3. Özellikle nüans gerektiren durumlarda karar vermek.

KESİNLİKLE:

- Haber metninin anlamını değiştirme.
- Gazetecilik üslubunu gereksiz yere düzeltme.
- Özel isimleri değiştirme.
- Kurum, kişi, yer ve marka isimlerini değiştirme.
- Ağız/alıntı/konuşma dilini otomatik olarak hata sayma.
- Sadece yüksek güvenli hataları bildir.
- Emin değilsen hata bildirme.
- Stil tercihini hata olarak bildirme.

Çıktı SADECE JSON olsun.

Format:

{
  "errors": [
    {
      "original": "hatalı ifade",
      "correction": "doğru ifade",
      "type": "yazım|noktalama|dilbilgisi|sayı|diğer",
      "confidence": 0.0,
      "reason": "kısa açıklama"
    }
  ]
}

Güven 0.85'in altındaysa hatayı listeleme.

Hata yoksa:

{
  "errors": []
}
`;

  const response =
    await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method:
          "POST",

        headers: {
          "Authorization":
            `Bearer ${env.NVIDIA_API_KEY}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            model:
              "nvidia/nemotron-3.5-lightning-30b-a3b",

            temperature:
              0.1,

            messages: [
              {
                role:
                  "system",

                content:
                  systemPrompt
              },

              {
                role:
                  "user",

                content:
                  `
BAŞLIK:
${title}

KURAL MOTORUNUN BULDUĞU NOKTALAR:
${ruleFindings}

ŞÜPHELİ NOKTALAR:
${suspicious}

MAKALE:
${articleText}
`
              }
            ]
          })
      }
    );

  if (
    !response.ok
  ) {
    const errorText =
      await response.text();

    throw new Error(
      `NVIDIA API ${response.status}: ${errorText.slice(
        0,
        500
      )}`
    );
  }

  const data =
    await response.json();

  const content =
    data?.choices?.[0]?.message?.content ||
    "";

  let parsed;

  try {
    parsed =
      JSON.parse(
        content
      );
  } catch {
    const match =
      content.match(
        /\{[\s\S]*\}/
      );

    if (!match) {
      return {
        ok: false,
        errors: [],
        status:
          "invalid-ai-response"
      };
    }

    try {
      parsed =
        JSON.parse(
          match[0]
        );
    } catch {
      return {
        ok: false,
        errors: [],
        status:
          "invalid-ai-json"
      };
    }
  }

  const errors =
    Array.isArray(
      parsed.errors
    )
      ? parsed.errors
          .filter(
            error =>
              error &&
              error.original &&
              error.correction &&
              Number(
                error.confidence
              ) >= 0.85
          )
          .map(
            error => ({
              original:
                String(
                  error.original
                ),

              correction:
                String(
                  error.correction
                ),

              type:
                error.type ||
                "diğer",

              confidence:
                Number(
                  error.confidence
                ),

              reason:
                error.reason ||
                "",

              source:
                "nvidia-ai"
            })
          )
      : [];

  return {
    ok: true,
    errors
  };
}


// =============================================================
// FRONTEND
// =============================================================

function frontendHTML() {
  return `<!DOCTYPE html>
<html lang="tr">

<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>WebProof AI</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #0b0f14;
  color: #f4f7fb;
  font-family:
    Arial,
    Helvetica,
    sans-serif;
}

.container {
  max-width: 1100px;
  margin: auto;
  padding: 32px 18px 60px;
}

h1 {
  margin-bottom: 8px;
}

.subtitle {
  color: #9ca8b8;
  margin-bottom: 30px;
}

.card {
  background: #121923;
  border: 1px solid #263242;
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 20px;
}

input {
  width: 100%;
  padding: 15px;
  border-radius: 10px;
  border: 1px solid #344255;
  background: #0d131c;
  color: white;
  font-size: 16px;
}

button {
  margin-top: 12px;
  padding: 14px 20px;
  border: 0;
  border-radius: 10px;
  background: white;
  color: #111;
  font-weight: bold;
  cursor: pointer;
}

button:disabled {
  opacity: .5;
}

.status {
  margin-top: 15px;
  color: #aeb9c9;
  white-space: pre-wrap;
}

.stats {
  display: grid;
  grid-template-columns:
    repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.stat {
  background: #0d131c;
  border-radius: 12px;
  padding: 15px;
}

.stat strong {
  display: block;
  font-size: 24px;
  margin-bottom: 5px;
}

.page {
  background: #0d131c;
  border: 1px solid #263242;
  border-radius: 12px;
  padding: 16px;
  margin-top: 12px;
}

.page-url {
  color: #8db8ff;
  word-break: break-all;
  font-size: 13px;
}

.badge {
  display: inline-block;
  margin-top: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  background: #202b3a;
  font-size: 12px;
}

.error {
  border-left: 3px solid #ff7b7b;
  padding: 10px;
  margin-top: 8px;
  background: #151a22;
}

.ai-error {
  border-left: 3px solid #ffd166;
}

.correction {
  margin-top: 5px;
}

small {
  color: #8f9bab;
}

</style>

</head>

<body>

<div class="container">

<h1>WebProof AI</h1>

<div class="subtitle">
Gerçek web taraması + kural motoru +
yapay zekâ destekli editoryal denetim
</div>

<div class="card">

<input
  id="url"
  value="https://www.bbc.com/turkce"
  placeholder="https://ornek.com"
>

<button
  id="scanButton"
  onclick="scanSite()">
SİTEYİ TARA
</button>

<div
  id="status"
  class="status">
</div>

</div>

<div
  id="stats"
  class="card"
  style="display:none">

<div class="stats">

<div class="stat">
<strong id="pages">0</strong>
Sayfa
</div>

<div class="stat">
<strong id="links">0</strong>
Link
</div>

<div class="stat">
<strong id="articles">0</strong>
Makale
</div>

<div class="stat">
<strong id="ai">0</strong>
AI
</div>

<div class="stat">
<strong id="ruleErrors">0</strong>
Robot
</div>

<div class="stat">
<strong id="aiErrors">0</strong>
AI Hata
</div>

<div class="stat">
<strong id="errors">0</strong>
Toplam
</div>

</div>

</div>

<div id="results"></div>

</div>

<script>

async function scanSite() {

  const input =
    document.getElementById(
      "url"
    );

  const button =
    document.getElementById(
      "scanButton"
    );

  const status =
    document.getElementById(
      "status"
    );

  const stats =
    document.getElementById(
      "stats"
    );

  const results =
    document.getElementById(
      "results"
    );

  const target =
    input.value.trim();

  if (!target) {
    status.textContent =
      "Lütfen bir URL girin.";
    return;
  }

  button.disabled =
    true;

  status.textContent =
    "Gerçek site bağlantısı kuruluyor...";

  stats.style.display =
    "none";

  results.innerHTML =
    "";

  try {

    const response =
      await fetch(
        "/api/scan",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              url:
                target
            })
        }
      );

    const data =
      await response.json();

    if (!data.ok) {
      throw new Error(
        data.error ||
        "Tarama başarısız"
      );
    }

    status.textContent =
      "Gerçek tarama tamamlandı.";

    stats.style.display =
      "block";

    document.getElementById(
      "pages"
    ).textContent =
      data.pagesScanned || 0;

    document.getElementById(
      "links"
    ).textContent =
      data.linksFound || 0;

    document.getElementById(
      "articles"
    ).textContent =
      data.articlePages || 0;

    document.getElementById(
      "ai"
    ).textContent =
      data.aiAnalyzed || 0;

    document.getElementById(
      "ruleErrors"
    ).textContent =
      data.ruleErrors || 0;

    document.getElementById(
      "aiErrors"
    ).textContent =
      data.aiErrors || 0;

    document.getElementById(
      "errors"
    ).textContent =
      data.totalErrors || 0;

    for (
      const page of
      data.pages || []
    ) {

      const div =
        document.createElement(
          "div"
        );

      div.className =
        "page";

      let html =
        "";

      html +=
        "<div class='page-url'>" +
        escapeHTML(
          page.url
        ) +
        "</div>";

      html +=
        "<small>" +
        "Tür: " +
        escapeHTML(
          page.type || ""
        ) +
        " | HTTP: " +
        escapeHTML(
          String(
            page.status ?? ""
          )
        ) +
        " | Skor: " +
        escapeHTML(
          String(
            page.score ?? 0
          )
        ) +
        " | Karakter: " +
        escapeHTML(
          String(
            page.chars ?? 0
          )
        ) +
        "</small>";

      if (
        page.title
      ) {
        html +=
          "<div style='margin-top:8px;font-weight:bold'>" +
          escapeHTML(
            page.title
          ) +
          "</div>";
      }

      // -------------------------------------------------------
      // RULE ERRORS
      // -------------------------------------------------------

      const ruleErrors =
        page.ruleAnalysis &&
        Array.isArray(
          page.ruleAnalysis.errors
        )
          ? page.ruleAnalysis.errors
          : [];

      for (
        const error of
        ruleErrors
      ) {

        html +=
          "<div class='error'>" +

          "<div>" +
          escapeHTML(
            error.original
          ) +
          "</div>" +

          "<div class='correction'>" +
          "→ " +
          escapeHTML(
            error.correction
          ) +
          "</div>" +

          "<small>" +
          "Robot kural motoru | " +
          escapeHTML(
            error.type || ""
          ) +
          "</small>" +

          "<div>" +
          "<small>" +
          escapeHTML(
            error.reason || ""
          ) +
          "</small>" +
          "</div>" +

          "</div>";
      }

      // -------------------------------------------------------
      // AI ERRORS
      // -------------------------------------------------------

      const aiErrors =
        page.ai &&
        Array.isArray(
          page.ai.errors
        )
          ? page.ai.errors
          : [];

      for (
        const error of
        aiErrors
      ) {

        html +=
          "<div class='error ai-error'>" +

          "<div>" +
          escapeHTML(
            error.original
          ) +
          "</div>" +

          "<div class='correction'>" +
          "→ " +
          escapeHTML(
            error.correction
          ) +
          "</div>" +

          "<small>" +
          "NVIDIA AI | " +
          escapeHTML(
            error.type || ""
          ) +
          " | Güven: " +
          escapeHTML(
            String(
              error.confidence ?? ""
            )
          ) +
          "</small>" +

          "<div>" +
          "<small>" +
          escapeHTML(
            error.reason || ""
          ) +
          "</small>" +
          "</div>" +

          "</div>";
      }

      // -------------------------------------------------------
      // AI STATUS
      // -------------------------------------------------------

      if (
        page.ai &&
        page.ai.status
      ) {
        html +=
          "<div class='badge'>" +
          escapeHTML(
            page.ai.message ||
            page.ai.status
          ) +
          "</div>";
      }

      div.innerHTML =
        html;

      results.appendChild(
        div
      );
    }

  } catch (
    error
  ) {

    status.textContent =
      "Hata: " +
      error.message;

  } finally {

    button.disabled =
      false;
  }
}


function escapeHTML(
  value
) {
  return String(
    value
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

</html>`;
}


// =============================================================
// JSON
// =============================================================

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

        ...corsHeaders()
      }
    }
  );
}


// =============================================================
// CORS
// =============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, POST, DELETE, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Authorization"
  };
}

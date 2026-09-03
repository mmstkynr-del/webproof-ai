const MAX_PAGES = 10;
const MAX_ARTICLES_FOR_AI = 5;
const MAX_LINKS = 300;

const temporaryTasks = [];

const NVIDIA_MODEL =
  "nvidia/nemotron-3.5-lightning-30b-a3b";

const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
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
      const hasNvidiaKey =
        typeof env.NVIDIA_API_KEY === "string" &&
        env.NVIDIA_API_KEY.trim().length > 0;

      return json({
        ok: true,
        service: "WebProof AI",
        status: "online",

        crawler: "real-web-crawler",
        ruleEngine: "enabled",

        ai: hasNvidiaKey
          ? "connected"
          : "missing-api-key",

        model: NVIDIA_MODEL,

        taskEngine: "enabled",
        storage: "temporary-memory",

        secretTest: {
          exists: hasNvidiaKey,
          type: typeof env.NVIDIA_API_KEY,
          length: hasNvidiaKey
            ? env.NVIDIA_API_KEY.trim().length
            : 0
        }
      });
    }

    // =========================================================
    // NVIDIA DIRECT TEST
    // =========================================================

    if (
      url.pathname === "/api/ai-test" &&
      request.method === "GET"
    ) {
      try {
        if (
          typeof env.NVIDIA_API_KEY !== "string" ||
          !env.NVIDIA_API_KEY.trim()
        ) {
          return json({
            ok: false,
            ai: "missing-api-key",
            error:
              "NVIDIA_API_KEY Cloudflare Worker runtime'ında bulunamadı."
          }, 500);
        }

        const result =
          await testNvidiaConnection(env);

        return json(result);

      } catch (error) {
        return json({
          ok: false,
          ai: "error",
          error: safeErrorMessage(error)
        }, 500);
      }
    }

    // =========================================================
    // TASKS - CREATE
    // =========================================================

    if (
      url.pathname === "/api/tasks" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        if (!body || !body.url) {
          return json({
            ok: false,
            error: "URL gerekli."
          }, 400);
        }

        const normalized =
          normalizeUrl(body.url);

        if (!normalized) {
          return json({
            ok: false,
            error:
              "Geçerli HTTP/HTTPS URL gerekli."
          }, 400);
        }

        const task = {
          id: crypto.randomUUID(),
          url: normalized,
          command:
            body.command ||
            "siteyi takip et",
          status: "active",
          createdAt:
            new Date().toISOString()
        };

        temporaryTasks.push(task);

        return json({
          ok: true,
          task
        });

      } catch (error) {
        return json({
          ok: false,
          error:
            safeErrorMessage(error)
        }, 500);
      }
    }

    // =========================================================
    // TASKS - LIST
    // =========================================================

    if (
      url.pathname === "/api/tasks" &&
      request.method === "GET"
    ) {
      return json({
        ok: true,
        tasks: temporaryTasks
      });
    }

    // =========================================================
    // TASKS - DELETE
    // =========================================================

    if (
      url.pathname === "/api/tasks" &&
      request.method === "DELETE"
    ) {
      const id =
        url.searchParams.get("id");

      if (!id) {
        return json({
          ok: false,
          error: "Task id gerekli."
        }, 400);
      }

      const index =
        temporaryTasks.findIndex(
          item => item.id === id
        );

      if (index === -1) {
        return json({
          ok: false,
          error: "Task bulunamadı."
        }, 404);
      }

      temporaryTasks.splice(index, 1);

      return json({
        ok: true,
        deleted: id
      });
    }

    // =========================================================
    // SCAN
    // =========================================================

    if (
      url.pathname === "/api/scan" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        if (!body || !body.url) {
          return json({
            ok: false,
            error: "URL gerekli."
          }, 400);
        }

        const startUrl =
          normalizeUrl(body.url);

        if (!startUrl) {
          return json({
            ok: false,
            error:
              "Geçerli HTTP/HTTPS URL gerekli."
          }, 400);
        }

        const result =
          await scanWebsite(
            startUrl,
            env
          );

        return json({
          ok: true,
          ...result
        });

      } catch (error) {
        return json({
          ok: false,
          error:
            safeErrorMessage(error)
        }, 500);
      }
    }

    // =========================================================
    // FRONTEND
    // =========================================================

    if (request.method === "GET") {
      return new Response(
        frontendHTML(),
        {
          status: 200,
          headers: {
            "content-type":
              "text/html; charset=UTF-8",
            ...corsHeaders()
          }
        }
      );
    }

    return json({
      ok: false,
      error: "Endpoint bulunamadı."
    }, 404);
  }
};


// =============================================================
// WEBSITE SCANNER
// =============================================================

async function scanWebsite(
  startUrl,
  env
) {
  const start =
    new URL(startUrl);

  const queue = [start.href];
  const visited = new Set();

  const pages = [];
  const allLinks = new Set();

  let articles = 0;
  let aiCount = 0;
  let robotErrors = 0;
  let aiErrors = 0;

  const aiAvailable =
    typeof env.NVIDIA_API_KEY === "string" &&
    env.NVIDIA_API_KEY.trim().length > 0;

  while (
    queue.length > 0 &&
    visited.size < MAX_PAGES
  ) {
    const currentUrl =
      queue.shift();

    if (
      !currentUrl ||
      visited.has(currentUrl)
    ) {
      continue;
    }

    visited.add(currentUrl);

    const page = {
      url: currentUrl,
      type: "page",
      status: null,
      score: 0,
      chars: 0,
      title: "",
      errors: [],
      suspicious: [],
      aiErrors: [],
      aiStatus: "not-run"
    };

    try {
      const response =
        await fetchPage(currentUrl);

      page.status =
        response.status;

      if (!response.ok) {
        page.type =
          "robot-error";

        page.errors.push({
          original: "",
          correction: "",
          type: "diğer",
          confidence: 1,
          reason:
            `Sayfa HTTP ${response.status} döndürdü.`
        });

        robotErrors++;
        pages.push(page);
        continue;
      }

      const html =
        response.html;

      page.title =
        extractTitle(html);

      const text =
        extractMainText(html);

      page.chars =
        text.length;

      const links =
        extractLinks(
          html,
          start.hostname
        );

      for (const link of links) {
        allLinks.add(link);

        if (
          queue.length < MAX_LINKS &&
          !visited.has(link)
        ) {
          queue.push(link);
        }
      }

      page.score =
        scoreArticleUrl(
          currentUrl
        );

      const articleStructure =
        hasArticleStructureInHTML(
          html
        );

      const isArticle =
        page.score >= 40 ||
        (
          page.score >= 20 &&
          articleStructure
        );

      if (isArticle) {
        page.type = "article";
        articles++;

        const ruleAnalysis =
          ruleBasedProofread(text);

        page.errors =
          ruleAnalysis.errors;

        page.suspicious =
          ruleAnalysis.suspicious;

        if (
          aiAvailable &&
          aiCount < MAX_ARTICLES_FOR_AI
        ) {
          try {
            const aiResult =
              await analyzeWithNvidia(
                page.title,
                text,
                ruleAnalysis,
                env
              );

            if (aiResult.ok) {
              page.aiStatus =
                "connected";

              page.aiErrors =
                aiResult.errors || [];

              aiCount++;

            } else {
              page.aiStatus =
                "error";

              page.aiErrors = [{
                original: "",
                correction: "",
                type: "diğer",
                confidence: 0,
                reason:
                  aiResult.error ||
                  "NVIDIA AI hatası."
              }];

              aiErrors++;
            }

          } catch (error) {
            page.aiStatus =
              "error";

            page.aiErrors = [{
              original: "",
              correction: "",
              type: "diğer",
              confidence: 0,
              reason:
                safeErrorMessage(error)
            }];

            aiErrors++;
          }

        } else if (!aiAvailable) {
          page.aiStatus =
            "missing-api-key";

          page.aiErrors = [{
            original: "",
            correction: "",
            type: "diğer",
            confidence: 0,
            reason:
              "NVIDIA_API_KEY Cloudflare Worker runtime'ında bulunamadı."
          }];
        }
      }

      pages.push(page);

    } catch (error) {
      page.type =
        "robot-error";

      page.errors.push({
        original: "",
        correction: "",
        type: "diğer",
        confidence: 0,
        reason:
          safeErrorMessage(error)
      });

      robotErrors++;

      pages.push(page);
    }
  }

  const totalErrors =
    pages.reduce(
      (sum, page) =>
        sum +
        (page.errors?.length || 0) +
        (page.aiErrors || [])
          .filter(
            item =>
              item.original &&
              item.correction
          ).length,
      0
    );

  return {
    scannedUrl: startUrl,

    pagesScanned:
      pages.length,

    linksFound:
      allLinks.size,

    articlesFound:
      articles,

    aiAnalyzed:
      aiCount,

    robotErrors,

    aiErrors,

    totalErrors,

    ai: {
      connected:
        aiAvailable,

      model:
        NVIDIA_MODEL
    },

    pages
  };
}


// =============================================================
// FETCH PAGE
// =============================================================

async function fetchPage(
  targetUrl
) {
  const parsed =
    new URL(targetUrl);

  if (
    !["http:", "https:"]
      .includes(parsed.protocol)
  ) {
    throw new Error(
      "Sadece HTTP/HTTPS adresleri desteklenir."
    );
  }

  if (
    isBlockedHost(
      parsed.hostname
    )
  ) {
    throw new Error(
      "Güvenlik nedeniyle bu hosta erişim engellendi."
    );
  }

  const response =
    await fetch(
      targetUrl,
      {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; WebProofAI/1.0)"
        }
      }
    );

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  if (
    !contentType.includes(
      "text/html"
    ) &&
    !contentType.includes(
      "application/xhtml"
    )
  ) {
    return {
      ok: false,
      status: response.status,
      html: ""
    };
  }

  const html =
    await response.text();

  return {
    ok: response.ok,
    status: response.status,
    html
  };
}


// =============================================================
// URL NORMALIZATION
// =============================================================

function normalizeUrl(value) {
  try {
    const url =
      new URL(
        String(value).trim()
      );

    if (
      !["http:", "https:"]
        .includes(url.protocol)
    ) {
      return null;
    }

    if (
      isBlockedHost(
        url.hostname
      )
    ) {
      return null;
    }

    url.hash = "";

    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid"
    ];

    for (
      const param of trackingParams
    ) {
      url.searchParams.delete(
        param
      );
    }

    return url.href;

  } catch {
    return null;
  }
}


// =============================================================
// INTERNAL HOST PROTECTION
// =============================================================

function isBlockedHost(
  hostname
) {
  const host =
    hostname.toLowerCase();

  if (
    host === "localhost" ||
    host ===
      "localhost.localdomain" ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return true;
  }

  if (
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  if (
    host ===
      "metadata.google.internal" ||
    host ===
      "metadata.google"
  ) {
    return true;
  }

  if (
    /^\d+\.\d+\.\d+\.\d+$/.test(
      host
    )
  ) {
    const parts =
      host.split(".").map(
        Number
      );

    const a = parts[0];
    const b = parts[1];

    if (
      a === 10 ||
      a === 127 ||
      (
        a === 172 &&
        b >= 16 &&
        b <= 31
      ) ||
      (
        a === 192 &&
        b === 168
      ) ||
      (
        a === 169 &&
        b === 254
      )
    ) {
      return true;
    }
  }

  return false;
}


// =============================================================
// TITLE
// =============================================================

function extractTitle(html) {
  const match =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  if (!match) {
    return "";
  }

  return cleanText(
    match[1]
  );
}


// =============================================================
// MAIN TEXT EXTRACTION
// =============================================================

function extractMainText(
  html
) {
  let working = html;

  working =
    working.replace(
      /<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );

  const candidates = [];

  const articleMatches =
    working.match(
      /<article\b[^>]*>[\s\S]*?<\/article>/gi
    ) || [];

  for (
    const item of articleMatches
  ) {
    candidates.push(item);
  }

  const mainMatches =
    working.match(
      /<main\b[^>]*>[\s\S]*?<\/main>/gi
    ) || [];

  for (
    const item of mainMatches
  ) {
    candidates.push(item);
  }

  let selected = "";

  if (
    candidates.length > 0
  ) {
    selected =
      candidates
        .map(
          item => cleanText(item)
        )
        .sort(
          (a, b) =>
            b.length - a.length
        )[0];
  }

  if (
    !selected ||
    selected.length < 500
  ) {
    selected =
      cleanText(working);
  }

  return selected
    .replace(/\s+/g, " ")
    .trim();
}


// =============================================================
// LINKS
// =============================================================

function extractLinks(
  html,
  hostname
) {
  const result =
    new Set();

  const regex =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;

  let match;

  while (
    (match = regex.exec(html)) !== null
  ) {
    const raw =
      match[1];

    try {
      const link =
        new URL(
          raw,
          `https://${hostname}`
        );

      if (
        !["http:", "https:"]
          .includes(link.protocol)
      ) {
        continue;
      }

      if (
        link.hostname.toLowerCase() !==
        hostname.toLowerCase()
      ) {
        continue;
      }

      if (
        isBlockedHost(
          link.hostname
        )
      ) {
        continue;
      }

      link.hash = "";

      const trackingParams = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid"
      ];

      for (
        const param of trackingParams
      ) {
        link.searchParams.delete(
          param
        );
      }

      result.add(
        link.href
      );

      if (
        result.size >= MAX_LINKS
      ) {
        break;
      }

    } catch {
      // Geçersiz link atlanır.
    }
  }

  return [...result];
}


// =============================================================
// ARTICLE SCORE
// =============================================================

function scoreArticleUrl(
  targetUrl
) {
  try {
    const url =
      new URL(targetUrl);

    const path =
      url.pathname.toLowerCase();

    let score = 0;

    const strongPatterns = [
      "/article/",
      "/articles/",
      "/haber/",
      "/haberler/",
      "/news/",
      "/story/",
      "/stories/",
      "/post/",
      "/posts/",
      "/gundem/",
      "/ekonomi/",
      "/siyaset/",
      "/dunya/",
      "/spor/",
      "/turkce/articles/"
    ];

    for (
      const pattern of strongPatterns
    ) {
      if (
        path.includes(pattern)
      ) {
        score += 40;
      }
    }

    const words = [
      "haber",
      "news",
      "article",
      "story",
      "gundem",
      "ekonomi",
      "siyaset",
      "dunya",
      "spor"
    ];

    for (
      const word of words
    ) {
      if (
        path.includes(word)
      ) {
        score += 10;
      }
    }

    if (
      path
        .split("/")
        .filter(Boolean)
        .length >= 2
    ) {
      score += 10;
    }

    if (
      /\d{4}[-/]\d{1,2}[-/]\d{1,2}/
        .test(path)
    ) {
      score += 15;
    }

    return Math.min(
      score,
      100
    );

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
  return (
    /<article\b/i.test(html) ||
    /<main\b/i.test(html) ||
    /articleBody/i.test(html) ||
    /NewsArticle/i.test(html)
  );
}


// =============================================================
// RULE BASED PROOFREADING
// =============================================================

function ruleBasedProofread(
  text
) {
  const errors = [];
  const suspicious = [];
  const seen = new Set();

  function addError(
    original,
    correction,
    type,
    reason,
    confidence = 0.98
  ) {
    if (
      !original ||
      !correction ||
      original === correction
    ) {
      return;
    }

    const key =
      `${original}|||${correction}|||${type}`;

    if (
      seen.has(key)
    ) {
      return;
    }

    seen.add(key);

    errors.push({
      original,
      correction,
      type,
      confidence,
      reason
    });
  }

  // Birden fazla boşluk
  const multipleSpace =
    text.match(/ {2,}/);

  if (multipleSpace) {
    addError(
      multipleSpace[0],
      " ",
      "yazım",
      "Birden fazla ardışık boşluk bulundu."
    );
  }

  // Noktalama işaretinden önce boşluk
  const beforePunctuation =
    /([^\s])\s+([,.!?;:])/g;

  let match;

  while (
    (match =
      beforePunctuation.exec(text)) !== null
  ) {
    const original =
      match[1] +
      match[0].slice(1);

    const correction =
      match[1] +
      match[2];

    addError(
      original,
      correction,
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk bulundu."
    );

    if (
      errors.length >= 30
    ) {
      break;
    }
  }

  // Tekrarlanan noktalama
  const duplicatePunctuation =
    /([!?;,])\1+|\.{2,}/g;

  while (
    (match =
      duplicatePunctuation.exec(text)) !== null
  ) {
    const original =
      match[0];

    if (
      original === "..."
    ) {
      continue;
    }

    const before =
      text.slice(
        Math.max(
          0,
          match.index - 30
        ),
        match.index
      );

    if (
      /https?:\/\/$/i.test(
        before
      )
    ) {
      continue;
    }

    if (
      /[\w.-]$/.test(before) &&
      original === ".."
    ) {
      continue;
    }

    addError(
      original,
      original[0],
      "noktalama",
      "Ardışık noktalama işaretleri bulundu."
    );

    if (
      errors.length >= 30
    ) {
      break;
    }
  }

  // Noktalama sonrası boşluk
  const missingSpace =
    /([.!?;:])([A-Za-zÇĞİÖŞÜçğıöşü])/g;

  while (
    (match =
      missingSpace.exec(text)) !== null
  ) {
    const index =
      match.index;

    const before =
      text.slice(
        Math.max(
          0,
          index - 80
        ),
        index + 20
      );

    if (
      /https?:\/\/[^\s]*$/i.test(
        before
      ) ||
      /www\.[^\s]*$/i.test(
        before
      ) ||
      /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/i.test(
        before
      )
    ) {
      continue;
    }

    const original =
      match[1] +
      match[2];

    const correction =
      match[1] +
      " " +
      match[2];

    addError(
      original,
      correction,
      "noktalama",
      "Noktalama işaretinden sonra boşluk eksik olabilir.",
      0.92
    );

    suspicious.push({
      original,
      correction,
      reason:
        "Bağlama göre değerlendirilmesi gereken olası boşluk hatası."
    });

    if (
      errors.length >= 30
    ) {
      break;
    }
  }

  // Türkçe yaygın hatalar
  const replacements = [
    [
      /\bbir çok\b/gi,
      "birçok",
      "Bu kelime Türkçede bitişik yazılır."
    ],
    [
      /\bhiç bir\b/gi,
      "hiçbir",
      "Bu kelime bitişik yazılır."
    ],
    [
      /\bher hangi\b/gi,
      "herhangi",
      "Bu kelime bitişik yazılır."
    ],
    [
      /\bşuan\b/gi,
      "şu an",
      "Doğru kullanım 'şu an' şeklindedir."
    ],
    [
      /\byalnış\b/gi,
      "yanlış",
      "Doğru yazım 'yanlış' şeklindedir."
    ],
    [
      /\byanlız\b/gi,
      "yalnız",
      "Doğru yazım 'yalnız' şeklindedir."
    ],
    [
      /\bherkez\b/gi,
      "herkes",
      "Doğru yazım 'herkes' şeklindedir."
    ],
    [
      /\bbirşey\b/gi,
      "bir şey",
      "Doğru kullanım 'bir şey' şeklindedir."
    ],
    [
      /\bhiçbirşey\b/gi,
      "hiçbir şey",
      "Doğru kullanım 'hiçbir şey' şeklindedir."
    ],
    [
      /\bpekçok\b/gi,
      "pek çok",
      "Doğru kullanım 'pek çok' şeklindedir."
    ]
  ];

  for (
    const [
      regex,
      correction,
      reason
    ] of replacements
  ) {
    const found =
      text.match(regex);

    if (!found) {
      continue;
    }

    addError(
      found[0],
      correction,
      "yazım",
      reason
    );

    if (
      errors.length >= 30
    ) {
      break;
    }
  }

  return {
    errors:
      errors.slice(0, 30),

    suspicious:
      suspicious.slice(0, 30)
  };
}


// =============================================================
// NVIDIA CONNECTION TEST
// =============================================================

async function testNvidiaConnection(
  env
) {
  const response =
    await fetch(
      NVIDIA_ENDPOINT,
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${env.NVIDIA_API_KEY.trim()}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          model: NVIDIA_MODEL,

          messages: [
            {
              role: "user",
              content:
                "Sadece şu JSON'u döndür: {\"ok\":true,\"message\":\"NVIDIA bağlantısı çalışıyor\"}"
            }
          ],

          temperature: 0,

          max_tokens: 100
        })
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    return {
      ok: false,
      ai: "error",
      httpStatus:
        response.status,
      error:
        `NVIDIA API HTTP ${response.status}: ${text.slice(0, 1000)}`
    };
  }

  let data = null;

  try {
    data =
      JSON.parse(text);
  } catch {
    return {
      ok: false,
      ai: "error",
      httpStatus:
        response.status,
      error:
        "NVIDIA API yanıtı JSON olarak ayrıştırılamadı."
    };
  }

  const content =
    data?.choices?.[0]?.message?.content ||
    "";

  return {
    ok: true,
    ai: "connected",
    model: NVIDIA_MODEL,
    httpStatus:
      response.status,
    responsePreview:
      String(content).slice(0, 500)
  };
}


// =============================================================
// NVIDIA AI ANALYSIS
// =============================================================

async function analyzeWithNvidia(
  title,
  text,
  ruleAnalysis,
  env
) {
  if (
    typeof env.NVIDIA_API_KEY !== "string" ||
    !env.NVIDIA_API_KEY.trim()
  ) {
    return {
      ok: false,
      error:
        "NVIDIA_API_KEY Worker runtime'ında bulunamadı."
    };
  }

  const limitedText =
    text.slice(0, 12000);

  const prompt =
`Başlık:
${title || "(başlık yok)"}

Metin:
${limitedText}

Kural tabanlı ön inceleme:
${JSON.stringify(ruleAnalysis)}

Bu metni profesyonel bir Türkçe haber editörü gibi kontrol et.

Yalnızca gerçekten hata olduğundan yüksek derecede emin olduğun yazım,
noktalama, dilbilgisi veya sayı kullanım hatalarını bildir.

Gazetecilik üslubunu değiştirme.
Cümleleri gereksiz yere yeniden yazma.
Doğru kullanımları hata olarak bildirme.
Özel isimleri değiştirme.
Alıntıları gereksiz yere değiştirme.

Yanıtı SADECE geçerli JSON olarak ver:

{
  "errors": [
    {
      "original": "hatalı bölüm",
      "correction": "doğru bölüm",
      "type": "yazım",
      "confidence": 0.95,
      "reason": "kısa açıklama"
    }
  ]
}

type yalnızca şu değerlerden biri olsun:
"yazım"
"noktalama"
"dilbilgisi"
"sayı"
"diğer"

confidence 0 ile 1 arasında olsun.

Yalnızca confidence >= 0.85 olan gerçek hataları bildir.

Hata yoksa:
{
  "errors": []
}`;

  const response =
    await fetch(
      NVIDIA_ENDPOINT,
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${env.NVIDIA_API_KEY.trim()}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          model: NVIDIA_MODEL,

          messages: [
            {
              role: "system",
              content:
                "Sen çok dikkatli çalışan profesyonel bir Türkçe haber editörüsün."
            },
            {
              role: "user",
              content: prompt
            }
          ],

          temperature: 0.1,

          max_tokens: 2000
        })
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    return {
      ok: false,
      error:
        `NVIDIA API HTTP ${response.status}: ${responseText.slice(0, 1000)}`
    };
  }

  let data;

  try {
    data =
      JSON.parse(
        responseText
      );
  } catch {
    return {
      ok: false,
      error:
        "NVIDIA API geçerli JSON döndürmedi."
    };
  }

  const content =
    data?.choices?.[0]?.message?.content;

  if (!content) {
    return {
      ok: false,
      error:
        "NVIDIA API yanıtında model çıktısı bulunamadı."
    };
  }

  const parsed =
    parseJsonObjectFromText(
      content
    );

  if (!parsed) {
    return {
      ok: false,
      error:
        "NVIDIA modeli JSON formatında yanıt vermedi."
    };
  }

  const rawErrors =
    Array.isArray(parsed.errors)
      ? parsed.errors
      : [];

  const errors =
    rawErrors
      .filter(
        item =>
          item &&
          item.original &&
          item.correction &&
          Number(item.confidence) >= 0.85
      )
      .slice(0, 30)
      .map(
        item => ({
          original:
            String(
              item.original
            ),

          correction:
            String(
              item.correction
            ),

          type:
            String(
              item.type ||
              "diğer"
            ),

          confidence:
            Number(
              item.confidence
            ),

          reason:
            String(
              item.reason ||
              "NVIDIA AI tarafından olası hata tespit edildi."
            )
        })
      );

  return {
    ok: true,
    errors
  };
}


// =============================================================
// ROBUST JSON PARSER
// =============================================================

function parseJsonObjectFromText(
  content
) {
  const text =
    String(content || "")
      .trim();

  try {
    return JSON.parse(text);
  } catch {}

  const withoutFence =
    text
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

  try {
    return JSON.parse(
      withoutFence
    );
  } catch {}

  const firstBrace =
    withoutFence.indexOf("{");

  const lastBrace =
    withoutFence.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace <= firstBrace
  ) {
    return null;
  }

  try {
    return JSON.parse(
      withoutFence.slice(
        firstBrace,
        lastBrace + 1
      )
    );
  } catch {
    return null;
  }
}


// =============================================================
// TEXT CLEANING
// =============================================================

function cleanText(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /<br\s*\/?>/gi,
      "\n"
    )
    .replace(
      /<\/p>/gi,
      "\n"
    )
    .replace(
      /<[^>]+>/g,
      " "
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
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// =============================================================
// SAFE ERROR
// =============================================================

function safeErrorMessage(
  error
) {
  const message =
    String(
      error?.message ||
      error ||
      "Bilinmeyen hata"
    );

  return message
    .replace(
      /Bearer\s+[A-Za-z0-9._-]+/gi,
      "Bearer [REDACTED]"
    )
    .slice(0, 1000);
}


// =============================================================
// JSON RESPONSE
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
      "GET,POST,DELETE,OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Authorization"
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

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>WebProof AI</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #0b0f14;
  color: #e8edf3;
  font-family:
    Arial,
    Helvetica,
    sans-serif;
}

.container {
  max-width: 1100px;
  margin: auto;
  padding: 25px 16px 60px;
}

h1 {
  margin-bottom: 5px;
}

.subtitle {
  color: #9ca7b3;
  margin-bottom: 25px;
}

.card {
  background: #111821;
  border: 1px solid #27313d;
  border-radius: 14px;
  padding: 18px;
  margin-bottom: 16px;
}

input {
  width: 100%;
  padding: 14px;
  background: #0b0f14;
  color: white;
  border: 1px solid #34404e;
  border-radius: 9px;
  font-size: 16px;
}

button {
  margin-top: 12px;
  padding: 13px 20px;
  border: 0;
  border-radius: 9px;
  background: #ffffff;
  color: #111111;
  font-weight: bold;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: wait;
}

.stats {
  display: grid;
  grid-template-columns:
    repeat(auto-fit,minmax(130px,1fr));
  gap: 10px;
}

.stat {
  background: #0b0f14;
  border: 1px solid #27313d;
  border-radius: 10px;
  padding: 15px;
}

.stat b {
  display: block;
  font-size: 25px;
  margin-bottom: 5px;
}

.stat span {
  color: #9ca7b3;
  font-size: 13px;
}

.page {
  border-top: 1px solid #27313d;
  padding: 18px 0;
}

.page:first-child {
  border-top: 0;
}

.url {
  word-break: break-all;
  color: #8fb8ff;
}

.badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 5px;
  background: #202b38;
  font-size: 12px;
  margin:
    4px 4px 8px 0;
}

.error {
  border-left:
    3px solid #ff6b6b;
  padding: 10px;
  margin: 8px 0;
  background: #171d25;
}

.aierror {
  border-left:
    3px solid #f0b84b;
  padding: 10px;
  margin: 8px 0;
  background: #171d25;
}

.original {
  font-weight: bold;
}

.correction {
  margin-top: 4px;
}

.reason {
  color: #9ca7b3;
  font-size: 13px;
  margin-top: 5px;
}

#message {
  margin-top: 12px;
  color: #9ca7b3;
  white-space: pre-wrap;
}

.success {
  color: #8fe388;
}

.warning {
  color: #f0b84b;
}

.danger {
  color: #ff8585;
}

</style>

</head>

<body>

<div class="container">

<h1>WebProof AI</h1>

<div class="subtitle">
Gerçek web taraması + kural tabanlı editörlük +
NVIDIA AI ikinci görüşü
</div>

<div class="card">

<input
  id="url"
  type="url"
  autocomplete="url"
  placeholder="https://www.ornek.com"
>

<button
  id="scanButton"
  onclick="startScan()"
>
  Siteyi Tara
</button>

<button
  id="aiButton"
  onclick="testAI()"
>
  NVIDIA AI Bağlantısını Test Et
</button>

<div id="message"></div>

</div>

<div
  id="statsCard"
  class="card"
  style="display:none"
>

<div class="stats">

<div class="stat">
<b id="pagesScanned">0</b>
<span>Taranan sayfa</span>
</div>

<div class="stat">
<b id="linksFound">0</b>
<span>Bulunan link</span>
</div>

<div class="stat">
<b id="articlesFound">0</b>
<span>Bulunan haber</span>
</div>

<div class="stat">
<b id="totalErrors">0</b>
<span>Toplam hata</span>
</div>

<div class="stat">
<b id="aiAnalyzed">0</b>
<span>AI analizi</span>
</div>

</div>

</div>

<div id="results"></div>

</div>

<script>

async function startScan() {

  const input =
    document.getElementById("url");

  const button =
    document.getElementById(
      "scanButton"
    );

  const message =
    document.getElementById(
      "message"
    );

  const results =
    document.getElementById(
      "results"
    );

  const statsCard =
    document.getElementById(
      "statsCard"
    );

  const targetUrl =
    input.value.trim();

  if (!targetUrl) {
    message.textContent =
      "Lütfen bir internet sitesi adresi gir.";

    return;
  }

  button.disabled = true;

  button.textContent =
    "Tarama yapılıyor...";

  message.textContent =
    "Site taranıyor. Sayfalar ve haberler analiz ediliyor...";

  results.innerHTML = "";

  statsCard.style.display =
    "none";

  try {

    const response =
      await fetch(
        "/api/scan",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              url: targetUrl
            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        "Tarama sırasında bilinmeyen bir hata oluştu."
      );
    }

    renderStats(data);

    renderPages(
      data.pages || []
    );

    message.textContent =
      "Tarama tamamlandı.";

    message.className =
      "success";

  } catch (error) {

    console.error(error);

    message.textContent =
      "Hata: " +
      String(
        error.message ||
        error
      );

    message.className =
      "danger";

  } finally {

    button.disabled =
      false;

    button.textContent =
      "Siteyi Tara";
  }
}


async function testAI() {

  const button =
    document.getElementById(
      "aiButton"
    );

  const message =
    document.getElementById(
      "message"
    );

  button.disabled =
    true;

  button.textContent =
    "NVIDIA test ediliyor...";

  message.textContent =
    "Cloudflare Worker üzerinden NVIDIA API bağlantısı test ediliyor...";

  message.className =
    "";

  try {

    const response =
      await fetch(
        "/api/ai-test"
      );

    const data =
      await response.json();

    if (
      data.ok &&
      data.ai === "connected"
    ) {

      message.textContent =
        "✓ NVIDIA AI bağlantısı başarılı. Model: " +
        data.model;

      message.className =
        "success";

    } else {

      message.textContent =
        "NVIDIA AI bağlantı hatası: " +
        (
          data.error ||
          "Bilinmeyen hata"
        );

      message.className =
        "danger";
    }

  } catch (error) {

    message.textContent =
      "AI test hatası: " +
      String(
        error.message ||
        error
      );

    message.className =
      "danger";

  } finally {

    button.disabled =
      false;

    button.textContent =
      "NVIDIA AI Bağlantısını Test Et";
  }
}


function renderStats(data) {

  document.getElementById(
    "pagesScanned"
  ).textContent =
    data.pagesScanned || 0;

  document.getElementById(
    "linksFound"
  ).textContent =
    data.linksFound || 0;

  document.getElementById(
    "articlesFound"
  ).textContent =
    data.articlesFound || 0;

  document.getElementById(
    "totalErrors"
  ).textContent =
    data.totalErrors || 0;

  document.getElementById(
    "aiAnalyzed"
  ).textContent =
    data.aiAnalyzed || 0;

  document.getElementById(
    "statsCard"
  ).style.display =
    "block";
}


function renderPages(
  pages
) {

  const container =
    document.getElementById(
      "results"
    );

  container.innerHTML = "";

  if (!pages.length) {

    container.innerHTML =
      '<div class="card">Tarama sonucunda sayfa bulunamadı.</div>';

    return;
  }

  for (
    const page of pages
  ) {

    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.className =
      "card page";

    let html = "";

    html +=
      "<div>" +
      '<span class="badge">' +
      escapeHTML(
        page.type || "page"
      ) +
      "</span>";

    if (
      page.status !== null
    ) {
      html +=
        '<span class="badge">HTTP ' +
        escapeHTML(
          page.status
        ) +
        "</span>";
    }

    html +=
      "</div>";

    html +=
      "<h3>" +
      escapeHTML(
        page.title ||
        "(Başlık yok)"
      ) +
      "</h3>";

    html +=
      '<div class="url">' +
      escapeHTML(
        page.url || ""
      ) +
      "</div>";

    if (
      page.aiStatus ===
      "connected"
    ) {

      html +=
        '<div class="badge">NVIDIA AI: bağlı</div>';

    } else if (
      page.aiStatus ===
      "missing-api-key"
    ) {

      html +=
        '<div class="badge">NVIDIA AI: API anahtarı yok</div>';

    } else if (
      page.aiStatus ===
      "error"
    ) {

      html +=
        '<div class="badge">NVIDIA AI: hata</div>';
    }


    if (
      page.errors &&
      page.errors.length
    ) {

      html +=
        "<h4>Kural tabanlı bulgular</h4>";

      for (
        const error of page.errors
      ) {

        html +=
          '<div class="error">' +

          '<div class="original">' +
          escapeHTML(
            error.original
          ) +
          "</div>" +

          '<div class="correction">→ ' +
          escapeHTML(
            error.correction
          ) +
          "</div>" +

          '<div class="reason">' +
          escapeHTML(
            error.reason || ""
          ) +
          "</div>" +

          "</div>";
      }
    }


    const realAiErrors =
      (
        page.aiErrors || []
      ).filter(
        error =>
          error &&
          error.original &&
          error.correction
      );

    if (
      realAiErrors.length
    ) {

      html +=
        "<h4>NVIDIA AI bulguları</h4>";

      for (
        const error of realAiErrors
      ) {

        const confidence =
          Number(
            error.confidence || 0
          );

        html +=
          '<div class="aierror">' +

          '<div class="original">' +
          escapeHTML(
            error.original
          ) +
          "</div>" +

          '<div class="correction">→ ' +
          escapeHTML(
            error.correction
          ) +
          "</div>" +

          '<div class="reason">' +
          escapeHTML(
            error.reason || ""
          ) +
          "</div>" +

          '<div class="reason">Güven: ' +
          Math.round(
            confidence * 100
          ) +
          "%</div>" +

          "</div>";
      }
    }


    if (
      page.suspicious &&
      page.suspicious.length
    ) {

      html +=
        "<h4>Şüpheli kullanımlar</h4>";

      for (
        const item of page.suspicious
      ) {

        html +=
          '<div class="error">' +

          '<div class="original">' +
          escapeHTML(
            item.original
          ) +
          "</div>" +

          '<div class="correction">→ ' +
          escapeHTML(
            item.correction
          ) +
          "</div>" +

          '<div class="reason">' +
          escapeHTML(
            item.reason || ""
          ) +
          "</div>" +

          "</div>";
      }
    }


    if (
      (!page.errors ||
        page.errors.length === 0) &&
      realAiErrors.length === 0 &&
      (!page.suspicious ||
        page.suspicious.length === 0)
    ) {

      html +=
        '<div class="reason">' +
        "Bu sayfada raporlanabilir hata bulunmadı." +
        "</div>";
    }

    wrapper.innerHTML =
      html;

    container.appendChild(
      wrapper
    );
  }
}


function escapeHTML(
  value
) {

  return String(
    value ?? ""
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

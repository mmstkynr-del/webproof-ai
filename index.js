const MAX_PAGES = 10;
const MAX_ARTICLES_FOR_AI = 5;
const MAX_LINKS = 500;
const MAX_TEXT_FOR_AI = 14000;

const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const temporaryTasks = [];

/* =========================================================
   MAIN WORKER
========================================================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/status" && request.method === "GET") {
        const hasNvidiaKey = Boolean(env.NVIDIA_API_KEY);

        return json({
          ok: true,
          service: "WebProof AI",
          status: "online",
          crawler: "real-web-crawler",
          ruleEngine: "advanced",
          ai: hasNvidiaKey ? "connected" : "missing-api-key",
          model: NVIDIA_MODEL,
          taskEngine: "enabled",
          storage: "temporary-memory",
          secretTest: {
            exists: hasNvidiaKey,
            type: typeof env.NVIDIA_API_KEY,
            length: hasNvidiaKey
              ? String(env.NVIDIA_API_KEY).length
              : 0
          }
        });
      }

      if (
        url.pathname === "/api/ai-test" &&
        request.method === "GET"
      ) {
        if (!env.NVIDIA_API_KEY) {
          return json(
            {
              ok: false,
              error:
                "NVIDIA_API_KEY Cloudflare Worker runtime'ında bulunamadı."
            },
            500
          );
        }

        const result = await analyzeWithNvidia(
          "WebProof AI bağlantı testi",
          "Bu bir bağlantı testidir. Türkçe yazım, noktalama ve dilbilgisi kontrolü yap.",
          {
            errors: [],
            suspicious: []
          },
          env
        );

        return json({
          ok: true,
          message: "NVIDIA AI bağlantısı başarılı.",
          model: NVIDIA_MODEL,
          result
        });
      }

      if (
        url.pathname === "/api/scan" &&
        request.method === "POST"
      ) {
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
          env
        );

        return json(result);
      }

      if (
        url.pathname === "/api/tasks" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          tasks: temporaryTasks
        });
      }

      if (
        url.pathname === "/api/tasks" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        const task = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          url: body.url || "",
          command: body.command || "",
          status: "active"
        };

        temporaryTasks.push(task);

        return json({
          ok: true,
          task
        });
      }

      if (
        url.pathname === "/api/tasks" &&
        request.method === "DELETE"
      ) {
        temporaryTasks.length = 0;

        return json({
          ok: true,
          tasks: []
        });
      }

      if (url.pathname === "/" && request.method === "GET") {
        return new Response(frontendHTML(), {
          headers: {
            "content-type": "text/html; charset=UTF-8"
          }
        });
      }

      return json(
        {
          ok: false,
          error: "Endpoint bulunamadı."
        },
        404
      );
    } catch (error) {
      return json(
        {
          ok: false,
          error:
            error?.message ||
            "Beklenmeyen Worker hatası."
        },
        500
      );
    }
  }
};

/* =========================================================
   WEBSITE SCANNER
========================================================= */

async function scanWebsite(inputUrl, env) {
  const start = normalizeUrl(inputUrl);

  if (!start) {
    throw new Error("Geçerli bir HTTP/HTTPS URL girin.");
  }

  const hostname = new URL(start).hostname;

  const visited = new Set();
  const queued = new Set([start]);

  let queue = [
    {
      url: start,
      priority: 100
    }
  ];

  const pages = [];
  const discoveredLinks = new Set();

  const articleCandidates = [];

  let pagesScanned = 0;

  while (
    queue.length > 0 &&
    pagesScanned < MAX_PAGES
  ) {
    queue.sort(
      (a, b) => b.priority - a.priority
    );

    const current = queue.shift();

    if (!current || visited.has(current.url)) {
      continue;
    }

    visited.add(current.url);

    let page;

    try {
      page = await fetchPage(current.url);
    } catch (error) {
      pages.push({
        url: current.url,
        title: "",
        status: 0,
        error: error?.message || "Sayfa alınamadı.",
        isArticle: false,
        errors: [],
        suspicious: [],
        aiErrors: []
      });

      continue;
    }

    pagesScanned++;

    const html = page.html;

    const title = extractTitle(html);

    const language = detectLanguage(html, title);

    const text = extractMainText(html);

    const links = extractLinks(
      html,
      current.url,
      hostname
    );

    for (const link of links) {
      discoveredLinks.add(link);
    }

    const articleScore = scoreArticleUrl(
      current.url,
      title,
      text,
      html
    );

    const isArticle = isLikelyArticle(
      current.url,
      title,
      text,
      html,
      articleScore
    );

    const ruleAnalysis =
      text.length > 100
        ? ruleBasedProofread(
            text,
            language
          )
        : {
            errors: [],
            suspicious: []
          };

    const pageResult = {
      url: current.url,
      title:
        title ||
        current.url,
      status: page.status,
      language,
      isArticle,
      articleScore,
      textLength: text.length,
      errors: ruleAnalysis.errors,
      suspicious: ruleAnalysis.suspicious,
      aiErrors: [],
      aiAnalyzed: false,
      error: null
    };

    pages.push(pageResult);

    if (
      isArticle &&
      text.length >= 500
    ) {
      articleCandidates.push({
        url: current.url,
        title:
          title ||
          current.url,
        text,
        html,
        language,
        articleScore,
        pageIndex: pages.length - 1
      });
    }

    /*
      Yeni linkleri sıraya koy.

      Gerçek haber linklerine yüksek öncelik veriyoruz.
      Böylece crawler ilk 10 sayfada sadece:
      /galeri
      /video
      /yazarlar
      gibi sayfalara takılmıyor.
    */

    for (const link of links) {
      if (
        visited.has(link) ||
        queued.has(link)
      ) {
        continue;
      }

      if (
        visited.size +
          queue.length >=
        MAX_LINKS
      ) {
        break;
      }

      const linkScore =
        scoreArticleUrl(
          link,
          "",
          "",
          ""
        );

      queue.push({
        url: link,
        priority:
          linkScore +
          (link === start ? 100 : 0)
      });

      queued.add(link);
    }
  }

  /*
    Aynı haberin farklı linklerle
    tekrar kontrol edilmesini engelle.
  */

  const uniqueArticles =
    dedupeArticles(
      articleCandidates
    );

  /*
    En güçlü gerçek haber adaylarını seç.
  */

  uniqueArticles.sort(
    (a, b) =>
      b.articleScore -
      a.articleScore
  );

  const selectedArticles =
    uniqueArticles.slice(
      0,
      MAX_ARTICLES_FOR_AI
    );

  /*
    AI analizi.

    Kural motoru zaten çalıştı.
    NVIDIA ikinci görüş olarak devreye giriyor.
  */

  if (env.NVIDIA_API_KEY) {
    for (const article of selectedArticles) {
      try {
        const aiResult =
          await analyzeWithNvidia(
            article.title,
            article.text,
            ruleBasedProofread(
              article.text,
              article.language
            ),
            env
          );

        const page =
          pages[article.pageIndex];

        page.aiAnalyzed = true;
        page.aiErrors =
          aiResult.errors || [];

        /*
          Nihai hata listesi:
          Kural motoru + AI.
        */

        page.errors =
          mergeErrors(
            page.errors,
            page.aiErrors
          );

        page.suspicious =
          mergeSuspicious(
            page.suspicious,
            aiResult.suspicious || []
          );
      } catch (error) {
        const page =
          pages[article.pageIndex];

        page.aiAnalyzed = false;

        page.aiError =
          error?.message ||
          "NVIDIA AI analizi başarısız.";
      }
    }
  }

  /*
    Sonuçları yeniden düzenle.
  */

  const totalRuleErrors =
    pages.reduce(
      (sum, page) =>
        sum +
        (page.errors?.length || 0),
      0
    );

  const totalAiErrors =
    pages.reduce(
      (sum, page) =>
        sum +
        (page.aiErrors?.length || 0),
      0
    );

  const articlesFound =
    pages.filter(
      page => page.isArticle
    ).length;

  return {
    ok: true,

    scannedUrl: start,

    summary: {
      pagesScanned,
      linksFound:
        discoveredLinks.size,
      articlesFound,
      totalErrors:
        totalRuleErrors,
      aiErrors:
        totalAiErrors,
      aiAnalyzed:
        pages.filter(
          page =>
            page.aiAnalyzed
        ).length
    },

    standards: {
      mode:
        "precision-first-editorial-QA",
      languageDetection:
        "enabled",
      contextAwareAI:
        Boolean(env.NVIDIA_API_KEY),
      preserveProperNames:
        true,
      preserveUrls:
        true,
      preserveNumbers:
        true,
      falsePositiveProtection:
        "high"
    },

    pages
  };
}

/* =========================================================
   FETCH
========================================================= */

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      15000
    );

  try {
    const response =
      await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; WebProofAI/1.0; +https://webproof-ai)"
        }
      });

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes(
        "text/html"
      )
    ) {
      throw new Error(
        "HTML olmayan içerik."
      );
    }

    const html =
      await response.text();

    return {
      status: response.status,
      html
    };
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   URL SECURITY / NORMALIZATION
========================================================= */

function normalizeUrl(value) {
  try {
    const url =
      new URL(value);

    if (
      url.protocol !==
        "http:" &&
      url.protocol !==
        "https:"
    ) {
      return null;
    }

    if (
      isPrivateHostname(
        url.hostname
      )
    ) {
      return null;
    }

    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid"
    ];

    for (const key of trackingParams) {
      url.searchParams.delete(key);
    }

    url.hash = "";

    return url.toString();
  } catch {
    return null;
  }
}

function isPrivateHostname(
  hostname
) {
  const h =
    hostname.toLowerCase();

  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(
      ".localhost"
    )
  ) {
    return true;
  }

  if (
    h.startsWith(
      "10."
    ) ||
    h.startsWith(
      "192.168."
    ) ||
    h.startsWith(
      "172.16."
    ) ||
    h.startsWith(
      "172.17."
    ) ||
    h.startsWith(
      "172.18."
    ) ||
    h.startsWith(
      "172.19."
    ) ||
    h.startsWith(
      "172.20."
    ) ||
    h.startsWith(
      "172.21."
    ) ||
    h.startsWith(
      "172.22."
    ) ||
    h.startsWith(
      "172.23."
    ) ||
    h.startsWith(
      "172.24."
    ) ||
    h.startsWith(
      "172.25."
    ) ||
    h.startsWith(
      "172.26."
    ) ||
    h.startsWith(
      "172.27."
    ) ||
    h.startsWith(
      "172.28."
    ) ||
    h.startsWith(
      "172.29."
    ) ||
    h.startsWith(
      "172.30."
    ) ||
    h.startsWith(
      "172.31."
    )
  ) {
    return true;
  }

  if (
    h ===
      "169.254.169.254"
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   TITLE
========================================================= */

function extractTitle(html) {
  const og =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i
    );

  if (og?.[1]) {
    return cleanText(
      decodeHtmlEntities(
        og[1]
      )
    );
  }

  const title =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  if (title?.[1]) {
    return cleanText(
      decodeHtmlEntities(
        title[1]
      )
    );
  }

  const h1 =
    html.match(
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    );

  if (h1?.[1]) {
    return cleanText(
      stripTags(
        h1[1]
      )
    );
  }

  return "";
}

/* =========================================================
   MAIN TEXT EXTRACTION
========================================================= */

function extractMainText(html) {
  let working =
    html;

  working =
    working.replace(
      /<(script|style|noscript|svg|canvas|template|iframe|nav|footer|header|aside|form|button|select|option)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );

  const articleMatches =
    working.match(
      /<article\b[^>]*>[\s\S]*?<\/article>/gi
    );

  if (
    articleMatches &&
    articleMatches.length
  ) {
    const articleText =
      articleMatches
        .map(
          part =>
            stripTags(
              part
            )
        )
        .join("\n");

    const cleaned =
      cleanText(
        decodeHtmlEntities(
          articleText
        )
      );

    if (
      cleaned.length >= 500
    ) {
      return limitText(
        cleaned,
        30000
      );
    }
  }

  const mainMatches =
    working.match(
      /<main\b[^>]*>[\s\S]*?<\/main>/gi
    );

  if (
    mainMatches &&
    mainMatches.length
  ) {
    const mainText =
      mainMatches
        .map(
          part =>
            stripTags(
              part
            )
        )
        .join("\n");

    const cleaned =
      cleanText(
        decodeHtmlEntities(
          mainText
        )
      );

    if (
      cleaned.length >= 500
    ) {
      return limitText(
        cleaned,
        30000
      );
    }
  }

  const paragraphs = [];

  const matches =
    working.matchAll(
      /<p\b[^>]*>([\s\S]*?)<\/p>/gi
    );

  for (
    const match of matches
  ) {
    const text =
      cleanText(
        decodeHtmlEntities(
          stripTags(
            match[1]
          )
        )
      );

    if (
      text.length >= 35
    ) {
      paragraphs.push(
        text
      );
    }
  }

  return limitText(
    paragraphs.join(
      "\n"
    ),
    30000
  );
}

/* =========================================================
   LINK EXTRACTION
========================================================= */

function extractLinks(
  html,
  baseUrl,
  hostname
) {
  const result =
    new Set();

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  for (
    const match of html.matchAll(
      regex
    )
  ) {
    const raw =
      decodeHtmlEntities(
        match[1]
      ).trim();

    if (
      !raw ||
      raw.startsWith(
        "#"
      ) ||
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

    try {
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
        absolute.hostname !==
        hostname
      ) {
        continue;
      }

      const normalized =
        normalizeUrl(
          absolute.toString()
        );

      if (
        normalized
      ) {
        result.add(
          normalized
        );
      }

      if (
        result.size >=
        MAX_LINKS
      ) {
        break;
      }
    } catch {
      continue;
    }
  }

  return [
    ...result
  ];
}

/* =========================================================
   ARTICLE DETECTION
========================================================= */

function scoreArticleUrl(
  url,
  title = "",
  text = "",
  html = ""
) {
  let score = 0;

  const lower =
    url.toLowerCase();

  const path =
    (() => {
      try {
        return new URL(
          url
        ).pathname.toLowerCase();
      } catch {
        return lower;
      }
    })();

  const excludedSections = [
    "/galeri",
    "/galeriler",
    "/video",
    "/videolar",
    "/yazarlar",
    "/yazar/",
    "/etiket/",
    "/tag/",
    "/kategori/",
    "/category/",
    "/arama",
    "/search",
    "/iletisim",
    "/iletisim/",
    "/hakkimizda",
    "/kunye",
    "/rss"
  ];

  for (
    const section of excludedSections
  ) {
    if (
      path === section ||
      path.startsWith(
        section + "/"
      )
    ) {
      score -= 60;
    }
  }

  const strongSignals = [
    "/haber/",
    "/haberler/",
    "/news/",
    "/article/",
    "/articles/",
    "/story/",
    "/gundem/",
    "/siyaset/",
    "/ekonomi/",
    "/spor/",
    "/dunya/",
    "/yasam/",
    "/guncel/"
  ];

  for (
    const signal of strongSignals
  ) {
    if (
      path.includes(
        signal
      )
    ) {
      score += 35;
    }
  }

  /*
    Tarih içeren URL'ler
  */

  if (
    /\/20\d{2}\/\d{1,2}\/\d{1,2}\//.test(
      path
    ) ||
    /\/20\d{2}-\d{1,2}-\d{1,2}/.test(
      path
    )
  ) {
    score += 40;
  }

  /*
    Haber sitelerinde uzun slug güçlü bir sinyaldir.
  */

  const segments =
    path
      .split("/")
      .filter(Boolean);

  const last =
    segments[
      segments.length - 1
    ] || "";

  const hyphenCount =
    (
      last.match(
        /-/g
      ) || []
    ).length;

  if (
    hyphenCount >= 2
  ) {
    score += 25;
  }

  if (
    last.length >= 35
  ) {
    score += 20;
  }

  if (
    last.length >= 60
  ) {
    score += 15;
  }

  /*
    Başlık varsa güçlü bir başlık sinyali.
  */

  if (
    title &&
    title.length >= 25 &&
    title.length <= 250
  ) {
    score += 15;
  }

  /*
    Metin uzunluğu.
  */

  if (
    text &&
    text.length >= 800
  ) {
    score += 20;
  }

  if (
    text &&
    text.length >= 1800
  ) {
    score += 20;
  }

  /*
    Article HTML sinyalleri.
  */

  if (
    html &&
    /<article\b/i.test(
      html
    )
  ) {
    score += 30;
  }

  if (
    html &&
    /<time\b/i.test(
      html
    )
  ) {
    score += 10;
  }

  return score;
}

function isLikelyArticle(
  url,
  title,
  text,
  html,
  score
) {
  const path =
    (() => {
      try {
        return new URL(
          url
        ).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();

  const sectionPages = [
    "/",
    "/galeri",
    "/video",
    "/yazarlar",
    "/guncel",
    "/siyaset",
    "/ekonomi",
    "/spor",
    "/dunya",
    "/yasam",
    "/kategori",
    "/category",
    "/arama",
    "/search"
  ];

  if (
    sectionPages.includes(
      path.replace(
        /\/$/,
        ""
      )
    )
  ) {
    return false;
  }

  if (
    text.length < 500
  ) {
    return false;
  }

  /*
    Güçlü haber sinyali varsa kabul.
  */

  if (
    score >= 60
  ) {
    return true;
  }

  /*
    Uzun ve makale benzeri sayfa.
  */

  const paragraphCount =
    (
      html.match(
        /<p\b/gi
      ) || []
    ).length;

  if (
    score >= 35 &&
    text.length >= 1200 &&
    paragraphCount >= 5
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   LANGUAGE DETECTION
========================================================= */

function detectLanguage(
  html,
  title
) {
  const lang =
    html.match(
      /<html[^>]+lang=["']([^"']+)["']/i
    );

  if (
    lang?.[1]
  ) {
    const value =
      lang[1]
        .toLowerCase();

    if (
      value.startsWith(
        "tr"
      )
    ) {
      return "tr";
    }

    if (
      value.startsWith(
        "en"
      )
    ) {
      return "en";
    }
  }

  const sample =
    `${title} ${extractVisibleSample(
      html
    )}`.toLowerCase();

  const turkishChars =
    (
      sample.match(
        /[çğıöşü]/g
      ) || []
    ).length;

  const turkishWords =
    [
      " ve ",
      " bir ",
      " için ",
      " olan ",
      " ile ",
      " bu ",
      " şu ",
      " daha ",
      " haber ",
      " açıklama ",
      " gündem "
    ].filter(
      word =>
        sample.includes(
          word
        )
    ).length;

  if (
    turkishChars >= 3 ||
    turkishWords >= 2
  ) {
    return "tr";
  }

  return "en";
}

function extractVisibleSample(
  html
) {
  return cleanText(
    stripTags(
      html
        .replace(
          /<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi,
          " "
        )
    )
  ).slice(
    0,
    5000
  );
}

/* =========================================================
   RULE-BASED PROOFREADING
========================================================= */

function ruleBasedProofread(
  text,
  language = "tr"
) {
  const errors = [];
  const suspicious = [];

  const addError = (
    original,
    correction,
    type,
    reason,
    confidence = 0.99
  ) => {
    if (
      !original ||
      original ===
        correction
    ) {
      return;
    }

    if (
      errors.some(
        item =>
          item.original ===
            original &&
          item.correction ===
            correction
      )
    ) {
      return;
    }

    errors.push({
      original,
      correction,
      type,
      confidence,
      reason,
      source: "rule-engine"
    });
  };

  const addSuspicious = (
    original,
    reason
  ) => {
    if (
      !original ||
      suspicious.some(
        item =>
          item.original ===
          original
      )
    ) {
      return;
    }

    suspicious.push({
      original,
      reason,
      source: "rule-engine"
    });
  };

  /*
    1. Çift boşluk
  */

  const doubleSpace =
    text.match(
      /[^\n ] {2,}[^\n ]/
    );

  if (
    doubleSpace
  ) {
    const original =
      doubleSpace[0];

    const correction =
      original.replace(
        / {2,}/g,
        " "
      );

    addError(
      original,
      correction,
      "noktalama",
      "İki kelime arasında gereksiz birden fazla boşluk bulunuyor."
    );
  }

  /*
    2. Noktalama işaretinden önce boşluk
  */

  const beforePunctuation =
    /([A-Za-zÇĞİÖŞÜçğıöşü0-9])\s+([,.!?;:])/g;

  for (
    const match of text.matchAll(
      beforePunctuation
    )
  ) {
    const original =
      match[0];

    if (
      looksLikeUrlContext(
        text,
        match.index
      )
    ) {
      continue;
    }

    addError(
      original,
      `${match[1]}${match[2]}`,
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk bulunuyor."
    );

    if (
      errors.length >=
      30
    ) {
      break;
    }
  }

  /*
    3. Tekrarlanan noktalama
  */

  const repeated =
    /([!?;,])\1+|\.{4,}/g;

  for (
    const match of text.matchAll(
      repeated
    )
  ) {
    const original =
      match[0];

    if (
      original ===
      "..."
    ) {
      continue;
    }

    if (
      looksLikeUrlContext(
        text,
        match.index
      )
    ) {
      continue;
    }

    addError(
      original,
      original[0],
      "noktalama",
      "Aynı noktalama işareti gereğinden fazla tekrar edilmiş."
    );
  }

  /*
    4. Noktalama sonrasında eksik boşluk
  */

  const missingSpace =
    /([.!?;:])([A-Za-zÇĞİÖŞÜçğıöşü])/g;

  for (
    const match of text.matchAll(
      missingSpace
    )
  ) {
    if (
      looksLikeUrlContext(
        text,
        match.index
      )
    ) {
      continue;
    }

    addError(
      match[0],
      `${match[1]} ${match[2]}`,
      "noktalama",
      "Noktalama işaretinden sonra kelime ile arasında boşluk bulunması gerekiyor."
    );
  }

  /*
    5. Türkçe kesin/kuvvetli birleşik yazım hataları
  */

  if (
    language === "tr"
  ) {
    const replacements = [
      [
        /\bbir çok\b/gi,
        "birçok",
        "yazım",
        "Bu kullanımda 'birçok' bitişik yazılır."
      ],
      [
        /\bhiç bir\b/gi,
        "hiçbir",
        "yazım",
        "Bu kullanımda 'hiçbir' bitişik yazılır."
      ],
      [
        /\bher hangi\b/gi,
        "herhangi",
        "yazım",
        "Bu kullanımda 'herhangi' bitişik yazılır."
      ],
      [
        /\bşuan\b/gi,
        "şu an",
        "yazım",
        "'Şu an' ayrı yazılır."
      ],
      [
        /\byalnış\b/gi,
        "yanlış",
        "yazım",
        "Kelimenin doğru yazımı 'yanlış'tır."
      ],
      [
        /\byanlız\b/gi,
        "yalnız",
        "yazım",
        "Kelimenin doğru yazımı 'yalnız'dır."
      ],
      [
        /\bherkez\b/gi,
        "herkes",
        "yazım",
        "Kelimenin doğru yazımı 'herkes'tir."
      ],
      [
        /\bbirşey\b/gi,
        "bir şey",
        "yazım",
        "'Bir şey' ayrı yazılır."
      ],
      [
        /\bhiçbirşey\b/gi,
        "hiçbir şey",
        "yazım",
        "'Hiçbir şey' ayrı yazılır."
      ],
      [
        /\bpekçok\b/gi,
        "pek çok",
        "yazım",
        "'Pek çok' ayrı yazılır."
      ],
      [
        /\bbugün ki\b/gi,
        "bugünkü",
        "yazım",
        "'Bugünkü' bitişik yazılır."
      ],
      [
        /\bdünkü\b/gi,
        "dünkü",
        "yazım",
        "Kelime doğruysa değişiklik yapılmaz; bağlam ayrıca değerlendirilmelidir."
      ]
    ];

    for (
      const [
        regex,
        correction,
        type,
        reason
      ] of replacements
    ) {
      for (
        const match of text.matchAll(
          regex
        )
      ) {
        /*
          'dünkü' örneğinde değişiklik yok.
        */

        if (
          match[0].toLowerCase() ===
          correction.toLowerCase()
        ) {
          continue;
        }

        addError(
          match[0],
          preserveCase(
            match[0],
            correction
          ),
          type,
          reason
        );
      }
    }
  }

  /*
    İngilizce temel mekanik kontroller.
  */

  if (
    language === "en"
  ) {
    const english =
      [
        [
          /\ba lotof\b/gi,
          "a lot of",
          "spelling",
          "The words should be separated."
        ],
        [
          /\balot\b/gi,
          "a lot",
          "spelling",
          "The standard spelling is 'a lot'."
        ]
      ];

    for (
      const [
        regex,
        correction,
        type,
        reason
      ] of english
    ) {
      for (
        const match of text.matchAll(
          regex
        )
      ) {
        addError(
          match[0],
          preserveCase(
            match[0],
            correction
          ),
          type,
          reason
        );
      }
    }
  }

  /*
    Çok şüpheli ama otomatik düzeltmeye uygun
    olmayan durumları AI'ya bırak.
  */

  const suspiciousPatterns = [
    /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b/g,
    /\b[A-ZÇĞİÖŞÜ]{2,}\b/g
  ];

  for (
    const regex of suspiciousPatterns
  ) {
    for (
      const match of text.matchAll(
        regex
      )
    ) {
      if (
        match[0].length <=
        3
      ) {
        continue;
      }

      addSuspicious(
        match[0],
        "Bağlama göre kontrol edilmesi gereken sayı, kısaltma veya büyük harfli ifade."
      );
    }
  }

  return {
    errors:
      errors.slice(
        0,
        30
      ),
    suspicious:
      suspicious.slice(
        0,
        30
      )
  };
}

/* =========================================================
   NVIDIA AI
========================================================= */

async function analyzeWithNvidia(
  title,
  text,
  ruleAnalysis,
  env
) {
  if (
    !env.NVIDIA_API_KEY
  ) {
    throw new Error(
      "NVIDIA_API_KEY Cloudflare Worker runtime'ında bulunamadı."
    );
  }

  const language =
    detectTextLanguage(
      text
    );

  const prompt = `
You are WebProof AI, a professional editorial proofreading engine.

Your job is NOT to rewrite the article.

Your job is to identify only genuine language errors.

LANGUAGE:
${language}

TITLE:
${title || "(no title)"}

TEXT:
${limitText(
  text,
  MAX_TEXT_FOR_AI
)}

RULE-BASED FINDINGS:
${JSON.stringify(
  ruleAnalysis,
  null,
  2
)}

EDITORIAL QUALITY POLICY:

1. Report only errors that are objectively wrong or highly likely to be wrong.
2. Prefer precision over recall. False positives are worse than missed stylistic preferences.
3. Do not report style preferences as errors.
4. Do not rewrite sentences merely because another wording sounds better.
5. Preserve proper names, organizations, locations, brands, usernames and titles.
6. Preserve URLs, e-mail addresses and technical strings.
7. Preserve numbers, dates, currencies and percentages unless there is a genuine formatting/language error.
8. Do not change quotations because you personally prefer another wording.
9. Do not change political terminology merely because of preference.
10. Do not invent facts.
11. Do not assume a word is wrong merely because it is uncommon.
12. Turkish names and foreign names must not be "corrected" without strong evidence.
13. Check punctuation in context.
14. Check spelling in context.
15. Check grammar in context.
16. Check capitalization only when there is a clear grammatical/editorial error.
17. Check spacing and repeated punctuation.
18. For Turkish, pay particular attention to:
    - ayrı/bitişik yazımlar
    - de/da
    - ki
    - mi/mı/mu/mü
    - büyük harf kullanımı
    - sayı ve tarih yazımı
    - özel isimlere gelen ekler
    - noktalama
19. For English, pay attention to:
    - spelling
    - punctuation
    - grammar
    - subject-verb agreement
    - articles
    - prepositions
    - capitalization
    - spacing
20. If uncertain, DO NOT report the item.
21. Confidence must reflect real certainty.
22. Only return confidence >= 0.85.
23. The original field must contain the exact text from the article.
24. The correction field must contain only the corrected form, not an explanation.
25. reason must be concise and editorially useful.

Return ONLY valid JSON.

Required JSON structure:

{
  "errors": [
    {
      "original": "...",
      "correction": "...",
      "type": "yazım|noktalama|dilbilgisi|sayı|büyük-harf|diğer",
      "confidence": 0.0,
      "reason": "..."
    }
  ],
  "suspicious": [
    {
      "original": "...",
      "reason": "..."
    }
  ]
}

If there are no genuine errors, return:

{
  "errors": [],
  "suspicious": []
}
`;

  const response =
    await fetch(
      NVIDIA_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Authorization":
            `Bearer ${env.NVIDIA_API_KEY}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          model:
            NVIDIA_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are a conservative professional copy editor. Return only valid JSON."
            },
            {
              role: "user",
              content:
                prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 3000
        })
      }
    );

  const raw =
    await response.text();

  if (
    !response.ok
  ) {
    throw new Error(
      `NVIDIA API ${response.status}: ${limitText(
        raw,
        500
      )}`
    );
  }

  const data =
    JSON.parse(
      raw
    );

  const content =
    data?.choices?.[0]?.message?.content;

  if (
    !content
  ) {
    return {
      errors: [],
      suspicious: []
    };
  }

  const parsed =
    parseJsonSafely(
      content
    );

  const errors =
    Array.isArray(
      parsed?.errors
    )
      ? parsed.errors
      : [];

  const suspicious =
    Array.isArray(
      parsed?.suspicious
    )
      ? parsed.suspicious
      : [];

  /*
    AI sonuçlarını güvenlik filtresinden geçir.
  */

  const filteredErrors =
    errors
      .filter(
        item =>
          item &&
          typeof item.original ===
            "string" &&
          typeof item.correction ===
            "string" &&
          item.original.length > 0 &&
          item.correction.length > 0 &&
          item.original !==
            item.correction &&
          Number(
            item.confidence
          ) >= 0.85
      )
      .map(
        item => ({
          original:
            item.original.trim(),
          correction:
            item.correction.trim(),
          type:
            item.type ||
            "diğer",
          confidence:
            Number(
              item.confidence
            ),
          reason:
            item.reason ||
            "Bağlam içinde tespit edilen editoryal hata.",
          source:
            "nvidia-ai"
        })
      )
      .slice(
        0,
        50
      );

  return {
    errors:
      filteredErrors,
    suspicious:
      suspicious
        .filter(
          item =>
            item &&
            typeof item.original ===
              "string"
        )
        .slice(
          0,
          30
        )
  };
}

/* =========================================================
   JSON PARSER
========================================================= */

function parseJsonSafely(
  value
) {
  let text =
    String(value)
      .trim();

  text =
    text.replace(
      /^```json\s*/i,
      ""
    );

  text =
    text.replace(
      /^```\s*/i,
      ""
    );

  text =
    text.replace(
      /\s*```$/i,
      ""
    );

  try {
    return JSON.parse(
      text
    );
  } catch {}

  const first =
    text.indexOf(
      "{"
    );

  const last =
    text.lastIndexOf(
      "}"
    );

  if (
    first >= 0 &&
    last > first
  ) {
    try {
      return JSON.parse(
        text.slice(
          first,
          last + 1
        )
      );
    } catch {}
  }

  return {
    errors: [],
    suspicious: []
  };
}

/* =========================================================
   MERGE RESULTS
========================================================= */

function mergeErrors(
  ruleErrors,
  aiErrors
) {
  const result = [];

  for (
    const item of [
      ...(ruleErrors || []),
      ...(aiErrors || [])
    ]
  ) {
    if (
      !item ||
      !item.original
    ) {
      continue;
    }

    const duplicate =
      result.some(
        existing =>
          normalizeCompare(
            existing.original
          ) ===
            normalizeCompare(
              item.original
            ) &&
          normalizeCompare(
            existing.correction
          ) ===
            normalizeCompare(
              item.correction
            )
      );

    if (
      !duplicate
    ) {
      result.push(
        item
      );
    }
  }

  return result.slice(
    0,
    50
  );
}

function mergeSuspicious(
  first,
  second
) {
  const result = [];

  for (
    const item of [
      ...(first || []),
      ...(second || [])
    ]
  ) {
    if (
      !item ||
      !item.original
    ) {
      continue;
    }

    if (
      result.some(
        existing =>
          normalizeCompare(
            existing.original
          ) ===
          normalizeCompare(
            item.original
          )
      )
    ) {
      continue;
    }

    result.push(
      item
    );
  }

  return result.slice(
    0,
    30
  );
}

/* =========================================================
   ARTICLE DEDUPLICATION
========================================================= */

function dedupeArticles(
  articles
) {
  const map =
    new Map();

  for (
    const article of articles
  ) {
    const key =
      normalizeArticleKey(
        article.url
      );

    const existing =
      map.get(
        key
      );

    if (
      !existing ||
      article.articleScore >
        existing.articleScore
    ) {
      map.set(
        key,
        article
      );
    }
  }

  return [
    ...map.values()
  ];
}

function normalizeArticleKey(
  url
) {
  try {
    const u =
      new URL(
        url
      );

    let path =
      u.pathname
        .toLowerCase()
        .replace(
          /\/+$/,
          ""
        );

    return (
      u.hostname +
      path
    );
  } catch {
    return url;
  }
}

/* =========================================================
   TEXT HELPERS
========================================================= */

function detectTextLanguage(
  text
) {
  const lower =
    text
      .slice(
        0,
        8000
      )
      .toLowerCase();

  const trChars =
    (
      lower.match(
        /[çğıöşü]/g
      ) || []
    ).length;

  const trWords =
    [
      " ve ",
      " bir ",
      " için ",
      " olan ",
      " ile ",
      " bu ",
      " şu ",
      " daha ",
      " ancak ",
      " çünkü "
    ].filter(
      word =>
        lower.includes(
          word
        )
    ).length;

  if (
    trChars >= 3 ||
    trWords >= 3
  ) {
    return "Turkish";
  }

  return "English";
}

function looksLikeUrlContext(
  text,
  index
) {
  const start =
    Math.max(
      0,
      index - 80
    );

  const end =
    Math.min(
      text.length,
      index + 80
    );

  const context =
    text.slice(
      start,
      end
    );

  return (
    /https?:\/\//i.test(
      context
    ) ||
    /www\./i.test(
      context
    ) ||
    /@/.test(
      context
    )
  );
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
    original[0] ===
    original[0]?.toUpperCase()
  ) {
    return (
      correction.charAt(0)
        .toUpperCase() +
      correction.slice(1)
    );
  }

  return correction;
}

function normalizeCompare(
  value
) {
  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function cleanText(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n\s*\n\s*\n+/g,
      "\n\n"
    )
    .trim();
}

function stripTags(
  html
) {
  return String(
    html || ""
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
      /<\/div>/gi,
      "\n"
    )
    .replace(
      /<[^>]+>/g,
      " "
    );
}

function decodeHtmlEntities(
  value
) {
  return String(
    value || ""
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
      /&#(\d+);/g,
      (_, code) =>
        String.fromCharCode(
          Number(code)
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code) =>
        String.fromCharCode(
          parseInt(
            code,
            16
          )
        )
    );
}

function limitText(
  value,
  max
) {
  const text =
    String(
      value || ""
    );

  if (
    text.length <= max
  ) {
    return text;
  }

  return text.slice(
    0,
    max
  );
}

/* =========================================================
   FRONTEND
========================================================= */

function frontendHTML() {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebProof AI</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: #f5f7fb;
  color: #172033;
}

.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 28px 18px 60px;
}

h1 {
  margin-bottom: 6px;
}

.subtitle {
  color: #667085;
  margin-bottom: 24px;
}

.controls {
  background: white;
  padding: 18px;
  border-radius: 14px;
  box-shadow: 0 3px 15px rgba(0,0,0,.06);
}

input {
  width: 100%;
  padding: 14px;
  border: 1px solid #d0d5dd;
  border-radius: 9px;
  font-size: 16px;
  margin-bottom: 12px;
}

button {
  border: 0;
  padding: 12px 18px;
  border-radius: 9px;
  cursor: pointer;
  font-size: 15px;
  margin-right: 8px;
  margin-bottom: 8px;
}

.primary {
  background: #172033;
  color: white;
}

.secondary {
  background: #e9edf5;
  color: #172033;
}

.status {
  margin-top: 15px;
  padding: 12px;
  border-radius: 9px;
  background: #f1f5f9;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4,1fr);
  gap: 12px;
  margin: 18px 0;
}

.stat {
  background: white;
  padding: 18px;
  border-radius: 12px;
  box-shadow: 0 3px 12px rgba(0,0,0,.05);
}

.stat strong {
  display: block;
  font-size: 28px;
  margin-bottom: 5px;
}

.page {
  background: white;
  margin-top: 14px;
  padding: 18px;
  border-radius: 12px;
  box-shadow: 0 3px 12px rgba(0,0,0,.05);
}

.bad {
  background: #fff1f2;
  padding: 10px;
  border-radius: 8px;
  margin-top: 8px;
}

.good {
  color: #067647;
}

.ai {
  color: #6941c6;
}

.meta {
  color: #667085;
  font-size: 13px;
  margin: 5px 0 12px;
}

.error-item {
  padding: 10px;
  border-left: 4px solid #d92d20;
  background: #fff5f4;
  margin: 8px 0;
  border-radius: 5px;
}

.error-item b {
  display: inline-block;
  margin-right: 8px;
}

.suspicious {
  padding: 10px;
  background: #fffaeb;
  border-left: 4px solid #f79009;
  margin-top: 8px;
}

@media(max-width:700px) {
  .stats {
    grid-template-columns: repeat(2,1fr);
  }
}
</style>
</head>

<body>

<div class="container">

<h1>WebProof AI</h1>

<div class="subtitle">
Gerçek web taraması + gelişmiş editoryal kural motoru + NVIDIA AI ikinci görüşü
</div>

<div class="controls">

<input
  id="url"
  type="url"
  value="https://www.gercekgundem.com/"
  placeholder="https://www.ornek.com"
/>

<button
  class="primary"
  onclick="scan()"
>
Siteyi Tara
</button>

<button
  class="secondary"
  onclick="testAI()"
>
NVIDIA AI Bağlantısını Test Et
</button>

<div
  id="status"
  class="status"
>
Hazır.
</div>

</div>

<div
  id="stats"
  class="stats"
  style="display:none"
></div>

<div id="results"></div>

</div>

<script>

async function testAI() {
  const status =
    document.getElementById("status");

  status.innerText =
    "NVIDIA AI bağlantısı test ediliyor...";

  try {
    const response =
      await fetch("/api/ai-test");

    const data =
      await response.json();

    if (data.ok) {
      status.innerHTML =
        "✓ NVIDIA AI bağlantısı başarılı. Model: " +
        data.model;
    } else {
      status.innerHTML =
        "NVIDIA AI bağlantı hatası: " +
        (data.error || "Bilinmeyen hata");
    }
  } catch (error) {
    status.innerText =
      "Bağlantı hatası: " +
      error.message;
  }
}

async function scan() {

  const url =
    document.getElementById("url").value.trim();

  const status =
    document.getElementById("status");

  const results =
    document.getElementById("results");

  const stats =
    document.getElementById("stats");

  if (!url) {
    status.innerText =
      "Lütfen bir URL girin.";
    return;
  }

  status.innerText =
    "Gerçek web taraması başlatıldı...";

  results.innerHTML = "";
  stats.style.display = "none";

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
          body: JSON.stringify({
            url
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        "Tarama başarısız."
      );
    }

    const summary =
      data.summary || {};

    stats.innerHTML =

      stat(
        summary.pagesScanned || 0,
        "Taranan sayfa"
      ) +

      stat(
        summary.linksFound || 0,
        "Bulunan link"
      ) +

      stat(
        summary.articlesFound || 0,
        "Bulunan haber"
      ) +

      stat(
        summary.totalErrors || 0,
        "Toplam hata"
      );

    stats.style.display =
      "grid";

    status.innerHTML =
      "✓ Tarama tamamlandı. " +
      (summary.aiAnalyzed || 0) +
      " haber NVIDIA AI tarafından analiz edildi.";

    for (
      const page of data.pages || []
    ) {
      results.appendChild(
        renderPage(page)
      );
    }

  } catch (error) {

    status.innerText =
      "Tarama hatası: " +
      error.message;
  }
}

function stat(
  number,
  label
) {
  return \`
    <div class="stat">
      <strong>\${escapeHtml(number)}</strong>
      <span>\${escapeHtml(label)}</span>
    </div>
  \`;
}

function renderPage(page) {

  const div =
    document.createElement("div");

  div.className =
    "page";

  let html = "";

  html +=
    "<h3>" +
    escapeHtml(
      page.title ||
      page.url
    ) +
    "</h3>";

  html +=
    '<div class="meta">' +
    "HTTP " +
    escapeHtml(
      page.status
    ) +
    " · " +
    escapeHtml(
      page.language ||
      ""
    ) +
    " · Article score: " +
    escapeHtml(
      page.articleScore ||
      0
    );

  if (
    page.aiAnalyzed
  ) {
    html +=
      ' · <span class="ai">NVIDIA AI ✓</span>';
  }

  html +=
    "</div>";

  html +=
    '<div class="meta">' +
    escapeHtml(
      page.url
    ) +
    "</div>";

  const errors =
    page.errors || [];

  if (
    errors.length === 0
  ) {

    html +=
      '<div class="good">Bu sayfada raporlanabilir hata bulunmadı.</div>';

  } else {

    html +=
      "<strong>" +
      errors.length +
      " raporlanabilir hata</strong>";

    for (
      const error of errors
    ) {

      html +=
        '<div class="error-item">' +

        "<b>" +
        escapeHtml(
          error.original
        ) +
        "</b>" +

        " → " +

        "<b>" +
        escapeHtml(
          error.correction
        ) +
        "</b>" +

        "<br>" +

        '<span class="meta">' +
        escapeHtml(
          error.type ||
          ""
        ) +
        " · güven: " +
        Math.round(
          Number(
            error.confidence ||
            0
          ) * 100
        ) +
        "% · " +
        escapeHtml(
          error.source ||
          ""
        ) +
        "</span>" +

        "<br>" +

        escapeHtml(
          error.reason ||
          ""
        ) +

        "</div>";
    }
  }

  const suspicious =
    page.suspicious || [];

  if (
    suspicious.length
  ) {

    html +=
      '<div class="suspicious">' +
      "<strong>İncelenmesi gereken ifadeler</strong>";

    for (
      const item of suspicious.slice(
        0,
        10
      )
    ) {
      html +=
        "<div>" +
        escapeHtml(
          item.original
        ) +
        " — " +
        escapeHtml(
          item.reason
        ) +
        "</div>";
    }

    html +=
      "</div>";
  }

  if (
    page.aiError
  ) {
    html +=
      '<div class="bad">' +
      "AI analizi yapılamadı: " +
      escapeHtml(
        page.aiError
      ) +
      "</div>";
  }

  div.innerHTML =
    html;

  return div;
}

function escapeHtml(
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

/* =========================================================
   JSON RESPONSE
========================================================= */

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

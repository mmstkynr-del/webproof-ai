const MAX_DISCOVERY_PAGES = 4;
const MAX_ARTICLES = 4;
const MAX_LINKS = 180;
const MAX_HTML_BYTES = 900000;
const MAX_ARTICLE_TEXT = 12000;
const FETCH_TIMEOUT = 9000;

const NVIDIA_MODEL =
  "nvidia/nemotron-3.5-lightning-30b-a3b";

const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const temporaryTasks = [];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {
        return new Response(frontendHTML(), {
          headers: {
            "content-type":
              "text/html; charset=UTF-8",
            "cache-control":
              "no-store"
          }
        });
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/status"
      ) {
        const exists =
          Boolean(env.NVIDIA_API_KEY);

        return json({
          ok: true,
          service: "WebProof AI",
          status: "online",
          crawler: "fast-editorial-crawler",
          ruleEngine: "precision-first",
          ai: exists
            ? "connected"
            : "missing-api-key",
          model: NVIDIA_MODEL,
          secretTest: {
            exists,
            type:
              typeof env.NVIDIA_API_KEY,
            length: exists
              ? String(
                  env.NVIDIA_API_KEY
                ).length
              : 0
          }
        });
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/ai-test"
      ) {
        if (!env.NVIDIA_API_KEY) {
          return json(
            {
              ok: false,
              error:
                "NVIDIA_API_KEY Worker runtime'ında bulunamadı."
            },
            500
          );
        }

        const result =
          await analyzeWithNvidia(
            "WebProof AI bağlantı testi",
            "Bu bir bağlantı testidir.",
            {
              errors: [],
              suspicious: []
            },
            env
          );

        return json({
          ok: true,
          message:
            "NVIDIA AI bağlantısı başarılı.",
          model: NVIDIA_MODEL,
          result
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/scan"
      ) {
        const body =
          await request.json();

        if (
          !body ||
          typeof body.url !== "string"
        ) {
          return json(
            {
              ok: false,
              error:
                "Geçerli bir URL gerekli."
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

      if (
        request.method === "GET" &&
        url.pathname === "/api/tasks"
      ) {
        return json({
          ok: true,
          tasks: temporaryTasks
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/tasks"
      ) {
        const body =
          await request.json();

        const task = {
          id: crypto.randomUUID(),
          createdAt:
            new Date().toISOString(),
          url:
            body.url || "",
          command:
            body.command || "",
          status: "active"
        };

        temporaryTasks.push(task);

        return json({
          ok: true,
          task
        });
      }

      if (
        request.method === "DELETE" &&
        url.pathname === "/api/tasks"
      ) {
        temporaryTasks.length = 0;

        return json({
          ok: true,
          tasks: []
        });
      }

      return json(
        {
          ok: false,
          error:
            "Endpoint bulunamadı."
        },
        404
      );
    } catch (error) {
      return json(
        {
          ok: false,
          error:
            error?.message ||
            "Beklenmeyen hata."
        },
        500
      );
    }
  }
};


/* =========================================================
   ANA TARAMA
========================================================= */

async function scanWebsite(
  inputUrl,
  env
) {
  const start =
    normalizeUrl(inputUrl);

  if (!start) {
    throw new Error(
      "Geçerli bir HTTP/HTTPS URL girin."
    );
  }

  const startUrl =
    new URL(start);

  const hostname =
    startUrl.hostname;

  const discovered =
    new Set([start]);

  const visited =
    new Set();

  const articleCandidates =
    new Map();

  const pages = [];

  let linksFound = 0;

  /*
    Önce yalnızca birkaç keşif sayfası.
    Böylece /galeri, /video, /yazarlar gibi
    bölümlerde zaman kaybetmiyoruz.
  */

  let queue = [
    {
      url: start,
      score: 100
    }
  ];

  while (
    queue.length &&
    visited.size <
      MAX_DISCOVERY_PAGES
  ) {
    queue.sort(
      (a, b) =>
        b.score - a.score
    );

    const current =
      queue.shift();

    if (
      !current ||
      visited.has(
        current.url
      )
    ) {
      continue;
    }

    visited.add(
      current.url
    );

    let page;

    try {
      page =
        await fetchPage(
          current.url
        );
    } catch (error) {
      pages.push({
        url: current.url,
        title: "",
        status: 0,
        isArticle: false,
        articleScore: 0,
        errors: [],
        suspicious: [],
        aiErrors: [],
        error:
          error?.message ||
          "Sayfa alınamadı."
      });

      continue;
    }

    const html =
      page.html;

    const title =
      extractTitle(html);

    const language =
      detectLanguage(
        html,
        title
      );

    const text =
      extractMainText(
        html
      );

    const score =
      scoreArticle(
        current.url,
        title,
        text,
        html
      );

    const isArticle =
      isLikelyArticle(
        current.url,
        title,
        text,
        html,
        score
      );

    const rule =
      isArticle
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
      articleScore: score,
      textLength:
        text.length,
      errors:
        rule.errors,
      suspicious:
        rule.suspicious,
      aiErrors: [],
      aiAnalyzed: false,
      error: null
    };

    pages.push(
      pageResult
    );

    if (
      isArticle &&
      text.length >= 500
    ) {
      const key =
        articleKey(
          current.url
        );

      if (
        !articleCandidates.has(
          key
        ) ||
        articleCandidates.get(
          key
        ).score < score
      ) {
        articleCandidates.set(
          key,
          {
            url:
              current.url,
            title:
              title ||
              current.url,
            text,
            language,
            score,
            pageIndex:
              pages.length - 1
          }
        );
      }
    }

    const links =
      extractLinks(
        html,
        current.url,
        hostname
      );

    linksFound +=
      links.length;

    for (
      const link of links
    ) {
      if (
        discovered.has(
          link
        )
      ) {
        continue;
      }

      if (
        discovered.size >=
        MAX_LINKS
      ) {
        break;
      }

      discovered.add(
        link
      );

      const linkScore =
        scoreArticle(
          link,
          "",
          "",
          ""
        );

      /*
        Haber ihtimali yüksek linkler
        keşif kuyruğunun önüne geçer.
      */

      queue.push({
        url: link,
        score:
          linkScore
      });
    }
  }

  /*
    Keşif sırasında bulunan haberleri seç.
  */

  const articles =
    Array.from(
      articleCandidates.values()
    )
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(
        0,
        MAX_ARTICLES
      );

  /*
    Eğer ilk keşif sayfalarında haber
    bulunamadıysa, doğrudan yüksek
    puanlı linkleri birkaç tane daha
    indiriyoruz.

    Bu, eski sistemdeki "0 haber"
    problemini azaltır.
  */

  if (
    articles.length === 0 &&
    queue.length > 0
  ) {
    const fallback =
      queue
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(
          0,
          MAX_ARTICLES
        );

    for (
      const candidate of fallback
    ) {
      if (
        visited.has(
          candidate.url
        )
      ) {
        continue;
      }

      let page;

      try {
        page =
          await fetchPage(
            candidate.url
          );
      } catch {
        continue;
      }

      const title =
        extractTitle(
          page.html
        );

      const text =
        extractMainText(
          page.html
        );

      const language =
        detectLanguage(
          page.html,
          title
        );

      const score =
        scoreArticle(
          candidate.url,
          title,
          text,
          page.html
        );

      if (
        isLikelyArticle(
          candidate.url,
          title,
          text,
          page.html,
          score
        )
      ) {
        const rule =
          ruleBasedProofread(
            text,
            language
          );

        pages.push({
          url:
            candidate.url,
          title:
            title ||
            candidate.url,
          status:
            page.status,
          language,
          isArticle: true,
          articleScore:
            score,
          textLength:
            text.length,
          errors:
            rule.errors,
          suspicious:
            rule.suspicious,
          aiErrors: [],
          aiAnalyzed: false,
          error: null
        });

        articleCandidates.set(
          articleKey(
            candidate.url
          ),
          {
            url:
              candidate.url,
            title:
              title ||
              candidate.url,
            text,
            language,
            score,
            pageIndex:
              pages.length - 1
          }
        );
      }
    }
  }

  /*
    Son seçimi yap.
  */

  const finalArticles =
    Array.from(
      articleCandidates.values()
    )
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(
        0,
        MAX_ARTICLES
      );

  /*
    NVIDIA analizini sadece gerçek
    haberlerde çalıştır.
  */

  if (
    env.NVIDIA_API_KEY
  ) {
    for (
      const article of finalArticles
    ) {
      const page =
        pages[
          article.pageIndex
        ];

      if (!page) {
        continue;
      }

      try {
        const result =
          await analyzeWithNvidia(
            article.title,
            article.text,
            {
              errors:
                page.errors,
              suspicious:
                page.suspicious
            },
            env
          );

        page.aiAnalyzed =
          true;

        page.aiErrors =
          result.errors || [];

        page.errors =
          mergeErrors(
            page.errors,
            page.aiErrors
          );

        page.suspicious =
          mergeSuspicious(
            page.suspicious,
            result.suspicious || []
          );
      } catch (error) {
        page.aiError =
          error?.message ||
          "AI analizi başarısız.";
      }
    }
  }

  /*
    Gerçek toplamlar.
  */

  const totalErrors =
    pages.reduce(
      (sum, page) =>
        sum +
        (page.errors?.length ||
          0),
      0
    );

  const aiAnalyzed =
    pages.filter(
      page =>
        page.aiAnalyzed
    ).length;

  const articlesFound =
    pages.filter(
      page =>
        page.isArticle
    ).length;

  return {
    ok: true,

    summary: {
      pagesScanned:
        pages.length,
      linksFound:
        Math.min(
          linksFound,
          MAX_LINKS
        ),
      articlesFound,
      totalErrors,
      aiAnalyzed
    },

    quality: {
      philosophy:
        "precision-first",
      falsePositiveProtection:
        true,
      contextAwareAI:
        Boolean(
          env.NVIDIA_API_KEY
        ),
      languageDetection:
        true,
      urlProtection:
        true,
      properNameProtection:
        true,
      numberProtection:
        true
    },

    pages
  };
}


/* =========================================================
   FETCH
========================================================= */

async function fetchPage(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      FETCH_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          redirect: "follow",
          signal:
            controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; WebProofAI/1.0)",
            "Accept":
              "text/html,application/xhtml+xml"
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
      )
    ) {
      throw new Error(
        "HTML olmayan içerik."
      );
    }

    if (
      response.status >=
      400
    ) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const html =
      await response.text();

    if (
      html.length >
      MAX_HTML_BYTES
    ) {
      return {
        status:
          response.status,
        html:
          html.slice(
            0,
            MAX_HTML_BYTES
          )
      };
    }

    return {
      status:
        response.status,
      html
    };
  } finally {
    clearTimeout(
      timer
    );
  }
}


/* =========================================================
   URL
========================================================= */

function normalizeUrl(
  value
) {
  try {
    const url =
      new URL(
        value
      );

    if (
      url.protocol !==
        "https:" &&
      url.protocol !==
        "http:"
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

    const remove = [
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

    for (
      const key of remove
    ) {
      url.searchParams.delete(
        key
      );
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
    h === "169.254.169.254"
  ) {
    return true;
  }

  if (
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(
      h
    )
  ) {
    return true;
  }

  return false;
}


/* =========================================================
   TITLE
========================================================= */

function extractTitle(
  html
) {
  const og =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    );

  if (
    og?.[1]
  ) {
    return cleanText(
      decodeEntities(
        og[1]
      )
    );
  }

  const title =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  if (
    title?.[1]
  ) {
    return cleanText(
      decodeEntities(
        title[1]
      )
    );
  }

  return "";
}


/* =========================================================
   METIN
========================================================= */

function extractMainText(
  html
) {
  let source =
    html;

  source =
    source.replace(
      /<(script|style|noscript|svg|canvas|iframe|nav|footer|header|aside|form|button|select|option|menu)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );

  /*
    Önce article.
  */

  const articles =
    source.match(
      /<article\b[^>]*>[\s\S]*?<\/article>/gi
    );

  if (
    articles?.length
  ) {
    const text =
      cleanText(
        decodeEntities(
          stripTags(
            articles.join(
              "\n"
            )
          )
        )
      );

    if (
      text.length >=
      500
    ) {
      return text.slice(
        0,
        30000
      );
    }
  }

  /*
    Sonra main.
  */

  const mains =
    source.match(
      /<main\b[^>]*>[\s\S]*?<\/main>/gi
    );

  if (
    mains?.length
  ) {
    const text =
      cleanText(
        decodeEntities(
          stripTags(
            mains.join(
              "\n"
            )
          )
        )
      );

    if (
      text.length >=
      500
    ) {
      return text.slice(
        0,
        30000
      );
    }
  }

  /*
    Son çare paragraflar.
  */

  const paragraphs = [];

  for (
    const match of source.matchAll(
      /<p\b[^>]*>([\s\S]*?)<\/p>/gi
    )
  ) {
    const text =
      cleanText(
        decodeEntities(
          stripTags(
            match[1]
          )
        )
      );

    if (
      text.length >=
      40
    ) {
      paragraphs.push(
        text
      );
    }

    if (
      paragraphs.join(
        "\n"
      ).length >=
      30000
    ) {
      break;
    }
  }

  return paragraphs
    .join(
      "\n"
    )
    .slice(
      0,
      30000
    );
}


/* =========================================================
   LINKLER
========================================================= */

function extractLinks(
  html,
  baseUrl,
  hostname
) {
  const links =
    new Set();

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  for (
    const match of html.matchAll(
      regex
    )
  ) {
    let raw =
      decodeEntities(
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
        links.add(
          normalized
        );
      }

      if (
        links.size >=
        MAX_LINKS
      ) {
        break;
      }
    } catch {}
  }

  return [
    ...links
  ];
}


/* =========================================================
   HABER PUANLAMA
========================================================= */

function scoreArticle(
  url,
  title,
  text,
  html
) {
  let score = 0;

  let pathname = "";

  try {
    pathname =
      new URL(
        url
      ).pathname.toLowerCase();
  } catch {}

  /*
    Kesinlikle kategori olmayan bölümler.
  */

  const excluded = [
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
    "/hakkimizda",
    "/kunye",
    "/rss",
    "/podcast"
  ];

  for (
    const item of excluded
  ) {
    if (
      pathname === item ||
      pathname.startsWith(
        item + "/"
      )
    ) {
      score -= 100;
    }
  }

  /*
    Güçlü haber URL sinyalleri.
  */

  const strong =
    [
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
      "/guncel/",
      "/yasam/"
    ];

  for (
    const signal of strong
  ) {
    if (
      pathname.includes(
        signal
      )
    ) {
      score += 35;
    }
  }

  /*
    Tarihli URL.
  */

  if (
    /\/20\d{2}\/\d{1,2}\/\d{1,2}\//.test(
      pathname
    ) ||
    /\/20\d{2}-\d{1,2}-\d{1,2}/.test(
      pathname
    )
  ) {
    score += 45;
  }

  /*
    Haber başlık slug'ı.
  */

  const last =
    pathname
      .split("/")
      .filter(Boolean)
      .pop() || "";

  const hyphens =
    (
      last.match(
        /-/g
      ) || []
    ).length;

  if (
    hyphens >= 2
  ) {
    score += 25;
  }

  if (
    last.length >= 40
  ) {
    score += 20;
  }

  if (
    last.length >= 70
  ) {
    score += 10;
  }

  /*
    Başlık.
  */

  if (
    title &&
    title.length >= 25 &&
    title.length <= 220
  ) {
    score += 20;
  }

  /*
    Gerçek metin.
  */

  if (
    text.length >=
    700
  ) {
    score += 25;
  }

  if (
    text.length >=
    1600
  ) {
    score += 20;
  }

  /*
    Article element.
  */

  if (
    /<article\b/i.test(
      html
    )
  ) {
    score += 30;
  }

  /*
    Tarih/saat.
  */

  if (
    /<time\b/i.test(
      html
    ) ||
    /datePublished/i.test(
      html
    )
  ) {
    score += 15;
  }

  /*
    JSON-LD Article.
  */

  if (
    /"@type"\s*:\s*"(NewsArticle|Article|ReportageNewsArticle)"/i.test(
      html
    )
  ) {
    score += 50;
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
  let pathname = "";

  try {
    pathname =
      new URL(
        url
      ).pathname
        .toLowerCase()
        .replace(
          /\/$/,
          ""
        );
  } catch {}

  const categoryPages = [
    "",
    "/galeri",
    "/galeriler",
    "/video",
    "/videolar",
    "/yazarlar",
    "/guncel",
    "/siyaset",
    "/ekonomi",
    "/spor",
    "/dunya",
    "/yasam",
    "/arama",
    "/search",
    "/kategori",
    "/category"
  ];

  if (
    categoryPages.includes(
      pathname
    )
  ) {
    return false;
  }

  if (
    score < 55
  ) {
    return false;
  }

  if (
    text.length < 500
  ) {
    return false;
  }

  /*
    Çok sayıda paragraf veya article
    yapısı bekliyoruz.
  */

  const paragraphs =
    (
      html.match(
        /<p\b/gi
      ) || []
    ).length;

  if (
    /<article\b/i.test(
      html
    )
  ) {
    return true;
  }

  if (
    paragraphs >= 5 &&
    text.length >=
      1200
  ) {
    return true;
  }

  if (
    score >= 90 &&
    text.length >=
      900
  ) {
    return true;
  }

  return false;
}


/* =========================================================
   DİL
========================================================= */

function detectLanguage(
  html,
  title
) {
  const match =
    html.match(
      /<html[^>]+lang=["']([^"']+)["']/i
    );

  if (
    match?.[1]
  ) {
    const lang =
      match[1]
        .toLowerCase();

    if (
      lang.startsWith(
        "tr"
      )
    ) {
      return "tr";
    }

    if (
      lang.startsWith(
        "en"
      )
    ) {
      return "en";
    }
  }

  const sample =
    (
      title +
      " " +
      extractVisibleSample(
        html
      )
    )
      .toLowerCase();

  const chars =
    (
      sample.match(
        /[çğıöşü]/g
      ) || []
    ).length;

  const words =
    [
      " ve ",
      " bir ",
      " için ",
      " olan ",
      " ile ",
      " bu ",
      " şu ",
      " daha "
    ].filter(
      item =>
        sample.includes(
          item
        )
    ).length;

  if (
    chars >= 2 ||
    words >= 2
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
   KURAL MOTORU
========================================================= */

function ruleBasedProofread(
  text,
  language
) {
  const errors = [];
  const suspicious = [];

  function add(
    original,
    correction,
    type,
    reason,
    confidence = 0.99
  ) {
    if (
      !original ||
      !correction ||
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
      source:
        "rule-engine"
    });
  }

  function suspect(
    original,
    reason
  ) {
    if (
      !original
    ) {
      return;
    }

    if (
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
      source:
        "rule-engine"
    });
  }

  /*
    Çift boşluk.
  */

  const doubleSpace =
    /[^\n ] {2,}[^\n ]/.exec(
      text
    );

  if (
    doubleSpace
  ) {
    add(
      doubleSpace[0],
      doubleSpace[0].replace(
        / {2,}/g,
        " "
      ),
      "noktalama",
      "Gereksiz birden fazla boşluk bulunuyor."
    );
  }

  /*
    Noktalama öncesi boşluk.
  */

  for (
    const match of text.matchAll(
      /([A-Za-zÇĞİÖŞÜçğıöşü0-9])\s+([,.!?;:])/g
    )
  ) {
    if (
      inUrlOrEmail(
        text,
        match.index
      )
    ) {
      continue;
    }

    add(
      match[0],
      match[1] +
        match[2],
      "noktalama",
      "Noktalama işaretinden önce gereksiz boşluk var."
    );

    if (
      errors.length >=
      25
    ) {
      break;
    }
  }

  /*
    Tekrarlanan noktalama.
  */

  for (
    const match of text.matchAll(
      /([!?;,])\1+|\.{4,}/g
    )
  ) {
    if (
      match[0] ===
      "..."
    ) {
      continue;
    }

    if (
      inUrlOrEmail(
        text,
        match.index
      )
    ) {
      continue;
    }

    add(
      match[0],
      match[0][0],
      "noktalama",
      "Noktalama işareti gereğinden fazla tekrar edilmiş."
    );
  }

  /*
    Noktalama sonrası eksik boşluk.
  */

  for (
    const match of text.matchAll(
      /([.!?;:])([A-Za-zÇĞİÖŞÜçğıöşü])/g
    )
  ) {
    if (
      inUrlOrEmail(
        text,
        match.index
      )
    ) {
      continue;
    }

    add(
      match[0],
      match[1] +
        " " +
        match[2],
      "noktalama",
      "Noktalama işaretinden sonra boşluk bulunması gerekiyor."
    );
  }

  if (
    language ===
    "tr"
  ) {
    const rules = [
      [
        /\bbir çok\b/gi,
        "birçok",
        "'Birçok' bitişik yazılır."
      ],
      [
        /\bhiç bir\b/gi,
        "hiçbir",
        "'Hiçbir' bitişik yazılır."
      ],
      [
        /\bher hangi\b/gi,
        "herhangi",
        "'Herhangi' bitişik yazılır."
      ],
      [
        /\bşuan\b/gi,
        "şu an",
        "'Şu an' ayrı yazılır."
      ],
      [
        /\byalnış\b/gi,
        "yanlış",
        "Doğru yazım 'yanlış'tır."
      ],
      [
        /\byanlız\b/gi,
        "yalnız",
        "Doğru yazım 'yalnız'dır."
      ],
      [
        /\bherkez\b/gi,
        "herkes",
        "Doğru yazım 'herkes'tir."
      ],
      [
        /\bbirşey\b/gi,
        "bir şey",
        "'Bir şey' ayrı yazılır."
      ],
      [
        /\bhiçbirşey\b/gi,
        "hiçbir şey",
        "'Hiçbir şey' ayrı yazılır."
      ],
      [
        /\bpekçok\b/gi,
        "pek çok",
        "'Pek çok' ayrı yazılır."
      ]
    ];

    for (
      const rule of rules
    ) {
      for (
        const match of text.matchAll(
          rule[0]
        )
      ) {
        add(
          match[0],
          preserveCase(
            match[0],
            rule[1]
          ),
          "yazım",
          rule[2]
        );
      }
    }
  }

  if (
    language ===
    "en"
  ) {
    const rules = [
      [
        /\balot\b/gi,
        "a lot",
        "The standard spelling is 'a lot'."
      ],
      [
        /\ba lotof\b/gi,
        "a lot of",
        "The words should be separated."
      ]
    ];

    for (
      const rule of rules
    ) {
      for (
        const match of text.matchAll(
          rule[0]
        )
      ) {
        add(
          match[0],
          preserveCase(
            match[0],
            rule[1]
          ),
          "spelling",
          rule[2]
        );
      }
    }
  }

  /*
    Bunları otomatik hata saymıyoruz.
    Sadece AI'ya bağlam sinyali veriyoruz.
  */

  for (
    const match of text.matchAll(
      /\b\d[\d.,%/-]{2,}\b/g
    )
  ) {
    suspect(
      match[0],
      "Sayı/tarih/yüzde/ölçü ifadesi; bağlama göre doğrulanmalı."
    );
  }

  return {
    errors:
      errors.slice(
        0,
        25
      ),
    suspicious:
      suspicious.slice(
        0,
        20
      )
  };
}


/* =========================================================
   NVIDIA
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
      "NVIDIA_API_KEY bulunamadı."
    );
  }

  const language =
    detectTextLanguage(
      text
    );

  const prompt = `
You are a professional newsroom copy editor.

Analyze the following article only for genuine language errors.

Language: ${language}

TITLE:
${title}

TEXT:
${text.slice(
  0,
  MAX_ARTICLE_TEXT
)}

RULE ENGINE FINDINGS:
${JSON.stringify(
  ruleAnalysis
)}

STRICT EDITORIAL POLICY:

- Precision is more important than recall.
- Do not report stylistic preferences.
- Do not rewrite the article.
- Do not improve wording merely because another wording sounds better.
- Do not change political terminology because of preference.
- Preserve quotations.
- Preserve proper names.
- Preserve organization names.
- Preserve locations.
- Preserve brands.
- Preserve URLs.
- Preserve e-mail addresses.
- Preserve numbers unless objectively incorrect.
- Preserve dates unless objectively incorrect.
- Check Turkish spelling, punctuation and grammar carefully.
- Check English spelling, punctuation and grammar carefully.
- Pay special attention to de/da, ki, mi, capitalization, compound words and punctuation in Turkish.
- If uncertain, do not report the item.
- Only report confidence >= 0.90.
- original MUST be copied exactly from the article.
- correction MUST contain only the corrected text.
- reason must be short.
- Never invent text that does not exist.

Return ONLY valid JSON:

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

If there are no genuine errors:

{
  "errors": [],
  "suspicious": []
}
`;

  const response =
    await fetch(
      NVIDIA_ENDPOINT,
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
              NVIDIA_MODEL,
            messages: [
              {
                role:
                  "system",
                content:
                  "You are a conservative professional copy editor. Return only JSON."
              },
              {
                role:
                  "user",
                content:
                  prompt
              }
            ],
            temperature:
              0.1,
            max_tokens:
              2500
          })
      }
    );

  const raw =
    await response.text();

  if (
    !response.ok
  ) {
    throw new Error(
      `NVIDIA API ${response.status}: ${raw.slice(
        0,
        300
      )}`
    );
  }

  const data =
    JSON.parse(
      raw
    );

  const content =
    data?.choices?.[0]?.message?.content ||
    "";

  const parsed =
    safeJson(
      content
    );

  const errors =
    Array.isArray(
      parsed.errors
    )
      ? parsed.errors
      : [];

  const suspicious =
    Array.isArray(
      parsed.suspicious
    )
      ? parsed.suspicious
      : [];

  return {
    errors:
      errors
        .filter(
          item =>
            item &&
            typeof item.original ===
              "string" &&
            typeof item.correction ===
              "string" &&
            item.original !==
              item.correction &&
            Number(
              item.confidence
            ) >= 0.90
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
              "Bağlam içinde tespit edilen hata.",
            source:
              "nvidia-ai"
          })
        )
        .slice(
          0,
          30
        ),

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
          20
        )
  };
}


/* =========================================================
   AI JSON
========================================================= */

function safeJson(
  value
) {
  let text =
    String(
      value || ""
    ).trim();

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
   BİRLEŞTİRME
========================================================= */

function mergeErrors(
  a,
  b
) {
  const result = [];

  for (
    const item of [
      ...(a || []),
      ...(b || [])
    ]
  ) {
    if (
      !item?.original
    ) {
      continue;
    }

    const duplicate =
      result.some(
        x =>
          normalizeCompare(
            x.original
          ) ===
            normalizeCompare(
              item.original
            ) &&
          normalizeCompare(
            x.correction
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
    40
  );
}

function mergeSuspicious(
  a,
  b
) {
  const result = [];

  for (
    const item of [
      ...(a || []),
      ...(b || [])
    ]
  ) {
    if (
      !item?.original
    ) {
      continue;
    }

    if (
      result.some(
        x =>
          normalizeCompare(
            x.original
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
    20
  );
}


/* =========================================================
   YARDIMCI
========================================================= */

function articleKey(
  url
) {
  try {
    const u =
      new URL(
        url
      );

    return (
      u.hostname.toLowerCase() +
      u.pathname
        .toLowerCase()
        .replace(
          /\/+$/,
          ""
        )
    );
  } catch {
    return url;
  }
}

function detectTextLanguage(
  text
) {
  const lower =
    text
      .slice(
        0,
        7000
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
      " ile ",
      " olan ",
      " bu ",
      " şu ",
      " daha "
    ].filter(
      x =>
        lower.includes(
          x
        )
    ).length;

  return trChars >= 2 ||
    trWords >= 2
    ? "Turkish"
    : "English";
}

function inUrlOrEmail(
  text,
  index
) {
  const context =
    text.slice(
      Math.max(
        0,
        index - 100
      ),
      Math.min(
        text.length,
        index + 100
      )
    );

  return (
    /https?:\/\//i.test(
      context
    ) ||
    /www\./i.test(
      context
    ) ||
    /[\w.-]+@[\w.-]+/.test(
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
      correction[0].toUpperCase() +
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

function decodeEntities(
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
      (_, n) =>
        String.fromCharCode(
          Number(n)
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) =>
        String.fromCharCode(
          parseInt(
            n,
            16
          )
        )
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
  box-sizing:border-box;
}

body {
  margin:0;
  background:#f5f7fa;
  color:#172033;
  font-family:Arial,Helvetica,sans-serif;
}

.container {
  max-width:1050px;
  margin:auto;
  padding:25px 16px 50px;
}

h1 {
  margin:0 0 6px;
}

.subtitle {
  color:#667085;
  margin-bottom:20px;
}

.panel {
  background:white;
  border-radius:14px;
  padding:18px;
  box-shadow:0 2px 12px rgba(0,0,0,.06);
}

input {
  width:100%;
  padding:14px;
  font-size:16px;
  border:1px solid #d0d5dd;
  border-radius:9px;
  margin-bottom:10px;
}

button {
  padding:12px 17px;
  border:0;
  border-radius:9px;
  cursor:pointer;
  margin-right:7px;
  margin-bottom:7px;
}

.primary {
  background:#172033;
  color:white;
}

.secondary {
  background:#e8ecf2;
}

.status {
  margin-top:10px;
  padding:11px;
  border-radius:8px;
  background:#f2f4f7;
}

.stats {
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:10px;
  margin:16px 0;
}

.stat {
  background:white;
  border-radius:10px;
  padding:15px;
}

.stat strong {
  display:block;
  font-size:27px;
}

.page {
  background:white;
  padding:17px;
  margin-top:12px;
  border-radius:11px;
}

.meta {
  color:#667085;
  font-size:13px;
  margin:5px 0;
  word-break:break-word;
}

.good {
  margin-top:10px;
  color:#067647;
}

.error {
  background:#fff1f0;
  border-left:4px solid #d92d20;
  padding:10px;
  margin-top:8px;
  border-radius:5px;
}

.suspicious {
  background:#fffaeb;
  border-left:4px solid #f79009;
  padding:10px;
  margin-top:10px;
}

.ai {
  color:#6941c6;
  font-weight:bold;
}

@media(max-width:650px) {
  .stats {
    grid-template-columns:repeat(2,1fr);
  }
}

</style>
</head>

<body>

<div class="container">

<h1>WebProof AI</h1>

<div class="subtitle">
Gerçek web taraması + hassas editoryal denetim + NVIDIA AI ikinci görüşü
</div>

<div class="panel">

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
    document.getElementById(
      "status"
    );

  status.innerText =
    "NVIDIA AI bağlantısı test ediliyor...";

  try {

    const response =
      await fetch(
        "/api/ai-test"
      );

    const data =
      await response.json();

    if (
      data.ok
    ) {

      status.innerHTML =
        "✓ NVIDIA AI bağlantısı başarılı. Model: " +
        escapeHtml(
          data.model
        );

    } else {

      status.innerText =
        "NVIDIA AI bağlantı hatası: " +
        (
          data.error ||
          "Bilinmeyen hata"
        );
    }

  } catch(error) {

    status.innerText =
      "Bağlantı hatası: " +
      error.message;

  }
}


async function scan() {

  const url =
    document
      .getElementById(
        "url"
      )
      .value
      .trim();

  const status =
    document
      .getElementById(
        "status"
      );

  const results =
    document
      .getElementById(
        "results"
      );

  const stats =
    document
      .getElementById(
        "stats"
      );

  if (!url) {

    status.innerText =
      "Lütfen URL girin.";

    return;
  }

  status.innerText =
    "Site keşfediliyor...";

  results.innerHTML =
    "";

  stats.style.display =
    "none";

  try {

    const response =
      await fetch(
        "/api/scan",
        {
          method:
            "POST",
          headers:{
            "Content-Type":
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

    if (
      !response.ok
    ) {
      throw new Error(
        data.error ||
        "Tarama başarısız."
      );
    }

    const s =
      data.summary ||
      {};

    stats.innerHTML =

      stat(
        s.pagesScanned || 0,
        "Taranan sayfa"
      ) +

      stat(
        s.linksFound || 0,
        "Bulunan link"
      ) +

      stat(
        s.articlesFound || 0,
        "Bulunan haber"
      ) +

      stat(
        s.totalErrors || 0,
        "Toplam hata"
      );

    stats.style.display =
      "grid";

    status.innerHTML =
      "✓ Tarama tamamlandı. " +
      (
        s.aiAnalyzed || 0
      ) +
      " haber AI tarafından analiz edildi.";

    for (
      const page of
      data.pages || []
    ) {

      results.appendChild(
        renderPage(
          page
        )
      );
    }

  } catch(error) {

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


function renderPage(
  page
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
    page.errors ||
    [];

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
      const error of
      errors
    ) {

      html +=
        '<div class="error">' +

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
        " · güven " +
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
    page.suspicious ||
    [];

  if (
    suspicious.length
  ) {

    html +=
      '<div class="suspicious">' +
      "<strong>Bağlama göre incelenmesi gerekenler</strong>";

    for (
      const item of
      suspicious.slice(
        0,
        8
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
      '<div class="error">' +
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
   JSON
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

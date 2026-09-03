/* =========================================================
   WEBPROOF AI
   Fast Web Crawler + Precision Editorial Engine
   + NVIDIA AI Second Opinion

   ARCHITECTURE:
   - Parallel discovery
   - Sitemap discovery
   - RSS/Atom discovery
   - JSON-LD Article discovery
   - Strong article detection
   - Parallel article fetching
   - Parallel NVIDIA analysis
   - Hard time budget
   - Partial-result protection
   - SSRF protection
   - URL / name / number protection
========================================================= */


/* =========================================================
   CONFIG
========================================================= */

const CONFIG = {

  // Ana sayfa + sitemap/feed keşfi
  DISCOVERY_FETCHES: 4,

  // Aynı anda indirilecek keşif linkleri
  DISCOVERY_CONCURRENCY: 8,

  // Aynı anda indirilecek haberler
  ARTICLE_CONCURRENCY: 4,

  // Sonuçlara alınacak haber sayısı
  MAX_ARTICLES: 8,

  // Toplam link keşif limiti
  MAX_LINKS: 300,

  // Her sayfa için HTML üst sınırı
  MAX_HTML_BYTES: 1200000,

  // AI'ya gönderilecek metin
  MAX_ARTICLE_TEXT: 11000,

  // Normal web timeout
  FETCH_TIMEOUT: 6500,

  // Toplam tarama bütçesi
  TOTAL_SCAN_BUDGET: 22000,

  // NVIDIA timeout
  NVIDIA_TIMEOUT: 9000,

  // AI'ya gönderilecek maksimum haber
  MAX_AI_ARTICLES: 5,

  // Çok küçük içerikleri haber sayma
  MIN_ARTICLE_TEXT: 450,

  // AI confidence
  MIN_AI_CONFIDENCE: 0.90
};


const NVIDIA_MODEL =
  "nvidia/nemotron-3.5-lightning-30b-a3b";

const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";


const temporaryTasks = [];


/* =========================================================
   ROUTER
========================================================= */

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

    const corsHeaders = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods":
        "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers":
        "Content-Type"
    };


    if (
      request.method === "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: corsHeaders
        }
      );
    }


    try {

      /*
        FRONTEND
      */

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {

        return new Response(
          frontendHTML(),
          {
            headers: {
              ...corsHeaders,
              "content-type":
                "text/html; charset=UTF-8",
              "cache-control":
                "no-store"
            }
          }
        );
      }


      /*
        STATUS
      */

      if (
        request.method === "GET" &&
        url.pathname === "/api/status"
      ) {

        const exists =
          Boolean(
            env.NVIDIA_API_KEY
          );

        return json(
          {
            ok: true,
            service: "WebProof AI",
            status: "online",

            crawler:
              "parallel-editorial-crawler",

            ruleEngine:
              "precision-first",

            ai:
              exists
                ? "connected"
                : "missing-api-key",

            model:
              NVIDIA_MODEL,

            architecture: {
              parallelDiscovery: true,
              sitemapDiscovery: true,
              feedDiscovery: true,
              jsonLdDiscovery: true,
              parallelArticles: true,
              parallelAI: true,
              partialResults: true,
              timeoutProtection: true
            },

            secretTest: {
              exists,
              type:
                typeof env.NVIDIA_API_KEY,
              length:
                exists
                  ? String(
                      env.NVIDIA_API_KEY
                    ).length
                  : 0
            }
          },
          200
        );
      }


      /*
        NVIDIA TEST
      */

      if (
        request.method === "GET" &&
        url.pathname === "/api/ai-test"
      ) {

        if (
          !env.NVIDIA_API_KEY
        ) {

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


        return json(
          {
            ok: true,
            message:
              "NVIDIA AI bağlantısı başarılı.",
            model:
              NVIDIA_MODEL,
            result
          }
        );
      }


      /*
        WEBSITE SCAN
      */

      if (
        request.method === "POST" &&
        url.pathname === "/api/scan"
      ) {

        let body;

        try {

          body =
            await request.json();

        } catch {

          return json(
            {
              ok: false,
              error:
                "Geçersiz JSON isteği."
            },
            400
          );
        }


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


        return json(
          result
        );
      }


      /*
        TASKS
      */

      if (
        request.method === "GET" &&
        url.pathname === "/api/tasks"
      ) {

        return json(
          {
            ok: true,
            tasks:
              temporaryTasks
          }
        );
      }


      if (
        request.method === "POST" &&
        url.pathname === "/api/tasks"
      ) {

        const body =
          await request.json();


        const task = {
          id:
            crypto.randomUUID(),

          createdAt:
            new Date().toISOString(),

          url:
            body.url || "",

          command:
            body.command || "",

          status:
            "active"
        };


        temporaryTasks.push(
          task
        );


        if (
          temporaryTasks.length >
          100
        ) {
          temporaryTasks.shift();
        }


        return json(
          {
            ok: true,
            task
          }
        );
      }


      if (
        request.method === "DELETE" &&
        url.pathname === "/api/tasks"
      ) {

        temporaryTasks.length = 0;

        return json(
          {
            ok: true,
            tasks: []
          }
        );
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
            "Beklenmeyen Worker hatası."
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

  const started =
    Date.now();


  const start =
    normalizeUrl(
      inputUrl
    );


  if (!start) {

    return {
      ok: false,
      error:
        "Geçerli bir HTTP/HTTPS URL girin."
    };
  }


  const startUrl =
    new URL(start);


  const hostname =
    startUrl.hostname;


  const deadline =
    started +
    CONFIG.TOTAL_SCAN_BUDGET;


  const visited =
    new Set();


  const discovered =
    new Set([
      start
    ]);


  const pages =
    [];


  const candidateMap =
    new Map();


  let linksFound = 0;


  /*
    -------------------------------------------------------
    1. ANA SAYFA + SITEMAP + FEED
    HEPSİ PARALEL
    -------------------------------------------------------
  */

  const discoveryTargets =
    await buildDiscoveryTargets(
      start,
      startUrl
    );


  const discoveryResults =
    await mapWithConcurrency(
      discoveryTargets.slice(
        0,
        CONFIG.DISCOVERY_FETCHES
      ),
      4,
      async (target) => {

        if (
          Date.now() >=
          deadline
        ) {
          return null;
        }


        try {

          const page =
            await fetchPage(
              target,
              Math.max(
                2500,
                Math.min(
                  CONFIG.FETCH_TIMEOUT,
                  deadline -
                    Date.now()
                )
              )
            );

          return {
            url:
              target,
            page
          };

        } catch (error) {

          return {
            url:
              target,
            error:
              error?.message ||
              "Sayfa alınamadı."
          };
        }
      }
    );


  /*
    Ana sayfa sonucunu işle.
  */

  for (
    const result of
    discoveryResults
  ) {

    if (!result) {
      continue;
    }


    if (
      result.page
    ) {

      visited.add(
        result.url
      );


      const html =
        result.page.html;


      /*
        Normal HTML ise link keşfi
      */

      if (
        isHtml(
          result.page.contentType
        )
      ) {

        const links =
          extractLinks(
            html,
            result.url,
            hostname
          );


        linksFound +=
          links.length;


        for (
          const link of links
        ) {

          if (
            discovered.size >=
            CONFIG.MAX_LINKS
          ) {
            break;
          }


          discovered.add(
            link
          );
        }


        /*
          JSON-LD haberleri doğrudan al.
        */

        const structured =
          extractStructuredArticleUrls(
            html,
            result.url,
            hostname
          );


        for (
          const item of structured
        ) {

          if (
            discovered.size >=
            CONFIG.MAX_LINKS
          ) {
            break;
          }


          discovered.add(
            item.url
          );
        }


        /*
          RSS / Atom benzeri linkleri de
          keşfe ekle.
        */

        const feeds =
          extractFeedLinks(
            html,
            result.url
          );


        for (
          const feed of feeds
        ) {

          if (
            discovered.size >=
            CONFIG.MAX_LINKS
          ) {
            break;
          }


          discovered.add(
            feed
          );
        }
      }


      /*
        Ana sayfanın kendisi haber olabilir.
      */

      const pageData =
        analyzePage(
          result.url,
          result.page
        );


      pages.push(
        pageData.page
      );


      if (
        pageData.article
      ) {

        candidateMap.set(
          articleKey(
            result.url
          ),
          pageData.article
        );
      }
    }
  }


  /*
    -------------------------------------------------------
    2. SITEMAP / RSS İÇERİKLERİNİ AYIKLA
    -------------------------------------------------------
  */

  const sitemapUrls =
    new Set();


  const feedUrls =
    new Set();


  for (
    const result of
    discoveryResults
  ) {

    if (
      !result?.page
    ) {
      continue;
    }


    const contentType =
      result.page.contentType ||
      "";


    if (
      isXml(
        contentType
      ) ||
      /sitemap|rss|atom/i.test(
        result.url
      )
    ) {

      const urls =
        extractXmlUrls(
          result.page.html,
          hostname
        );


      for (
        const item of urls
      ) {

        if (
          isLikelyUsefulUrl(
            item,
            hostname
          )
        ) {

          if (
            /sitemap/i.test(
              result.url
            )
          ) {
            sitemapUrls.add(
              item
            );
          } else {
            feedUrls.add(
              item
            );
          }
        }
      }
    }
  }


  /*
    -------------------------------------------------------
    3. NORMAL LINKLER + SITEMAP + FEED
       PUANLA
    -------------------------------------------------------
  */

  const candidates =
    [];


  for (
    const url of
    discovered
  ) {

    if (
      visited.has(url)
    ) {
      continue;
    }


    const score =
      scoreArticle(
        url,
        "",
        "",
        ""
      );


    if (
      score >= 0
    ) {

      candidates.push(
        {
          url,
          score,
          source:
            "homepage"
        }
      );
    }
  }


  for (
    const url of
    sitemapUrls
  ) {

    if (
      visited.has(url)
    ) {
      continue;
    }


    const score =
      scoreArticle(
        url,
        "",
        "",
        ""
      ) + 35;


    candidates.push(
      {
        url,
        score,
        source:
          "sitemap"
      }
    );
  }


  for (
    const url of
    feedUrls
  ) {

    if (
      visited.has(url)
    ) {
      continue;
    }


    const score =
      scoreArticle(
        url,
        "",
        "",
        ""
      ) + 50;


    candidates.push(
      {
        url,
        score,
        source:
          "feed"
      }
    );
  }


  /*
    Duplicate URL temizliği
  */

  const uniqueCandidates =
    new Map();


  for (
    const item of
    candidates
  ) {

    const key =
      articleKey(
        item.url
      );


    const existing =
      uniqueCandidates.get(
        key
      );


    if (
      !existing ||
      existing.score <
        item.score
    ) {

      uniqueCandidates.set(
        key,
        item
      );
    }
  }


  const rankedCandidates =
    Array.from(
      uniqueCandidates.values()
    )
      .sort(
        (a, b) =>
          b.score -
          a.score
      )
      .slice(
        0,
        Math.max(
          18,
          CONFIG.MAX_ARTICLES *
            3
        )
      );


  /*
    -------------------------------------------------------
    4. HABER ADAYLARINI PARALEL TARA
    -------------------------------------------------------
  */

  const articleResults =
    await mapWithConcurrency(
      rankedCandidates,
      CONFIG.ARTICLE_CONCURRENCY,
      async (candidate) => {

        if (
          Date.now() >=
          deadline
        ) {
          return null;
        }


        if (
          visited.has(
            candidate.url
          )
        ) {
          return null;
        }


        try {

          const remaining =
            deadline -
            Date.now();


          if (
            remaining <
            1200
          ) {
            return null;
          }


          const page =
            await fetchPage(
              candidate.url,
              Math.min(
                CONFIG.FETCH_TIMEOUT,
                remaining
              )
            );


          visited.add(
            candidate.url
          );


          return {
            candidate,
            page
          };

        } catch (error) {

          return {
            candidate,
            error:
              error?.message ||
              "Haber alınamadı."
          };
        }
      }
    );


  /*
    -------------------------------------------------------
    5. SONUÇLARI DEĞERLENDİR
    -------------------------------------------------------
  */

  for (
    const result of
    articleResults
  ) {

    if (!result) {
      continue;
    }


    if (
      !result.page
    ) {

      pages.push(
        {
          url:
            result.candidate.url,

          title:
            result.candidate.url,

          status: 0,

          language:
            "unknown",

          isArticle:
            false,

          articleScore:
            result.candidate.score,

          textLength: 0,

          errors: [],

          suspicious: [],

          aiErrors: [],

          aiAnalyzed:
            false,

          error:
            result.error ||
            "Sayfa alınamadı."
        }
      );


      continue;
    }


    const analyzed =
      analyzePage(
        result.candidate.url,
        result.page
      );


    pages.push(
      analyzed.page
    );


    if (
      analyzed.article
    ) {

      const key =
        articleKey(
          result.candidate.url
        );


      const old =
        candidateMap.get(
          key
        );


      if (
        !old ||
        old.score <
          analyzed.article.score
      ) {

        candidateMap.set(
          key,
          analyzed.article
        );
      }
    }
  }


  /*
    -------------------------------------------------------
    6. EN İYİ HABERLER
    -------------------------------------------------------
  */

  const finalArticles =
    Array.from(
      candidateMap.values()
    )
      .sort(
        (a, b) =>
          b.score -
          a.score
      )
      .slice(
        0,
        CONFIG.MAX_ARTICLES
      );


  /*
    -------------------------------------------------------
    7. NVIDIA AI
       PARALEL ÇALIŞIR
    -------------------------------------------------------
  */

  if (
    env.NVIDIA_API_KEY &&
    finalArticles.length
  ) {

    const aiArticles =
      finalArticles.slice(
        0,
        CONFIG.MAX_AI_ARTICLES
      );


    await mapWithConcurrency(
      aiArticles,
      CONFIG.MAX_AI_ARTICLES,
      async (article) => {

        if (
          Date.now() >=
          deadline
        ) {
          return null;
        }


        const page =
          pages[
            article.pageIndex
          ];


        if (!page) {
          return null;
        }


        try {

          const remaining =
            deadline -
            Date.now();


          if (
            remaining <
            1800
          ) {

            page.aiError =
              "Tarama zaman bütçesi doldu.";

            return null;
          }


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
              env,
              Math.min(
                CONFIG.NVIDIA_TIMEOUT,
                remaining
              )
            );


          page.aiAnalyzed =
            true;


          page.aiErrors =
            result.errors ||
            [];


          page.errors =
            mergeErrors(
              page.errors,
              page.aiErrors
            );


          page.suspicious =
            mergeSuspicious(
              page.suspicious,
              result.suspicious ||
                []
            );


          return null;

        } catch (error) {

          page.aiError =
            error?.message ||
            "NVIDIA AI analizi başarısız.";

          return null;
        }
      }
    );
  }


  /*
    -------------------------------------------------------
    8. GERÇEK TOPLAMLAR
    -------------------------------------------------------
  */

  const totalErrors =
    pages.reduce(
      (sum, page) =>
        sum +
        (
          page.errors?.length ||
          0
        ),
      0
    );


  const articlesFound =
    pages.filter(
      page =>
        page.isArticle
    ).length;


  const aiAnalyzed =
    pages.filter(
      page =>
        page.aiAnalyzed
    ).length;


  const elapsed =
    Date.now() -
    started;


  const timedOut =
    elapsed >=
    CONFIG.TOTAL_SCAN_BUDGET;


  /*
    Sayfaları en anlamlı şekilde sırala:
    haberler önce.
  */

  pages.sort(
    (a, b) => {

      if (
        a.isArticle &&
        !b.isArticle
      ) {
        return -1;
      }

      if (
        !a.isArticle &&
        b.isArticle
      ) {
        return 1;
      }

      return (
        (b.articleScore || 0) -
        (a.articleScore || 0)
      );
    }
  );


  return {

    ok: true,

    summary: {

      pagesScanned:
        pages.length,

      linksFound:
        Math.min(
          linksFound +
            discovered.size +
            sitemapUrls.size +
            feedUrls.size,
          CONFIG.MAX_LINKS
        ),

      articlesFound,

      totalErrors,

      aiAnalyzed,

      elapsedMs:
        elapsed,

      timedOut,

      partial:
        timedOut
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
        true,

      sitemapDiscovery:
        true,

      feedDiscovery:
        true,

      jsonLdDiscovery:
        true,

      parallelCrawling:
        true
    },


    pages
  };
}


/* =========================================================
   DISCOVERY TARGETS
========================================================= */

async function buildDiscoveryTargets(
  start,
  startUrl
) {

  const origin =
    startUrl.origin;


  const candidates = [

    start,

    origin +
      "/sitemap.xml",

    origin +
      "/sitemap_index.xml",

    origin +
      "/robots.txt"

  ];


  /*
    robots.txt içinden sitemap adreslerini
    bulmak için robots'u ayrıca indiriyoruz.
    İlk paralel turda bu zaten var.
  */

  return unique(
    candidates
  );
}


/* =========================================================
   PAGE ANALYSIS
========================================================= */

function analyzePage(
  url,
  page
) {

  const html =
    page.html || "";


  const title =
    extractTitle(
      html
    );


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
      url,
      title,
      text,
      html
    );


  const isArticle =
    isLikelyArticle(
      url,
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

    url,

    title:
      title ||
      url,

    status:
      page.status || 0,

    language,

    isArticle,

    articleScore:
      score,

    textLength:
      text.length,

    errors:
      rule.errors,

    suspicious:
      rule.suspicious,

    aiErrors: [],

    aiAnalyzed:
      false,

    error:
      null
  };


  let article =
    null;


  if (
    isArticle &&
    text.length >=
      CONFIG.MIN_ARTICLE_TEXT
  ) {

    article = {

      url,

      title:
        title ||
        url,

      text:
        text.slice(
          0,
          CONFIG.MAX_ARTICLE_TEXT
        ),

      language,

      score,

      pageIndex:
        -1
    };
  }


  return {
    page:
      pageResult,
    article
  };
}


/* =========================================================
   FETCH ENGINE
========================================================= */

async function fetchPage(
  url,
  timeout =
    CONFIG.FETCH_TIMEOUT
) {

  if (
    !isSafeExternalUrl(
      url
    )
  ) {
    throw new Error(
      "Güvenlik nedeniyle URL engellendi."
    );
  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      Math.max(
        1000,
        timeout
      )
    );


  try {

    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {

            "User-Agent":
              "Mozilla/5.0 (compatible; WebProofAI/2.0; +https://webproof.ai)",

            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",

            "Accept-Language":
              "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",

            "Cache-Control":
              "no-cache"
          }
        }
      );


    const contentType =
      response.headers.get(
        "content-type"
      ) || "";


    if (
      response.status >=
      400
    ) {

      throw new Error(
        `HTTP ${response.status}`
      );
    }


    /*
      Çok büyük response'larda
      Worker'ın gereksiz yüklenmesini önle.
    */

    const html =
      await response.text();


    return {

      status:
        response.status,

      contentType,

      html:
        html.slice(
          0,
          CONFIG.MAX_HTML_BYTES
        )
    };

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "Sayfa zaman aşımına uğradı."
      );
    }


    throw error;

  } finally {

    clearTimeout(
      timer
    );
  }
}


/* =========================================================
   SAFE URL
========================================================= */

function isSafeExternalUrl(
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
      return false;
    }


    if (
      url.username ||
      url.password
    ) {
      return false;
    }


    /*
      Standart web portları.
    */

    if (
      url.port &&
      ![
        "80",
        "443"
      ].includes(
        url.port
      )
    ) {
      return false;
    }


    return !isPrivateHostname(
      url.hostname
    );

  } catch {

    return false;
  }
}


function isPrivateHostname(
  hostname
) {

  const h =
    String(
      hostname || ""
    )
      .toLowerCase()
      .replace(
        /^\[|\]$/g,
        ""
      );


  if (
    h ===
      "localhost" ||
    h ===
      "localhost.localdomain" ||
    h ===
      "127.0.0.1" ||
    h ===
      "0.0.0.0" ||
    h ===
      "::1" ||
    h ===
      "169.254.169.254"
  ) {
    return true;
  }


  if (
    /^10\./.test(h)
  ) {
    return true;
  }


  if (
    /^192\.168\./.test(h)
  ) {
    return true;
  }


  if (
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  ) {
    return true;
  }


  if (
    /^169\.254\./.test(h)
  ) {
    return true;
  }


  return false;
}


/* =========================================================
   NORMALIZE URL
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
      !isSafeExternalUrl(
        url.toString()
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
      "mc_eid",

      "ref",
      "ref_src"

    ];


    for (
      const key of
      remove
    ) {

      url.searchParams.delete(
        key
      );
    }


    url.hash = "";


    /*
      Trailing slash standardizasyonu.
    */

    if (
      url.pathname.length >
      1
    ) {

      url.pathname =
        url.pathname.replace(
          /\/+$/,
          ""
        );
    }


    return url.toString();

  } catch {

    return null;
  }
}


/* =========================================================
   TITLE
========================================================= */

function extractTitle(
  html
) {

  /*
    JSON-LD headline
  */

  const ld =
    extractJsonLdObjects(
      html
    );


  for (
    const item of
    ld
  ) {

    if (
      typeof item?.headline ===
      "string"
    ) {

      const value =
        cleanText(
          decodeEntities(
            item.headline
          )
        );


      if (
        value.length >=
        5
      ) {

        return value.slice(
          0,
          250
        );
      }
    }
  }


  /*
    OG title
  */

  const og =
    html.match(
      /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i
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


  /*
    Reverse attribute order.
  */

  const og2 =
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:title["']/i
    );


  if (
    og2?.[1]
  ) {

    return cleanText(
      decodeEntities(
        og2[1]
      )
    );
  }


  /*
    HTML title.
  */

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
   MAIN TEXT EXTRACTION
========================================================= */

function extractMainText(
  html
) {

  let source =
    String(
      html || ""
    );


  /*
    Gereksiz blokları temizle.
  */

  source =
    source.replace(
      /<(script|style|noscript|svg|canvas|iframe|nav|footer|header|aside|form|button|select|option|menu|template)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );


  /*
    Article bloklarını puanla.
  */

  const articleBlocks =
    source.match(
      /<article\b[^>]*>[\s\S]*?<\/article>/gi
    ) || [];


  if (
    articleBlocks.length
  ) {

    const scored =
      articleBlocks
        .map(
          block => {

            const text =
              cleanText(
                decodeEntities(
                  stripTags(
                    block
                  )
                )
              );


            return {
              text,
              score:
                text.length
            };
          }
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );


    if (
      scored[0]?.text.length >=
      450
    ) {

      return scored[0].text.slice(
        0,
        30000
      );
    }
  }


  /*
    Main
  */

  const mains =
    source.match(
      /<main\b[^>]*>[\s\S]*?<\/main>/gi
    ) || [];


  if (
    mains.length
  ) {

    const text =
      cleanText(
        decodeEntities(
          stripTags(
            mains
              .sort(
                (a, b) =>
                  b.length -
                  a.length
              )[0]
          )
        )
      );


    if (
      text.length >=
      450
    ) {

      return text.slice(
        0,
        30000
      );
    }
  }


  /*
    Content class/id sinyalleri.
  */

  const contentBlocks =
    source.match(
      /<(div|section)[^>]+(?:class|id)=["'][^"']*(?:article|content|story|post|news|entry|body|icerik|haber)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi
    ) || [];


  if (
    contentBlocks.length
  ) {

    const best =
      contentBlocks
        .map(
          block =>
            cleanText(
              decodeEntities(
                stripTags(
                  block
                )
              )
            )
        )
        .filter(
          text =>
            text.length >=
            450
        )
        .sort(
          (a, b) =>
            b.length -
            a.length
        )[0];


    if (
      best
    ) {

      return best.slice(
        0,
        30000
      );
    }
  }


  /*
    Son çare p tagleri.
  */

  const paragraphs = [];


  for (
    const match of
    source.matchAll(
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
      35
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
   LINK EXTRACTION
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
    const match of
    html.matchAll(
      regex
    )
  ) {

    const raw =
      decodeEntities(
        match[1]
      ).trim();


    if (
      !raw ||
      raw.startsWith("#") ||
      /^javascript:/i.test(raw) ||
      /^mailto:/i.test(raw) ||
      /^tel:/i.test(raw) ||
      /^data:/i.test(raw)
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

        if (
          isUsefulNavigationUrl(
            normalized
          )
        ) {

          links.add(
            normalized
          );
        }
      }


      if (
        links.size >=
        CONFIG.MAX_LINKS
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
   JSON-LD ARTICLE DISCOVERY
========================================================= */

function extractStructuredArticleUrls(
  html,
  baseUrl,
  hostname
) {

  const result =
    [];


  const objects =
    extractJsonLdObjects(
      html
    );


  for (
    const item of
    objects
  ) {

    const type =
      String(
        item?.["@type"] ||
        ""
      ).toLowerCase();


    const isArticle =
      type.includes(
        "article"
      ) ||
      type.includes(
        "news"
      ) ||
      type.includes(
        "reportage"
      );


    if (
      !isArticle
    ) {
      continue;
    }


    const candidates = [

      item.url,
      item.mainEntityOfPage,

      item["@id"]

    ];


    for (
      const raw of
      candidates
    ) {

      let value =
        raw;


      if (
        typeof value ===
        "object"
      ) {

        value =
          value?.["@id"] ||
          value?.url ||
          "";
      }


      if (
        typeof value !==
        "string"
      ) {
        continue;
      }


      try {

        const absolute =
          new URL(
            value,
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

          result.push(
            {
              url:
                normalized,

              score:
                100
            }
          );
        }

      } catch {}
    }
  }


  return uniqueStructured(
    result
  );
}


/* =========================================================
   JSON-LD PARSER
========================================================= */

function extractJsonLdObjects(
  html
) {

  const result =
    [];


  const blocks =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ) || [];


  for (
    const block of
    blocks
  ) {

    const content =
      block
        .replace(
          /<script[^>]*>/i,
          ""
        )
        .replace(
          /<\/script>\s*$/i,
          ""
        )
        .trim();


    if (
      !content
    ) {
      continue;
    }


    try {

      const parsed =
        JSON.parse(
          content
        );


      flattenJsonLd(
        parsed,
        result
      );

    } catch {

      /*
        Bazı sitelerde JSON-LD içinde
        hatalı trailing virgüller bulunabilir.
      */

      try {

        const repaired =
          content
            .replace(
              /,\s*([}\]])/g,
              "$1"
            );


        const parsed =
          JSON.parse(
            repaired
          );


        flattenJsonLd(
          parsed,
          result
        );

      } catch {}
    }
  }


  return result;
}


function flattenJsonLd(
  value,
  output
) {

  if (
    Array.isArray(value)
  ) {

    for (
      const item of
      value
    ) {

      flattenJsonLd(
        item,
        output
      );
    }

    return;
  }


  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return;
  }


  output.push(
    value
  );


  if (
    Array.isArray(
      value["@graph"]
    )
  ) {

    flattenJsonLd(
      value["@graph"],
      output
    );
  }
}


/* =========================================================
   FEED LINKS
========================================================= */

function extractFeedLinks(
  html,
  baseUrl
) {

  const result =
    new Set();


  const regex =
    /<link\b[^>]+(?:type|rel)=["'][^"']*(?:rss|atom|xml)[^"']*["'][^>]*>/gi;


  for (
    const match of
    html.matchAll(
      regex
    )
  ) {

    const tag =
      match[0];


    const href =
      tag.match(
        /href=["']([^"']+)["']/i
      );


    if (
      !href?.[1]
    ) {
      continue;
    }


    try {

      const absolute =
        new URL(
          href[1],
          baseUrl
        );


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

    } catch {}
  }


  return [
    ...result
  ];
}


/* =========================================================
   XML URL EXTRACTION
========================================================= */

function extractXmlUrls(
  xml,
  hostname
) {

  const result =
    new Set();


  const patterns = [

    /<loc>\s*([^<\s]+)\s*<\/loc>/gi,

    /<link[^>]*>\s*([^<\s]+)\s*<\/link>/gi

  ];


  for (
    const regex of
    patterns
  ) {

    for (
      const match of
      xml.matchAll(
        regex
      )
    ) {

      let value =
        decodeEntities(
          match[1]
        ).trim();


      try {

        const normalized =
          normalizeUrl(
            value
          );


        if (!normalized) {
          continue;
        }


        const parsed =
          new URL(
            normalized
          );


        if (
          parsed.hostname !==
          hostname
        ) {
          continue;
        }


        result.add(
          normalized
        );

      } catch {}
    }
  }


  return [
    ...result
  ];
}


/* =========================================================
   ARTICLE SCORING
========================================================= */

function scoreArticle(
  url,
  title,
  text,
  html
) {

  let score =
    0;


  let pathname =
    "";


  try {

    pathname =
      new URL(
        url
      )
        .pathname
        .toLowerCase();

  } catch {}


  const excluded = [

    "/galeri",
    "/galeriler",

    "/video",
    "/videolar",

    "/yazarlar",
    "/yazar",

    "/etiket",
    "/tag",

    "/kategori",
    "/category",

    "/arama",
    "/search",

    "/iletisim",
    "/hakkimizda",
    "/kunye",

    "/rss",
    "/podcast",

    "/login",
    "/giris",

    "/uye",
    "/register",

    "/contact",

    "/privacy",
    "/gizlilik",

    "/cookie"

  ];


  for (
    const item of
    excluded
  ) {

    if (
      pathname === item ||
      pathname.startsWith(
        item + "/"
      )
    ) {

      score -=
        150;
    }
  }


  /*
    Güçlü haber URL sinyalleri
  */

  const strong = [

    "/haber/",
    "/haberler/",

    "/news/",
    "/article/",
    "/articles/",

    "/story/",
    "/stories/",

    "/gundem/",
    "/siyaset/",
    "/politika/",

    "/ekonomi/",
    "/finans/",

    "/spor/",
    "/dunya/",

    "/guncel/",
    "/yasam/",

    "/kultur/",
    "/magazin/"

  ];


  for (
    const signal of
    strong
  ) {

    if (
      pathname.includes(
        signal
      )
    ) {

      score +=
        45;
    }
  }


  /*
    Tarihli URL
  */

  if (
    /\/20\d{2}\/\d{1,2}\/\d{1,2}(\/|$)/.test(
      pathname
    )
  ) {

    score +=
      55;
  }


  if (
    /\/20\d{2}-\d{1,2}-\d{1,2}/.test(
      pathname
    )
  ) {

    score +=
      50;
  }


  /*
    Slug
  */

  const last =
    pathname
      .split("/")
      .filter(Boolean)
      .pop() ||
    "";


  const hyphens =
    (
      last.match(
        /-/g
      ) || []
    ).length;


  if (
    hyphens >= 2
  ) {

    score +=
      25;
  }


  if (
    last.length >=
    40
  ) {

    score +=
      20;
  }


  if (
    last.length >=
    70
  ) {

    score +=
      10;
  }


  /*
    Başlık
  */

  if (
    title &&
    title.length >=
      25 &&
    title.length <=
      220
  ) {

    score +=
      25;
  }


  /*
    Metin
  */

  if (
    text.length >=
    450
  ) {

    score +=
      20;
  }


  if (
    text.length >=
    1000
  ) {

    score +=
      25;
  }


  if (
    text.length >=
    1800
  ) {

    score +=
      20;
  }


  /*
    HTML article
  */

  if (
    /<article\b/i.test(
      html
    )
  ) {

    score +=
      40;
  }


  /*
    time
  */

  if (
    /<time\b/i.test(
      html
    )
  ) {

    score +=
      15;
  }


  /*
    datePublished
  */

  if (
    /datePublished/i.test(
      html
    )
  ) {

    score +=
      30;
  }


  /*
    JSON-LD Article
  */

  if (
    /"@type"\s*:\s*"(NewsArticle|Article|ReportageNewsArticle|OpinionNewsArticle)"/i.test(
      html
    )
  ) {

    score +=
      80;
  }


  /*
    canonical
  */

  if (
    /<link[^>]+rel=["']canonical["']/i.test(
      html
    )
  ) {

    score +=
      5;
  }


  return score;
}


/* =========================================================
   ARTICLE DECISION
========================================================= */

function isLikelyArticle(
  url,
  title,
  text,
  html,
  score
) {

  let pathname =
    "";


  try {

    pathname =
      new URL(
        url
      )
        .pathname
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
    "/politika",

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
    text.length <
    CONFIG.MIN_ARTICLE_TEXT
  ) {

    return false;
  }


  const paragraphs =
    (
      html.match(
        /<p\b/gi
      ) || []
    ).length;


  /*
    JSON-LD Article varsa çok güçlü sinyal.
  */

  if (
    /"@type"\s*:\s*"(NewsArticle|Article|ReportageNewsArticle|OpinionNewsArticle)"/i.test(
      html
    ) &&
    text.length >=
      450
  ) {

    return true;
  }


  if (
    /<article\b/i.test(
      html
    ) &&
    text.length >=
      500
  ) {

    return true;
  }


  if (
    paragraphs >=
      5 &&
    text.length >=
      900 &&
    score >=
      75
  ) {

    return true;
  }


  if (
    score >=
      110 &&
    text.length >=
      700
  ) {

    return true;
  }


  return false;
}


/* =========================================================
   LANGUAGE
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


  const words = [

    " ve ",
    " bir ",
    " için ",
    " olan ",
    " ile ",
    " bu ",
    " şu ",
    " daha ",
    " ancak ",
    " tarafından "

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
      html.replace(
        /<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi,
        " "
      )
    )
  ).slice(
    0,
    6000
  );
}


/* =========================================================
   RULE ENGINE
========================================================= */

function ruleBasedProofread(
  text,
  language
) {

  const errors =
    [];

  const suspicious =
    [];


  function add(
    original,
    correction,
    type,
    reason,
    confidence =
      0.99
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
      original.length >
      250
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


    errors.push(
      {
        original,
        correction,
        type,
        confidence,
        reason,
        source:
          "rule-engine"
      }
    );
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


    suspicious.push(
      {
        original,
        reason,
        source:
          "rule-engine"
      }
    );
  }


  /*
    Çift boşluk
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
    Noktalama öncesi boşluk
  */

  for (
    const match of
    text.matchAll(
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
      30
    ) {
      break;
    }
  }


  /*
    Tekrarlanan noktalama
  */

  for (
    const match of
    text.matchAll(
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
    Noktalama sonrası boşluk
  */

  for (
    const match of
    text.matchAll(
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


  /*
    Türkçe
  */

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
      ],

      [
        /\bbir takım\b/gi,
        "birtakım",
        "'Birtakım' anlamına göre bitişik yazılabilir; burada bağlama dayalı dikkat gerekir."
      ]

    ];


    for (
      const rule of
      rules
    ) {

      for (
        const match of
        text.matchAll(
          rule[0]
        )
      ) {

        /*
          "bir takım" kuralında
          yanlış pozitifleri azalt.
        */

        if (
          rule[1] ===
            "birtakım" &&
          !looksLikeIndefiniteBirTakim(
            text,
            match.index
          )
        ) {

          continue;
        }


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


  /*
    English
  */

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
      ],

      [
        /\binfront\b/gi,
        "in front",
        "The standard form is 'in front'."
      ]

    ];


    for (
      const rule of
      rules
    ) {

      for (
        const match of
        text.matchAll(
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
    Sayılar / tarih / yüzde
    otomatik hata DEĞİL.
  */

  for (
    const match of
    text.matchAll(
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
        30
      ),

    suspicious:
      suspicious.slice(
        0,
        20
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
  env,
  timeout =
    CONFIG.NVIDIA_TIMEOUT
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
You are a senior professional newsroom copy editor.

Your job is NOT to rewrite the article.
Your job is ONLY to identify genuine objective language errors.

LANGUAGE:
${language}

TITLE:
${title}

ARTICLE:
${text.slice(
  0,
  CONFIG.MAX_ARTICLE_TEXT
)}

RULE ENGINE:
${JSON.stringify(
  ruleAnalysis
)}

STRICT POLICY:

1. Precision is more important than recall.
2. Never report stylistic preferences.
3. Never rewrite sentences merely to make them sound better.
4. Never change political terminology because of preference.
5. Preserve quotations.
6. Preserve names.
7. Preserve surnames.
8. Preserve organization names.
9. Preserve place names.
10. Preserve brands.
11. Preserve URLs.
12. Preserve e-mail addresses.
13. Preserve numbers unless objectively wrong.
14. Preserve dates unless objectively wrong.
15. Do not infer facts.
16. Do not invent corrections.
17. Turkish: carefully check spelling, punctuation, capitalization, de/da, ki, mi and compound words.
18. English: carefully check spelling, punctuation and grammar.
19. If uncertain, DO NOT report it.
20. Only confidence >= 0.90.
21. "original" MUST appear exactly in the article.
22. "correction" must contain only the corrected form.
23. Do not report an item merely because another expression is preferable.
24. Do not report proper names as spelling errors without very strong evidence.

Return ONLY valid JSON.

{
  "errors": [
    {
      "original": "...",
      "correction": "...",
      "type": "yazım|noktalama|dilbilgisi|sayı|büyük-harf|diğer",
      "confidence": 0.95,
      "reason": "Kısa açıklama"
    }
  ],
  "suspicious": [
    {
      "original": "...",
      "reason": "Bağlama göre kontrol edilmeli."
    }
  ]
}

If there are no genuine errors:

{
  "errors": [],
  "suspicious": []
}
`;


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      Math.max(
        1200,
        timeout
      )
    );


  try {

    const response =
      await fetch(
        NVIDIA_ENDPOINT,
        {
          method:
            "POST",

          signal:
            controller.signal,

          headers: {

            "Authorization":
              `Bearer ${env.NVIDIA_API_KEY}`,

            "Content-Type":
              "application/json",

            "Accept":
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
                    "You are a conservative professional newsroom copy editor. Return only valid JSON."
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
                2200
            })
        }
      );


    const raw =
      await response.text();


    if (
      !response.ok
    ) {

      throw new Error(
        `NVIDIA API ${response.status}: ${raw.slice(0, 250)}`
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
        "NVIDIA yanıtı JSON olarak okunamadı."
      );
    }


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
              ) >=
                CONFIG.MIN_AI_CONFIDENCE &&

              item.original.length <=
                250
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
                "Bağlam içinde tespit edilen gerçek dil hatası.",

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

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "NVIDIA AI zaman aşımına uğradı."
      );
    }


    throw error;

  } finally {

    clearTimeout(
      timer
    );
  }
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
   MERGE ERRORS
========================================================= */

function mergeErrors(
  a,
  b
) {

  const result =
    [];


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
    40
  );
}


/* =========================================================
   MERGE SUSPICIOUS
========================================================= */

function mergeSuspicious(
  a,
  b
) {

  const result =
    [];


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
    20
  );
}


/* =========================================================
   TEXT LANGUAGE
========================================================= */

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


  const trWords = [

    " ve ",
    " bir ",
    " için ",
    " ile ",
    " olan ",
    " bu ",
    " şu ",
    " daha ",
    " ancak "

  ].filter(
    x =>
      lower.includes(
        x
      )
  ).length;


  return
    trChars >= 2 ||
    trWords >= 2
      ? "Turkish"
      : "English";
}


/* =========================================================
   URL / EMAIL
========================================================= */

function inUrlOrEmail(
  text,
  index
) {

  const context =
    text.slice(
      Math.max(
        0,
        index - 120
      ),
      Math.min(
        text.length,
        index + 120
      )
    );


  return (

    /https?:\/\//i.test(
      context
    ) ||

    /www\./i.test(
      context
    ) ||

    /[\w.-]+@[\w.-]+\.\w+/.test(
      context
    )
  );
}


/* =========================================================
   BIR TAKIM
========================================================= */

function looksLikeIndefiniteBirTakim(
  text,
  index
) {

  const context =
    text.slice(
      Math.max(
        0,
        index - 30
      ),
      Math.min(
        text.length,
        index + 80
      )
    )
      .toLowerCase();


  /*
    "bir takım elbise", "bir takım oyuncular"
    gibi gerçek "takım" isim kullanımını
    otomatik değiştirme.
  */

  if (
    /\bbir takım\s+(elbis|oyunc|takım|insan|ekip|malzeme)/i.test(
      context
    )
  ) {

    return false;
  }


  return true;
}


/* =========================================================
   PRESERVE CASE
========================================================= */

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


/* =========================================================
   ARTICLE KEY
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

      u.hostname
        .toLowerCase() +

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


/* =========================================================
   URL USEFULNESS
========================================================= */

function isUsefulNavigationUrl(
  url
) {

  try {

    const pathname =
      new URL(
        url
      )
        .pathname
        .toLowerCase();


    const blocked = [

      "/login",
      "/giris",

      "/register",
      "/kayit",

      "/logout",

      "/search",
      "/arama",

      "/iletisim",
      "/contact",

      "/privacy",
      "/gizlilik",

      "/terms",

      "/cookie",

      "/rss",

      "/feed",

      "/sitemap"

    ];


    return !blocked.some(
      item =>
        pathname === item ||
        pathname.startsWith(
          item + "/"
        )
    );

  } catch {

    return false;
  }
}


function isLikelyUsefulUrl(
  url,
  hostname
) {

  try {

    const parsed =
      new URL(
        url
      );


    return (
      parsed.hostname ===
        hostname &&
      isUsefulNavigationUrl(
        url
      )
    );

  } catch {

    return false;
  }
}


/* =========================================================
   UNIQUE
========================================================= */

function unique(
  array
) {

  return [
    ...new Set(
      array
    )
  ];
}


function uniqueStructured(
  array
) {

  const map =
    new Map();


  for (
    const item of
    array
  ) {

    if (
      !item?.url
    ) {
      continue;
    }


    const key =
      articleKey(
        item.url
      );


    if (
      !map.has(key)
    ) {

      map.set(
        key,
        item
      );
    }
  }


  return [
    ...map.values()
  ];
}


/* =========================================================
   CONCURRENCY ENGINE
========================================================= */

async function mapWithConcurrency(
  items,
  concurrency,
  worker
) {

  const results =
    new Array(
      items.length
    );


  let cursor =
    0;


  async function runner() {

    while (true) {

      const index =
        cursor++;


      if (
        index >=
        items.length
      ) {

        return;
      }


      try {

        results[index] =
          await worker(
            items[index],
            index
          );

      } catch (
        error
      ) {

        results[index] =
          {
            error:
              error?.message ||
              "İşlem başarısız."
          };
      }
    }
  }


  const workers =
    [];


  const count =
    Math.min(
      concurrency,
      items.length
    );


  for (
    let i = 0;
    i < count;
    i++
  ) {

    workers.push(
      runner()
    );
  }


  await Promise.all(
    workers
  );


  return results;
}


/* =========================================================
   CONTENT TYPE
========================================================= */

function isHtml(
  contentType
) {

  return /text\/html|application\/xhtml\+xml/i.test(
    contentType ||
    ""
  );
}


function isXml(
  contentType
) {

  return /xml|rss|atom/i.test(
    contentType ||
    ""
  );
}


/* =========================================================
   CLEAN / STRIP / ENTITIES
========================================================= */

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
      /<\/li>/gi,
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
   NORMALIZE COMPARE
========================================================= */

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


/* =========================================================
   FRONTEND
========================================================= */

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

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:#f5f7fa;
  color:#172033;
  font-family:
    Inter,
    Arial,
    Helvetica,
    sans-serif;
}

.container{
  max-width:1100px;
  margin:auto;
  padding:28px 16px 60px;
}

h1{
  margin:0 0 7px;
  font-size:30px;
}

.subtitle{
  color:#667085;
  margin-bottom:22px;
  line-height:1.5;
}

.panel{
  background:#fff;
  border-radius:16px;
  padding:20px;
  box-shadow:
    0 2px 15px rgba(0,0,0,.06);
}

input{
  width:100%;
  padding:14px 15px;
  font-size:16px;
  border:
    1px solid #d0d5dd;
  border-radius:10px;
  margin-bottom:11px;
  outline:none;
}

input:focus{
  border-color:#667085;
}

button{
  padding:12px 17px;
  border:0;
  border-radius:9px;
  cursor:pointer;
  margin-right:7px;
  margin-bottom:7px;
  font-size:14px;
}

button:disabled{
  opacity:.55;
  cursor:not-allowed;
}

.primary{
  background:#172033;
  color:white;
}

.secondary{
  background:#e8ecf2;
  color:#172033;
}

.status{
  margin-top:10px;
  padding:12px;
  border-radius:9px;
  background:#f2f4f7;
  line-height:1.5;
}

.status.running{
  background:#eef4ff;
}

.status.success{
  background:#ecfdf3;
  color:#067647;
}

.status.fail{
  background:#fff1f0;
  color:#b42318;
}

.stats{
  display:grid;
  grid-template-columns:
    repeat(5,1fr);
  gap:10px;
  margin:16px 0;
}

.stat{
  background:#fff;
  border-radius:11px;
  padding:15px;
  box-shadow:
    0 2px 10px rgba(0,0,0,.04);
}

.stat strong{
  display:block;
  font-size:25px;
  margin-bottom:4px;
}

.stat span{
  color:#667085;
  font-size:13px;
}

.page{
  background:#fff;
  padding:18px;
  margin-top:12px;
  border-radius:12px;
  box-shadow:
    0 2px 10px rgba(0,0,0,.04);
}

.page h3{
  margin:
    0 0 6px;
  line-height:1.4;
}

.meta{
  color:#667085;
  font-size:13px;
  margin:
    5px 0;
  word-break:
    break-word;
}

.good{
  margin-top:11px;
  color:#067647;
  font-weight:500;
}

.error{
  background:#fff1f0;
  border-left:
    4px solid #d92d20;
  padding:11px;
  margin-top:8px;
  border-radius:6px;
  line-height:1.5;
}

.suspicious{
  background:#fffaeb;
  border-left:
    4px solid #f79009;
  padding:11px;
  margin-top:10px;
  border-radius:6px;
  line-height:1.5;
}

.ai{
  color:#6941c6;
  font-weight:bold;
}

.badge{
  display:inline-block;
  padding:3px 7px;
  border-radius:20px;
  font-size:11px;
  background:#f2f4f7;
  margin-left:4px;
}

.progress{
  margin-top:10px;
  height:5px;
  background:#eaecf0;
  border-radius:10px;
  overflow:hidden;
}

.progressBar{
  height:100%;
  width:0%;
  transition:
    width .3s ease;
  background:#172033;
}

.empty{
  background:#fff;
  border-radius:12px;
  padding:25px;
  margin-top:15px;
  color:#667085;
  text-align:center;
}

@media(max-width:800px){

  .stats{
    grid-template-columns:
      repeat(3,1fr);
  }

}

@media(max-width:550px){

  .stats{
    grid-template-columns:
      repeat(2,1fr);
  }

  h1{
    font-size:26px;
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
Gerçek web taraması + hassas editoryal denetim + NVIDIA AI ikinci görüşü
</div>


<div class="panel">

<input
 id="url"
 type="url"
 value="https://www.gercekgundem.com/"
 placeholder="https://www.ornek.com"
 autocomplete="url"
/>


<button
 id="scanButton"
 class="primary"
 onclick="scan()"
>
Siteyi Tara
</button>


<button
 id="aiButton"
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


<div
 id="progress"
 class="progress"
 style="display:none"
>

<div
 id="progressBar"
 class="progressBar"
></div>

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

let scanning = false;


/* =========================================================
   AI TEST
========================================================= */

async function testAI(){

  if(scanning){
    return;
  }

  const status =
    document.getElementById(
      "status"
    );

  const button =
    document.getElementById(
      "aiButton"
    );

  button.disabled = true;

  setStatus(
    "NVIDIA AI bağlantısı test ediliyor...",
    "running"
  );

  try{

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () => controller.abort(),
        12000
      );

    const response =
      await fetch(
        "/api/ai-test",
        {
          method:"GET",
          cache:"no-store",
          signal:
            controller.signal
        }
      );

    clearTimeout(timer);

    const data =
      await response.json();

    if(!response.ok || !data.ok){

      throw new Error(
        data.error ||
        "NVIDIA AI bağlantısı başarısız."
      );
    }

    setStatus(
      "✓ NVIDIA AI bağlantısı başarılı. Model: " +
      escapeHtml(
        data.model
      ),
      "success"
    );

  }catch(error){

    setStatus(
      "NVIDIA AI bağlantı hatası: " +
      (
        error?.message ||
        "Bağlantı kurulamadı."
      ),
      "fail"
    );

  }finally{

    button.disabled = false;
  }
}


/* =========================================================
   SCAN
========================================================= */

async function scan(){

  if(scanning){
    return;
  }

  const url =
    document
      .getElementById(
        "url"
      )
      .value
      .trim();


  const results =
    document.getElementById(
      "results"
    );


  const stats =
    document.getElementById(
      "stats"
    );


  const scanButton =
    document.getElementById(
      "scanButton"
    );


  if(!url){

    setStatus(
      "Lütfen taranacak web sitesinin adresini girin.",
      "fail"
    );

    return;
  }


  scanning = true;

  scanButton.disabled = true;

  results.innerHTML = "";

  stats.style.display = "none";


  showProgress();


  setStatus(
    "Site keşfediliyor... Ana sayfa, sitemap ve haber bağlantıları paralel olarak taranıyor.",
    "running"
  );


  /*
    Uzun süreli ağ bağlantılarında
    tarayıcı tarafında kontrol.
  */

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () => {

        controller.abort();

      },
      28000
    );


  /*
    Progress yalnızca kullanıcı deneyimi.
  */

  let progress =
    5;


  const progressTimer =
    setInterval(
      () => {

        if(
          progress <
          90
        ){

          progress +=
            progress < 50
              ? 4
              : 1;

          setProgress(
            progress
          );
        }

      },
      700
    );


  try{

    const response =
      await fetch(
        "/api/scan",
        {
          method:
            "POST",

          cache:
            "no-store",

          headers:{
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              url
            }),

          signal:
            controller.signal
        }
      );


    clearTimeout(
      timeout
    );


    if(!response.ok){

      let data = null;

      try{
        data =
          await response.json();
      }catch{}

      throw new Error(
        data?.error ||
        "Sunucu taramayı tamamlayamadı. HTTP " +
        response.status
      );
    }


    const data =
      await response.json();


    if(!data.ok){

      throw new Error(
        data.error ||
        "Tarama başarısız."
      );
    }


    setProgress(100);


    renderStats(
      data.summary ||
      {}
    );


    const pages =
      data.pages ||
      [];


    if(!pages.length){

      results.innerHTML =
        '<div class="empty">' +
        "Siteye erişildi ancak analiz edilebilecek sayfa bulunamadı." +
        "</div>";

    }else{

      for(
        const page of pages
      ){

        results.appendChild(
          renderPage(
            page
          )
        );
      }
    }


    const summary =
      data.summary ||
      {};


    if(
      summary.partial
    ){

      setStatus(
        "⚠ Tarama zaman bütçesine ulaştı; bulunan sonuçlar eksiksiz şekilde gösteriliyor. " +
        summary.pagesScanned +
        " sayfa işlendi.",
        "success"
      );

    }else{

      setStatus(
        "✓ Tarama tamamlandı. " +
        (summary.articlesFound || 0) +
        " haber bulundu, " +
        (summary.totalErrors || 0) +
        " raporlanabilir hata tespit edildi. " +
        (summary.aiAnalyzed || 0) +
        " haber NVIDIA AI tarafından analiz edildi.",
        "success"
      );
    }


  }catch(error){

    clearTimeout(
      timeout
    );


    if(
      error?.name ===
      "AbortError"
    ){

      setStatus(
        "Tarama istemci zaman aşımına uğradı. Worker'ın uzun süre beklemesini önlemek için bağlantı sonlandırıldı.",
        "fail"
      );

    }else{

      setStatus(
        "Tarama hatası: " +
        (
          error?.message ||
          "Bağlantı kurulamadı."
        ),
        "fail"
      );
    }


    /*
      Kritik:
      Daha önce "Load failed" geldiğinde
      kullanıcı hiçbir açıklama göremiyordu.
      Burada açık hata kartı oluşturuyoruz.
    */

    results.innerHTML =
      '<div class="empty">' +
      "<strong>Tarama tamamlanamadı.</strong><br><br>" +
      escapeHtml(
        error?.message ||
        "Bilinmeyen bağlantı hatası."
      ) +
      "<br><br>" +
      "Bu hata, sitenin dışarıdan erişime kapalı olması veya ağ zaman aşımı nedeniyle oluşmuş olabilir." +
      "</div>";

  }finally{

    clearInterval(
      progressTimer
    );

    scanning = false;

    scanButton.disabled = false;

    setTimeout(
      hideProgress,
      500
    );
  }
}


/* =========================================================
   STATS
========================================================= */

function renderStats(
  s
){

  const stats =
    document.getElementById(
      "stats"
    );


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
    ) +

    stat(
      s.elapsedMs
        ? (
            Math.round(
              s.elapsedMs /
              100
            ) / 10
          ) + " sn"
        : "—",
      "Tarama süresi"
    );


  stats.style.display =
    "grid";
}


function stat(
  number,
  label
){

  return \`
    <div class="stat">
      <strong>\${escapeHtml(number)}</strong>
      <span>\${escapeHtml(label)}</span>
    </div>
  \`;
}


/* =========================================================
   PAGE RENDER
========================================================= */

function renderPage(
  page
){

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


  if(
    page.isArticle
  ){

    html +=
      '<span class="badge">HABER</span>';
  }


  if(
    page.aiAnalyzed
  ){

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


  if(
    page.error
  ){

    html +=
      '<div class="error">' +
      escapeHtml(
        page.error
      ) +
      "</div>";

    div.innerHTML =
      html;

    return div;
  }


  const errors =
    page.errors ||
    [];


  if(
    errors.length ===
    0
  ){

    html +=
      '<div class="good">' +
      "Bu sayfada raporlanabilir hata bulunmadı." +
      "</div>";

  }else{

    html +=
      "<strong>" +
      errors.length +
      " raporlanabilir hata</strong>";


    for(
      const error of
      errors
    ){

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


  if(
    suspicious.length
  ){

    html +=
      '<div class="suspicious">' +

      "<strong>" +
      "Bağlama göre incelenmesi gerekenler" +
      "</strong>";


    for(
      const item of
      suspicious.slice(
        0,
        8
      )
    ){

      html +=
        "<div>" +

        "<b>" +
        escapeHtml(
          item.original
        ) +
        "</b>" +

        " — " +

        escapeHtml(
          item.reason
        ) +

        "</div>";
    }


    html +=
      "</div>";
  }


  if(
    page.aiError
  ){

    html +=
      '<div class="error">' +

      "NVIDIA AI analizi tamamlanamadı: " +

      escapeHtml(
        page.aiError
      ) +

      "</div>";
  }


  div.innerHTML =
    html;


  return div;
}


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  text,
  type
){

  const status =
    document.getElementById(
      "status"
    );


  status.className =
    "status " +
    (
      type ||
      ""
    );


  status.innerHTML =
    text;
}


/* =========================================================
   PROGRESS
========================================================= */

function showProgress(){

  document.getElementById(
    "progress"
  ).style.display =
    "block";

  setProgress(
    5
  );
}


function setProgress(
  value
){

  document.getElementById(
    "progressBar"
  ).style.width =
    Math.max(
      0,
      Math.min(
        100,
        value
      )
    ) +
    "%";
}


function hideProgress(){

  document.getElementById(
    "progress"
  ).style.display =
    "none";
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(
  value
){

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
          "no-store",

        "access-control-allow-origin":
          "*",

        "access-control-allow-methods":
          "GET,POST,DELETE,OPTIONS",

        "access-control-allow-headers":
          "Content-Type"
      }
    }
  );
}

/* =========================================================
   WEBPROOF AI — FAST CRAWLER + RULE ENGINE + NVIDIA REVIEW
   Cloudflare Worker
========================================================= */

const MAX_DISCOVERY_PAGES = 8;
const MAX_ARTICLES = 8;
const MAX_LINKS = 250;

const MAX_HTML_BYTES = 1000000;
const MAX_ARTICLE_TEXT = 14000;

const FETCH_TIMEOUT = 6500;
const AI_TIMEOUT = 12000;

/*
  NVIDIA'nın güncel endpoint'inde mevcut model.
  NVIDIA Build sayfasında ücretsiz endpoint olarak listeleniyor.
*/
const NVIDIA_MODEL =
  "nvidia/nemotron-3.5-lightning-30b-a3b";

const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const temporaryTasks = [];


/* =========================================================
   MAIN ROUTER
========================================================= */

export default {
  async fetch(request, env) {

    const url =
      new URL(request.url);

    try {

      /* -----------------------------------------------------
         FRONTEND
      ----------------------------------------------------- */

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {
        return new Response(
          frontendHTML(),
          {
            headers: {
              "content-type":
                "text/html; charset=UTF-8",
              "cache-control":
                "no-store"
            }
          }
        );
      }


      /* -----------------------------------------------------
         STATUS
      ----------------------------------------------------- */

      if (
        request.method === "GET" &&
        url.pathname === "/api/status"
      ) {

        const exists =
          Boolean(
            env.NVIDIA_API_KEY
          );

        return json({
          ok: true,
          service: "WebProof AI",

          status: "online",

          crawler:
            "fast-editorial-crawler-v2",

          ruleEngine:
            "precision-first",

          ai:
            exists
              ? "configured"
              : "missing-api-key",

          aiModel:
            NVIDIA_MODEL,

          aiEndpoint:
            NVIDIA_ENDPOINT,

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
        });
      }


      /* -----------------------------------------------------
         NVIDIA TEST
      ----------------------------------------------------- */

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
              aiConfigured: false,
              error:
                "NVIDIA_API_KEY Worker runtime'ında bulunamadı."
            },
            500
          );
        }

        const test =
          await analyzeWithNvidia(
            "WebProof AI bağlantı testi",
            "WebProof AI bağlantı testi başarılı çalışıyor.",
            {
              errors: [],
              suspicious: []
            },
            env
          );

        return json({
          ok: true,

          aiConfigured:
            true,

          aiReachable:
            true,

          message:
            "NVIDIA AI API bağlantısı başarılı.",

          model:
            NVIDIA_MODEL,

          result:
            test
        });
      }


      /* -----------------------------------------------------
         SCAN
      ----------------------------------------------------- */

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

        return json(
          await scanWebsite(
            body.url,
            env
          )
        );
      }


      /* -----------------------------------------------------
         TASKS
      ----------------------------------------------------- */

      if (
        request.method === "GET" &&
        url.pathname === "/api/tasks"
      ) {

        return json({
          ok: true,
          tasks:
            temporaryTasks
        });
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
            "Beklenmeyen sunucu hatası."
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

  const startedAt =
    Date.now();

  const start =
    normalizeUrl(
      inputUrl
    );

  if (!start) {
    throw new Error(
      "Geçerli bir HTTP/HTTPS URL girin."
    );
  }

  const startUrl =
    new URL(start);

  const hostname =
    startUrl.hostname
      .toLowerCase();


  const discovered =
    new Set([start]);

  const visited =
    new Set();

  const pages =
    [];

  const articleCandidates =
    new Map();

  let linksFound = 0;

  let aiAttempted = 0;
  let aiSucceeded = 0;
  let aiFailed = 0;


  /*
    ---------------------------------------------------------
    DISCOVERY QUEUE
    ---------------------------------------------------------
  */

  let queue = [
    {
      url: start,
      score: 100
    }
  ];


  /*
    ---------------------------------------------------------
    FAST DISCOVERY
    ---------------------------------------------------------
  */

  while (
    queue.length &&
    visited.size <
      MAX_DISCOVERY_PAGES
  ) {

    queue.sort(
      (a, b) =>
        b.score -
        a.score
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
        url:
          current.url,

        title:
          "",

        status:
          0,

        language:
          "",

        isArticle:
          false,

        articleScore:
          0,

        textLength:
          0,

        errors:
          [],

        suspicious:
          [],

        aiErrors:
          [],

        aiSuspicious:
          [],

        aiAnalyzed:
          false,

        aiStatus:
          "not-run",

        error:
          error?.message ||
          "Sayfa alınamadı."
      });

      continue;
    }


    const html =
      page.html;

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


    /*
      SADECE GERÇEK HABERLERDE
      KURAL MOTORU ÇALIŞIYOR.
    */

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

      url:
        current.url,

      title:
        title ||
        current.url,

      status:
        page.status,

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

      aiErrors:
        [],

      aiSuspicious:
        [],

      aiAnalyzed:
        false,

      aiStatus:
        env.NVIDIA_API_KEY
          ? "queued"
          : "not-configured",

      aiError:
        null,

      error:
        null
    };


    pages.push(
      pageResult
    );


    /*
      HABER ADAYI
    */

    if (
      isArticle &&
      text.length >= 500
    ) {

      const key =
        articleKey(
          current.url
        );

      const existing =
        articleCandidates.get(
          key
        );

      if (
        !existing ||
        existing.score <
          score
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


    /*
      LINK DISCOVERY
    */

    const links =
      extractLinks(
        html,
        current.url,
        hostname
      );

    linksFound +=
      links.length;


    for (
      const link of
      links
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
        KATEGORİ / VIDEO / GALERİ
        gibi linkleri aşağı at.
      */

      queue.push({
        url:
          link,

        score:
          linkScore
      });
    }
  }


  /*
    ---------------------------------------------------------
    FALLBACK ARTICLE DISCOVERY
    ---------------------------------------------------------
  */

  if (
    articleCandidates.size === 0 &&
    queue.length
  ) {

    const fallback =
      queue
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(
          0,
          MAX_ARTICLES
        );


    for (
      const candidate of
      fallback
    ) {

      if (
        visited.has(
          candidate.url
        )
      ) {
        continue;
      }

      visited.add(
        candidate.url
      );


      try {

        const page =
          await fetchPage(
            candidate.url
          );

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

            isArticle:
              true,

            articleScore:
              score,

            textLength:
              text.length,

            errors:
              rule.errors,

            suspicious:
              rule.suspicious,

            aiErrors:
              [],

            aiSuspicious:
              [],

            aiAnalyzed:
              false,

            aiStatus:
              env.NVIDIA_API_KEY
                ? "queued"
                : "not-configured",

            aiError:
              null,

            error:
              null
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

      } catch {}
    }
  }


  /*
    ---------------------------------------------------------
    FINAL ARTICLES
    ---------------------------------------------------------
  */

  const finalArticles =
    Array.from(
      articleCandidates.values()
    )
      .sort(
        (a, b) =>
          b.score -
          a.score
      )
      .slice(
        0,
        MAX_ARTICLES
      );


  /*
    ---------------------------------------------------------
    NVIDIA SECOND OPINION
    ---------------------------------------------------------

    ÇOK ÖNEMLİ:

    Rule engine = bariz / deterministik hatalar

    NVIDIA =
    bağlam gerektiren,
    sözlükte olmayan,
    dilbilgisi,
    kelime seçimi,
    cümle içi kullanım,
    şüpheli ifade.

    Yani her şeyi NVIDIA'ya göndermiyoruz.
  */

  if (
    env.NVIDIA_API_KEY &&
    finalArticles.length
  ) {

    const aiJobs =
      finalArticles.map(
        async article => {

          const page =
            pages[
              article.pageIndex
            ];

          if (!page) {
            return {
              ok: false
            };
          }


          /*
            AI'ya gönderilecek metni
            küçültüyoruz.
          */

          const aiText =
            article.text.slice(
              0,
              MAX_ARTICLE_TEXT
            );


          /*
            Bariz kural hatalarını
            AI'ya tekrar sormuyoruz.
          */

          const deterministicErrors =
            page.errors || [];


          const candidateText =
            prepareAiCandidateText(
              aiText,
              deterministicErrors
            );


          /*
            Hiçbir bağlamsal aday yoksa
            AI çağrısını gereksiz yapma.
            
            Fakat haber çok uzunsa ve
            rule engine hiç hata bulmadıysa
            AI yine ikinci görüş yapabilir.
          */

          const shouldAskAI =
            candidateText.length >=
            250;


          if (!shouldAskAI) {

            page.aiStatus =
              "skipped-no-candidate";

            return {
              ok: true,
              skipped: true
            };
          }


          aiAttempted++;


          try {

            const result =
              await analyzeWithNvidia(
                article.title,
                candidateText,
                {
                  errors:
                    deterministicErrors,
                  suspicious:
                    page.suspicious
                },
                env
              );


            page.aiAnalyzed =
              true;

            page.aiStatus =
              "success";

            page.aiErrors =
              validateAiErrors(
                result.errors || [],
                article.text
              );

            page.aiSuspicious =
              Array.isArray(
                result.suspicious
              )
                ? result.suspicious.slice(
                    0,
                    20
                  )
                : [];


            /*
              AI yalnızca doğrulanmış
              gerçek hataları ekler.
            */

            page.errors =
              mergeErrors(
                page.errors,
                page.aiErrors
              );


            page.suspicious =
              mergeSuspicious(
                page.suspicious,
                page.aiSuspicious
              );


            aiSucceeded++;


            return {
              ok: true
            };

          } catch (error) {

            page.aiStatus =
              "failed";

            page.aiError =
              error?.message ||
              "NVIDIA AI analizi başarısız.";

            aiFailed++;

            return {
              ok: false,
              error:
                page.aiError
            };
          }
        }
      );


    /*
      PARALEL AI.
      8 haber varsa 8 AI çağrısı
      sırayla beklenmez.
    */

    await Promise.allSettled(
      aiJobs
    );
  }


  /*
    ---------------------------------------------------------
    SUMMARY
    ---------------------------------------------------------
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


  const aiConfigured =
    Boolean(
      env.NVIDIA_API_KEY
    );


  const durationMs =
    Date.now() -
    startedAt;


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

      aiConfigured,

      aiAttempted,

      aiSucceeded,

      aiFailed,

      aiAnalyzed,

      durationMs,

      durationSeconds:
        Number(
          (
            durationMs /
            1000
          ).toFixed(2)
        )
    },


    ai: {

      configured:
        aiConfigured,

      model:
        NVIDIA_MODEL,

      endpoint:
        NVIDIA_ENDPOINT,

      attempted:
        aiAttempted,

      succeeded:
        aiSucceeded,

      failed:
        aiFailed,

      analyzed:
        aiAnalyzed,

      role:
        "contextual-second-opinion",

      deterministicErrorsBypassAI:
        true
    },


    quality: {

      philosophy:
        "precision-first",

      falsePositiveProtection:
        true,

      contextAwareAI:
        aiConfigured,

      parallelAI:
        true,

      aiTimeout:
        AI_TIMEOUT,

      languageDetection:
        true,

      urlProtection:
        true,

      properNameProtection:
        true,

      numberProtection:
        true,

      sourceLinkOnEveryError:
        true,

      aiValidation:
        true
    },


    pages
  };
}


/* =========================================================
   AI CANDIDATE PREPARATION
========================================================= */

function prepareAiCandidateText(
  text,
  deterministicErrors
) {

  let result =
    String(text || "");


  /*
    Rule engine tarafından zaten
    kesin hata kabul edilen ifadeleri
    AI promptundan çıkarıyoruz.
  */

  for (
    const item of
    deterministicErrors || []
  ) {

    if (
      !item?.original
    ) {
      continue;
    }

    result =
      result.replace(
        item.original,
        " "
      );
  }


  return result
    .replace(
      /\s+/g,
      " "
    )
    .trim();
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
              "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",

            "Accept-Language":
              "tr-TR,tr;q=0.9,en;q=0.7"
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
        "application/xhtml+xml"
      )
    ) {

      throw new Error(
        "HTML olmayan içerik."
      );
    }


    if (
      response.status >= 400
    ) {

      throw new Error(
        `HTTP ${response.status}`
      );
    }


    const html =
      await response.text();


    return {

      status:
        response.status,

      html:
        html.length >
        MAX_HTML_BYTES

          ? html.slice(
              0,
              MAX_HTML_BYTES
            )

          : html
    };

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        `Sayfa zaman aşımına uğradı (${FETCH_TIMEOUT} ms).`
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


  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      AI_TIMEOUT
    );


  const language =
    detectTextLanguage(
      text
    );


  const prompt = `
You are the SECOND-OPINION EDITOR for a professional newsroom.

Your job is NOT to rewrite the article.

You are checking only for genuine language errors that require
contextual or linguistic judgment.

ARTICLE TITLE:
${title}

LANGUAGE:
${language}

ARTICLE TEXT:
${text.slice(
  0,
  MAX_ARTICLE_TEXT
)}

DETERMINISTIC RULE ENGINE FINDINGS:
${JSON.stringify(
  ruleAnalysis
)}

IMPORTANT ARCHITECTURE:

The deterministic rule engine already handles obvious,
high-confidence errors.

DO NOT repeat those errors.

Your job is to detect errors such as:

- context-dependent spelling mistakes
- incorrect word usage
- genuine Turkish grammar errors
- Turkish de/da mistakes
- Turkish ki mistakes
- Turkish mi mistakes
- incorrect compound-word usage
- capitalization errors
- sentence-level punctuation errors
- obvious accidental word substitutions
- a real typo where the intended word is clear from context
- English grammar/spelling problems

VERY IMPORTANT:

If a word looks unusual but could be a proper name,
surname, organization, place, brand, political term,
technical term, quoted expression or foreign name,
DO NOT report it unless the context makes the error certain.

For example:

"kelem" used where "kalem" is clearly intended:
report it only if the surrounding sentence proves
that "kalem" is the intended word.

Do NOT report stylistic preferences.

Do NOT rewrite sentences.

Do NOT make political terminology changes.

Do NOT change a quote merely because you dislike its wording.

Do NOT change factual information.

Do NOT change numbers unless the language itself is objectively wrong.

Do NOT change dates.

Do NOT change URLs.

Do NOT change e-mail addresses.

Do NOT change names.

Do NOT change organization names.

Do NOT change locations.

Precision is more important than recall.

Only report errors with confidence >= 0.90.

The original field MUST be an exact substring of the article text.

The correction field must contain ONLY the replacement text.

Return ONLY valid JSON.

FORMAT:

{
  "errors": [
    {
      "original": "...",
      "correction": "...",
      "type": "yazım|noktalama|dilbilgisi|büyük-harf|kelime-kullanımı|diğer",
      "confidence": 0.95,
      "reason": "Kısa açıklama."
    }
  ],
  "suspicious": [
    {
      "original": "...",
      "reason": "Neden bağlama bağlı olduğu."
    }
  ]
}

If there are no genuine errors:

{
  "errors": [],
  "suspicious": []
}
`;


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

              top_p:
                0.9,

              max_tokens:
                2200,

              stream:
                false
            })
        }
      );


    const raw =
      await response.text();


    if (
      !response.ok
    ) {

      throw new Error(
        `NVIDIA API ${response.status}: ${raw.slice(0, 500)}`
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
        "NVIDIA API geçerli JSON döndürmedi."
      );
    }


    const content =
      data?.choices?.[0]?.message?.content ||
      "";


    if (!content) {

      throw new Error(
        "NVIDIA API boş yanıt döndürdü."
      );
    }


    const parsed =
      safeJson(
        content
      );


    return {

      errors:
        Array.isArray(
          parsed.errors
        )
          ? parsed.errors
          : [],

      suspicious:
        Array.isArray(
          parsed.suspicious
        )
          ? parsed.suspicious
          : []
    };

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        `NVIDIA AI zaman aşımı (${AI_TIMEOUT} ms).`
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
   AI ERROR VALIDATION
========================================================= */

function validateAiErrors(
  errors,
  originalText
) {

  const result =
    [];


  for (
    const item of
    errors || []
  ) {

    if (
      !item ||
      typeof item.original !==
        "string" ||
      typeof item.correction !==
        "string"
    ) {
      continue;
    }


    const original =
      item.original.trim();

    const correction =
      item.correction.trim();


    if (
      !original ||
      !correction ||
      original ===
        correction
    ) {
      continue;
    }


    /*
      AI'nin uydurduğu ifade
      makalede gerçekten yoksa
      kabul etme.
    */

    if (
      !originalText.includes(
        original
      )
    ) {
      continue;
    }


    const confidence =
      Number(
        item.confidence
      );


    if (
      !Number.isFinite(
        confidence
      ) ||
      confidence <
        0.90
    ) {
      continue;
    }


    /*
      URL / e-mail koruması.
    */

    if (
      looksLikeProtectedToken(
        original
      )
    ) {
      continue;
    }


    result.push({

      original,

      correction,

      type:
        item.type ||
        "diğer",

      confidence,

      reason:
        item.reason ||
        "NVIDIA AI tarafından bağlam içinde tespit edildi.",

      source:
        "nvidia-ai",

      aiSecondOpinion:
        true
    });
  }


  return dedupeErrors(
    result
  ).slice(
    0,
    30
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
      looksLikeProtectedToken(
        original
      )
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
        "rule-engine",

      deterministic:
        true
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
    ---------------------------------------------------------
    BARİZ BOŞLUK HATALARI
    ---------------------------------------------------------
  */

  for (
    const match of
    text.matchAll(
      /[ \t]{2,}/g
    )
  ) {

    const value =
      match[0];

    /*
      Satır başlangıcı /
      biçimlendirme kaynaklı boşlukları
      görmezden gel.
    */

    if (
      value.length <= 4
    ) {

      add(
        value,
        " ",
        "boşluk",
        "Gereksiz birden fazla boşluk."
      );
    }
  }


  /*
    ---------------------------------------------------------
    NOKTALAMA ÖNCESİ BOŞLUK
    ---------------------------------------------------------

    HTML extraction kaynaklı
    ". Ş" / "i ," gibi bozuk örnekleri
    daha kontrollü ele alıyoruz.
  */

  for (
    const match of
    text.matchAll(
      /([A-Za-zÇĞİÖŞÜçğıöşü0-9])\s+([,;:!?])/g
    )
  ) {

    const index =
      match.index;

    if (
      inProtectedContext(
        text,
        index
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
  }


  /*
    Nokta için daha katı kontrol.
    .Ş gibi durumlarda bunun gerçekten
    cümle sonu olup olmadığına bakıyoruz.
  */

  for (
    const match of
    text.matchAll(
      /([a-zçğıöşü0-9])\s+\./g
    )
  ) {

    if (
      inProtectedContext(
        text,
        match.index
      )
    ) {
      continue;
    }


    add(
      match[0],
      match[1] + ".",
      "noktalama",
      "Nokta işaretinden önce gereksiz boşluk var."
    );
  }


  /*
    ---------------------------------------------------------
    TEKRARLANAN NOKTALAMA
    ---------------------------------------------------------
  */

  for (
    const match of
    text.matchAll(
      /([!?;,])\1+|\.{4,}/g
    )
  ) {

    if (
      inProtectedContext(
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
    ---------------------------------------------------------
    NOKTALAMA SONRASI EKSİK BOŞLUK
    ---------------------------------------------------------

    URL / domain / kısaltma / decimal
    gibi yapıları koruyoruz.
  */

  for (
    const match of
    text.matchAll(
      /([.!?])([A-Za-zÇĞİÖŞÜçğıöşü])/g
    )
  ) {

    const index =
      match.index;


    if (
      inProtectedContext(
        text,
        index
      )
    ) {
      continue;
    }


    /*
      "Dr.Şahin"
      "Prof.İsim"
      gibi özel isim / unvan
      durumlarını otomatik düzeltme.
    */

    const before =
      text.slice(
        Math.max(
          0,
          index - 12
        ),
        index + 8
      );


    if (
      /\b(Dr|Prof|Doç|Av|Sn|No)\.$/i.test(
        before.slice(
          0,
          before.lastIndexOf(
            match[0]
          )
        )
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
    ---------------------------------------------------------
    TÜRKÇE BARİZ YAZIM HATALARI
    ---------------------------------------------------------
  */

  if (
    language === "tr"
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
        "'Birtakım' anlamında bitişik yazılır."
      ],

      [
        /\bbir kaç\b/gi,
        "birkaç",
        "'Birkaç' bitişik yazılır."
      ],

      [
        /\bhiç birisi\b/gi,
        "hiçbirisi",
        "'Hiçbirisi' bitişik yazılır."
      ],

      [
        /\bşeyler\b/gi,
        "şeyler",
        "Kontrol için ayrılmış sözcük."
      ],

      [
        /\bmi ki\b/gi,
        "mi ki",
        "Bağlama göre kontrol edilmesi gereken yapı."
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
          Bazı kalıpları doğrudan
          hata olarak değil AI adayına
          bırakıyoruz.
        */

        if (
          rule[1] ===
          "şeyler"
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
    ---------------------------------------------------------
    İNGİLİZCE
    ---------------------------------------------------------
  */

  if (
    language === "en"
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
        /\beveryday\b/gi,
        "every day",
        "Use 'every day' when referring to frequency."
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
    ---------------------------------------------------------
    SAYILAR
    ---------------------------------------------------------

    Artık her sayıyı suspicious olarak
    göstermiyoruz.

    Sadece çok kritik / alışılmadık
    biçimler AI adayına bırakılabilir.
  */

  for (
    const match of
    text.matchAll(
      /\b\d{6,}\b/g
    )
  ) {

    suspect(
      match[0],
      "Uzun sayısal ifade; bağlama göre doğrulanabilir."
    );
  }


  return {

    errors:
      errors
        .slice(
          0,
          40
        ),

    suspicious:
      suspicious
        .slice(
          0,
          12
        )
  };
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
        String(value).trim()
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
      const key of
      remove
    ) {

      url.searchParams.delete(
        key
      );
    }


    url.hash =
      "";


    return url.toString();

  } catch {

    return null;
  }
}


/* =========================================================
   SSRF PROTECTION
========================================================= */

function isPrivateHostname(
  hostname
) {

  const h =
    String(
      hostname || ""
    )
      .toLowerCase();


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
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
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
   METİN
========================================================= */

function extractMainText(
  html
) {

  let source =
    String(html || "");


  /*
    Önce script / style / navigation
    gibi alanları temizle.
  */

  source =
    source.replace(
      /<(script|style|noscript|svg|canvas|iframe|nav|footer|header|aside|form|button|select|option|menu)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );


  /*
    ARTICLE
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
      text.length >= 500
    ) {

      return text.slice(
        0,
        30000
      );
    }
  }


  /*
    MAIN
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
      text.length >= 500
    ) {

      return text.slice(
        0,
        30000
      );
    }
  }


  /*
    PARAGRAFLAR
  */

  const paragraphs =
    [];


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
      text.length >= 40
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
   LINKS
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

    let raw =
      decodeEntities(
        match[1]
      )
        .trim();


    if (
      !raw ||
      raw.startsWith("#") ||
      /^javascript:/i.test(raw) ||
      /^mailto:/i.test(raw) ||
      /^tel:/i.test(raw)
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
        absolute.hostname
          .toLowerCase() !==
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

  let score =
    0;


  let pathname =
    "";


  try {

    pathname =
      new URL(
        url
      ).pathname
        .toLowerCase();

  } catch {}


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
    const item of
    excluded
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


  const strong = [

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
    const signal of
    strong
  ) {

    if (
      pathname.includes(
        signal
      )
    ) {

      score += 35;
    }
  }


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


  if (
    title &&
    title.length >= 25 &&
    title.length <= 220
  ) {

    score += 20;
  }


  if (
    text.length >= 700
  ) {
    score += 25;
  }


  if (
    text.length >= 1600
  ) {
    score += 20;
  }


  if (
    /<article\b/i.test(
      html
    )
  ) {

    score += 30;
  }


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


  if (
    /"@type"\s*:\s*"(NewsArticle|Article|ReportageNewsArticle)"/i.test(
      html
    )
  ) {

    score += 50;
  }


  return score;
}


/* =========================================================
   ARTICLE CHECK
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
    text.length >= 1200
  ) {
    return true;
  }


  if (
    score >= 90 &&
    text.length >= 900
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
      lang.startsWith("tr")
    ) {
      return "tr";
    }


    if (
      lang.startsWith("en")
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
    " tarafından ",
    " ancak "
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


function detectTextLanguage(
  text
) {

  const lower =
    String(
      text || ""
    )
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
    " daha "
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
   PROTECTED CONTEXT
========================================================= */

function looksLikeProtectedToken(
  value
) {

  const text =
    String(
      value || ""
    );


  return (

    /https?:\/\//i.test(
      text
    ) ||

    /www\./i.test(
      text
    ) ||

    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(
      text
    ) ||

    /^#[A-Za-z0-9_-]+$/.test(
      text
    )
  );
}


function inProtectedContext(
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

    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(
      context
    )
  );
}


/* =========================================================
   MERGE
========================================================= */

function mergeErrors(
  a,
  b
) {

  return dedupeErrors([
    ...(a || []),
    ...(b || [])
  ]).slice(
    0,
    50
  );
}


function dedupeErrors(
  items
) {

  const result =
    [];


  for (
    const item of
    items || []
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


  return result;
}


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
   SAFE JSON
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
   HELPERS
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
          "*"
      }
    }
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

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>WebProof AI</title>

<style>

* {
  box-sizing:border-box;
}

body {
  margin:0;
  background:#f5f7fa;
  color:#172033;
  font-family:
    Inter,
    Arial,
    Helvetica,
    sans-serif;
}

.container {
  max-width:1100px;
  margin:auto;
  padding:25px 16px 60px;
}

h1 {
  margin:0 0 6px;
  font-size:30px;
}

.subtitle {
  color:#667085;
  margin-bottom:20px;
  line-height:1.5;
}

.panel {
  background:white;
  border-radius:15px;
  padding:18px;
  box-shadow:
    0 3px 15px rgba(0,0,0,.06);
}

input {
  width:100%;
  padding:14px;
  font-size:16px;
  border:
    1px solid #d0d5dd;
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
  font-weight:600;
}

button:disabled {
  opacity:.55;
  cursor:not-allowed;
}

.primary {
  background:#172033;
  color:white;
}

.secondary {
  background:#e8ecf2;
  color:#172033;
}

.status {
  margin-top:10px;
  padding:12px;
  border-radius:8px;
  background:#f2f4f7;
  line-height:1.5;
}

.status.success {
  background:#ecfdf3;
  color:#067647;
}

.status.error {
  background:#fef3f2;
  color:#b42318;
}

.stats {
  display:grid;
  grid-template-columns:
    repeat(5,1fr);
  gap:10px;
  margin:16px 0;
}

.stat {
  background:white;
  border-radius:10px;
  padding:15px;
  box-shadow:
    0 2px 8px rgba(0,0,0,.04);
}

.stat strong {
  display:block;
  font-size:25px;
  margin-bottom:3px;
}

.stat span {
  color:#667085;
  font-size:13px;
}

.page {
  background:white;
  padding:18px;
  margin-top:12px;
  border-radius:11px;
  box-shadow:
    0 2px 8px rgba(0,0,0,.04);
}

.page h3 {
  margin-top:0;
  margin-bottom:7px;
}

.meta {
  color:#667085;
  font-size:13px;
  margin:5px 0;
  word-break:break-word;
}

.article-link {
  display:inline-block;
  margin-top:7px;
  color:#175cd3;
  font-size:13px;
  text-decoration:none;
  font-weight:600;
}

.article-link:hover {
  text-decoration:underline;
}

.good {
  margin-top:12px;
  color:#067647;
  font-weight:600;
}

.error {
  background:#fff1f0;
  border-left:
    4px solid #d92d20;
  padding:11px;
  margin-top:9px;
  border-radius:6px;
}

.error-source {
  margin-top:8px;
  font-size:12px;
  color:#667085;
}

.error-context {
  margin-top:8px;
  padding:8px;
  background:#fff;
  border-radius:5px;
  font-size:13px;
  line-height:1.5;
}

.suspicious {
  background:#fffaeb;
  border-left:
    4px solid #f79009;
  padding:11px;
  margin-top:12px;
  border-radius:6px;
}

.ai {
  color:#6941c6;
  font-weight:bold;
}

.ai-ok {
  color:#067647;
  font-weight:600;
}

.ai-fail {
  color:#b42318;
  font-weight:600;
}

.badge {
  display:inline-block;
  padding:3px 7px;
  border-radius:999px;
  background:#f2f4f7;
  margin-left:4px;
  font-size:11px;
}

.scan-info {
  margin-top:10px;
  font-size:13px;
  color:#667085;
}

@media(max-width:800px) {

  .stats {
    grid-template-columns:
      repeat(3,1fr);
  }
}

@media(max-width:600px) {

  .stats {
    grid-template-columns:
      repeat(2,1fr);
  }

  h1 {
    font-size:25px;
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
  Gerçek web taraması +
  hassas editoryal denetim +
  NVIDIA AI ikinci görüşü
</div>


<div class="panel">


<input
  id="url"
  type="url"
  value="https://www.bbc.com/turkce/"
  placeholder="https://www.ornek.com"
>


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


/* =========================================================
   NVIDIA TEST
========================================================= */

async function testAI() {

  const status =
    document.getElementById(
      "status"
    );

  const button =
    document.getElementById(
      "aiButton"
    );


  button.disabled =
    true;


  status.className =
    "status";

  status.innerText =
    "NVIDIA AI bağlantısı test ediliyor...";


  try {

    const response =
      await fetch(
        "/api/ai-test",
        {
          cache:
            "no-store"
        }
      );


    const data =
      await response.json();


    if (
      data.ok
    ) {

      status.className =
        "status success";

      status.innerHTML =
        "✓ NVIDIA AI API bağlantısı başarılı." +
        "<br><span class='scan-info'>" +
        "Model: " +
        escapeHtml(
          data.model
        ) +
        "</span>";

    } else {

      throw new Error(
        data.error ||
        "NVIDIA bağlantısı başarısız."
      );
    }

  } catch(error) {

    status.className =
      "status error";

    status.innerText =
      "NVIDIA AI bağlantı hatası: " +
      error.message;

  } finally {

    button.disabled =
      false;
  }
}


/* =========================================================
   SCAN
========================================================= */

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


  const button =
    document
      .getElementById(
        "scanButton"
      );


  if (!url) {

    status.className =
      "status error";

    status.innerText =
      "Lütfen bir URL girin.";

    return;
  }


  button.disabled =
    true;


  status.className =
    "status";


  status.innerText =
    "Site keşfediliyor ve haberler analiz ediliyor...";


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

          headers: {
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
      !response.ok ||
      !data.ok
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
      ) +

      stat(
        s.aiAnalyzed || 0,
        "NVIDIA analizi"
      );


    stats.style.display =
      "grid";


    const aiText =
      s.aiConfigured

        ? (
            "NVIDIA: " +
            (s.aiSucceeded || 0) +
            " başarılı / " +
            (s.aiFailed || 0) +
            " başarısız"
          )

        : "NVIDIA API anahtarı bağlı değil";


    status.className =
      "status success";


    status.innerHTML =
      "✓ Tarama tamamlandı. " +

      "<b>" +
      (s.articlesFound || 0) +
      " haber</b> bulundu, " +

      "<b>" +
      (s.totalErrors || 0) +
      " raporlanabilir hata</b> tespit edildi." +

      "<br><span class='scan-info'>" +

      escapeHtml(
        aiText
      ) +

      " · " +

      escapeHtml(
        String(
          s.durationSeconds || 0
        )
      ) +

      " sn" +

      "</span>";


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


    if (
      !data.pages ||
      data.pages.length === 0
    ) {

      results.innerHTML =
        "<div class='page'>" +
        "<div class='good'>" +
        "Tarama tamamlandı ancak sonuç üretilemedi." +
        "</div>" +
        "</div>";
    }

  } catch(error) {

    status.className =
      "status error";

    status.innerText =
      "Tarama hatası: " +
      error.message;

  } finally {

    button.disabled =
      false;
  }
}


/* =========================================================
   STAT
========================================================= */

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


/* =========================================================
   PAGE RENDER
========================================================= */

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
    page.isArticle
  ) {

    html +=
      ' <span class="badge">HABER</span>';
  }


  if (
    page.aiAnalyzed
  ) {

    html +=
      ' · <span class="ai">NVIDIA AI ✓</span>';

  } else if (
    page.aiStatus ===
    "failed"
  ) {

    html +=
      ' · <span class="ai-fail">NVIDIA AI ✕</span>';

  } else if (
    page.aiStatus ===
    "skipped-no-candidate"
  ) {

    html +=
      ' · <span class="meta">AI: atlandı</span>';
  }


  html +=
    "</div>";


  /*
    HATA İÇİN DOĞRUDAN LİNK
  */

  html +=
    '<div class="meta">' +
    escapeHtml(
      page.url
    ) +
    "</div>";


  html +=
    '<a class="article-link" href="' +
    escapeAttribute(
      page.url
    ) +
    '" target="_blank" rel="noopener noreferrer">' +
    "↗ Habere git" +
    "</a>";


  /*
    ---------------------------------------------------------
    ERRORS
    ---------------------------------------------------------
  */

  const errors =
    page.errors ||
    [];


  if (
    errors.length === 0
  ) {

    if (
      page.isArticle
    ) {

      html +=
        '<div class="good">' +
        "✓ Bu haberde raporlanabilir hata bulunmadı." +
        "</div>";

    } else {

      html +=
        '<div class="meta" style="margin-top:12px">' +
        "Haber sayfası değil." +
        "</div>";
    }

  } else {

    html +=
      "<strong>" +
      errors.length +
      " raporlanabilir hata</strong>";


    for (
      const error of
      errors
    ) {

      const source =
        error.source ===
        "nvidia-ai"

          ? "NVIDIA AI ikinci görüş"

          : "Kural motoru";


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
          source
        ) +

        "</span>" +

        "<br>" +

        escapeHtml(
          error.reason ||
          ""
        );


      /*
        HATANIN BULUNDUĞU SAYFAYI
        HER HATA İÇİN AÇIKÇA GÖSTER.
      */

      html +=
        '<div class="error-source">' +

        "Kaynak haber: " +

        '<a href="' +
        escapeAttribute(
          page.url
        ) +
        '" target="_blank" rel="noopener noreferrer">' +

        escapeHtml(
          page.url
        ) +

        "</a>" +

        "</div>";


      html +=
        "</div>";
    }
  }


  /*
    ---------------------------------------------------------
    AI STATUS
    ---------------------------------------------------------
  */

  if (
    page.aiStatus ===
    "success"
  ) {

    html +=
      '<div class="scan-info ai-ok">' +
      "✓ NVIDIA AI bu haberi ikinci görüş olarak analiz etti." +
      "</div>";

  } else if (
    page.aiStatus ===
    "failed"
  ) {

    html +=
      '<div class="error">' +

      "<strong>NVIDIA AI analizi başarısız</strong>" +

      "<br>" +

      escapeHtml(
        page.aiError ||
        "Bilinmeyen NVIDIA API hatası."
      ) +

      "</div>";
  }


  /*
    ---------------------------------------------------------
    SUSPICIOUS
    ---------------------------------------------------------
  */

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
        "<div style='margin-top:6px'>" +

        "<b>" +

        escapeHtml(
          item.original
        ) +

        "</b> — " +

        escapeHtml(
          item.reason
        ) +

        "</div>";
    }


    html +=
      "</div>";
  }


  div.innerHTML =
    html;


  return div;
}


/* =========================================================
   HTML ESCAPE
========================================================= */

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


function escapeAttribute(
  value
) {

  return escapeHtml(
    value
  );
}

</script>

</body>

</html>`;
}

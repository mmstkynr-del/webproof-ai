export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // WEBPROOF AI
    // Current system:
    // - Smart article crawler
    // - NVIDIA Nemotron AI proofreading
    // - Web interface
    //
    // New:
    // - Task API foundation
    // - Create / list / delete monitoring tasks
    // =========================================================

    // ---------------------------------------------------------
    // CORS / OPTIONS
    // ---------------------------------------------------------
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    // ---------------------------------------------------------
    // API STATUS
    // ---------------------------------------------------------
    if (url.pathname === "/api/status" && request.method === "GET") {
      return json({
        ok: true,
        service: "WebProof AI",
        status: "online",
        crawler: "smart-article-crawler",
        ai: env.NVIDIA_API_KEY ? "connected" : "missing-api-key",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        taskEngine: "enabled",
        storage: "temporary-memory"
      });
    }

    // ---------------------------------------------------------
    // CREATE TASK
    // ---------------------------------------------------------
    if (url.pathname === "/api/tasks" && request.method === "POST") {
      try {
        const body = await request.json();

        if (!body || !body.url) {
          return json({
            ok: false,
            error: "url gerekli"
          }, 400);
        }

        const target = validateTargetUrl(body.url);

        if (!target.ok) {
          return json({
            ok: false,
            error: target.error
          }, 400);
        }

        const task = {
          id: crypto.randomUUID(),
          url: target.url,
          type: body.type || "website",
          condition: body.condition || null,
          keyword: body.keyword || null,
          threshold: body.threshold ?? null,
          notify: body.notify || "none",
          status: "active",
          createdAt: new Date().toISOString(),
          lastCheckedAt: null,
          lastResult: null
        };

        // -----------------------------------------------------
        // IMPORTANT:
        // This first version uses temporary Worker memory.
        // KV/D1 will be connected after the API is verified.
        // -----------------------------------------------------
        temporaryTasks.push(task);

        return json({
          ok: true,
          message: "Takip görevi oluşturuldu",
          task
        });

      } catch (error) {
        return json({
          ok: false,
          error: "Geçersiz JSON veya görev oluşturulamadı",
          details: error.message
        }, 400);
      }
    }

    // ---------------------------------------------------------
    // LIST TASKS
    // ---------------------------------------------------------
    if (url.pathname === "/api/tasks" && request.method === "GET") {
      return json({
        ok: true,
        count: temporaryTasks.length,
        tasks: temporaryTasks
      });
    }

    // ---------------------------------------------------------
    // DELETE TASK
    // ---------------------------------------------------------
    if (
      url.pathname.startsWith("/api/tasks/") &&
      request.method === "DELETE"
    ) {
      const taskId = url.pathname.split("/").pop();

      const index = temporaryTasks.findIndex(
        task => task.id === taskId
      );

      if (index === -1) {
        return json({
          ok: false,
          error: "Görev bulunamadı"
        }, 404);
      }

      const deleted = temporaryTasks.splice(index, 1)[0];

      return json({
        ok: true,
        message: "Görev silindi",
        task: deleted
      });
    }

    // ---------------------------------------------------------
    // SCAN API
    // ---------------------------------------------------------
    if (url.pathname === "/api/scan" && request.method === "POST") {
      try {
        const body = await request.json();

        if (!body || !body.url) {
          return json({
            ok: false,
            error: "url gerekli"
          }, 400);
        }

        const validation = validateTargetUrl(body.url);

        if (!validation.ok) {
          return json({
            ok: false,
            error: validation.error
          }, 400);
        }

        const targetUrl = validation.url;

        const MAX_PAGES = 10;
        const MAX_ARTICLES_FOR_AI = 5;
        const MAX_LINKS = 300;

        const startUrl = normalizeUrl(targetUrl);
        const start = new URL(startUrl);
        const domain = start.hostname;

        const queue = [];
        const visited = new Set();
        const queued = new Set();

        const pages = [];

        let linksFound = 0;
        let articleCandidates = 0;
        let articlePages = 0;
        let aiAnalyzed = 0;
        let totalErrors = 0;
        let totalCharacters = 0;

        addQueue(startUrl, 100);

        while (queue.length > 0 && pages.length < MAX_PAGES) {
          queue.sort((a, b) => b.score - a.score);

          const item = queue.shift();
          const pageUrl = item.url;

          if (visited.has(pageUrl)) {
            continue;
          }

          visited.add(pageUrl);

          let result;

          try {
            result = await fetchPage(pageUrl);
          } catch (error) {
            pages.push({
              url: pageUrl,
              type: "unknown",
              score: item.score,
              status: "fetch-error",
              chars: 0,
              title: "",
              ai: null,
              error: error.message
            });

            continue;
          }

          const html = result.html;
          const status = result.status;

          const title = extractTitle(html);
          const text = cleanText(html);

          const chars = text.length;

          totalCharacters += chars;

          const links = extractLinks(
            html,
            pageUrl,
            domain,
            MAX_LINKS
          );

          linksFound += links.length;

          for (const link of links) {
            if (!visited.has(link.url) && !queued.has(link.url)) {
              addQueue(link.url, link.score);
            }
          }

          const articleScore = scoreArticleUrl(pageUrl);

          const looksLikeArticle =
            articleScore >= 20 ||
            chars > 1500 ||
            looksLikeArticleText(text);

          if (looksLikeArticle) {
            articleCandidates++;
          }

          const pageInfo = {
            url: pageUrl,
            type: looksLikeArticle ? "article" : "page",
            score: articleScore,
            status,
            chars,
            title,
            ai: null
          };

          pages.push(pageInfo);

          if (looksLikeArticle) {
            articlePages++;
          }
        }

        // -----------------------------------------------------
        // AI ANALYSIS
        // -----------------------------------------------------
        const candidates = pages
          .filter(p => p.type === "article")
          .slice(0, MAX_ARTICLES_FOR_AI);

        for (const page of candidates) {
          try {
            const pageData = await fetchPage(page.url);

            const text = cleanText(pageData.html);

            const aiResult = await analyzeWithNvidia(
              page.title,
              text,
              env
            );

            page.ai = aiResult;

            if (aiResult && Array.isArray(aiResult.errors)) {
              totalErrors += aiResult.errors.length;
            }

            aiAnalyzed++;

          } catch (error) {
            page.ai = {
              ok: false,
              errors: [],
              error: error.message
            };
          }
        }

        return json({
          ok: true,

          target: targetUrl,
          domain,

          crawler: "smart-article-crawler",

          ai: env.NVIDIA_API_KEY
            ? "connected"
            : "missing-api-key",

          model:
            "nvidia/nemotron-3.5-lightning-30b-a3b",

          pagesScanned: pages.length,
          pagesLimit: MAX_PAGES,

          linksFound,

          articleCandidates,
          articlePages,

          aiAnalyzed,
          aiLimit: MAX_ARTICLES_FOR_AI,

          totalErrors,
          totalCharacters,

          readyForAI: Boolean(env.NVIDIA_API_KEY),

          pages
        });

        function addQueue(url, score) {
          if (
            !queued.has(url) &&
            !visited.has(url) &&
            queue.length < MAX_LINKS
          ) {
            queued.add(url);
            queue.push({
              url,
              score
            });
          }
        }

      } catch (error) {
        return json({
          ok: false,
          error: error.message || "Tarama sırasında hata oluştu"
        }, 500);
      }
    }

    // ---------------------------------------------------------
    // FRONTEND
    // ---------------------------------------------------------
    return new Response(frontendHTML(), {
      headers: {
        "content-type": "text/html; charset=UTF-8"
      }
    });
  }
};


// =============================================================
// TEMPORARY TASK STORAGE
// =============================================================
//
// IMPORTANT:
// Cloudflare Worker instances are ephemeral.
// This is intentionally temporary.
//
// After this version is tested successfully,
// we will replace this with Cloudflare KV/D1.
//
// =============================================================

const temporaryTasks = [];


// =============================================================
// URL VALIDATION
// =============================================================

function validateTargetUrl(value) {
  try {
    const parsed = new URL(value);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return {
        ok: false,
        error: "Sadece HTTP ve HTTPS adresleri destekleniyor"
      };
    }

    const hostname = parsed.hostname.toLowerCase();

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
      blocked.includes(hostname) ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".internal")
    ) {
      return {
        ok: false,
        error: "Bu hedef adres güvenlik nedeniyle engellendi"
      };
    }

    return {
      ok: true,
      url: parsed.toString()
    };

  } catch {
    return {
      ok: false,
      error: "Geçerli bir URL girin"
    };
  }
}


// =============================================================
// URL NORMALIZATION
// =============================================================

function normalizeUrl(value) {
  const u = new URL(value);

  const removeParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid"
  ];

  for (const param of removeParams) {
    u.searchParams.delete(param);
  }

  u.hash = "";

  return u.toString();
}


// =============================================================
// FETCH PAGE
// =============================================================

async function fetchPage(pageUrl) {
  const response = await fetch(pageUrl, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; WebProofAI/1.0)",
      "Accept":
        "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });

  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return {
      status: response.status,
      html: ""
    };
  }

  const html = await response.text();

  return {
    status: response.status,
    html
  };
}


// =============================================================
// EXTRACT TITLE
// =============================================================

function extractTitle(html) {
  const match = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  if (!match) {
    return "";
  }

  return decodeEntities(
    match[1]
      .replace(/\s+/g, " ")
      .trim()
  );
}


// =============================================================
// CLEAN TEXT
// =============================================================

function cleanText(html) {
  if (!html) {
    return "";
  }

  let text = html;

  text = text.replace(
    /<script[\s\S]*?<\/script>/gi,
    " "
  );

  text = text.replace(
    /<style[\s\S]*?<\/style>/gi,
    " "
  );

  text = text.replace(
    /<noscript[\s\S]*?<\/noscript>/gi,
    " "
  );

  text = text.replace(
    /<svg[\s\S]*?<\/svg>/gi,
    " "
  );

  text = text.replace(
    /<!--[\s\S]*?-->/g,
    " "
  );

  text = text.replace(
    /<\/?(header|footer|nav)[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  text = text.replace(
    /<[^>]+>/g,
    " "
  );

  text = decodeEntities(text);

  text = text.replace(
    /\s+/g,
    " "
  );

  return text.trim();
}


// =============================================================
// HTML ENTITY DECODER
// =============================================================

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}


// =============================================================
// EXTRACT LINKS
// =============================================================

function extractLinks(
  html,
  baseUrl,
  domain,
  maxLinks
) {
  const results = [];
  const seen = new Set();

  const regex =
    /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match = regex.exec(html)) !== null &&
    results.length < maxLinks
  ) {
    try {
      const raw = match[1].trim();

      if (
        !raw ||
        raw.startsWith("#") ||
        raw.startsWith("javascript:") ||
        raw.startsWith("mailto:") ||
        raw.startsWith("tel:")
      ) {
        continue;
      }

      const absolute =
        new URL(raw, baseUrl);

      if (
        absolute.protocol !== "http:" &&
        absolute.protocol !== "https:"
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
        normalizeUrl(absolute.toString());

      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);

      results.push({
        url: normalized,
        score: scoreArticleUrl(normalized)
      });

    } catch {
      // Ignore invalid links
    }
  }

  return results;
}


// =============================================================
// ARTICLE SCORING
// =============================================================

function scoreArticleUrl(pageUrl) {
  try {
    const path =
      new URL(pageUrl).pathname.toLowerCase();

    let score = 0;

    const strongPatterns = [
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

    const mediumPatterns = [
      "/gundem/",
      "/ekonomi/",
      "/siyaset/",
      "/dunya/",
      "/spor/",
      "/kultur/",
      "/teknoloji/",
      "/yasam/"
    ];

    for (const pattern of strongPatterns) {
      if (path.includes(pattern)) {
        score += 50;
      }
    }

    for (const pattern of mediumPatterns) {
      if (path.includes(pattern)) {
        score += 25;
      }
    }

    if (/\/20\d{2}\//.test(path)) {
      score += 20;
    }

    const parts =
      path
        .split("/")
        .filter(Boolean);

    const last =
      parts[parts.length - 1] || "";

    if (last.length > 45) {
      score += 20;
    }

    const exclusions = [
      "/topics/",
      "/topic/",
      "/ws/",
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

    for (const exclusion of exclusions) {
      if (path.includes(exclusion)) {
        score -= 50;
      }
    }

    return score;

  } catch {
    return 0;
  }
}


// =============================================================
// ARTICLE TEXT DETECTION
// =============================================================

function looksLikeArticleText(text) {
  if (!text) {
    return false;
  }

  if (text.length < 1500) {
    return false;
  }

  const indicators = [
    "son dakika",
    "haber",
    "açıklama",
    "göre",
    "bildirdi",
    "dedi",
    "ifadelerini kullandı",
    "yaptığı açıklamada"
  ];

  let score = 0;

  const lower = text.toLowerCase();

  for (const indicator of indicators) {
    if (lower.includes(indicator)) {
      score++;
    }
  }

  return score >= 2;
}


// =============================================================
// NVIDIA AI
// =============================================================

async function analyzeWithNvidia(
  title,
  text,
  env
) {
  if (!env.NVIDIA_API_KEY) {
    return {
      ok: false,
      errors: [],
      error: "NVIDIA_API_KEY bulunamadı"
    };
  }

  const articleText =
    text.slice(0, 12000);

  const systemPrompt = `
Sen profesyonel bir Türkçe web editörü ve
yazım denetim uzmanısın.

Görevin metindeki KESİN veya çok yüksek güvenli
yazım, noktalama, dilbilgisi ve sayı kullanım
hatalarını tespit etmektir.

Özellikle şunları kontrol et:

- Yazım yanlışları
- Harf hataları
- Birleşik / ayrı yazılması gereken kelimeler
- Noktalama
- Gereksiz veya eksik boşluk
- Kesme işareti
- Büyük / küçük harf
- Sayı ve saat yazımları
- Açık dilbilgisi hataları

Ancak:

- Özel isimleri değiştirme.
- Kişi, kurum, yer ve marka isimlerini değiştirme.
- Haber dilini gereksiz yere değiştirme.
- Anlamı değiştirme.
- Emin olmadığın ifadeleri hata olarak işaretleme.
- Stil tercihini hata olarak kabul etme.

Sadece yüksek güvenli hataları döndür.

JSON dışında hiçbir şey döndürme.

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

Hata yoksa:

{
  "errors": []
}
`;

  const response =
    await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
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
            "nvidia/nemotron-3.5-lightning-30b-a3b",

          temperature: 0.1,

          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content:
                `BAŞLIK:\n${title}\n\nMETİN:\n${articleText}`
            }
          ]
        })
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `NVIDIA API ${response.status}: ${errorText.slice(0, 500)}`
    );
  }

  const data =
    await response.json();

  const content =
    data?.choices?.[0]?.message?.content || "";

  let parsed;

  try {
    parsed =
      JSON.parse(content);
  } catch {
    const jsonMatch =
      content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return {
        ok: false,
        errors: [],
        raw: content.slice(0, 1000)
      };
    }

    try {
      parsed =
        JSON.parse(jsonMatch[0]);
    } catch {
      return {
        ok: false,
        errors: [],
        raw: content.slice(0, 1000)
      };
    }
  }

  const errors =
    Array.isArray(parsed.errors)
      ? parsed.errors
          .filter(error =>
            error &&
            error.original &&
            error.correction &&
            Number(error.confidence) >= 0.85
          )
          .map(error => ({
            original: String(error.original),
            correction: String(error.correction),
            type:
              error.type || "diğer",
            confidence:
              Number(error.confidence),
            reason:
              error.reason || ""
          }))
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
  margin: 0 auto;
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
  background: #ffffff;
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

.error {
  border-left: 3px solid #ff7b7b;
  padding: 10px;
  margin-top: 8px;
  background: #151a22;
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
    Yapay zekâ destekli web sitesi tarama ve
    içerik denetim sistemi
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
        AI Analizi
      </div>

      <div class="stat">
        <strong id="errors">0</strong>
        Hata
      </div>

    </div>

  </div>

  <div id="results"></div>

</div>

<script>

async function scanSite() {

  const input =
    document.getElementById("url");

  const button =
    document.getElementById("scanButton");

  const status =
    document.getElementById("status");

  const stats =
    document.getElementById("stats");

  const results =
    document.getElementById("results");

  const target =
    input.value.trim();

  if (!target) {
    status.textContent =
      "Lütfen bir URL girin.";
    return;
  }

  button.disabled = true;

  status.textContent =
    "Site taranıyor...";

  stats.style.display = "none";

  results.innerHTML = "";

  try {

    const response =
      await fetch("/api/scan", {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          url: target
        })
      });

    const data =
      await response.json();

    if (!data.ok) {
      throw new Error(
        data.error ||
        "Tarama başarısız"
      );
    }

    status.textContent =
      "Tarama tamamlandı.";

    stats.style.display =
      "block";

    document.getElementById("pages")
      .textContent =
      data.pagesScanned ?? 0;

    document.getElementById("links")
      .textContent =
      data.linksFound ?? 0;

    document.getElementById("articles")
      .textContent =
      data.articlePages ?? 0;

    document.getElementById("ai")
      .textContent =
      data.aiAnalyzed ?? 0;

    document.getElementById("errors")
      .textContent =
      data.totalErrors ?? 0;

    for (const page of data.pages || []) {

      const div =
        document.createElement("div");

      div.className =
        "page";

      let html = "";

      html +=
        "<div class='page-url'>" +
        escapeHTML(page.url) +
        "</div>";

      html +=
        "<small>" +
        "Tür: " +
        escapeHTML(page.type || "") +
        " | HTTP: " +
        escapeHTML(String(page.status ?? "")) +
        " | Skor: " +
        escapeHTML(String(page.score ?? 0)) +
        " | Karakter: " +
        escapeHTML(String(page.chars ?? 0)) +
        "</small>";

      if (page.title) {
        html +=
          "<div style='margin-top:8px;font-weight:bold'>" +
          escapeHTML(page.title) +
          "</div>";
      }

      const errors =
        page.ai &&
        Array.isArray(page.ai.errors)
          ? page.ai.errors
          : [];

      for (const error of errors) {

        html +=
          "<div class='error'>" +

          "<div>" +
          escapeHTML(error.original) +
          "</div>" +

          "<div class='correction'>" +
          "→ " +
          escapeHTML(error.correction) +
          "</div>" +

          "<small>" +
          escapeHTML(error.type || "") +
          " | Güven: " +
          escapeHTML(
            String(error.confidence ?? "")
          ) +
          "</small>" +

          (error.reason
            ? "<div><small>" +
              escapeHTML(error.reason) +
              "</small></div>"
            : "") +

          "</div>";
      }

      div.innerHTML =
        html;

      results.appendChild(div);
    }

  } catch (error) {

    status.textContent =
      "Hata: " +
      error.message;

  } finally {

    button.disabled = false;
  }
}


function escapeHTML(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

</script>

</body>
</html>`;
}


// =============================================================
// JSON RESPONSE
// =============================================================

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data, null, 2),
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
    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "GET, POST, DELETE, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Authorization"
  };
}

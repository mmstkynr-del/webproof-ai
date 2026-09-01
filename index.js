export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // WEBPROOF AI - CRAWLER + NVIDIA AI PROOFREADING
    // =========================================================

    if (url.pathname === "/api/status") {
      return json({
        ok: true,
        service: "WebProof AI",
        status: "online",
        crawler: "smart-article-crawler",
        ai: env.NVIDIA_API_KEY ? "connected" : "missing-api-key",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b"
      });
    }

    // =========================================================
    // SITE SCAN
    // =========================================================

    if (url.pathname === "/api/scan" && request.method === "POST") {
      try {
        const body = await request.json();
        const target = String(body.url || "").trim();

        if (!target) {
          return json({
            ok: false,
            error: "URL girilmedi."
          }, 400);
        }

        let startUrl;

        try {
          startUrl = new URL(target);
        } catch {
          return json({
            ok: false,
            error: "Geçerli bir URL girin."
          }, 400);
        }

        if (!["http:", "https:"].includes(startUrl.protocol)) {
          return json({
            ok: false,
            error: "Sadece HTTP ve HTTPS adresleri destekleniyor."
          }, 400);
        }

        const hostname = startUrl.hostname.toLowerCase();

        const blockedHosts = [
          "localhost",
          "127.0.0.1",
          "0.0.0.0",
          "::1",
          "metadata.google.internal",
          "metadata.google",
          "169.254.169.254"
        ];

        if (
          blockedHosts.includes(hostname) ||
          hostname.endsWith(".localhost") ||
          hostname.endsWith(".internal")
        ) {
          return json({
            ok: false,
            error: "Bu adres taranamaz."
          }, 400);
        }

        const MAX_PAGES = 10;
        const MAX_ARTICLES_FOR_AI = 5;
        const MAX_LINKS = 300;

        const domain = startUrl.hostname;

        const queue = [];
        const queued = new Set();
        const visited = new Set();

        const articleCandidates = new Map();

        function normalizeUrl(raw) {
          try {
            const u = new URL(raw);

            if (!["http:", "https:"].includes(u.protocol)) {
              return null;
            }

            if (u.hostname !== domain) {
              return null;
            }

            u.hash = "";

            const removeParams = [
              "utm_source",
              "utm_medium",
              "utm_campaign",
              "utm_term",
              "utm_content",
              "fbclid",
              "gclid"
            ];

            for (const p of removeParams) {
              u.searchParams.delete(p);
            }

            return u.toString();
          } catch {
            return null;
          }
        }

        // =====================================================
        // ARTICLE DETECTOR
        // =====================================================

        function looksLikeArticle(link) {
          try {
            const u = new URL(link);
            const path = u.pathname.toLowerCase();

            // BBC Türkçe'nin gerçek haber formatı
            if (
              path.startsWith("/turkce/articles/") ||
              path.startsWith("/turkce/article/")
            ) {
              return {
                score: 100,
                type: "article"
              };
            }

            let score = 0;

            const articleWords = [
              "/haber/",
              "/haberler/",
              "/news/",
              "/article/",
              "/articles/",
              "/story/",
              "/stories/",
              "/gundem/",
              "/ekonomi/",
              "/siyaset/",
              "/dunya/",
              "/spor/",
              "/kultur/",
              "/teknoloji/",
              "/yasam/"
            ];

            for (const word of articleWords) {
              if (path.includes(word)) {
                score += 30;
              }
            }

            if (/\b20\d{2}\b/.test(path)) {
              score += 15;
            }

            const lastPart =
              path.split("/").filter(Boolean).pop() || "";

            if (lastPart.length > 25) {
              score += 10;
            }

            const excluded = [
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

            for (const word of excluded) {
              if (path.includes(word)) {
                score -= 100;
              }
            }

            if (score >= 25) {
              return {
                score,
                type: "article"
              };
            }

            return {
              score,
              type: "page"
            };
          } catch {
            return {
              score: 0,
              type: "page"
            };
          }
        }

        // =====================================================
        // TEXT CLEANER
        // =====================================================

        function cleanText(html) {
          let text = html;

          text = text.replace(
            /<script\b[^>]*>[\s\S]*?<\/script>/gi,
            " "
          );

          text = text.replace(
            /<style\b[^>]*>[\s\S]*?<\/style>/gi,
            " "
          );

          text = text.replace(
            /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
            " "
          );

          text = text.replace(
            /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
            " "
          );

          text = text.replace(
            /<!--[\s\S]*?-->/g,
            " "
          );

          text = text.replace(
            /<header\b[^>]*>[\s\S]*?<\/header>/gi,
            " "
          );

          text = text.replace(
            /<footer\b[^>]*>[\s\S]*?<\/footer>/gi,
            " "
          );

          text = text.replace(/<[^>]+>/g, " ");

          text = text
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&apos;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">");

          text = text.replace(/\u00a0/g, " ");

          text = text.replace(/[ \t]+/g, " ");

          text = text.replace(
            /\n\s*\n+/g,
            "\n\n"
          );

          return text.trim();
        }

        function extractTitle(html) {
          const match = html.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
          );

          if (!match) {
            return "";
          }

          return cleanText(match[1]);
        }

        // =====================================================
        // LINK EXTRACTION
        // =====================================================

        function extractLinks(html, baseUrl) {
          const links = [];

          const regex =
            /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

          let match;

          while ((match = regex.exec(html)) !== null) {
            try {
              const absolute =
                new URL(match[1], baseUrl).toString();

              const normalized =
                normalizeUrl(absolute);

              if (normalized) {
                links.push(normalized);
              }
            } catch {}

            if (links.length >= MAX_LINKS) {
              break;
            }
          }

          return [...new Set(links)];
        }

        // =====================================================
        // FETCH PAGE
        // =====================================================

        async function fetchPage(pageUrl) {
          try {
            const response = await fetch(pageUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (compatible; WebProofAI/1.0)",
                "Accept":
                  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
              }
            });

            const contentType =
              response.headers.get("content-type") || "";

            if (!contentType.includes("text/html")) {
              return {
                ok: false,
                status: response.status,
                reason: "HTML değil"
              };
            }

            const html = await response.text();

            return {
              ok: response.ok,
              status: response.status,
              html
            };
          } catch (error) {
            return {
              ok: false,
              status: 0,
              reason:
                error.message || "Bağlantı hatası"
            };
          }
        }

        // =====================================================
        // NVIDIA AI
        // =====================================================

        async function analyzeWithNvidia(title, text) {

          if (!env.NVIDIA_API_KEY) {
            return {
              ok: false,
              error: "NVIDIA_API_KEY Cloudflare Worker'da bulunamadı."
            };
          }

          // Çok uzun metni kontrol altında tut
          const MAX_TEXT = 12000;

          const articleText =
            text.length > MAX_TEXT
              ? text.slice(0, MAX_TEXT)
              : text;

          const systemPrompt = `
Sen WebProof AI adlı profesyonel bir Türkçe web yazım denetim sisteminin yapay zeka motorusun.

Görevin haber metnini incelemek ve SADECE gerçekten hatalı olduğundan yüksek derecede emin olduğun durumları bulmaktır.

Özellikle şunları kontrol et:

1. Yazım yanlışları
2. Bariz kelime hataları
3. Harf eksikliği veya fazlalığı
4. Yanlış birleşik/ayrı yazımlar
5. Noktalama hataları
6. Noktalama işaretlerinden önce/sonra yanlış boşluk
7. Kesme işareti kullanımı
8. Büyük/küçük harf hataları
9. Açık ve bariz dilbilgisi hataları
10. Sayı ve saat yazımındaki açık yazım hataları

ÖNEMLİ:

- Özel isimleri gereksiz yere değiştirme.
- Haber dilini yeniden yazma.
- Stil tercihlerine müdahale etme.
- Anlamı değiştiren öneriler verme.
- Emin olmadığın bir ifadeyi hata olarak işaretleme.
- Kaynak metinde olmayan hata üretme.
- Sadece gerçekten mevcut olan hataları bildir.

ÇIKTIYI SADECE GEÇERLİ JSON OLARAK VER.

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

JSON dışında hiçbir açıklama yazma.
`;

          const userPrompt =
            "HABER BAŞLIĞI:\n" +
            title +
            "\n\nHABER METNİ:\n" +
            articleText;

          try {
            const response = await fetch(
              "https://integrate.api.nvidia.com/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  "Authorization":
                    "Bearer " + env.NVIDIA_API_KEY,
                  "Content-Type":
                    "application/json"
                },
                body: JSON.stringify({
                  model:
                    "nvidia/nemotron-3.5-lightning-30b-a3b",

                  messages: [
                    {
                      role: "system",
                      content: systemPrompt
                    },
                    {
                      role: "user",
                      content: userPrompt
                    }
                  ],

                  temperature: 0.1,
                  top_p: 0.9,
                  max_tokens: 4000,

                  stream: false,

                  extra_body: {
                    chat_template_kwargs: {
                      enable_thinking: false
                    }
                  }
                })
              }
            );

            const raw = await response.text();

            if (!response.ok) {
              return {
                ok: false,
                status: response.status,
                error: raw.slice(0, 1000)
              };
            }

            let data;

            try {
              data = JSON.parse(raw);
            } catch {
              return {
                ok: false,
                error: "NVIDIA cevabı JSON olarak okunamadı.",
                raw: raw.slice(0, 2000)
              };
            }

            const content =
              data?.choices?.[0]?.message?.content;

            if (!content) {
              return {
                ok: false,
                error: "NVIDIA boş cevap döndürdü."
              };
            }

            // Markdown JSON temizleme
            let cleaned = content.trim();

            cleaned = cleaned
              .replace(/^```json\s*/i, "")
              .replace(/^```\s*/i, "")
              .replace(/\s*```$/i, "")
              .trim();

            // JSON bloğunu bulmaya çalış
            const firstBrace =
              cleaned.indexOf("{");

            const lastBrace =
              cleaned.lastIndexOf("}");

            if (
              firstBrace !== -1 &&
              lastBrace !== -1 &&
              lastBrace > firstBrace
            ) {
              cleaned =
                cleaned.slice(
                  firstBrace,
                  lastBrace + 1
                );
            }

            let result;

            try {
              result = JSON.parse(cleaned);
            } catch {
              return {
                ok: false,
                error:
                  "NVIDIA geçerli JSON üretmedi.",
                raw: cleaned.slice(0, 3000)
              };
            }

            if (!Array.isArray(result.errors)) {
              result.errors = [];
            }

            // Güven düşükse gösterme
            result.errors =
              result.errors.filter(error => {
                const confidence =
                  Number(error.confidence);

                return (
                  Number.isFinite(confidence) &&
                  confidence >= 0.85 &&
                  error.original &&
                  error.correction
                );
              });

            return {
              ok: true,
              errors: result.errors,
              model:
                "nvidia/nemotron-3.5-lightning-30b-a3b"
            };

          } catch (error) {
            return {
              ok: false,
              error:
                error.message ||
                "NVIDIA bağlantı hatası."
            };
          }
        }

        // =====================================================
        // START
        // =====================================================

        const normalizedStart =
          normalizeUrl(startUrl.toString());

        if (!normalizedStart) {
          return json({
            ok: false,
            error:
              "Başlangıç adresi kabul edilmedi."
          }, 400);
        }

        queue.push({
          url: normalizedStart,
          score: 1000,
          type: "homepage"
        });

        queued.add(normalizedStart);

        // =====================================================
        // HOMEPAGE
        // =====================================================

        const startResult =
          await fetchPage(normalizedStart);

        if (!startResult.ok) {
          return json({
            ok: false,
            error: "Siteye erişilemedi.",
            status: startResult.status,
            reason:
              startResult.reason || null
          }, 502);
        }

        const homepageLinks =
          extractLinks(
            startResult.html,
            normalizedStart
          );

        for (const link of homepageLinks) {

          const info =
            looksLikeArticle(link);

          if (info.score > 0) {
            articleCandidates.set(
              link,
              info
            );
          }
        }

        // =====================================================
        // ARTICLE QUEUE
        // =====================================================

        const sortedCandidates =
          [...articleCandidates.entries()]
            .map(([url, info]) => ({
              url,
              score: info.score,
              type: info.type
            }))
            .sort(
              (a, b) =>
                b.score - a.score
            );

        for (const candidate of sortedCandidates) {

          if (
            queue.length >=
            MAX_PAGES * 3
          ) {
            break;
          }

          if (!queued.has(candidate.url)) {
            queue.push(candidate);
            queued.add(candidate.url);
          }
        }

        // =====================================================
        // CRAWL
        // =====================================================

        const pages = [];

        let totalCharacters = 0;
        let linksFound =
          homepageLinks.length;

        while (
          queue.length > 0 &&
          pages.length < MAX_PAGES
        ) {

          queue.sort(
            (a, b) =>
              b.score - a.score
          );

          const item =
            queue.shift();

          if (
            !item ||
            visited.has(item.url)
          ) {
            continue;
          }

          visited.add(item.url);

          const result =
            await fetchPage(item.url);

          if (!result.ok) {

            pages.push({
              url: item.url,
              type: item.type,
              score: item.score,
              status: result.status,
              chars: 0,
              title: "",
              text: "",
              error:
                result.reason ||
                "Sayfa alınamadı.",
              ai: null
            });

            continue;
          }

          const title =
            extractTitle(
              result.html
            );

          const text =
            cleanText(
              result.html
            );

          const pageLinks =
            extractLinks(
              result.html,
              item.url
            );

          linksFound +=
            pageLinks.length;

          for (const link of pageLinks) {

            if (visited.has(link)) {
              continue;
            }

            const info =
              looksLikeArticle(link);

            if (info.score > 0) {

              const old =
                articleCandidates.get(
                  link
                );

              if (
                !old ||
                info.score > old.score
              ) {
                articleCandidates.set(
                  link,
                  info
                );
              }

              if (!queued.has(link)) {

                queue.push({
                  url: link,
                  score: info.score,
                  type: info.type
                });

                queued.add(link);
              }
            }
          }

          let pageType =
            item.type;

          const lowerText =
            text.toLowerCase();

          if (
            pageType !== "homepage" &&
            (
              lowerText.includes("kaynak,") ||
              lowerText.includes(
                "haber kaynağı"
              ) ||
              text.length > 1500
            )
          ) {
            pageType = "article";
          }

          pages.push({
            url: item.url,
            type: pageType,
            score: item.score,
            status: result.status,
            chars: text.length,
            title,
            text,
            ai: null
          });

          totalCharacters +=
            text.length;
        }

        // =====================================================
        // NVIDIA ANALYSIS
        // =====================================================

        const articlePages =
          pages.filter(
            page =>
              page.type === "article"
          );

        const aiPages =
          articlePages.slice(
            0,
            MAX_ARTICLES_FOR_AI
          );

        let aiAnalyzed = 0;
        let totalErrors = 0;

        for (const page of aiPages) {

          const aiResult =
            await analyzeWithNvidia(
              page.title,
              page.text
            );

          page.ai = aiResult;

          if (aiResult.ok) {
            aiAnalyzed += 1;
            totalErrors +=
              aiResult.errors.length;
          }
        }

        // =====================================================
        // RESPONSE
        // =====================================================

        return json({
          ok: true,

          target:
            normalizedStart,

          domain,

          crawler:
            "smart-article-crawler",

          ai:
            env.NVIDIA_API_KEY
              ? "nvidia-connected"
              : "missing-api-key",

          model:
            "nvidia/nemotron-3.5-lightning-30b-a3b",

          pagesScanned:
            pages.length,

          pagesLimit:
            MAX_PAGES,

          linksFound,

          articleCandidates:
            articleCandidates.size,

          articlePages:
            articlePages.length,

          aiAnalyzed,

          aiLimit:
            MAX_ARTICLES_FOR_AI,

          totalErrors,

          totalCharacters,

          readyForAI:
            articlePages.length,

          pages:
            pages.map(page => ({
              url: page.url,
              type: page.type,
              score: page.score,
              status: page.status,
              chars: page.chars,
              title: page.title,
              ai: page.ai
            }))
        });

      } catch (error) {

        return json({
          ok: false,
          error:
            "Tarama sırasında beklenmeyen bir hata oluştu.",
          details:
            error.message ||
            String(error)
        }, 500);
      }
    }

    // =========================================================
    // WEBPROOF AI UI
    // =========================================================

    const HTML = `
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>WebProof AI</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Arial,
    sans-serif;

  background:
    radial-gradient(
      circle at top left,
      rgba(80,120,255,.18),
      transparent 35%
    ),
    radial-gradient(
      circle at bottom right,
      rgba(0,220,180,.10),
      transparent 35%
    ),
    #070b14;

  color: #f5f7ff;
}

.container {
  width: min(
    1100px,
    calc(100% - 32px)
  );

  margin: 0 auto;
  padding: 60px 0;
}

.logo {
  font-size: 34px;
  font-weight: 800;
  letter-spacing: -1px;
}

.logo span {
  color: #6d8cff;
}

.subtitle {
  margin-top: 12px;
  color: #9ca8bd;
  font-size: 16px;
  line-height: 1.6;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  margin-top: 22px;

  padding: 8px 13px;

  border:
    1px solid
    rgba(80,220,150,.25);

  border-radius: 999px;

  background:
    rgba(80,220,150,.07);

  color: #70e0a5;

  font-size: 13px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;

  background: #55df91;

  box-shadow:
    0 0 12px #55df91;
}

.card {
  margin-top: 34px;
  padding: 26px;

  border:
    1px solid
    rgba(255,255,255,.09);

  border-radius: 22px;

  background:
    rgba(17,23,37,.78);

  backdrop-filter:
    blur(18px);

  box-shadow:
    0 20px 70px
    rgba(0,0,0,.35);
}

.label {
  display: block;

  margin-bottom: 10px;

  font-size: 13px;
  color: #aeb9cc;
}

.input-row {
  display: flex;
  gap: 12px;
}

input {
  flex: 1;
  min-width: 0;

  padding:
    17px 18px;

  border:
    1px solid
    rgba(255,255,255,.10);

  border-radius: 13px;

  outline: none;

  background: #0b101c;
  color: white;

  font-size: 15px;
}

input:focus {
  border-color: #6d8cff;

  box-shadow:
    0 0 0 3px
    rgba(109,140,255,.12);
}

button {
  border: 0;
  border-radius: 13px;

  padding: 0 25px;

  background:
    linear-gradient(
      135deg,
      #607cff,
      #795cff
    );

  color: white;

  font-weight: 800;

  cursor: pointer;

  transition: .2s;
}

button:hover {
  transform:
    translateY(-1px);

  filter:
    brightness(1.08);
}

button:disabled {
  opacity: .55;
  cursor: not-allowed;

  transform: none;
}

.status-box {
  display: none;

  margin-top: 20px;
  padding: 16px;

  border-radius: 13px;

  background: #0b101c;

  border:
    1px solid
    rgba(255,255,255,.08);

  color: #b9c3d6;

  line-height: 1.6;
}

.stats {
  display: grid;

  grid-template-columns:
    repeat(5, 1fr);

  gap: 12px;

  margin-top: 20px;
}

.stat {
  padding: 18px;

  border-radius: 15px;

  background:
    rgba(255,255,255,.035);

  border:
    1px solid
    rgba(255,255,255,.06);
}

.stat-value {
  font-size: 24px;
  font-weight: 800;
}

.stat-label {
  margin-top: 5px;

  color: #8e9ab0;

  font-size: 12px;
}

.results {
  margin-top: 22px;
}

.page {
  padding: 18px 0;

  border-bottom:
    1px solid
    rgba(255,255,255,.06);
}

.page:last-child {
  border-bottom: 0;
}

.page-title {
  font-size: 15px;
  font-weight: 700;
  color: #e8ecf7;
}

.page-url {
  margin-top: 6px;

  color: #77849c;

  font-size: 12px;

  word-break: break-all;
}

.badges {
  display: flex;
  flex-wrap: wrap;

  gap: 7px;

  margin-top: 9px;
}

.badge {
  padding:
    4px 8px;

  border-radius: 7px;

  font-size: 11px;

  background:
    rgba(109,140,255,.10);

  color: #91a5ff;
}

.badge.article {
  background:
    rgba(80,220,150,.10);

  color: #70e0a5;
}

.badge.error {
  background:
    rgba(255,80,100,.12);

  color: #ff8b99;
}

.ai-box {
  margin-top: 15px;

  padding: 16px;

  border-radius: 14px;

  background:
    rgba(109,140,255,.055);

  border:
    1px solid
    rgba(109,140,255,.12);
}

.ai-title {
  font-size: 13px;
  font-weight: 800;

  color: #a9b8ff;

  margin-bottom: 10px;
}

.ai-ok {
  color: #70e0a5;
  font-size: 13px;
}

.error-item {
  padding: 12px 0;

  border-top:
    1px solid
    rgba(255,255,255,.06);
}

.error-original {
  color: #ff8997;
  font-weight: 700;
}

.error-arrow {
  color: #69768c;
  margin: 0 6px;
}

.error-correction {
  color: #70e0a5;
  font-weight: 700;
}

.error-reason {
  margin-top: 5px;

  color: #8f9bb0;

  font-size: 12px;
}

.footer {
  margin-top: 35px;

  text-align: center;

  color: #647086;

  font-size: 12px;
}

@media (max-width: 850px) {

  .stats {
    grid-template-columns:
      repeat(2, 1fr);
  }

}

@media (max-width: 700px) {

  .container {
    padding: 35px 0;
  }

  .logo {
    font-size: 28px;
  }

  .input-row {
    flex-direction: column;
  }

  button {
    height: 52px;
  }

}

</style>
</head>

<body>

<div class="container">

  <div class="logo">
    WebProof <span>AI</span>
  </div>

  <div class="subtitle">
    Web sitelerinizi yapay zekâ ile yazım,
    dilbilgisi ve noktalama hatalarına karşı
    kontrol edin.
  </div>

  <div class="status">
    <span class="dot"></span>
    Sistem çevrimiçi
  </div>

  <div class="card">

    <label class="label">
      Kontrol etmek istediğiniz web sitesi
    </label>

    <div class="input-row">

      <input
        id="url"
        type="url"
        placeholder="https://www.bbc.com/turkce"
        value="https://www.bbc.com/turkce"
      />

      <button
        id="scanBtn"
        onclick="scanSite()"
      >
        SİTEYİ TARA
      </button>

    </div>

    <div
      id="statusBox"
      class="status-box">
    </div>

    <div
      id="stats"
      class="stats"
      style="display:none;"
    >

      <div class="stat">
        <div
          id="pagesScanned"
          class="stat-value">
          0
        </div>

        <div class="stat-label">
          Taranan sayfa
        </div>
      </div>

      <div class="stat">
        <div
          id="linksFound"
          class="stat-value">
          0
        </div>

        <div class="stat-label">
          Bulunan bağlantı
        </div>
      </div>

      <div class="stat">
        <div
          id="articlePages"
          class="stat-value">
          0
        </div>

        <div class="stat-label">
          Haber / makale
        </div>
      </div>

      <div class="stat">
        <div
          id="aiAnalyzed"
          class="stat-value">
          0
        </div>

        <div class="stat-label">
          AI analiz
        </div>
      </div>

      <div class="stat">
        <div
          id="totalErrors"
          class="stat-value">
          0
        </div>

        <div class="stat-label">
          Tespit edilen hata
        </div>
      </div>

    </div>

    <div
      id="results"
      class="results">
    </div>

  </div>

  <div class="footer">
    WebProof AI · AI destekli
    web içerik kontrol sistemi
  </div>

</div>

<script>

async function scanSite() {

  const input =
    document.getElementById("url");

  const button =
    document.getElementById("scanBtn");

  const statusBox =
    document.getElementById("statusBox");

  const stats =
    document.getElementById("stats");

  const results =
    document.getElementById("results");

  const target =
    input.value.trim();

  if (!target) {

    statusBox.style.display =
      "block";

    statusBox.textContent =
      "Lütfen bir web sitesi adresi girin.";

    return;
  }

  button.disabled = true;

  button.textContent =
    "AI ANALİZ EDİYOR...";

  statusBox.style.display =
    "block";

  statusBox.textContent =
    "Site taranıyor ve gerçek haber metinleri NVIDIA yapay zekâsı tarafından kontrol ediliyor...";

  stats.style.display =
    "none";

  results.innerHTML = "";

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
            url: target
          })
        }
      );

    const data =
      await response.json();

    if (!data.ok) {
      throw new Error(
        data.error ||
        "Tarama başarısız oldu."
      );
    }

    statusBox.textContent =
      "Tarama ve NVIDIA AI analizi tamamlandı.";

    stats.style.display =
      "grid";

    document.getElementById(
      "pagesScanned"
    ).textContent =
      data.pagesScanned;

    document.getElementById(
      "linksFound"
    ).textContent =
      data.linksFound;

    document.getElementById(
      "articlePages"
    ).textContent =
      data.articlePages;

    document.getElementById(
      "aiAnalyzed"
    ).textContent =
      data.aiAnalyzed;

    document.getElementById(
      "totalErrors"
    ).textContent =
      data.totalErrors;

    results.innerHTML = "";

    for (const page of data.pages) {

      const div =
        document.createElement(
          "div"
        );

      div.className =
        "page";

      const safeTitle =
        page.title ||
        "Başlık alınamadı";

      const typeLabel =
        page.type === "article"
          ? "HABER / MAKALE"
          : "SAYFA";

      let html = "";

      html += `
        <div class="page-title">
          ${escapeHtml(safeTitle)}
        </div>

        <div class="page-url">
          ${escapeHtml(page.url)}
        </div>

        <div class="badges">

          <span class="badge">
            HTTP ${page.status}
          </span>

          <span class="badge ${
            page.type === "article"
              ? "article"
              : ""
          }">
            ${typeLabel}
          </span>

          <span class="badge">
            Skor ${page.score}
          </span>

          <span class="badge">
            ${Number(page.chars)
              .toLocaleString("tr-TR")}
            karakter
          </span>

        </div>
      `;

      if (page.ai) {

        html += `
          <div class="ai-box">

            <div class="ai-title">
              🤖 NVIDIA AI ANALİZİ
            </div>
        `;

        if (page.ai.ok) {

          if (
            page.ai.errors &&
            page.ai.errors.length > 0
          ) {

            for (
              const error
              of page.ai.errors
            ) {

              html += `
                <div class="error-item">

                  <span class="error-original">
                    ${escapeHtml(
                      error.original
                    )}
                  </span>

                  <span class="error-arrow">
                    →
                  </span>

                  <span class="error-correction">
                    ${escapeHtml(
                      error.correction
                    )}
                  </span>

                  <div class="error-reason">
                    ${escapeHtml(
                      error.reason ||
                      "Yazım denetimi"
                    )}

                    · Güven:
                    ${Math.round(
                      Number(
                        error.confidence
                      ) * 100
                    )}%
                  </div>

                </div>
              `;
            }

          } else {

            html += `
              <div class="ai-ok">
                ✓ AI tarafından
                yüksek güvenle hata
                tespit edilmedi.
              </div>
            `;
          }

        } else {

          html += `
            <div class="badge error">
              AI hatası:
              ${escapeHtml(
                page.ai.error ||
                "Bilinmeyen hata"
              )}
            </div>
          `;
        }

        html += `
          </div>
        `;
      }

      div.innerHTML =
        html;

      results.appendChild(
        div
      );
    }

  } catch (error) {

    statusBox.textContent =
      "Hata: " +
      error.message;

  } finally {

    button.disabled =
      false;

    button.textContent =
      "SİTEYİ TARA";
  }
}

function escapeHtml(value) {

  return String(value)
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

    return new Response(
      HTML,
      {
        headers: {
          "content-type":
            "text/html;charset=UTF-8"
        }
      }
    );
  }
};

function json(data, status = 200) {

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
          "application/json;charset=UTF-8",

        "access-control-allow-origin":
          "*"
      }
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // WEBPROOF AI - SMART ARTICLE CRAWLER
    // =========================================================

    if (url.pathname === "/api/status") {
      return json({
        ok: true,
        service: "WebProof AI",
        status: "online",
        crawler: "smart-article-crawler",
        ai: "ready-for-next-stage"
      });
    }

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

        // Basit SSRF koruması
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

            // Fragment kaldır
            u.hash = "";

            // Gereksiz tracking parametrelerini temizle
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

        function looksLikeArticle(link) {
          try {
            const u = new URL(link);
            const path = u.pathname.toLowerCase();

            // BBC Türkçe için en güçlü sinyal
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

            // Genel haber/makale URL sinyalleri
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

            // Tarih içeren URL'ler genellikle haber/makale
            if (/\b20\d{2}\b/.test(path)) {
              score += 15;
            }

            // Uzun slug genellikle makale
            const lastPart = path.split("/").filter(Boolean).pop() || "";

            if (lastPart.length > 25) {
              score += 10;
            }

            // Navigation / kategori / sistem sayfalarını düşür
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

        function cleanText(html) {
          let text = html;

          // Script/style/noscript kaldır
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

          // HTML yorumları
          text = text.replace(/<!--[\s\S]*?-->/g, " ");

          // Bazı BBC arayüz parçalarını kaldır
          text = text.replace(
            /<header\b[^>]*>[\s\S]*?<\/header>/gi,
            " "
          );

          text = text.replace(
            /<footer\b[^>]*>[\s\S]*?<\/footer>/gi,
            " "
          );

          // HTML taglerini kaldır
          text = text.replace(/<[^>]+>/g, " ");

          // HTML entity
          text = text
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&apos;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">");

          // Unicode boşluklar
          text = text.replace(/\u00a0/g, " ");

          // Fazla boşlukları temizle
          text = text.replace(/[ \t]+/g, " ");

          // Çok fazla boş satırı temizle
          text = text.replace(/\n\s*\n+/g, "\n\n");

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

        function extractLinks(html, baseUrl) {
          const links = [];

          const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

          let match;

          while ((match = regex.exec(html)) !== null) {
            const normalized = normalizeUrl(
              new URL(match[1], baseUrl).toString()
            );

            if (normalized) {
              links.push(normalized);
            }

            if (links.length >= MAX_LINKS) {
              break;
            }
          }

          return [...new Set(links)];
        }

        async function fetchPage(pageUrl) {
          try {
            const response = await fetch(pageUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (compatible; WebProofAI/1.0; +https://webproof.ai)",
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
              reason: error.message || "Bağlantı hatası"
            };
          }
        }

        // Başlangıç URL'sini kuyruğa ekle
        const normalizedStart = normalizeUrl(startUrl.toString());

        if (!normalizedStart) {
          return json({
            ok: false,
            error: "Başlangıç adresi kabul edilmedi."
          }, 400);
        }

        queue.push({
          url: normalizedStart,
          score: 1000,
          type: "homepage"
        });

        queued.add(normalizedStart);

        // =====================================================
        // 1. AŞAMA
        // Ana sayfayı indir ve haber linklerini keşfet
        // =====================================================

        const discoveredLinks = [];

        const startResult = await fetchPage(normalizedStart);

        if (!startResult.ok) {
          return json({
            ok: false,
            error:
              "Siteye erişilemedi.",
            status: startResult.status,
            reason: startResult.reason || null
          }, 502);
        }

        const startHtml = startResult.html;

        const homepageLinks = extractLinks(
          startHtml,
          normalizedStart
        );

        for (const link of homepageLinks) {
          const info = looksLikeArticle(link);

          if (info.score > 0) {
            articleCandidates.set(link, info);
          }

          discoveredLinks.push({
            url: link,
            score: info.score,
            type: info.type
          });
        }

        // =====================================================
        // 2. AŞAMA
        // Haber linklerini puanla ve sırala
        // =====================================================

        const sortedCandidates = [...articleCandidates.entries()]
          .map(([url, info]) => ({
            url,
            score: info.score,
            type: info.type
          }))
          .sort((a, b) => b.score - a.score);

        // Önce makale/haber sayfaları
        for (const candidate of sortedCandidates) {
          if (queue.length >= MAX_PAGES * 3) {
            break;
          }

          if (!queued.has(candidate.url)) {
            queue.push(candidate);
            queued.add(candidate.url);
          }
        }

        // =====================================================
        // 3. AŞAMA
        // İlk 10 akıllı sayfayı tara
        // =====================================================

        const pages = [];
        let totalCharacters = 0;
        let linksFound = homepageLinks.length;

        while (queue.length > 0 && pages.length < MAX_PAGES) {
          // En yüksek skorlu sayfayı al
          queue.sort((a, b) => b.score - a.score);

          const item = queue.shift();

          if (!item || visited.has(item.url)) {
            continue;
          }

          visited.add(item.url);

          const result = await fetchPage(item.url);

          if (!result.ok) {
            pages.push({
              url: item.url,
              type: item.type,
              score: item.score,
              status: result.status,
              chars: 0,
              title: "",
              error: result.reason || "Sayfa alınamadı"
            });

            continue;
          }

          const title = extractTitle(result.html);
          const text = cleanText(result.html);

          const pageLinks = extractLinks(
            result.html,
            item.url
          );

          linksFound += pageLinks.length;

          // Yeni makale linklerini keşfet
          for (const link of pageLinks) {
            if (visited.has(link)) {
              continue;
            }

            const info = looksLikeArticle(link);

            if (info.score > 0) {
              const old = articleCandidates.get(link);

              if (!old || info.score > old.score) {
                articleCandidates.set(link, info);
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

          // Gerçek makale olup olmadığını biraz daha güvenli tahmin et
          let pageType = item.type;

          const lowerText = text.toLowerCase();

          if (
            pageType !== "homepage" &&
            (
              lowerText.includes("kaynak,") ||
              lowerText.includes("haber kaynağı") ||
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
            text: text.slice(0, 12000)
          });

          totalCharacters += text.length;
        }

        // =====================================================
        // SONUÇLARI HAZIRLA
        // =====================================================

        const articlePages = pages.filter(
          page => page.type === "article"
        );

        return json({
          ok: true,
          target: normalizedStart,
          domain,
          crawler: "smart-article-crawler",
          pagesScanned: pages.length,
          pagesLimit: MAX_PAGES,
          linksFound,
          articleCandidates: articleCandidates.size,
          articlePages: articlePages.length,
          totalCharacters,
          readyForAI: articlePages.length,
          aiProvider: "NVIDIA - next stage",
          pages: pages.map(page => ({
            url: page.url,
            type: page.type,
            score: page.score,
            status: page.status,
            chars: page.chars,
            title: page.title,
            error: page.error || null
          }))
        });

      } catch (error) {
        return json({
          ok: false,
          error: "Tarama sırasında beklenmeyen bir hata oluştu.",
          details: error.message || String(error)
        }, 500);
      }
    }

    // =========================================================
    // WEBPROOF AI ARAYÜZÜ
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
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  background:
    radial-gradient(circle at top left, rgba(80,120,255,.18), transparent 35%),
    radial-gradient(circle at bottom right, rgba(0,220,180,.10), transparent 35%),
    #070b14;
  color: #f5f7ff;
}

.container {
  width: min(1100px, calc(100% - 32px));
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
  border: 1px solid rgba(80,220,150,.25);
  border-radius: 999px;
  background: rgba(80,220,150,.07);
  color: #70e0a5;
  font-size: 13px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #55df91;
  box-shadow: 0 0 12px #55df91;
}

.card {
  margin-top: 34px;
  padding: 26px;
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 22px;
  background: rgba(17,23,37,.78);
  backdrop-filter: blur(18px);
  box-shadow: 0 20px 70px rgba(0,0,0,.35);
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
  padding: 17px 18px;
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 13px;
  outline: none;
  background: #0b101c;
  color: white;
  font-size: 15px;
}

input:focus {
  border-color: #6d8cff;
  box-shadow: 0 0 0 3px rgba(109,140,255,.12);
}

button {
  border: 0;
  border-radius: 13px;
  padding: 0 25px;
  background: linear-gradient(135deg, #607cff, #795cff);
  color: white;
  font-weight: 800;
  cursor: pointer;
  transition: .2s;
}

button:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
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
  border: 1px solid rgba(255,255,255,.08);
  color: #b9c3d6;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 20px;
}

.stat {
  padding: 18px;
  border-radius: 15px;
  background: rgba(255,255,255,.035);
  border: 1px solid rgba(255,255,255,.06);
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
  padding: 15px 0;
  border-bottom: 1px solid rgba(255,255,255,.06);
}

.page:last-child {
  border-bottom: 0;
}

.page-title {
  font-size: 14px;
  font-weight: 700;
  color: #e8ecf7;
}

.page-url {
  margin-top: 5px;
  color: #77849c;
  font-size: 12px;
  word-break: break-all;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

.badge {
  padding: 4px 8px;
  border-radius: 7px;
  font-size: 11px;
  background: rgba(109,140,255,.10);
  color: #91a5ff;
}

.badge.article {
  background: rgba(80,220,150,.10);
  color: #70e0a5;
}

.footer {
  margin-top: 35px;
  text-align: center;
  color: #647086;
  font-size: 12px;
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

  .stats {
    grid-template-columns: repeat(2, 1fr);
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
    Web sitelerinizi yapay zekâ ile yazım, dilbilgisi ve noktalama
    hatalarına karşı kontrol edin.
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

      <button id="scanBtn" onclick="scanSite()">
        SİTEYİ TARA
      </button>
    </div>

    <div id="statusBox" class="status-box"></div>

    <div id="stats" class="stats" style="display:none;">

      <div class="stat">
        <div id="pagesScanned" class="stat-value">0</div>
        <div class="stat-label">Taranan sayfa</div>
      </div>

      <div class="stat">
        <div id="linksFound" class="stat-value">0</div>
        <div class="stat-label">Bulunan bağlantı</div>
      </div>

      <div class="stat">
        <div id="articlePages" class="stat-value">0</div>
        <div class="stat-label">Haber / makale</div>
      </div>

      <div class="stat">
        <div id="characters" class="stat-value">0</div>
        <div class="stat-label">Metin karakteri</div>
      </div>

    </div>

    <div id="results" class="results"></div>

  </div>

  <div class="footer">
    WebProof AI · AI destekli web içerik kontrol sistemi
  </div>

</div>

<script>

async function scanSite() {

  const input = document.getElementById("url");
  const button = document.getElementById("scanBtn");
  const statusBox = document.getElementById("statusBox");
  const stats = document.getElementById("stats");
  const results = document.getElementById("results");

  const target = input.value.trim();

  if (!target) {
    statusBox.style.display = "block";
    statusBox.textContent = "Lütfen bir web sitesi adresi girin.";
    return;
  }

  button.disabled = true;
  button.textContent = "TARANIYOR...";

  statusBox.style.display = "block";
  statusBox.textContent =
    "Site analiz ediliyor, haber bağlantıları keşfediliyor...";

  stats.style.display = "none";
  results.innerHTML = "";

  try {

    const response = await fetch("/api/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: target
      })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(
        data.error || "Tarama başarısız oldu."
      );
    }

    statusBox.textContent =
      "Tarama tamamlandı. Haber ve makale sayfaları tespit edildi.";

    stats.style.display = "grid";

    document.getElementById("pagesScanned").textContent =
      data.pagesScanned;

    document.getElementById("linksFound").textContent =
      data.linksFound;

    document.getElementById("articlePages").textContent =
      data.articlePages;

    document.getElementById("characters").textContent =
      data.totalCharacters.toLocaleString("tr-TR");

    results.innerHTML = "";

    for (const page of data.pages) {

      const div = document.createElement("div");
      div.className = "page";

      const safeTitle =
        page.title ||
        "Başlık alınamadı";

      const typeLabel =
        page.type === "article"
          ? "HABER / MAKALE"
          : "SAYFA";

      div.innerHTML = \`
        <div class="page-title">
          \${escapeHtml(safeTitle)}
        </div>

        <div class="page-url">
          \${escapeHtml(page.url)}
        </div>

        <div class="badges">

          <span class="badge">
            HTTP \${page.status}
          </span>

          <span class="badge \${page.type === "article" ? "article" : ""}">
            \${typeLabel}
          </span>

          <span class="badge">
            Skor \${page.score}
          </span>

          <span class="badge">
            \${page.chars.toLocaleString("tr-TR")} karakter
          </span>

        </div>
      \`;

      results.appendChild(div);
    }

  } catch (error) {

    statusBox.textContent =
      "Hata: " + error.message;

  } finally {

    button.disabled = false;
    button.textContent = "SİTEYİ TARA";
  }
}

function escapeHtml(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

</script>

</body>
</html>
`;

    return new Response(HTML, {
      headers: {
        "content-type": "text/html;charset=UTF-8"
      }
    });
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "access-control-allow-origin": "*"
    }
  });
}

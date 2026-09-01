export default {
  async fetch(request) {

    const url = new URL(request.url);

    // ======================================================
    // CORS
    // ======================================================

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }


    // ======================================================
    // API STATUS
    // ======================================================

    if (
      url.pathname === "/api/status"
    ) {

      return new Response(
        JSON.stringify({
          success: true,
          project: "WebProof AI",
          status: "online",
          engine: "Crawler",
          message: "WebProof AI crawler hazır."
        }, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type":
              "application/json; charset=UTF-8",
            ...corsHeaders
          }
        }
      );
    }


    // ======================================================
    // API SCAN
    // ======================================================

    if (
      url.pathname === "/api/scan" &&
      request.method === "POST"
    ) {

      try {

        const body = await request.json();

        const targetUrl =
          typeof body.url === "string"
            ? body.url.trim()
            : "";

        if (!targetUrl) {

          return jsonResponse(
            {
              success: false,
              error:
                "Lütfen bir web sitesi adresi girin."
            },
            400,
            corsHeaders
          );
        }


        // ==================================================
        // URL KONTROLÜ
        // ==================================================

        let parsed;

        try {

          parsed = new URL(
            targetUrl
          );

        } catch {

          return jsonResponse(
            {
              success: false,
              error:
                "Geçerli bir URL girin."
            },
            400,
            corsHeaders
          );
        }


        if (
          parsed.protocol !== "https:" &&
          parsed.protocol !== "http:"
        ) {

          return jsonResponse(
            {
              success: false,
              error:
                "Sadece HTTP ve HTTPS adresleri destekleniyor."
            },
            400,
            corsHeaders
          );
        }


        // ==================================================
        // TEHLİKELİ / YEREL ADRES KONTROLÜ
        // ==================================================

        const hostname =
          parsed.hostname.toLowerCase();

        const blockedHosts = [
          "localhost",
          "127.0.0.1",
          "0.0.0.0",
          "::1",
          "metadata.google.internal"
        ];

        if (
          blockedHosts.includes(
            hostname
          )
        ) {

          return jsonResponse(
            {
              success: false,
              error:
                "Bu adres güvenlik nedeniyle taranamıyor."
            },
            403,
            corsHeaders
          );
        }


        // ==================================================
        // CRAWLER AYARLARI
        // ==================================================

        const MAX_PAGES = 10;

        const visited = new Set();

        const queue = [
          parsed.href
        ];

        const pages = [];

        let totalCharacters = 0;

        let totalLinks = 0;


        // ==================================================
        // SAYFA TARAYICI
        // ==================================================

        async function crawlPage(pageUrl) {

          try {

            const page = new URL(
              pageUrl
            );

            // Sadece aynı domain

            if (
              page.hostname.toLowerCase() !==
              hostname
            ) {
              return null;
            }


            const response =
              await fetch(
                page.href,
                {
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (compatible; WebProofAI/1.0)"
                  },
                  redirect: "follow"
                }
              );


            if (!response.ok) {

              return null;
            }


            const contentType =
              response.headers.get(
                "content-type"
              ) || "";


            if (
              !contentType.includes(
                "text/html"
              )
            ) {

              return null;
            }


            const html =
              await response.text();


            // ==================================================
            // HTML'DEN METİN ÇIKAR
            // ==================================================

            const textParts = [];

            const paragraphRegex =
              /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

            let match;

            while (
              (
                match =
                  paragraphRegex.exec(
                    html
                  )
              ) !== null
            ) {

              let text =
                match[1];

              // Script/style temizliği

              text =
                text.replace(
                  /<script[\s\S]*?<\/script>/gi,
                  " "
                );

              text =
                text.replace(
                  /<style[\s\S]*?<\/style>/gi,
                  " "
                );

              // HTML tag temizliği

              text =
                text.replace(
                  /<[^>]+>/g,
                  " "
                );

              // HTML entity

              text =
                text.replace(
                  /&nbsp;/gi,
                  " "
                );

              text =
                text.replace(
                  /&amp;/gi,
                  "&"
                );

              text =
                text.replace(
                  /&quot;/gi,
                  '"'
                );

              text =
                text.replace(
                  /&#39;/gi,
                  "'"
                );

              // Boşluk temizliği

              text =
                text.replace(
                  /\s+/g,
                  " "
                )
                .trim();


              if (
                text.length >= 25
              ) {

                textParts.push(
                  text
                );
              }
            }


            const text =
              textParts.join(
                "\n\n"
              );


            // ==================================================
            // LİNKLERİ BUL
            // ==================================================

            const links = [];

            const linkRegex =
              /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

            let linkMatch;

            while (
              (
                linkMatch =
                  linkRegex.exec(
                    html
                  )
              ) !== null
            ) {

              const rawHref =
                linkMatch[1];

              try {

                const absolute =
                  new URL(
                    rawHref,
                    page.href
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
                  hostname
                ) {
                  continue;
                }


                // Fragment kaldır

                absolute.hash = "";


                // Bazı dosya tiplerini atla

                const pathname =
                  absolute.pathname.toLowerCase();

                if (
                  pathname.endsWith(".pdf") ||
                  pathname.endsWith(".jpg") ||
                  pathname.endsWith(".jpeg") ||
                  pathname.endsWith(".png") ||
                  pathname.endsWith(".gif") ||
                  pathname.endsWith(".webp") ||
                  pathname.endsWith(".zip") ||
                  pathname.endsWith(".mp4")
                ) {
                  continue;
                }


                const normalized =
                  absolute.href;


                if (
                  !links.includes(
                    normalized
                  )
                ) {

                  links.push(
                    normalized
                  );
                }

              } catch {
                // Geçersiz link
              }
            }


            return {
              url: page.href,
              text,
              links
            };

          } catch {

            return null;
          }
        }


        // ==================================================
        // CRAWL DÖNGÜSÜ
        // ==================================================

        while (
          queue.length > 0 &&
          visited.size < MAX_PAGES
        ) {

          const current =
            queue.shift();


          if (
            visited.has(
              current
            )
          ) {
            continue;
          }


          visited.add(
            current
          );


          const result =
            await crawlPage(
              current
            );


          if (!result) {
            continue;
          }


          pages.push({
            url: result.url,
            characters:
              result.text.length
          });


          totalCharacters +=
            result.text.length;


          totalLinks +=
            result.links.length;


          // Yeni linkleri kuyruğa ekle

          for (
            const link
            of result.links
          ) {

            if (
              visited.size +
              queue.length >=
              MAX_PAGES
            ) {
              break;
            }


            if (
              !visited.has(
                link
              ) &&
              !queue.includes(
                link
              )
            ) {

              queue.push(
                link
              );
            }
          }
        }


        // ==================================================
        // SONUÇ
        // ==================================================

        return jsonResponse(
          {
            success: true,

            target: targetUrl,

            domain: hostname,

            pagesScanned:
              pages.length,

            pagesLimit:
              MAX_PAGES,

            linksFound:
              totalLinks,

            totalCharacters:
              totalCharacters,

            readyForAI:
              pages.length > 0 &&
              totalCharacters > 0,

            pages: pages,

            message:
              "Web sitesi başarıyla tarandı. İçerik AI analizine hazır."
          },
          200,
          corsHeaders
        );

      } catch (error) {

        return jsonResponse(
          {
            success: false,
            error:
              "Tarama sırasında bir hata oluştu.",
            detail:
              String(error)
          },
          500,
          corsHeaders
        );
      }
    }


    // ======================================================
    // WEB ARAYÜZÜ
    // ======================================================

    const html = `<!DOCTYPE html>

<html lang="tr">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>WebProof AI</title>

<meta
  name="description"
  content="WebProof AI ile web sitelerinizi yapay zekâ ile yazım, dilbilgisi ve noktalama hatalarına karşı kontrol edin."
>

<style>

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Arial,
    sans-serif;

  min-height: 100vh;

  background:
    linear-gradient(
      135deg,
      #f7f9fc 0%,
      #eef3f9 100%
    );

  color: #111827;
}

.container {

  width: 100%;
  max-width: 900px;

  margin: 0 auto;

  padding: 24px;
}

header {

  text-align: center;

  padding:
    70px 20px 35px;
}

.logo {

  display: inline-flex;

  align-items: center;
  justify-content: center;

  width: 64px;
  height: 64px;

  border-radius: 18px;

  background: #111827;

  color: white;

  font-size: 30px;

  font-weight: 800;

  margin-bottom: 20px;
}

h1 {

  font-size: 46px;

  line-height: 1.1;

  letter-spacing: -1.5px;

  margin-bottom: 16px;
}

.subtitle {

  max-width: 650px;

  margin: 0 auto;

  color: #667085;

  font-size: 18px;

  line-height: 1.6;
}

.card {

  background: white;

  border:
    1px solid #e5e7eb;

  border-radius: 22px;

  padding: 28px;

  box-shadow:
    0 15px 40px
    rgba(
      15,
      23,
      42,
      0.08
    );
}

label {

  display: block;

  font-size: 14px;

  font-weight: 700;

  margin-bottom: 10px;
}

.input-row {

  display: flex;

  gap: 12px;
}

input {

  flex: 1;

  width: 100%;

  padding:
    17px 18px;

  border:
    1px solid #d0d5dd;

  border-radius: 12px;

  font-size: 16px;

  outline: none;
}

input:focus {

  border-color: #111827;

  box-shadow:
    0 0 0 3px
    rgba(
      17,
      24,
      39,
      0.08
    );
}

button {

  border: 0;

  border-radius: 12px;

  padding:
    0 25px;

  background: #111827;

  color: white;

  font-size: 16px;

  font-weight: 700;

  cursor: pointer;
}

button:disabled {

  opacity: 0.6;

  cursor: not-allowed;
}

.status {

  display: none;

  margin-top: 22px;

  padding: 16px;

  border-radius: 12px;

  background: #f8fafc;

  border:
    1px solid #e5e7eb;

  color: #475467;

  line-height: 1.5;
}

.status.show {
  display: block;
}

.result {

  display: none;

  margin-top: 20px;

  padding: 20px;

  border-radius: 14px;

  background: #f8fafc;

  border:
    1px solid #e5e7eb;
}

.result.show {
  display: block;
}

.stat-grid {

  display: grid;

  grid-template-columns:
    repeat(3, 1fr);

  gap: 12px;

  margin-top: 15px;
}

.stat {

  padding: 15px;

  border-radius: 12px;

  background: white;

  border:
    1px solid #e5e7eb;

  text-align: center;
}

.stat-number {

  font-size: 24px;

  font-weight: 800;
}

.stat-label {

  margin-top: 4px;

  color: #667085;

  font-size: 12px;
}

.page-list {

  margin-top: 18px;
}

.page-item {

  padding: 10px 0;

  border-bottom:
    1px solid #eaecf0;

  font-size: 13px;

  word-break: break-all;
}

.online {

  display: inline-flex;

  align-items: center;

  gap: 7px;

  margin-top: 20px;

  padding:
    7px 12px;

  border-radius: 999px;

  background: #ecfdf3;

  color: #067647;

  font-size: 13px;

  font-weight: 700;
}

.dot {

  width: 8px;
  height: 8px;

  border-radius: 50%;

  background: #12b76a;
}

footer {

  text-align: center;

  padding:
    35px 20px;

  color: #98a2b3;

  font-size: 13px;
}

@media (max-width: 700px) {

  header {
    padding-top: 45px;
  }

  h1 {
    font-size: 36px;
  }

  .subtitle {
    font-size: 16px;
  }

  .input-row {
    flex-direction: column;
  }

  button {
    height: 52px;
  }

  .card {
    padding: 20px;
  }

  .stat-grid {
    grid-template-columns: 1fr;
  }
}

</style>

</head>

<body>

<div class="container">

<header>

<div class="logo">
W
</div>

<h1>
WebProof AI
</h1>

<p class="subtitle">
Web sitelerinizi yapay zekâ ile
yazım, dilbilgisi ve noktalama
hatalarına karşı kontrol edin.
</p>

<div class="online">
<span class="dot"></span>
Sistem çevrimiçi
</div>

</header>


<main>

<div class="card">

<label for="siteUrl">
Kontrol etmek istediğiniz web sitesi
</label>

<div class="input-row">

<input
  id="siteUrl"
  type="url"
  placeholder="https://www.bbc.com/turkce"
  autocomplete="url"
>

<button
  id="scanButton"
  onclick="startScan()"
>
SİTEYİ TARA
</button>

</div>


<div
  id="status"
  class="status"
></div>


<div
  id="result"
  class="result"
>

<strong>
TARAMA SONUCU
</strong>

<div
  id="stats"
  class="stat-grid"
></div>

<div
  id="pageList"
  class="page-list"
></div>

</div>

</div>

</main>


<footer>
WebProof AI · AI destekli web içerik kontrol sistemi
</footer>

</div>


<script>

async function startScan() {

  const input =
    document.getElementById(
      "siteUrl"
    );

  const button =
    document.getElementById(
      "scanButton"
    );

  const status =
    document.getElementById(
      "status"
    );

  const result =
    document.getElementById(
      "result"
    );

  const stats =
    document.getElementById(
      "stats"
    );

  const pageList =
    document.getElementById(
      "pageList"
    );

  const target =
    input.value.trim();


  if (!target) {

    status.textContent =
      "Lütfen bir web sitesi adresi girin.";

    status.classList.add(
      "show"
    );

    return;
  }


  button.disabled = true;

  button.textContent =
    "TARANIYOR...";

  result.classList.remove(
    "show"
  );

  status.classList.add(
    "show"
  );

  status.textContent =
    "WebProof AI siteyi tarıyor. Lütfen bekleyin...";


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


    if (!response.ok ||
        !data.success) {

      throw new Error(
        data.error ||
        "Tarama başarısız."
      );
    }


    status.textContent =
      "Tarama tamamlandı. İçerik AI analizine hazır.";


    stats.innerHTML = `

      <div class="stat">

        <div class="stat-number">
          ${data.pagesScanned}
        </div>

        <div class="stat-label">
          Taranan sayfa
        </div>

      </div>


      <div class="stat">

        <div class="stat-number">
          ${data.linksFound}
        </div>

        <div class="stat-label">
          Bulunan bağlantı
        </div>

      </div>


      <div class="stat">

        <div class="stat-number">
          ${data.totalCharacters.toLocaleString("tr-TR")}
        </div>

        <div class="stat-label">
          Metin karakteri
        </div>

      </div>

    `;


    pageList.innerHTML =
      "<strong>Taranan sayfalar</strong>";


    for (
      const page
      of data.pages
    ) {

      const item =
        document.createElement(
          "div"
        );

      item.className =
        "page-item";

      item.textContent =
        page.url +
        " · " +
        page.characters +
        " karakter";

      pageList.appendChild(
        item
      );
    }


    result.classList.add(
      "show"
    );


  } catch (error) {

    status.textContent =
      error.message ||
      "Tarama sırasında hata oluştu.";

    result.classList.remove(
      "show"
    );

  }


  button.disabled = false;

  button.textContent =
    "SİTEYİ TARA";
}

</script>

</body>

</html>`;


    return new Response(
      html,
      {
        status: 200,

        headers: {
          "Content-Type":
            "text/html; charset=UTF-8",

          "Cache-Control":
            "no-cache"
        }
      }
    );
  }
};


// ==========================================================
// JSON YARDIMCI FONKSİYON
// ==========================================================

function jsonResponse(
  data,
  status,
  corsHeaders
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
        "Content-Type":
          "application/json; charset=UTF-8",

        ...corsHeaders
      }
    }
  );
}

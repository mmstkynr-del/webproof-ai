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
  font-family: Arial, Helvetica, sans-serif;
  color: #fff;
  background:
    radial-gradient(circle at 10% 10%, #18345c, transparent 35%),
    radial-gradient(circle at 90% 90%, #17213d, transparent 35%),
    #070b14;
}

.container {
  width: min(1050px, 92%);
  margin: auto;
  padding: 65px 0 45px;
}

.header {
  text-align: center;
  margin-bottom: 40px;
}

.logo {
  width: 70px;
  height: 70px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  background: linear-gradient(135deg, #00d4ff, #635bff);
  font-size: 32px;
  box-shadow: 0 0 40px rgba(0,212,255,.25);
}

h1 {
  margin: 0;
  font-size: clamp(38px, 7vw, 64px);
  letter-spacing: -2px;
}

.subtitle {
  max-width: 700px;
  margin: 15px auto;
  color: #aab7d4;
  line-height: 1.6;
  font-size: 17px;
}

.online {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 14px;
  border-radius: 30px;
  color: #5cff9a;
  background: rgba(46,213,115,.1);
  border: 1px solid rgba(46,213,115,.25);
  font-size: 13px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #39ff88;
  box-shadow: 0 0 12px #39ff88;
}

.card {
  padding: 30px;
  border-radius: 24px;
  background: rgba(14,20,35,.88);
  border: 1px solid rgba(130,160,220,.16);
  box-shadow: 0 25px 80px rgba(0,0,0,.35);
}

.label {
  display: block;
  margin-bottom: 12px;
  color: #cbd6ef;
  font-size: 14px;
  font-weight: bold;
}

.input-row {
  display: flex;
  gap: 12px;
}

input {
  flex: 1;
  min-width: 0;
  padding: 18px;
  border-radius: 14px;
  border: 1px solid #293754;
  background: #080e1c;
  color: white;
  font-size: 16px;
  outline: none;
}

input:focus {
  border-color: #00c8ff;
  box-shadow: 0 0 0 3px rgba(0,200,255,.08);
}

button {
  min-height: 58px;
  padding: 0 25px;
  border: 0;
  border-radius: 14px;
  background: linear-gradient(135deg, #00c8ff, #635bff);
  color: white;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
}

button:disabled {
  opacity: .6;
  cursor: wait;
}

.status {
  margin-top: 20px;
  padding: 16px;
  border-radius: 14px;
  background: #0a1120;
  border: 1px solid #1e2b45;
  color: #9eafd0;
  line-height: 1.5;
}

.results {
  display: none;
  margin-top: 25px;
}

.results.show {
  display: block;
}

.result-title {
  margin-bottom: 18px;
  font-size: 20px;
  font-weight: bold;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.stat {
  padding: 18px;
  border-radius: 15px;
  background: #0a1120;
  border: 1px solid #1c2942;
}

.number {
  font-size: 27px;
  font-weight: bold;
}

.small {
  margin-top: 5px;
  color: #8293b5;
  font-size: 12px;
}

.page-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.page {
  padding: 15px;
  border-radius: 12px;
  background: #0a1120;
  border: 1px solid #1c2942;
}

.page-url {
  color: #69d9ff;
  word-break: break-all;
  font-size: 14px;
}

.page-info {
  margin-top: 7px;
  color: #7889aa;
  font-size: 12px;
}

.error {
  color: #ff7b7b;
}

.success {
  color: #66f2a1;
}

.footer {
  margin-top: 35px;
  text-align: center;
  color: #566783;
  font-size: 12px;
}

@media (max-width: 700px) {

  .container {
    padding-top: 40px;
  }

  .card {
    padding: 20px;
  }

  .input-row {
    flex-direction: column;
  }

  button {
    width: 100%;
  }

  .stats {
    grid-template-columns: repeat(2, 1fr);
  }

}
</style>
</head>

<body>

<div class="container">

<div class="header">

<div class="logo">✓</div>

<h1>WebProof AI</h1>

<div class="subtitle">
Web sitelerinizi yapay zekâ ile yazım, dilbilgisi ve noktalama hatalarına karşı kontrol edin.
</div>

<div class="online">
<span class="dot"></span>
Sistem çevrimiçi
</div>

</div>

<div class="card">

<label class="label">
Kontrol etmek istediğiniz web sitesi
</label>

<div class="input-row">

<input
id="urlInput"
type="url"
placeholder="https://www.bbc.com/turkce"
>

<button id="scanButton">
SİTEYİ TARA
</button>

</div>

<div id="status" class="status">
WebProof AI hazır. Bir web sitesi adresi girerek taramayı başlatabilirsiniz.
</div>

<div id="results" class="results">

<div class="result-title">
Tarama sonucu
</div>

<div class="stats">

<div class="stat">
<div id="pagesScanned" class="number">0</div>
<div class="small">Taranan sayfa</div>
</div>

<div class="stat">
<div id="linksFound" class="number">0</div>
<div class="small">Bulunan bağlantı</div>
</div>

<div class="stat">
<div id="totalCharacters" class="number">0</div>
<div class="small">Metin karakteri</div>
</div>

<div class="stat">
<div id="readyForAI" class="number">0</div>
<div class="small">AI için hazır</div>
</div>

</div>

<div id="pageList" class="page-list"></div>

</div>

</div>

<div class="footer">
WebProof AI · AI destekli web içerik kontrol sistemi
</div>

</div>

<script>

const input = document.getElementById("urlInput");
const button = document.getElementById("scanButton");
const statusBox = document.getElementById("status");
const results = document.getElementById("results");

const pagesScanned = document.getElementById("pagesScanned");
const linksFound = document.getElementById("linksFound");
const totalCharacters = document.getElementById("totalCharacters");
const readyForAI = document.getElementById("readyForAI");
const pageList = document.getElementById("pageList");

function setStatus(message, type) {

  statusBox.textContent = message;
  statusBox.className = "status";

  if (type === "error") {
    statusBox.classList.add("error");
  }

  if (type === "success") {
    statusBox.classList.add("success");
  }

}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("tr-TR");
}

function displayResults(data) {

  results.classList.add("show");

  pagesScanned.textContent =
    formatNumber(data.pagesScanned);

  linksFound.textContent =
    formatNumber(data.linksFound);

  totalCharacters.textContent =
    formatNumber(data.totalCharacters);

  readyForAI.textContent =
    formatNumber(data.readyForAI);

  pageList.innerHTML = "";

  if (!data.pages || data.pages.length === 0) {

    pageList.textContent =
      "Taranabilir sayfa bulunamadı.";

    return;

  }

  data.pages.forEach(function(page) {

    const box =
      document.createElement("div");

    box.className = "page";

    const pageUrl =
      document.createElement("div");

    pageUrl.className = "page-url";

    pageUrl.textContent =
      page.url;

    const info =
      document.createElement("div");

    info.className = "page-info";

    info.textContent =
      "HTTP " +
      page.status +
      " · " +
      formatNumber(page.characters) +
      " karakter";

    box.appendChild(pageUrl);
    box.appendChild(info);

    pageList.appendChild(box);

  });

}

async function scanSite() {

  const target =
    input.value.trim();

  if (!target) {

    setStatus(
      "Lütfen bir web sitesi adresi girin.",
      "error"
    );

    return;

  }

  try {

    const parsed =
      new URL(target);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {

      throw new Error(
        "Sadece HTTP veya HTTPS adresleri kullanılabilir."
      );

    }

  } catch (error) {

    setStatus(
      error.message ||
      "Geçerli bir URL girin.",
      "error"
    );

    return;

  }

  button.disabled = true;
  button.textContent = "TARANIYOR...";

  results.classList.remove("show");

  setStatus(
    "Web sitesi taranıyor. Sayfalar ve bağlantılar bulunuyor...",
    null
  );

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

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        "Tarama başarısız."
      );

    }

    displayResults(data);

    setStatus(
      "Tarama tamamlandı. Bulunan içerikler AI analizine hazır.",
      "success"
    );

  } catch (error) {

    setStatus(
      "Hata: " + error.message,
      "error"
    );

  }

  button.disabled = false;
  button.textContent = "SİTEYİ TARA";

}

button.addEventListener(
  "click",
  scanSite
);

input.addEventListener(
  "keydown",
  function(event) {

    if (event.key === "Enter") {
      scanSite();
    }

  }
);

</script>

</body>
</html>
`;

function jsonResponse(data, statusCode) {

  return new Response(
    JSON.stringify(data, null, 2),
    {
      status: statusCode || 200,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );

}

function normalizeUrl(url) {

  try {

    const parsed =
      new URL(url);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return null;
    }

    parsed.hash = "";

    return parsed.href;

  } catch {

    return null;

  }

}

function isBlockedHost(hostname) {

  const host =
    hostname.toLowerCase();

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
    blockedHosts.includes(host)
  ) {
    return true;
  }

  if (host.startsWith("10.")) {
    return true;
  }

  if (host.startsWith("192.168.")) {
    return true;
  }

  if (host.startsWith("127.")) {
    return true;
  }

  return false;

}

function shouldSkipUrl(url) {

  const lower =
    url.toLowerCase();

  const extensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".pdf",
    ".zip",
    ".rar",
    ".7z",
    ".mp3",
    ".mp4",
    ".avi",
    ".mov",
    ".webm",
    ".css",
    ".js",
    ".xml",
    ".json",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot"
  ];

  for (
    const extension of extensions
  ) {

    if (
      lower.includes(extension)
    ) {
      return true;
    }

  }

  return false;

}

function decodeBasicEntities(text) {

  return text
    .split("&nbsp;").join(" ")
    .split("&amp;").join("&")
    .split("&quot;").join('"')
    .split("&#39;").join("'")
    .split("&lt;").join("<")
    .split("&gt;").join(">");

}

function extractText(html) {

  let text =
    html;

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

  text =
    text.replace(
      /<noscript[\s\S]*?<\/noscript>/gi,
      " "
    );

  text =
    text.replace(
      /<svg[\s\S]*?<\/svg>/gi,
      " "
    );

  text =
    text.replace(
      /<nav[\s\S]*?<\/nav>/gi,
      " "
    );

  text =
    text.replace(
      /<footer[\s\S]*?<\/footer>/gi,
      " "
    );

  text =
    text.replace(
      /<header[\s\S]*?<\/header>/gi,
      " "
    );

  const paragraphs = [];

  const paragraphPattern =
    /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

  let match;

  while (
    (match =
      paragraphPattern.exec(text)) !== null
  ) {

    let paragraph =
      match[1];

    paragraph =
      paragraph.replace(
        /<[^>]+>/g,
        " "
      );

    paragraph =
      decodeBasicEntities(
        paragraph
      );

    paragraph =
      paragraph.replace(
        /\s+/g,
        " "
      );

    paragraph =
      paragraph.trim();

    if (
      paragraph.length >= 40
    ) {

      paragraphs.push(
        paragraph
      );

    }

  }

  if (
    paragraphs.length > 0
  ) {

    return paragraphs.join(
      "\n\n"
    );

  }

  text =
    text.replace(
      /<[^>]+>/g,
      " "
    );

  text =
    decodeBasicEntities(
      text
    );

  text =
    text.replace(
      /\s+/g,
      " "
    );

  return text.trim();

}

function extractLinks(
  html,
  baseUrl,
  domain
) {

  const found =
    new Set();

  const linkPattern =
    /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match =
      linkPattern.exec(html)) !== null
  ) {

    const raw =
      match[1];

    if (!raw) {
      continue;
    }

    const cleanRaw =
      raw.trim();

    if (
      cleanRaw.startsWith("#") ||
      cleanRaw.startsWith("mailto:") ||
      cleanRaw.startsWith("tel:") ||
      cleanRaw.startsWith("javascript:")
    ) {
      continue;
    }

    try {

      const absolute =
        new URL(
          cleanRaw,
          baseUrl
        );

      absolute.hash = "";

      if (
        absolute.protocol !== "http:" &&
        absolute.protocol !== "https:"
      ) {
        continue;
      }

      if (
        absolute.hostname.toLowerCase() !==
        domain
      ) {
        continue;
      }

      const normalized =
        normalizeUrl(
          absolute.href
        );

      if (!normalized) {
        continue;
      }

      if (
        shouldSkipUrl(
          normalized
        )
      ) {
        continue;
      }

      found.add(
        normalized
      );

    } catch {

      continue;

    }

  }

  return Array.from(found);

}

async function fetchPage(url) {

  try {

    const response =
      await fetch(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; WebProofAI/1.0)"
          },
          redirect: "follow"
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
        url,
        status:
          response.status,
        html: "",
        text: "",
        links: []
      };

    }

    const html =
      await response.text();

    const finalUrl =
      normalizeUrl(
        response.url
      ) || url;

    const text =
      extractText(
        html
      );

    return {
      url:
        finalUrl,
      status:
        response.status,
      html,
      text,
      links: []
    };

  } catch (error) {

    return {
      url,
      status: 0,
      html: "",
      text: "",
      links: [],
      error:
        error.message
    };

  }

}

async function crawlWebsite(
  startUrl
) {

  const normalizedStart =
    normalizeUrl(
      startUrl
    );

  if (!normalizedStart) {

    throw new Error(
      "Geçersiz URL."
    );

  }

  const start =
    new URL(
      normalizedStart
    );

  if (
    isBlockedHost(
      start.hostname
    )
  ) {

    throw new Error(
      "Bu adres güvenlik nedeniyle taranamıyor."
    );

  }

  const domain =
    start.hostname.toLowerCase();

  const MAX_PAGES = 10;

  const queue = [
    normalizedStart
  ];

  const visited =
    new Set();

  const pages = [];

  let linksFound = 0;

  let totalCharacters = 0;

  while (
    queue.length > 0 &&
    pages.length < MAX_PAGES
  ) {

    const currentUrl =
      queue.shift();

    if (
      visited.has(
        currentUrl
      )
    ) {
      continue;
    }

    visited.add(
      currentUrl
    );

    const page =
      await fetchPage(
        currentUrl
      );

    if (
      page.status === 0
    ) {
      continue;
    }

    const links =
      extractLinks(
        page.html,
        page.url,
        domain
      );

    page.links =
      links;

    linksFound +=
      links.length;

    totalCharacters +=
      page.text.length;

    pages.push({
      url:
        page.url,
      status:
        page.status,
      characters:
        page.text.length
    });

    for (
      const link of links
    ) {

      if (
        !visited.has(link) &&
        !queue.includes(link) &&
        queue.length < 100
      ) {

        queue.push(
          link
        );

      }

    }

  }

  return {
    success: true,
    target:
      normalizedStart,
    domain,
    pagesScanned:
      pages.length,
    pagesLimit:
      MAX_PAGES,
    linksFound,
    totalCharacters,
    readyForAI:
      pages.filter(
        function(page) {
          return page.characters > 0;
        }
      ).length,
    pages
  };

}

export default {

  async fetch(request) {

    const url =
      new URL(
        request.url
      );

    if (
      request.method === "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin":
              "*",
            "Access-Control-Allow-Methods":
              "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type"
          }
        }
      );

    }

    if (
      url.pathname ===
      "/api/status"
    ) {

      return jsonResponse({
        success: true,
        project:
          "WebProof AI",
        status:
          "online",
        message:
          "WebProof AI çalışıyor!"
      });

    }

    if (
      url.pathname ===
      "/api/scan" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        if (
          !body ||
          typeof body.url !==
          "string"
        ) {

          return jsonResponse(
            {
              success: false,
              error:
                "URL gönderilmedi."
            },
            400
          );

        }

        const result =
          await crawlWebsite(
            body.url.trim()
          );

        return jsonResponse(
          result
        );

      } catch (error) {

        return jsonResponse(
          {
            success: false,
            error:
              error.message ||
              "Tarama sırasında hata oluştu."
          },
          400
        );

      }

    }

    if (
      url.pathname === "/"
    ) {

      return new Response(
        HTML,
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

    return jsonResponse(
      {
        success: false,
        error:
          "Endpoint bulunamadı."
      },
      404
    );

  }

};

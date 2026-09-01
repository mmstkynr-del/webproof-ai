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
  font-family: Arial, sans-serif;
  color: white;
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

function status(message, type) {
  statusBox.textContent = message;
  statusBox.className = "status";

  if (type === "error") {
    statusBox.classList.add("error");
  }

  if (type === "success") {
    statusBox.classList.add("success");
  }
}

function number(value) {
  return Number(value || 0).toLocaleString("tr-TR");
}

function showResults(data) {

  results.classList.add("show");

  pagesScanned.textContent = number(data.pagesScanned);
  linksFound.textContent = number(data.linksFound);
  totalCharacters.textContent = number(data.totalCharacters);
  readyForAI.textContent = number(data.readyForAI);

  pageList.innerHTML = "";

  if (!data.pages || data.pages.length === 0) {

    pageList.textContent = "Taranabilir sayfa bulunamadı.";

    return;
  }

  data.pages.forEach(function(page) {

    const box = document.createElement("div");
    box.className = "page";

    const url = document.createElement("div");
    url.className = "page-url";
    url.textContent = page.url;

    const info = document.createElement("div");
    info.className = "page-info";

    info.textContent =
      "HTTP " +
      page.status +
      " · " +
      number(page.characters) +
      " karakter";

    box.appendChild(url);
    box.appendChild(info);

    pageList.appendChild(box);

  });
}

async function scan() {

  const target = input.value.trim();

  if (!target) {
    status("Lütfen bir web sitesi adresi girin.", "error");
    return;
  }

  try {

    const parsed = new URL(target);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      throw new Error("Sadece HTTP veya HTTPS kullanılabilir.");
    }

  } catch (error) {

    status(
      error.message || "Geçerli bir URL girin.",
      "error"
    );

    return;
  }

  button.disabled = true;
  button.textContent = "TARANIYOR...";

  results.classList.remove("show");

  status(
    "Web sitesi taranıyor. Lütfen bekleyin...",
    null
  );

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

    if (!response.ok || !data.success) {
      throw new Error(
        data.error || "Tarama başarısız."
      );
    }

    showResults(data);

    status(
      "Tarama tamamlandı. Bulunan içerikler AI analizine hazır.",
      "success"
    );

  } catch (error) {

    status(
      "Hata: " + error.message,
      "error"
    );

  }

  button.disabled = false;
  button.textContent = "SİTEYİ TARA";
}

button.addEventListener("click", scan);

input.addEventListener("keydown", function(event) {

  if (event.key === "Enter") {
    scan();
  }

});

</script>

</body>
</html>
`;

function json(data, statusCode) {

  return new Response(
    JSON.stringify(data, null, 2),
    {
      status: statusCode || 200,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );

}

function normalize(url) {

  try {

    const u = new URL(url);

    if (
      u.protocol !== "http:" &&
      u.protocol !== "https:"
    ) {
      return null;
    }

    u.hash = "";

    return u.href;

  } catch {

    return null;

  }

}

function blocked(host) {

  const h = host.toLowerCase();

  const bad = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal",
    "metadata.google",
    "169.254.169.254"
  ];

  if (bad.includes(h)) {
    return true;
  }

  if (h.startsWith("10.")) {
    return true;
  }

  if (h.startsWith("192.168.")) {
    return true;
  }

  if (h.startsWith("127.")) {
    return true;
  }

  return false;

}

function skip(url) {

  const u = url.toLowerCase();

  const endings = [
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
    ".ttf"
  ];

  for (const ending of endings) {

    if (u.includes(ending)) {
      return true;
    }

  }

  return false;

}

function cleanText(html) {

  let text = html;

  const patterns = [
    new RegExp("<script[\\\\s\\\\S]*?<\\\\/script>", "gi"),
    new RegExp("<style[\\\\s\\\\S]*?<\\\\/style>", "gi"),
    new RegExp("<noscript[\\\\s\\\\S]*?<\\\\/noscript>", "gi"),
    new RegExp("<svg[\\\\s\\\\S]*?<\\\\/svg>", "gi"),
    new RegExp("<nav[\\\\s\\\\S]*?<\\\\/nav>", "gi"),
    new RegExp("<footer[\\\\s\\\\S]*?<\\\\/footer>", "gi"),
    new RegExp("<header[\\\\s\\\\S]*?<\\\\/header>", "gi")
  ];

  for (const pattern of patterns) {
    text = text.replace(pattern, " ");
  }

  text = text.replace(
    new RegExp("<p\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/p>", "gi"),
    " $1 "
  );

  text = text.replace(
    new RegExp("<[^>]+>", "g"),
    " "
  );

  text = text.split("&nbsp;").join(" ");
  text = text.split("&amp;").join("&");
  text = text.split("&quot;").join('"');
  text = text.split("&#39;").join("'");

  text = text.replace(
    new RegExp("\\\\s+", "g"),
    " "
  );

  return text.trim();

}

function findLinks(html, baseUrl, domain) {

  const found = new Set();

  const pattern =
    new RegExp(
      "<a\\\\b[^>]*href\\\\s*=\\\\s*[\\\"']([^\\\"']+)[\\\"'][^>]*>",
      "gi"
    );

  let match;

  while ((match = pattern.exec(html)) !== null) {

    const raw = match[1];

    if (!raw) {
      continue;
    }

    if (
      raw.startsWith("#") ||
      raw.startsWith("mailto:") ||
      raw.startsWith("tel:") ||
      raw.startsWith("javascript:")
    ) {
      continue;
    }

    try {

      const absolute =
        new URL(raw, baseUrl);

      absolute.hash = "";

      if (
        absolute.protocol !== "http:" &&
        absolute.protocol !== "https:"
      ) {
        continue;
      }

      if (
        absolute.hostname.toLowerCase() !== domain
      ) {
        continue;
      }

      const normalized =
        normalize(absolute.href);

      if (!normalized) {
        continue;
      }

      if (skip(normalized)) {
        continue;
      }

      found.add(normalized);

    } catch {

      continue;

    }

  }

  return Array.from(found);

}

async function download(url) {

  try {

    const response = await fetch(
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
      response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {

      return {
        url,
        status: response.status,
        html: "",
        text: "",
        links: []
      };

    }

    const html =
      await response.text();

    const finalUrl =
      normalize(response.url) || url;

    const text =
      cleanText(html);

    return {
      url: finalUrl,
      status: response.status,
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
      error: error.message
    };

  }

}

async function crawl(startUrl) {

  const start =
    normalize(startUrl);

  if (!start) {
    throw new Error("Geçersiz URL.");
  }

  const startObject =
    new URL(start);

  if (blocked(startObject.hostname)) {
    throw new Error(
      "Bu adres güvenlik nedeniyle taranamıyor."
    );
  }

  const domain =
    startObject.hostname.toLowerCase();

  const MAX_PAGES = 10;

  const queue = [start];

  const visited = new Set();

  const pages = [];

  let totalCharacters = 0;
  let linksFound = 0;

  while (
    queue.length > 0 &&
    pages.length < MAX_PAGES
  ) {

    const current =
      queue.shift();

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    const page =
      await download(current);

    if (page.status === 0) {
      continue;
    }

    const links =
      findLinks(
        page.html,
        page.url,
        domain
      );

    linksFound += links.length;

    totalCharacters += page.text.length;

    pages.push({
      url: page.url,
      status: page.status,
      characters: page.text.length
    });

    for (const link of links) {

      if (
        !visited.has(link) &&
        !queue.includes(link)
      ) {

        queue.push(link);

      }

    }

  }

  return {
    success: true,
    target: start,
    domain,
    pagesScanned: pages.length,
    pagesLimit: MAX_PAGES,
    linksFound,
    totalCharacters,
    readyForAI: pages.filter(function(page) {
      return page.characters > 0;
    }).length,
    pages
  };

}

export default {

  async fetch(request) {

    const url =
      new URL(request.url);

    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods":
            "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type"
        }
      });

    }

    if (url.pathname === "/api/status") {

      return json({
        success: true,
        project: "WebProof AI",
        status: "online"
      });

    }

    if (
      url.pathname === "/api/scan" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        if (
          !body ||
          typeof body.url !== "string"
        ) {

          return json(
            {
              success: false,
              error: "URL gönderilmedi."
            },
            400
          );

        }

        const result =
          await crawl(body.url.trim());

        return json(result);

      } catch (error) {

        return json(
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

    if (url.pathname === "/") {

      return new Response(
        HTML,
        {
          status: 200,
          headers: {
            "Content-Type":
              "text/html; charset=UTF-8"
          }
        }
      );

    }

    return json(
      {
        success: false,
        error: "Endpoint bulunamadı."
      },
      404
    );

  }

};

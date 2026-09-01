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
  background:
    radial-gradient(circle at top left, #18345c 0%, transparent 35%),
    radial-gradient(circle at bottom right, #17213d 0%, transparent 35%),
    #070b14;
  color: #ffffff;
}

.container {
  width: min(1050px, 92%);
  margin: 0 auto;
  padding: 70px 0 50px;
}

.header {
  text-align: center;
  margin-bottom: 45px;
}

.logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 22px;
  background: linear-gradient(135deg, #00d4ff, #635bff);
  font-size: 32px;
  margin-bottom: 20px;
  box-shadow: 0 0 40px rgba(0, 212, 255, 0.25);
}

h1 {
  margin: 0;
  font-size: clamp(36px, 7vw, 64px);
  letter-spacing: -2px;
}

.subtitle {
  max-width: 700px;
  margin: 15px auto 0;
  color: #aab7d4;
  font-size: 17px;
  line-height: 1.6;
}

.online {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  padding: 8px 14px;
  border-radius: 30px;
  background: rgba(46, 213, 115, 0.1);
  border: 1px solid rgba(46, 213, 115, 0.25);
  color: #5cff9a;
  font-size: 13px;
}

.online-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #39ff88;
  box-shadow: 0 0 12px #39ff88;
}

.card {
  background: rgba(14, 20, 35, 0.82);
  border: 1px solid rgba(130, 160, 220, 0.16);
  border-radius: 24px;
  padding: 30px;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(15px);
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
  box-shadow: 0 0 0 3px rgba(0, 200, 255, 0.08);
}

button {
  border: 0;
  border-radius: 14px;
  padding: 0 25px;
  background: linear-gradient(135deg, #00c8ff, #635bff);
  color: white;
  font-weight: bold;
  font-size: 15px;
  cursor: pointer;
  transition: 0.2s;
  min-height: 58px;
}

button:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 30px rgba(0, 200, 255, 0.2);
}

button:disabled {
  opacity: 0.6;
  cursor: wait;
  transform: none;
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
  margin-top: 25px;
  display: none;
}

.results.show {
  display: block;
}

.result-title {
  font-size: 20px;
  font-weight: bold;
  margin-bottom: 18px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.stat {
  background: #0a1120;
  border: 1px solid #1c2942;
  border-radius: 15px;
  padding: 18px;
}

.stat-number {
  font-size: 27px;
  font-weight: bold;
  color: #ffffff;
}

.stat-label {
  margin-top: 5px;
  font-size: 12px;
  color: #8293b5;
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
  overflow: hidden;
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

.footer {
  text-align: center;
  margin-top: 35px;
  color: #566783;
  font-size: 12px;
}

.error {
  color: #ff7b7b;
}

.success {
  color: #66f2a1;
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
      Web sitelerinizi yapay zekâ ile yazım, dilbilgisi ve noktalama
      hatalarına karşı kontrol edin.
    </div>

    <div class="online">
      <span class="online-dot"></span>
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
        autocomplete="off"
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
          <div id="pagesScanned" class="stat-number">0</div>
          <div class="stat-label">Taranan sayfa</div>
        </div>

        <div class="stat">
          <div id="linksFound" class="stat-number">0</div>
          <div class="stat-label">Bulunan bağlantı</div>
        </div>

        <div class="stat">
          <div id="totalCharacters" class="stat-number">0</div>
          <div class="stat-label">Metin karakteri</div>
        </div>

        <div class="stat">
          <div id="readyForAI" class="stat-number">0</div>
          <div class="stat-label">AI için hazır</div>
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

function formatNumber(number) {
  return Number(number || 0).toLocaleString("tr-TR");
}

function renderResults(data) {

  results.classList.add("show");

  pagesScanned.textContent = formatNumber(data.pagesScanned);
  linksFound.textContent = formatNumber(data.linksFound);
  totalCharacters.textContent = formatNumber(data.totalCharacters);
  readyForAI.textContent = formatNumber(data.readyForAI);

  pageList.innerHTML = "";

  if (!data.pages || data.pages.length === 0) {

    pageList.innerHTML =
      '<div class="page">Taranabilir sayfa bulunamadı.</div>';

    return;
  }

  data.pages.forEach(function(page) {

    const item = document.createElement("div");
    item.className = "page";

    const url = document.createElement("div");
    url.className = "page-url";
    url.textContent = page.url;

    const info = document.createElement("div");
    info.className = "page-info";

    info.textContent =
      "HTTP " +
      page.status +
      " · " +
      formatNumber(page.characters) +
      " karakter";

    item.appendChild(url);
    item.appendChild(info);

    pageList.appendChild(item);

  });
}

async function scanSite() {

  const url = input.value.trim();

  if (!url) {
    setStatus("Lütfen bir web sitesi adresi girin.", "error");
    input.focus();
    return;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch (error) {
    setStatus("Geçerli bir web sitesi adresi girin.", "error");
    return;
  }

  if (
    parsedUrl.protocol !== "http:" &&
    parsedUrl.protocol !== "https:"
  ) {
    setStatus("Sadece HTTP veya HTTPS adresleri kullanılabilir.", "error");
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

    const response = await fetch("/api/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: url
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.error || "Tarama sırasında bir hata oluştu."
      );
    }

    renderResults(data);

    setStatus(
      "Tarama tamamlandı. Bulunan içerikler AI analizine hazır.",
      "success"
    );

  } catch (error) {

    setStatus(
      "Hata: " + error.message,
      "error"
    );

  } finally {

    button.disabled = false;
    button.textContent = "SİTEYİ TARA";

  }
}

button.addEventListener("click", scanSite);

input.addEventListener("keydown", function(event) {

  if (event.key === "Enter") {
    scanSite();
  }

});

</script>

</body>
</html>
`;

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

function normalizeUrl(url) {

  try {

    const parsed = new URL(url);

    parsed.hash = "";

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return null;
    }

    return parsed.href;

  } catch {
    return null;
  }
}

function isBlockedHost(hostname) {

  const host = hostname.toLowerCase();

  const blocked = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal",
    "metadata.google",
    "169.254.169.254"
  ];

  if (blocked.includes(host)) {
    return true;
  }

  if (
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("127.")
  ) {
    return true;
  }

  return false;
}

function shouldSkipUrl(url) {

  const lower = url.toLowerCase();

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

  return extensions.some(function(extension) {
    return lower.includes(extension);
  });
}

function extractText(html) {

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
    /<nav[\s\S]*?<\/nav>/gi,
    " "
  );

  text = text.replace(
    /<footer[\s\S]*?<\/footer>/gi,
    " "
  );

  text = text.replace(
    /<header[\s\S]*?<\/header>/gi,
    " "
  );

  const paragraphs = [];

  const paragraphRegex =
    /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

  let match;

  while ((match = paragraphRegex.exec(text)) !== null) {

    let paragraph = match[1];

    paragraph = paragraph.replace(
      /<[^>]+>/g,
      " "
    );

    paragraph = paragraph.replace(
      /&

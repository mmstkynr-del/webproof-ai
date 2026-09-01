export default {
  async fetch(request) {
    const url = new URL(request.url);

    // --------------------------------------------------
    // API: /api/status
    // --------------------------------------------------

    if (url.pathname === "/api/status") {
      return new Response(
        JSON.stringify({
          success: true,
          project: "WebProof AI",
          status: "online",
          engine: "NVIDIA AI",
          message: "WebProof AI çalışıyor!"
        }, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    // --------------------------------------------------
    // ANA WEB ARAYÜZÜ
    // --------------------------------------------------

    const html = `
<!DOCTYPE html>
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
    content="WebProof AI ile web sitelerinizi yapay zekâ ile yazım ve dil hatalarına karşı kontrol edin."
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
      padding: 70px 20px 35px;
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

      border: 1px solid #e5e7eb;

      border-radius: 22px;

      padding: 28px;

      box-shadow:
        0 15px 40px rgba(
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

      padding: 17px 18px;

      border:
        1px solid #d0d5dd;

      border-radius: 12px;

      font-size: 16px;

      outline: none;

      transition: 0.2s;
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

      padding: 0 25px;

      background: #111827;

      color: white;

      font-size: 16px;
      font-weight: 700;

      cursor: pointer;

      transition: 0.2s;
    }

    button:hover {
      transform: translateY(-1px);
      background: #000000;
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .status {
      display: none;

      margin-top: 22px;

      padding: 16px;

      border-radius: 12px;

      background: #f8fafc;

      border: 1px solid #e5e7eb;

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

      border: 1px solid #e5e7eb;
    }

    .result.show {
      display: block;
    }

    .result-title {
      font-size: 15px;
      font-weight: 800;

      margin-bottom: 8px;
    }

    .online {
      display: inline-flex;

      align-items: center;

      gap: 7px;

      margin-top: 20px;

      padding: 7px 12px;

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

      padding: 35px 20px;

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
          <div class="result-title">
            WebProof AI
          </div>

          <div id="resultText">
          </div>
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

      const resultText =
        document.getElementById(
          "resultText"
        );

      const value =
        input.value.trim();

      if (!value) {

        status.textContent =
          "Lütfen kontrol etmek istediğiniz web sitesinin adresini girin.";

        status.classList.add(
          "show"
        );

        result.classList.remove(
          "show"
        );

        return;
      }


      try {

        new URL(value);

      } catch {

        status.textContent =
          "Lütfen geçerli bir web sitesi adresi girin. Örneğin: https://www.bbc.com/turkce";

        status.classList.add(
          "show"
        );

        result.classList.remove(
          "show"
        );

        return;
      }


      button.disabled = true;

      button.textContent =
        "KONTROL EDİLİYOR...";

      result.classList.remove(
        "show"
      );

      status.classList.add(
        "show"
      );

      status.textContent =
        "WebProof AI sistemi hazırlanıyor...";


      try {

        const response =
          await fetch(
            "/api/status"
          );

        const data =
          await response.json();


        if (
          data.success &&
          data.status === "online"
        ) {

          status.textContent =
            "WebProof AI hazır. Gerçek site tarama motoru bir sonraki aşamada bağlanacak.";

          resultText.textContent =
            "Sistem başarıyla çalışıyor. URL alındı ve WebProof AI altyapısı çevrimiçi.";

          result.classList.add(
            "show"
          );

        } else {

          throw new Error(
            "Sistem çevrimdışı."
          );

        }

      } catch (error) {

        status.textContent =
          "Bir bağlantı hatası oluştu. Lütfen tekrar deneyin.";

      }


      button.disabled = false;

      button.textContent =
        "SİTEYİ TARA";
    }

  </script>

</body>
</html>
`;

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

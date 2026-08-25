export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Sağlık testi
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "WebProof Engine",
        status: "running",
        languages: ["tr", "en"]
      });
    }

    // Yazım denetimi
    if (url.pathname === "/check" && request.method === "POST") {
      try {
        const body = await request.json();

        const text = String(body.text || "");
        const language = body.language || "auto";

        if (!text.trim()) {
          return json({
            ok: false,
            error: "Metin boş."
          }, 400);
        }

        if (text.length > 60000) {
          return json({
            ok: false,
            error: "Tek istekte en fazla 60.000 karakter."
          }, 413);
        }

        const result = await checkLanguageTool(text, language);

        return json({
          ok: true,
          language,
          matches: result.matches || [],
          total: result.matches?.length || 0
        });

      } catch (error) {
        return json({
          ok: false,
          error: error.message
        }, 500);
      }
    }

    return json({
      ok: true,
      service: "WebProof Engine",
      endpoints: [
        "/health",
        "/check"
      ]
    });
  }
};

async function checkLanguageTool(text, language) {

  const form = new URLSearchParams();

  form.set("text", text);

  if (language === "tr") {
    form.set("language", "tr");
  } else if (language === "en") {
    form.set("language", "en-US");
  } else {
    form.set("language", "auto");
  }

  const response = await fetch(
    "https://api.languagetool.org/v2/check",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body: form.toString()
    }
  );

  if (!response.ok) {
    throw new Error(
      `LanguageTool HTTP ${response.status}`
    );
  }

  return await response.json();
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods":
          "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type"
      }
    }
  );
}

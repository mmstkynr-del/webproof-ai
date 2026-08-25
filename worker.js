const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

const LANGUAGE_TOOL_URL =
  "https://api.languagetool.org/v2/check";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    // Sağlık kontrolü
    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "WebProof Engine",
        version: "2.1",
        status: "running",
        languages: ["tr", "en"],
        engine: "LanguageTool"
      });
    }

    // Yazım denetimi
    if (url.pathname === "/check") {

      if (request.method !== "POST") {
        return json({
          ok: false,
          error: "Bu endpoint yalnızca POST kabul eder."
        }, 405);
      }

      try {
        const body = await request.json();

        const text = String(body?.text || "").trim();
        const language = String(
          body?.language || "auto"
        ).toLowerCase();

        if (!text) {
          return json({
            ok: false,
            error: "Metin boş."
          }, 400);
        }

        if (text.length > 50000) {
          return json({
            ok: false,
            error: "Tek istekte en fazla 50.000 karakter."
          }, 413);
        }

        if (!["tr", "en", "auto"].includes(language)) {
          return json({
            ok: false,
            error: "Dil yalnızca tr, en veya auto olabilir."
          }, 400);
        }

        const result = await checkLanguageTool(
          text,
          language
        );

        const matches = Array.isArray(result?.matches)
          ? result.matches
          : [];

        return json({
          ok: true,
          language,
          total: matches.length,
          matches: matches.map(match => ({
            message: match?.message || "",
            shortMessage: match?.shortMessage || "",
            offset: Number(match?.offset || 0),
            length: Number(match?.length || 0),

            replacements:
              Array.isArray(match?.replacements)
                ? match.replacements
                    .slice(0, 8)
                    .map(item => item?.value)
                    .filter(Boolean)
                : [],

            rule: match?.rule?.id || "",

            category:
              match?.rule?.category?.id || ""
          }))
        });

      } catch (error) {

        return json({
          ok: false,
          error:
            error?.message ||
            "Yazım denetimi sırasında bilinmeyen hata."
        }, 500);
      }
    }

    // Bilinmeyen endpoint
    return json({
      ok: false,
      error: "Endpoint Bulunamadı",
      available: [
        "GET /health",
        "POST /check"
      ]
    }, 404);
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

  // LanguageTool'un aktif kurallarını kullan
  form.set("enabledOnly", "false");

  const response = await fetch(
    LANGUAGE_TOOL_URL,
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
        ...CORS_HEADERS,

        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "WebProof Engine",
        version: "2.0",
        languages: ["tr", "en"],
        engine: "LanguageTool"
      });
    }

    if (url.pathname === "/check" && request.method === "POST") {
      try {
        const body = await request.json();

        const text = String(body.text || "").trim();
        const language = String(body.language || "auto");

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

        const result = await checkLanguageTool(
          text,
          language
        );

        const matches = Array.isArray(result.matches)
          ? result.matches
          : [];

        return json({
          ok: true,
          language,
          total: matches.length,
          matches: matches.map(match => ({
            message: match.message || "",
            shortMessage: match.shortMessage || "",
            offset: match.offset || 0,
            length: match.length || 0,
            replacements: Array.isArray(match.replacements)
              ? match.replacements
                  .slice(0, 8)
                  .map(x => x.value)
              : [],
            rule: match.rule?.id || "",
            category: match.rule?.category?.id || ""
          }))
        });

      } catch (error) {
        return json({
          ok: false,
          error: error?.message || "Bilinmeyen hata."
        }, 500);
      }
    }

    return json({
      ok: true,
      service: "WebProof Engine",
      endpoints: ["/health", "/check"]
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

  form.set("enabledOnly", "false");

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
        ...CORS_HEADERS,
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

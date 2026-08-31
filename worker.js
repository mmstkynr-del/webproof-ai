export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    return new Response(
      JSON.stringify(
        {
          success: true,
          project: "WebProof AI",
          status: "online",
          message: "WebProof AI çalışıyor.",
          path: url.pathname,
          method: request.method,
          timestamp: new Date().toISOString()
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=UTF-8"
        }
      }
    );
  }
};

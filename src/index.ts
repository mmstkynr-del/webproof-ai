export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(
      "WebProof AI Agent sistemi çalışıyor.",
      {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=UTF-8"
        }
      }
    );
  }
};

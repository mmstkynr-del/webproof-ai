export default {
  async fetch(request) {
    return new Response(
      JSON.stringify({
        success: true,
        project: "WebProof AI",
        status: "online",
        message: "WebProof AI çalışıyor!"
      }, null, 2),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=UTF-8"
        }
      }
    );
  }
};

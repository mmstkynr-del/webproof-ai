if (url.pathname === "/api/status" && request.method === "GET") {
  const hasNvidiaKey = Boolean(env.NVIDIA_API_KEY);

  return json({
    ok: true,
    service: "WebProof AI",
    status: "online",

    crawler: "real-web-crawler",
    ruleEngine: "enabled",

    ai: hasNvidiaKey
      ? "connected"
      : "missing-api-key",

    model: "nvidia/nemotron-3.5-lightning-30b-a3b",

    taskEngine: "enabled",
    storage: "temporary-memory",

    // NVIDIA_API_KEY Cloudflare Worker tarafından gerçekten okunuyor mu?
    // API anahtarının kendisi kesinlikle gösterilmez.
    secretTest: {
      exists: hasNvidiaKey,
      type: typeof env.NVIDIA_API_KEY,
      length: hasNvidiaKey
        ? env.NVIDIA_API_KEY.length
        : 0
    }
  });
}

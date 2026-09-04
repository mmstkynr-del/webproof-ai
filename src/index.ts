import { routeAgentRequest } from "agents";
import { MainAgent } from "./agent";

export { MainAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routeAgentRequest(request, env);

    if (response) {
      return response;
    }

    return new Response("WebProof AI Agent hazır.", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=UTF-8"
      }
    });
  }
};

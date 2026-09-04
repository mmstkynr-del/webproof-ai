import { Agent } from "agents";

export class MainAgent extends Agent {
  initialState = {
    status: "ready"
  };

  async onChatMessage() {
    const response = await this.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          {
            role: "system",
            content:
              "Sen WebProof AI'nin ana yapay zeka ajanısın. Kullanıcıya Türkçe, açık ve doğru cevap ver."
          },
          ...this.messages.map((message: any) => ({
            role: message.role,
            content:
              typeof message.content === "string"
                ? message.content
                : JSON.stringify(message.content)
          }))
        ]
      }
    );

    return new Response(
      JSON.stringify(response),
      {
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }
}

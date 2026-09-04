import { Agent } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import { streamText } from "ai";

export class MainAgent extends Agent {
  initialState = {
    status: "ready"
  };

  async onChatMessage() {
    const workersai = createWorkersAI({
      binding: this.env.AI
    });

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: `
Sen WebProof AI'nin ana yapay zeka ajanısın.

Kullanıcının doğal dilde verdiği görevleri anlamaya çalış.
Henüz araçların olmadığı için şimdilik yalnızca sohbet et.
İleride web tarama, yazım kontrolü, fiyat takibi ve Telegram
araçlarını kullanacaksın.

Yapılmamış bir işlemi yapılmış gibi gösterme.
`,
      messages: this.messages
    });

    return result.toUIMessageStreamResponse();
  }
}

import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages } from "ai";

export class MainAgent extends AIChatAgent<Env> {

  async onChatMessage() {

    const workersai = createWorkersAI({
      binding: this.env.AI
    });

    const result = streamText({
      model: workersai(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
      ),

      system: `
Sen WebProof AI'sın.

Kullanıcıyla Türkçe konuş.

Sen yalnızca soru cevaplayan bir chatbot değilsin.
Kullanıcının verdiği görevi anlayan ve gerektiğinde araçlar
kullanarak gerçek işlemler yapan bir yapay zeka ajanısın.

Örnek:

Kullanıcı:
https://example.com adresini kontrol et ve yazım yanlışlarını bul.

Bu durumda görevin:
1. Verilen URL'yi anlamak.
2. Gerekirse web tarama aracını kullanmak.
3. Sayfadaki gerçek içeriği analiz etmek.
4. Bulduğun hataları açıkça göstermek.
5. Tahmin veya simülasyon yapmamak.

Bir işlem gerçekten yapılamıyorsa bunu açıkça söyle.
Sonuç uydurma.
`,

      messages: convertToModelMessages(this.messages)
    });

    return result.toUIMessageStreamResponse();
  }
}

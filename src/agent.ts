import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages } from "ai";
import { tool } from "ai";
import { z } from "zod";

export class MainAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    const workersai = createWorkersAI({
      binding: this.env.AI
    });

    const webScan = tool({
      description:
        "Verilen internet adresini gerçekten açar ve web sayfasının içeriğini getirir.",
      inputSchema: z.object({
        url: z.string().url().describe("Taranacak internet adresi")
      }),
      execute: async ({ url }) => {
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; WebProofAI/1.0)"
            }
          });

          if (!response.ok) {
            return {
              success: false,
              url,
              error: `HTTP ${response.status}`
            };
          }

          const contentType =
            response.headers.get("content-type") || "";

          if (!contentType.includes("text/html")) {
            return {
              success: false,
              url,
              error: "Bu adres HTML sayfası döndürmedi."
            };
          }

          const html = await response.text();

          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, " ")
            .trim();

          return {
            success: true,
            url,
            title:
              html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ||
              "",
            content: text.slice(0, 100000)
          };
        } catch (error) {
          return {
            success: false,
            url,
            error:
              error instanceof Error
                ? error.message
                : "Web sayfası okunamadı."
          };
        }
      }
    });

    const result = streamText({
      model: workersai(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
      ),

      system: `
Sen WebProof AI'sın.

Kullanıcıyla doğal şekilde sohbet et.

Kullanıcı normal bir soru sorarsa cevapla.

Kullanıcı bir URL verip o site üzerinde bir işlem
yapmanı isterse webScan aracını kullan.

Örneğin:
"https://example.com sitesindeki yazım hatalarını bul."

Bu durumda:
1. Önce webScan ile gerçek sayfayı aç.
2. Gelen gerçek içeriği incele.
3. Kullanıcının istediği işlemi gerçekleştir.
4. Bulduğun sonuçları açıkça göster.

Sonuç uydurma.
Bir sayfaya erişemediysen erişemediğini söyle.

Kullanıcı araç seçmek zorunda kalmasın.
Görevi kendin anlayıp uygun aracı kullan.

Türkçe konuş.
`,

      messages: await convertToModelMessages(this.messages),

      tools: {
        webScan
      },

      maxOutputTokens: 4096
    });

    return result.toUIMessageStreamResponse();
  }
}

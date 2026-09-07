import {
  Agent,
  type Connection,
  type ConnectionContext,
} from "agents";
interface Env {
  AI: Ai;
  MAIN_AGENT: DurableObjectNamespace;
  // Add these later when the corresponding
  // services are connected:
  //
  // GEMINI_API_KEY: string;
  // TELEGRAM_BOT_TOKEN: string;
}
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};
type AgentState = {
  messages: ChatMessage[];
};
export class MainAgent extends Agent<Env, AgentState> {
  initialState: AgentState = {
    messages: [],
  };
  /*
   * ============================================================
   * CONNECTION
   * ============================================================
   */
  async onConnect(
    connection: Connection,
    ctx: ConnectionContext
  ) {
    console.log(
      "WebProof AI connection established:",
      ctx.request.url
    );
  }
  /*
   * ============================================================
   * HTTP REQUEST
   * ============================================================
   *
   * This is intentionally simple and reliable.
   *
   * The Worker/UI sends:
   *
   * {
   *   "message": "Track the price of this book"
   * }
   *
   * The Agent processes the request and returns JSON.
   */
  async onRequest(
    request: Request
  ): Promise<Response> {
    if (request.method === "GET") {
      return Response.json({
        success: true,
        agent: "WebProof AI",
        status: "online",
      });
    }
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          error: "Method not allowed.",
        },
        {
          status: 405,
        }
      );
    }
    try {
      const body =
        await request.json() as {
          message?: unknown;
        };
      /*
       * Validate incoming message.
       */
      if (
        typeof body.message !== "string"
      ) {
        return Response.json(
          {
            success: false,
            error:
              "A message string is required.",
          },
          {
            status: 400,
          }
        );
      }
      const message =
        body.message.trim();
      if (!message) {
        return Response.json(
          {
            success: false,
            error:
              "Message cannot be empty.",
          },
          {
            status: 400,
          }
        );
      }
      if (message.length > 10000) {
        return Response.json(
          {
            success: false,
            error:
              "Message is too long.",
          },
          {
            status: 400,
          }
        );
      }
      /*
       * Process the request.
       */
      const answer =
        await this.processMessage(
          message
        );
      return Response.json({
        success: true,
        response: answer,
      });
    } catch (error) {
      console.error(
        "WebProof AI request error:",
        error
      );
      return Response.json(
        {
          success: false,
          error:
            "WebProof AI could not process the request.",
        },
        {
          status: 500,
        }
      );
    }
  }
  /*
   * ============================================================
   * MESSAGE PROCESSOR
   * ============================================================
   */
  private async processMessage(
    message: string
  ): Promise<string> {
    /*
     * Store the user message.
     */
    const history =
      this.state?.messages ?? [];
    const updatedHistory: ChatMessage[] = [
      ...history,
      {
        role: "user",
        content: message,
      },
    ];
    /*
     * Keep the conversation reasonably small.
     *
     * Later this can be replaced with a proper
     * database/vector-memory architecture.
     */
    const recentMessages =
      updatedHistory.slice(-20);
    /*
     * Save state before AI processing so that
     * the conversation isn't lost if processing
     * takes time.
     */
    this.setState({
      messages: recentMessages,
    });
    /*
     * ========================================================
     * AI SYSTEM INSTRUCTION
     * ========================================================
     */
    const systemPrompt = `
You are WebProof AI.
You are an intelligent web assistant designed to help
users track, monitor and analyze information on the internet.
Your long-term capabilities include:
1. PRICE TRACKING
   - Track products
   - Track books
   - Track prices
   - Detect price decreases
   - Detect percentage changes
   - Create monitoring tasks
2. WEBSITE MONITORING
   - Monitor websites
   - Detect content changes
   - Monitor specific pages
   - Monitor news websites
   - Compare previous and current versions
3. WRITING ANALYSIS
   - Detect Turkish spelling mistakes
   - Detect English spelling mistakes
   - Detect grammar problems
   - Detect punctuation problems
   - Suggest corrections
   - Explain why a correction is necessary
4. WEB RESEARCH
   - Understand what the user is asking for
   - Identify URLs, products and websites
   - Determine what information is required
   - Ask a concise clarification question when necessary
5. AUTOMATION
   - Create monitoring tasks
   - Remember the user's active tasks
   - Eventually send notifications
   - Eventually integrate with Telegram and other channels
IMPORTANT BEHAVIOR:
- Understand natural language.
- Do not force the user to use commands.
- Do not require special syntax.
- Be concise but useful.
- Never pretend that you performed an action when you did not.
- Never claim that a price was checked unless a price-checking tool actually returned a result.
- Never claim that a website was scanned unless a web-scanning tool actually ran.
- If a capability is not connected yet, clearly say so.
- When a task requires a URL, product or other information that the user has not supplied, ask for it.
- If the user's request is clear, do not ask unnecessary questions.
WebProof AI is intended to become a production-grade AI agent.
`;
    
    /*
     * ========================================================
     * PREPARE AI INPUT
     * ========================================================
     */
    const aiMessages = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...recentMessages.map(
        (item) => ({
          role: item.role,
          content: item.content,
        })
      ),
    ];
    /*
     * ========================================================
     * CLOUDFLARE AI
     * ========================================================
     */
    let answer: string;
    try {
      const result =
        await this.env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: aiMessages,
            max_tokens: 800,
            temperature: 0.2,
          }
        );
      /*
       * Cloudflare AI can return different structures
       * depending on the model.
       */
      if (
        result &&
        typeof result === "object"
      ) {
        const aiResult =
          result as {
            response?: unknown;
          };
        if (
          typeof aiResult.response === "string"
        ) {
          answer =
            aiResult.response.trim();
        } else {
          answer =
            "I received an unexpected response from the AI model.";
        }
      } else {
        answer =
          "I received an unexpected response from the AI model.";
      }
    } catch (error) {
      console.error(
        "Cloudflare AI error:",
        error
      );
      /*
       * Do NOT pretend the AI worked.
       */
      return (
        "I couldn't connect to my AI model right now. " +
        "Please try again in a moment."
      );
    }
    /*
     * ========================================================
     * SAVE ASSISTANT RESPONSE
     * ========================================================
     */
    this.setState({
      messages: [
        ...recentMessages,
        {
          role: "assistant",
          content: answer,
        },
      ].slice(-20),
    });
    return answer;
  }
  /*
   * ============================================================
   * FUTURE TOOL ARCHITECTURE
   * ============================================================
   *
   * These methods are deliberately separated from the main
   * conversation processor.
   *
   * We will implement them one by one instead of putting
   * scraping, price monitoring and proofreading into one huge
   * function.
   */
  private async priceCheck(
    url: string
  ): Promise<unknown> {
    /*
     * TODO:
     *
     * Connect to a real price extraction system.
     */
    return {
      success: false,
      message:
        "Price checking is not connected yet.",
      url,
    };
  }
  private async websiteScan(
    url: string
  ): Promise<unknown> {
    /*
     * TODO:
     *
     * Connect the existing WebProof crawler here.
     */
    return {
      success: false,
      message:
        "Website scanning is not connected yet.",
      url,
    };
  }
  private async proofread(
    text: string,
    language: "tr" | "en"
  ): Promise<unknown> {
    /*
     * TODO:
     *
     * Connect the proofreading engine here.
     */
    return {
      success: false,
      message:
        "Proofreading is not connected yet.",
      language,
      text,
    };
  }
}

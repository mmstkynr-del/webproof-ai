import {
  Agent,
  type Connection,
  type ConnectionContext,
} from "agents";

interface Env {
  AI: Ai;
  MAIN_AGENT: DurableObjectNamespace;
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
      "WebProof AI connected:",
      ctx.request.url
    );

    /*
     * Send the current conversation to the client
     * immediately after connection.
     */
    connection.send(
      JSON.stringify({
        type: "history",
        messages: this.state?.messages ?? [],
      })
    );
  }

  /*
   * ============================================================
   * WEBSOCKET MESSAGE HANDLER
   * ============================================================
   *
   * This is the important part that was missing.
   *
   * If the frontend uses the Agents/WebSocket connection,
   * incoming messages arrive here.
   */

  async onMessage(
    connection: Connection,
    message: unknown
  ) {
    try {
      console.log(
        "WebProof AI received message:",
        message
      );

      let userMessage = "";

      /*
       * The Agents SDK may provide a string,
       * Uint8Array, or another serializable value.
       */

      if (typeof message === "string") {
        userMessage = message;
      } else if (
        message instanceof Uint8Array
      ) {
        userMessage =
          new TextDecoder().decode(message);
      } else if (
        message &&
        typeof message === "object"
      ) {
        const data = message as {
          message?: unknown;
          content?: unknown;
          text?: unknown;
        };

        if (
          typeof data.message === "string"
        ) {
          userMessage = data.message;
        } else if (
          typeof data.content === "string"
        ) {
          userMessage = data.content;
        } else if (
          typeof data.text === "string"
        ) {
          userMessage = data.text;
        }
      }

      userMessage = userMessage.trim();

      /*
       * Empty message.
       */

      if (!userMessage) {
        connection.send(
          JSON.stringify({
            type: "error",
            error: "Message cannot be empty.",
          })
        );

        return;
      }

      /*
       * Process the message.
       */

      connection.send(
        JSON.stringify({
          type: "status",
          status: "thinking",
        })
      );

      const answer =
        await this.processMessage(
          userMessage
        );

      /*
       * Send the final answer back to frontend.
       */

      connection.send(
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: answer,
        })
      );

      connection.send(
        JSON.stringify({
          type: "status",
          status: "complete",
        })
      );
    } catch (error) {
      console.error(
        "WebProof AI WebSocket error:",
        error
      );

      connection.send(
        JSON.stringify({
          type: "error",
          error:
            "WebProof AI could not process your message.",
        })
      );
    }
  }

  /*
   * ============================================================
   * HTTP API
   * ============================================================
   *
   * This also allows the frontend to communicate using
   * normal POST requests.
   */

  async onRequest(
    request: Request
  ): Promise<Response> {
    /*
     * Health check.
     */

    if (request.method === "GET") {
      return Response.json({
        success: true,
        agent: "WebProof AI",
        status: "online",
        messages:
          this.state?.messages?.length ?? 0,
      });
    }

    /*
     * Only POST is supported for messages.
     */

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
       * Validate message.
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
       * Process message.
       */

      const answer =
        await this.processMessage(
          message
        );

      return Response.json({
        success: true,
        response: answer,
        messages:
          this.state?.messages ?? [],
      });
    } catch (error) {
      console.error(
        "WebProof AI HTTP error:",
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
   * MAIN MESSAGE PROCESSOR
   * ============================================================
   */

  private async processMessage(
    message: string
  ): Promise<string> {
    /*
     * Get existing conversation.
     */

    const history =
      this.state?.messages ?? [];

    /*
     * Add user's message.
     */

    const userHistory: ChatMessage[] = [
      ...history,
      {
        role: "user",
        content: message,
      },
    ];

    /*
     * Keep only recent messages.
     */

    const recentMessages =
      userHistory.slice(-20);

    /*
     * Save user message immediately.
     */

    this.setState({
      messages: recentMessages,
    });

    /*
     * ========================================================
     * WEBPROOF AI SYSTEM PROMPT
     * ========================================================
     */

    const systemPrompt = `
You are WebProof AI.

You are a general-purpose AI assistant and intelligent
web-monitoring agent.

Your job is to understand what the user wants using
normal natural language.

The user does NOT need to use commands.

The user may say things such as:

"Hello"

"Who are you?"

"Write me a news article."

"Check this website for spelling mistakes."

"Monitor this product price."

"Tell me what this website is about."

"Find mistakes in this text."

"Track this product and tell me when the price drops."

You should understand these requests naturally.

IMPORTANT:

At the moment, WebProof AI has basic conversational AI
connected.

The following real tools are NOT YET connected:

1. Website scanning
2. Price tracking
3. Product monitoring
4. Telegram notifications
5. Advanced web browsing
6. Automatic scheduled monitoring

Therefore:

NEVER claim that you scanned a website if you did not.

NEVER claim that you checked a live price if you did not.

NEVER claim that you created a monitoring task if you did not.

NEVER claim that you sent a Telegram notification if you did not.

NEVER invent live web information.

If the user asks for something that requires a tool which
is not currently connected, clearly explain that the capability
is not connected yet.

However, still be helpful.

You are allowed to answer normal knowledge, writing,
reasoning and conversational questions using your AI knowledge.

Be concise but useful.

Do not force command syntax.

Do not ask unnecessary questions.

If the user says "send this message", understand that they
are asking you to send a message only if an actual messaging
tool is connected.

Since no external messaging tool is currently connected,
explain that you cannot actually send it yet.

You are WebProof AI.
`;

    /*
     * ========================================================
     * BUILD AI MESSAGES
     * ========================================================
     */

    const aiMessages = [
      {
        role: "system" as const,
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
      console.log(
        "Sending message to Cloudflare AI..."
      );

      const result =
        await this.env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: aiMessages,
            max_tokens: 1000,
            temperature: 0.2,
          }
        );

      console.log(
        "Cloudflare AI response:",
        result
      );

      /*
       * Cloudflare's text-generation response.
       */

      if (
        result &&
        typeof result === "object" &&
        "response" in result &&
        typeof (
          result as {
            response?: unknown;
          }
        ).response === "string"
      ) {
        answer =
          (
            result as {
              response: string;
            }
          ).response.trim();
      } else {
        console.error(
          "Unexpected AI response:",
          result
        );

        answer =
          "I received an unexpected response from my AI model.";
      }
    } catch (error) {
      console.error(
        "Cloudflare AI execution failed:",
        error
      );

      answer =
        "I couldn't connect to my AI model right now. Please try again in a moment.";
    }

    /*
     * ========================================================
     * SAVE ASSISTANT MESSAGE
     * ========================================================
     */

    const finalHistory: ChatMessage[] = [
      ...recentMessages,
      {
        role: "assistant",
        content: answer,
      },
    ].slice(-20);

    this.setState({
      messages: finalHistory,
    });

    return answer;
  }
}

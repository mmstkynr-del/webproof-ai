interface Env {
  AI: Ai;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebProof AI</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:#fff;
  color:#111;
  height:100vh;
  display:flex;
  flex-direction:column
}
header{
  height:60px;
  border-bottom:1px solid #eee;
  display:flex;
  align-items:center;
  padding:0 20px;
  font-weight:600;
  font-size:18px
}
#chat{
  flex:1;
  overflow-y:auto;
  padding:25px max(20px,calc((100% - 850px)/2));
}
.message{
  display:flex;
  margin-bottom:25px;
  line-height:1.6;
  white-space:pre-wrap
}
.user{
  justify-content:flex-end
}
.user .bubble{
  background:#f1f1f1;
  padding:11px 16px;
  border-radius:18px;
  max-width:75%
}
.assistant .bubble{
  max-width:850px;
  width:100%
}
#bottom{
  border-top:1px solid #eee;
  padding:15px 20px 20px
}
#form{
  max-width:850px;
  margin:auto;
  display:flex;
  gap:10px;
  align-items:flex-end
}
textarea{
  flex:1;
  resize:none;
  min-height:48px;
  max-height:180px;
  border:1px solid #ccc;
  border-radius:16px;
  padding:13px 15px;
  font-size:16px;
  outline:none;
  font-family:inherit
}
textarea:focus{
  border-color:#888
}
button{
  width:48px;
  height:48px;
  border:0;
  border-radius:50%;
  background:#111;
  color:white;
  font-size:20px;
  cursor:pointer
}
button:disabled{
  opacity:.4;
  cursor:not-allowed
}
#status{
  max-width:850px;
  margin:7px auto 0;
  font-size:12px;
  color:#888
}
</style>
</head>

<body>

<header>WebProof AI</header>

<div id="chat"></div>

<div id="bottom">
  <form id="form">
    <textarea
      id="input"
      placeholder="Message WebProof AI..."
      rows="1"
    ></textarea>
    <button id="send" type="submit">↑</button>
  </form>
  <div id="status"></div>
</div>

<script>
const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const send = document.getElementById("send");
const status = document.getElementById("status");

let busy = false;

function addMessage(role, text) {
  const row = document.createElement("div");
  row.className = "message " + role;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  row.appendChild(bubble);
  chat.appendChild(row);

  chat.scrollTop = chat.scrollHeight;

  return bubble;
}

function setBusy(value) {
  busy = value;
  send.disabled = value;
  input.disabled = value;
  status.textContent = value ? "WebProof AI is thinking..." : "";
}

async function sendMessage(text) {
  if (busy) return;

  text = text.trim();

  if (!text) return;

  addMessage("user", text);

  input.value = "";
  input.style.height = "48px";

  setBusy(true);

  try {
    console.log("Sending:", text);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: text
      })
    });

    console.log("HTTP status:", response.status);

    const data = await response.json();

    console.log("Server response:", data);

    if (!response.ok || !data.success) {
      throw new Error(
        data.error || "The server could not process the message."
      );
    }

    addMessage(
      "assistant",
      data.response || "I received an empty response."
    );

  } catch (error) {

    console.error("Send error:", error);

    addMessage(
      "assistant",
      "Sorry, I could not send your message. " +
      (error.message || "")
    );

  } finally {
    setBusy(false);
    input.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", function(event) {
  event.preventDefault();

  console.log("SEND BUTTON PRESSED");

  sendMessage(input.value);
});

input.addEventListener("keydown", function(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", function() {
  this.style.height = "48px";
  this.style.height =
    Math.min(this.scrollHeight, 180) + "px";
});

addMessage(
  "assistant",
  "Hello! I'm WebProof AI. How can I help you?"
);
</script>

</body>
</html>`;

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const url = new URL(request.url);

    /*
     * ==========================================================
     * CHAT API
     * ==========================================================
     */

    if (
      url.pathname === "/api/chat" &&
      request.method === "POST"
    ) {
      try {

        const body = await request.json() as {
          message?: unknown;
        };

        if (typeof body.message !== "string") {
          return Response.json(
            {
              success: false,
              error: "Message must be a string."
            },
            { status: 400 }
          );
        }

        const message = body.message.trim();

        if (!message) {
          return Response.json(
            {
              success: false,
              error: "Message cannot be empty."
            },
            { status: 400 }
          );
        }

        if (message.length > 10000) {
          return Response.json(
            {
              success: false,
              error: "Message is too long."
            },
            { status: 400 }
          );
        }

        console.log(
          "WebProof AI received:",
          message
        );

        /*
         * ======================================================
         * AI
         * ======================================================
         */

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content: `
You are WebProof AI.

You are a helpful general-purpose AI assistant.

Understand normal natural language.

The user does not need to use commands.

You can answer questions, explain things,
write text, analyze information and have
normal conversations.

WebProof AI will eventually have tools for:

- website scanning
- spelling checking
- price tracking
- product monitoring
- web research
- website monitoring
- Telegram notifications
- scheduled automation

Those tools are NOT connected in this basic version.

Therefore never pretend that you performed
an action that you did not actually perform.

If the user asks you to send a message,
explain that external messaging is not connected yet.

Be helpful, natural and concise.
                `
              },
              {
                role: "user",
                content: message
              }
            ],
            max_tokens: 1000,
            temperature: 0.3
          }
        );

        console.log(
          "AI result:",
          result
        );

        let answer = "";

        if (
          result &&
          typeof result === "object" &&
          "response" in result &&
          typeof result.response === "string"
        ) {
          answer = result.response.trim();
        }

        if (!answer) {
          answer =
            "I received a response from the AI model, but it was empty.";
        }

        return Response.json({
          success: true,
          response: answer
        });

      } catch (error) {

        console.error(
          "CHAT ERROR:",
          error
        );

        return Response.json(
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Unknown server error."
          },
          { status: 500 }
        );
      }
    }

    /*
     * ==========================================================
     * HEALTH CHECK
     * ==========================================================
     */

    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        service: "WebProof AI",
        status: "online"
      });
    }

    /*
     * ==========================================================
     * FRONTEND
     * ==========================================================
     */

    if (request.method === "GET") {
      return new Response(HTML, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8"
        }
      });
    }

    return new Response("Not Found", {
      status: 404
    });
  }
};

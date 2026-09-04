import { routeAgentRequest } from "agents";
import { MainAgent } from "./agent";

export { MainAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const agentResponse = await routeAgentRequest(request, env);

    if (agentResponse) {
      return agentResponse;
    }

    return new Response(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebProof AI</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f5f5f5;
    }

    .app {
      max-width: 900px;
      margin: 0 auto;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: white;
    }

    header {
      padding: 20px;
      border-bottom: 1px solid #ddd;
      font-size: 22px;
      font-weight: bold;
    }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
    }

    .message {
      margin-bottom: 15px;
      padding: 12px 16px;
      border-radius: 12px;
      max-width: 80%;
      white-space: pre-wrap;
    }

    .user {
      margin-left: auto;
      background: #e8f0fe;
    }

    .assistant {
      background: #f1f1f1;
    }

    .input-area {
      display: flex;
      padding: 15px;
      border-top: 1px solid #ddd;
      gap: 10px;
    }

    input {
      flex: 1;
      padding: 14px;
      border: 1px solid #ccc;
      border-radius: 10px;
      font-size: 16px;
    }

    button {
      padding: 14px 20px;
      border: none;
      border-radius: 10px;
      background: #111;
      color: white;
      font-size: 16px;
      cursor: pointer;
    }
  </style>
</head>

<body>
  <div class="app">
    <header>WebProof AI</header>

    <div id="messages">
      <div class="message assistant">
        Merhaba! Ben WebProof AI. Bana bir görev verebilirsin.
      </div>
    </div>

    <div class="input-area">
      <input
        id="input"
        placeholder="Bana bir görev ver..."
        autocomplete="off"
      />
      <button onclick="sendMessage()">Gönder</button>
    </div>
  </div>

  <script>
    const input = document.getElementById("input");
    const messages = document.getElementById("messages");

    function addMessage(text, type) {
      const div = document.createElement("div");
      div.className = "message " + type;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    async function sendMessage() {
      const text = input.value.trim();

      if (!text) return;

      addMessage(text, "user");
      input.value = "";

      addMessage("Düşünüyorum...", "assistant");

      try {
        const response = await fetch("/agents/main-agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: text
          })
        });

        const result = await response.text();

        messages.lastElementChild.remove();

        addMessage(result, "assistant");

      } catch (error) {
        messages.lastElementChild.remove();
        addMessage("Bir hata oluştu: " + error.message, "assistant");
      }
    }

    input.addEventListener("keydown", function(event) {
      if (event.key === "Enter") {
        sendMessage();
      }
    });
  </script>
</body>
</html>
    `, {
      headers: {
        "content-type": "text/html; charset=UTF-8"
      }
    });
  }
};

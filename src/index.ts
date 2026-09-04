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
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: #f7f7f8;
}

.app {
  width: 100%;
  max-width: 900px;
  height: 100vh;
  margin: auto;
  display: flex;
  flex-direction: column;
  background: white;
}

.header {
  padding: 18px 20px;
  border-bottom: 1px solid #ddd;
  font-size: 21px;
  font-weight: 700;
}

#messages {
  flex: 1;
  overflow-y: auto;
  padding: 25px 20px;
}

.message {
  max-width: 85%;
  margin-bottom: 18px;
  padding: 13px 16px;
  border-radius: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.user {
  margin-left: auto;
  background: #e8eefc;
}

.assistant {
  margin-right: auto;
  background: #f0f0f0;
}

.input-area {
  display: flex;
  gap: 10px;
  padding: 15px;
  border-top: 1px solid #ddd;
}

#input {
  flex: 1;
  padding: 15px;
  border: 1px solid #ccc;
  border-radius: 12px;
  font-size: 16px;
  outline: none;
}

button {
  border: 0;
  border-radius: 12px;
  padding: 0 20px;
  background: #111;
  color: white;
  font-size: 16px;
  cursor: pointer;
}

button:disabled {
  opacity: .5;
}
</style>
</head>

<body>

<div class="app">

  <div class="header">
    WebProof AI
  </div>

  <div id="messages">

    <div class="message assistant">
      Merhaba! Ben WebProof AI.
      Bana istediğin görevi yazabilirsin.
    </div>

  </div>

  <div class="input-area">

    <input
      id="input"
      placeholder="Bana bir görev ver..."
      autocomplete="off"
    />

    <button id="send">
      Gönder
    </button>

  </div>

</div>

<script>

const input = document.getElementById("input");
const send = document.getElementById("send");
const messages = document.getElementById("messages");

function addMessage(text, type) {

  const element = document.createElement("div");

  element.className = "message " + type;

  element.textContent = text;

  messages.appendChild(element);

  messages.scrollTop = messages.scrollHeight;

  return element;
}

async function sendMessage() {

  const text = input.value.trim();

  if (!text) return;

  addMessage(text, "user");

  input.value = "";

  send.disabled = true;

  const thinking = addMessage(
    "Düşünüyorum...",
    "assistant"
  );

  try {

    const response = await fetch(
      "/agents/main-agent",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: text
            }
          ]
        })
      }
    );

    const result = await response.text();

    thinking.remove();

    if (!response.ok) {

      addMessage(
        "Hata: " + result,
        "assistant"
      );

    } else {

      addMessage(
        result,
        "assistant"
      );

    }

  } catch (error) {

    thinking.remove();

    addMessage(
      "Bağlantı hatası oluştu.",
      "assistant"
    );

  }

  send.disabled = false;

  input.focus();
}

send.addEventListener(
  "click",
  sendMessage
);

input.addEventListener(
  "keydown",
  function(event) {

    if (event.key === "Enter") {
      sendMessage();
    }

  }
);

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

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
    >

    <button id="send">
      Gönder
    </button>

  </div>

</div>

<script type="module">

import { createElement } from "https://esm.sh/react@19";
import { createRoot } from "https://esm.sh/react-dom@19/client";
import { useEffect, useRef, useState } from "https://esm.sh/react@19";
import { useAgent } from "https://esm.sh/agents@0.22.0/react";
import { useAgentChat } from "https://esm.sh/@cloudflare/ai-chat@0.11.0/react";

function Chat() {

  const agent = useAgent({
    agent: "MainAgent",
    name: "webproof-main"
  });

  const {
    messages,
    sendMessage,
    status
  } = useAgentChat({
    agent
  });

  const inputRef = useRef(null);
  const messagesRef = useRef(null);

  useEffect(() => {

    if (!messagesRef.current) return;

    messagesRef.current.scrollTop =
      messagesRef.current.scrollHeight;

  }, [messages]);

  function send() {

    const input = inputRef.current;

    if (!input) return;

    const text = input.value.trim();

    if (!text) return;

    sendMessage({
      text
    });

    input.value = "";

  }

  function keyDown(event) {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      send();

    }

  }

  return createElement(
    "div",
    {
      style: {
        display: "contents"
      }
    },

    createElement(
      "div",
      {
        ref: messagesRef,
        id: "messages"
      },

      createElement(
        "div",
        {
          className: "message assistant"
        },
        "Merhaba! Ben WebProof AI.\nBana istediğin görevi yazabilirsin."
      ),

      messages.map(function(message) {

        const text = message.parts
          ?.filter(function(part) {
            return part.type === "text";
          })
          .map(function(part) {
            return part.text;
          })
          .join("") || "";

        if (!text) return null;

        return createElement(
          "div",
          {
            key: message.id,
            className:
              "message " +
              (message.role === "user"
                ? "user"
                : "assistant")
          },
          text
        );

      })

    ),

    createElement(
      "div",
      {
        className: "input-area"
      },

      createElement(
        "input",
        {
          ref: inputRef,
          id: "input",
          placeholder: "Bana bir görev ver...",
          autoComplete: "off",
          onKeyDown: keyDown
        }
      ),

      createElement(
        "button",
        {
          id: "send",
          disabled:
            status === "streaming" ||
            status === "submitted",
          onClick: send
        },
        status === "streaming"
          ? "Düşünüyor..."
          : "Gönder"
      )

    )

  );

}

createRoot(
  document.querySelector(".app")
).render(
  createElement(Chat)
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

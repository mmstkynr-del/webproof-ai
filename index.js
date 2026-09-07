import { routeAgentRequest } from "agents";
import { MainAgent } from "./agent";
export { MainAgent };
export interface Env {
  // Add your bindings here if you have them.
  // Example:
  // AI: Ai;
  // DB: D1Database;
  // GEMINI_API_KEY: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    /*
     * ------------------------------------------------------------
     * 1. CLOUDflare AGENT ROUTING
     * ------------------------------------------------------------
     *
     * Agent requests are handled by routeAgentRequest().
     * We deliberately keep this before the normal website response.
     */
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }
    /*
     * ------------------------------------------------------------
     * 2. WEBPROOF AI APPLICATION
     * ------------------------------------------------------------
     */
    return new Response(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <meta
    name="description"
    content="WebProof AI — Track prices, monitor websites and analyze writing."
  >
  <title>WebProof AI</title>
  <style>
    * {
      box-sizing: border-box;
    }
    html,
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      background: #f7f7f8;
      color: #171717;
    }
    body {
      display: flex;
      justify-content: center;
    }
    button,
    input,
    textarea {
      font: inherit;
    }
    button {
      cursor: pointer;
    }
    .app {
      width: 100%;
      max-width: 1100px;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-left: 1px solid #e5e5e5;
      border-right: 1px solid #e5e5e5;
    }
    /* ----------------------------------------------------------
       HEADER
       ---------------------------------------------------------- */
    .header {
      height: 64px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      border-bottom: 1px solid #e5e5e5;
      background: rgba(255, 255, 255, 0.96);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 18px;
      letter-spacing: -0.02em;
    }
    .brand-icon {
      width: 32px;
      height: 32px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111111;
      color: #ffffff;
      font-size: 16px;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      color: #737373;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
    }
    /* ----------------------------------------------------------
       CHAT
       ---------------------------------------------------------- */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 32px 20px 24px;
      scroll-behavior: smooth;
    }
    .conversation {
      width: 100%;
      max-width: 820px;
      margin: 0 auto;
    }
    .welcome {
      padding: 45px 10px 30px;
      text-align: center;
    }
    .welcome h1 {
      margin: 0 0 12px;
      font-size: clamp(28px, 5vw, 42px);
      letter-spacing: -0.04em;
    }
    .welcome p {
      margin: 0 auto;
      max-width: 650px;
      color: #737373;
      line-height: 1.6;
      font-size: 15px;
    }
    .examples {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin: 28px auto 0;
      max-width: 700px;
    }
    .example {
      border: 1px solid #e5e5e5;
      background: #ffffff;
      border-radius: 12px;
      padding: 14px;
      text-align: left;
      color: #404040;
      transition:
        border-color 0.15s ease,
        background 0.15s ease;
    }
    .example:hover {
      border-color: #bdbdbd;
      background: #fafafa;
    }
    .message-row {
      display: flex;
      margin: 18px 0;
    }
    .message-row.user {
      justify-content: flex-end;
    }
    .message-row.assistant {
      justify-content: flex-start;
    }
    .message {
      max-width: min(78%, 700px);
      padding: 13px 16px;
      border-radius: 16px;
      line-height: 1.55;
      font-size: 15px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .message-row.user .message {
      background: #111111;
      color: #ffffff;
      border-bottom-right-radius: 5px;
    }
    .message-row.assistant .message {
      background: #f1f1f1;
      color: #171717;
      border-bottom-left-radius: 5px;
    }
    .message.error {
      background: #fff1f2;
      color: #be123c;
    }
    /* ----------------------------------------------------------
       TYPING INDICATOR
       ---------------------------------------------------------- */
    .typing {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 54px;
    }
    .typing span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #737373;
      animation: typing 1.2s infinite ease-in-out;
    }
    .typing span:nth-child(2) {
      animation-delay: 0.15s;
    }
    .typing span:nth-child(3) {
      animation-delay: 0.30s;
    }
    @keyframes typing {
      0%,
      60%,
      100% {
        transform: translateY(0);
        opacity: 0.4;
      }
      30% {
        transform: translateY(-3px);
        opacity: 1;
      }
    }
    /* ----------------------------------------------------------
       INPUT
       ---------------------------------------------------------- */
    .composer {
      flex-shrink: 0;
      padding: 12px 16px 16px;
      border-top: 1px solid #e5e5e5;
      background: #ffffff;
    }
    .composer-inner {
      max-width: 820px;
      margin: 0 auto;
    }
    .input-box {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 8px;
      border: 1px solid #d4d4d4;
      border-radius: 16px;
      background: #ffffff;
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.04);
    }
    .input-box:focus-within {
      border-color: #999999;
      box-shadow:
        0 0 0 3px rgba(0, 0, 0, 0.05);
    }
    #input {
      flex: 1;
      min-width: 0;
      min-height: 42px;
      max-height: 180px;
      resize: none;
      border: 0;
      outline: 0;
      padding: 10px 12px;
      background: transparent;
      color: #171717;
      line-height: 1.45;
    }
    #input::placeholder {
      color: #a3a3a3;
    }
    #send {
      width: 42px;
      height: 42px;
      flex-shrink: 0;
      border: 0;
      border-radius: 11px;
      background: #111111;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      transition:
        opacity 0.15s ease,
        transform 0.1s ease;
    }
    #send:hover {
      opacity: 0.86;
    }
    #send:active {
      transform: scale(0.96);
    }
    #send:disabled {
      cursor: not-allowed;
      opacity: 0.35;
    }
    .composer-note {
      padding-top: 8px;
      text-align: center;
      color: #a3a3a3;
      font-size: 11px;
    }
    /* ----------------------------------------------------------
       MOBILE
       ---------------------------------------------------------- */
    @media (max-width: 650px) {
      .header {
        height: 58px;
        padding: 0 14px;
      }
      #messages {
        padding: 20px 12px 18px;
      }
      .welcome {
        padding: 35px 8px 22px;
      }
      .welcome h1 {
        font-size: 30px;
      }
      .examples {
        grid-template-columns: 1fr;
      }
      .message {
        max-width: 88%;
      }
      .composer {
        padding: 9px 10px 12px;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="brand">
        <div class="brand-icon">W</div>
        <span>WebProof AI</span>
      </div>
      <div class="status">
        <span class="status-dot"></span>
        <span id="statusText">Ready</span>
      </div>
    </header>
    <main id="messages">
      <div class="conversation" id="conversation">
        <section class="welcome" id="welcome">
          <h1>What can I help you track?</h1>
          <p>
            Track prices, monitor websites, check writing,
            find changes and give WebProof AI a task in natural language.
          </p>
          <div class="examples">
            <button
              class="example"
              data-prompt="Track the price of this book and notify me when the price drops."
            >
              📚 Track a book price
            </button>
            <button
              class="example"
              data-prompt="Monitor this website and tell me when its content changes."
            >
              🌐 Monitor a website
            </button>
            <button
              class="example"
              data-prompt="Check this website for Turkish spelling and grammar mistakes."
            >
              ✍️ Check writing
            </button>
            <button
              class="example"
              data-prompt="I want to track a product and receive an alert when its price decreases by 10 percent."
            >
              🔔 Create a price alert
            </button>
          </div>
        </section>
      </div>
    </main>
    <div class="composer">
      <div class="composer-inner">
        <div class="input-box">
          <textarea
            id="input"
            rows="1"
            maxlength="10000"
            placeholder="Tell WebProof AI what you want to do..."
            autocomplete="off"
          ></textarea>
          <button
            id="send"
            type="button"
            aria-label="Send message"
          >
            ↑
          </button>
        </div>
        <div class="composer-note">
          WebProof AI can track, monitor and analyze web content.
        </div>
      </div>
    </div>
  </div>
  <script>
    /*
     * ============================================================
     * WEBPROOF AI CLIENT
     * ============================================================
     *
     * IMPORTANT:
     *
     * This client does NOT manually POST:
     *
     *     { message: "..." }
     *
     * to /agents/main-agent anymore.
     *
     * Instead it establishes a WebSocket connection with an
     * individual MainAgent instance.
     *
     * The browser then communicates with the Agent over that
     * persistent connection.
     */
    const input = document.getElementById("input");
    const sendButton = document.getElementById("send");
    const conversation = document.getElementById("conversation");
    const messagesContainer = document.getElementById("messages");
    const welcome = document.getElementById("welcome");
    const statusText = document.getElementById("statusText");
    /*
     * Give every browser session its own Agent instance.
     *
     * We intentionally keep this identifier in sessionStorage so
     * reloading the page during the same browser session does not
     * unnecessarily create another conversation.
     */
    let agentInstance = sessionStorage.getItem(
      "webproof-agent-instance"
    );
    if (!agentInstance) {
      agentInstance =
        "user-" +
        crypto.randomUUID().replace(/-/g, "");
      sessionStorage.setItem(
        "webproof-agent-instance",
        agentInstance
      );
    }
    /*
     * Cloudflare Agent route:
     *
     * /agents/main-agent/<instance-name>
     */
    const agentPath =
      "/agents/main-agent/" +
      encodeURIComponent(agentInstance);
    let socket = null;
    let connected = false;
    let sending = false;
    let currentAssistantMessage = null;
    /*
     * ------------------------------------------------------------
     * STATUS
     * ------------------------------------------------------------
     */
    function setStatus(text) {
      statusText.textContent = text;
    }
    /*
     * ------------------------------------------------------------
     * SCROLL
     * ------------------------------------------------------------
     */
    function scrollToBottom() {
      requestAnimationFrame(() => {
        messagesContainer.scrollTop =
          messagesContainer.scrollHeight;
      });
    }
    /*
     * ------------------------------------------------------------
     * MESSAGE UI
     * ------------------------------------------------------------
     */
    function addUserMessage(text) {
      hideWelcome();
      const row = document.createElement("div");
      row.className = "message-row user";
      const message = document.createElement("div");
      message.className = "message";
      message.textContent = text;
      row.appendChild(message);
      conversation.appendChild(row);
      scrollToBottom();
    }
    function addAssistantMessage(text) {
      hideWelcome();
      const row = document.createElement("div");
      row.className = "message-row assistant";
      const message = document.createElement("div");
      message.className = "message";
      message.textContent = text;
      row.appendChild(message);
      conversation.appendChild(row);
      scrollToBottom();
      return message;
    }
    function addErrorMessage(text) {
      const row = document.createElement("div");
      row.className = "message-row assistant";
      const message = document.createElement("div");
      message.className = "message error";
      message.textContent = text;
      row.appendChild(message);
      conversation.appendChild(row);
      scrollToBottom();
    }
    function hideWelcome() {
      if (welcome) {
        welcome.style.display = "none";
      }
    }
    /*
     * ------------------------------------------------------------
     * TYPING INDICATOR
     * ------------------------------------------------------------
     */
    function addTypingMessage() {
      hideWelcome();
      const row = document.createElement("div");
      row.className = "message-row assistant";
      row.id = "typing-message";
      const message = document.createElement("div");
      message.className = "message";
      const typing = document.createElement("div");
      typing.className = "typing";
      typing.innerHTML =
        "<span></span><span></span><span></span>";
      message.appendChild(typing);
      row.appendChild(message);
      conversation.appendChild(row);
      scrollToBottom();
    }
    function removeTypingMessage() {
      const typing =
        document.getElementById("typing-message");
      if (typing) {
        typing.remove();
      }
    }
    /*
     * ------------------------------------------------------------
     * WEBSOCKET
     * ------------------------------------------------------------
     */
    function connect() {
      if (socket) {
        try {
          socket.close();
        } catch (_) {}
      }
      const protocol =
        window.location.protocol === "https:"
          ? "wss:"
          : "ws:";
      const wsUrl =
        protocol +
        "//" +
        window.location.host +
        agentPath;
      setStatus("Connecting...");
      socket = new WebSocket(wsUrl);
      socket.addEventListener("open", () => {
        connected = true;
        setStatus("Online");
        updateSendButton();
      });
      socket.addEventListener("message", (event) => {
        handleAgentMessage(event.data);
      });
      socket.addEventListener("close", () => {
        connected = false;
        setStatus("Reconnecting...");
        updateSendButton();
        /*
         * Small reconnect delay.
         *
         * We do not reconnect immediately in a tight loop.
         */
        setTimeout(() => {
          if (!connected) {
            connect();
          }
        }, 1500);
      });
      socket.addEventListener("error", () => {
        connected = false;
        setStatus("Connection error");
        updateSendButton();
      });
    }
    /*
     * ------------------------------------------------------------
     * AGENT MESSAGE HANDLER
     * ------------------------------------------------------------
     *
     * Cloudflare Agents can send different message types.
     *
     * We therefore do not assume every incoming WebSocket message
     * is a simple string.
     */
    function handleAgentMessage(rawData) {
      let data;
      try {
        data = JSON.parse(rawData);
      } catch (_) {
        /*
         * Fallback for a plain-text response.
         */
        removeTypingMessage();
        addAssistantMessage(String(rawData));
        sending = false;
        currentAssistantMessage = null;
        updateSendButton();
        return;
      }
      /*
       * Debugging is deliberately limited to the browser console.
       * This helps us diagnose protocol problems without exposing
       * internal data in the visible interface.
       */
      console.debug(
        "WebProof AI Agent message:",
        data
      );
      /*
       * Handle common text/content fields.
       *
       * Different Agent SDK versions may represent messages
       * slightly differently, so we support several safe shapes.
       */
      const text =
        extractText(data);
      if (text) {
        removeTypingMessage();
        if (!currentAssistantMessage) {
          currentAssistantMessage =
            addAssistantMessage(text);
        } else {
          currentAssistantMessage.textContent += text;
          scrollToBottom();
        }
      }
      /*
       * Detect completed assistant messages.
       */
      if (
        data.type === "done" ||
        data.type === "complete" ||
        data.type === "message_complete" ||
        data.done === true
      ) {
        removeTypingMessage();
        sending = false;
        currentAssistantMessage = null;
        updateSendButton();
      }
      /*
       * Explicit error from the Agent.
       */
      if (
        data.type === "error" ||
        data.error
      ) {
        removeTypingMessage();
        const errorText =
          typeof data.error === "string"
            ? data.error
            : "WebProof AI could not complete the request.";
        addErrorMessage(errorText);
        sending = false;
        currentAssistantMessage = null;
        updateSendButton();
      }
    }
    function extractText(data) {
      if (!data) {
        return "";
      }
      if (typeof data === "string") {
        return data;
      }
      if (typeof data.text === "string") {
        return data.text;
      }
      if (typeof data.content === "string") {
        return data.content;
      }
      if (
        data.message &&
        typeof data.message === "string"
      ) {
        return data.message;
      }
      if (
        data.message &&
        typeof data.message.content === "string"
      ) {
        return data.message.content;
      }
      if (
        data.delta &&
        typeof data.delta === "string"
      ) {
        return data.delta;
      }
      if (
        data.content &&
        Array.isArray(data.content)
      ) {
        return data.content
          .map(item => {
            if (typeof item === "string") {
              return item;
            }
            if (
              item &&
              typeof item.text === "string"
            ) {
              return item.text;
            }
            return "";
          })
          .join("");
      }
      return "";
    }
    /*
     * ------------------------------------------------------------
     * SEND MESSAGE
     * ------------------------------------------------------------
     */
    function sendMessage() {
      const text = input.value.trim();
      if (!text) {
        return;
      }
      if (!connected || !socket) {
        addErrorMessage(
          "WebProof AI is still connecting. Please try again in a moment."
        );
        return;
      }
      if (sending) {
        return;
      }
      /*
       * Prevent oversized accidental requests.
       */
      if (text.length > 10000) {
        addErrorMessage(
          "Your message is too long. Please shorten it."
        );
        return;
      }
      sending = true;
      updateSendButton();
      addUserMessage(text);
      input.value = "";
      autoResize();
      addTypingMessage();
      /*
       * Send the user message through the Agent connection.
       *
       * The exact Agent protocol is handled by the Agent runtime.
       */
      try {
        socket.send(
          JSON.stringify({
            type: "message",
            message: text
          })
        );
      } catch (error) {
        removeTypingMessage();
        addErrorMessage(
          "The message could not be sent. Please try again."
        );
        sending = false;
        updateSendButton();
      }
    }
    /*
     * ------------------------------------------------------------
     * INPUT
     * ------------------------------------------------------------
     */
    function autoResize() {
      input.style.height = "auto";
      input.style.height =
        Math.min(input.scrollHeight, 180) +
        "px";
    }
    input.addEventListener(
      "input",
      autoResize
    );
    input.addEventListener(
      "keydown",
      event => {
        /*
         * Enter sends.
         *
         * Shift + Enter creates a new line.
         */
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();
          sendMessage();
        }
      }
    );
    sendButton.addEventListener(
      "click",
      sendMessage
    );
    /*
     * ------------------------------------------------------------
     * EXAMPLE PROMPTS
     * ------------------------------------------------------------
     */
    document
      .querySelectorAll(".example")
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const prompt =
              button.dataset.prompt || "";
            input.value = prompt;
            autoResize();
            input.focus();
          }
        );
      });
    /*
     * ------------------------------------------------------------
     * BUTTON STATE
     * ------------------------------------------------------------
     */
    function updateSendButton() {
      sendButton.disabled =
        !connected || sending;
    }
    /*
     * ------------------------------------------------------------
     * START
     * ------------------------------------------------------------
     */
    connect();
    updateSendButton();
  </script>
</body>
</html>`,
      {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "no-store"
        }
      }
    );
  }
};

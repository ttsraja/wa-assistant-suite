# 🤖 WhatsApp AI Assistant Suite Overview

This suite provides a comprehensive, autonomous AI assistant for WhatsApp, enabling real-time message handling, intelligent response generation, and deep integration with external services.

## 🚀 Core Architecture & Components

The system is built around five interconnected components, managing the entire lifecycle from message reception to final action.

### 🌐 1. Web Control Center (`apps/web-control-center`)
*   **Purpose:** The primary User Interface (UI) for monitoring, debugging, and controlling the agent's operations.
*   **Functionality:** Provides a centralized dashboard for viewing connection status, agent logs, and manual intervention points.
*   **Key Feature:** Offers real-time visibility into the agent's decision-making process.

### 💬 2. Live Messaging Module
*   **Technology:** Utilizes `socket.io-client` for robust, real-time communication.
*   **Functionality:** Establishes a persistent connection to stream incoming WhatsApp messages instantly.
*   **Process:** Acts as the primary input stream, triggering the agent logic upon message receipt.

### 🧠 3. Agent Logic (The Brain)
*   **Engine:** Powered by a Large Language Model (LLM), specifically configured for **Ollama/Gemma4**.
*   **Functionality:** Autonomous decision-making. It processes incoming messages, determines the user's intent, and generates contextually appropriate, natural language replies.
*   **Trigger:** Activated by the Live Messaging Module upon receiving a new message.

## 🔗 Integrations & Data Persistence

The suite extends its capabilities by connecting to external services and maintaining local data records.

*   **📅 Google Calendar:** Allows the assistant to read, create, and manage calendar events, enabling time-sensitive actions.
*   **✅ Google Tasks:** Provides task management capabilities, allowing the agent to create, list, and update to-do items.
*   **<0xF0><0x9F><0x97><0x84>️ Local SQLite Database:** Used for persistent logging, auditing, and storing custom, non-critical context data. This ensures a reliable record of all agent actions and system events.

## 🔄 Operational Flow Summary

1.  **Receive:** `Live Messaging` streams a message into the system.
2.  **Contextualize:** `State Management` updates the current context.
3.  **Decide:** `Agent Logic` (LLM) analyzes the message against the current context and available integrations.
4.  **Act:** The agent executes necessary actions (e.g., calling the Google Calendar API, writing to SQLite) and generates a reply.
5.  **Respond:** The reply is streamed back via the `Live Messaging` module to the user.
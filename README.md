# 🤖 WhatsApp AI Assistant Suite

This repository contains the full source code for an autonomous AI assistant designed to manage and respond to WhatsApp messages in real-time. The system integrates advanced LLM capabilities with external services to provide a comprehensive, automated communication layer.

## 🚀 Features

*   **Live Messaging:** Real-time streaming of incoming WhatsApp messages via Socket.IO.
*   **Autonomous Reply:** AI-driven response generation using an LLM (Ollama/Gemma4).
*   **Context Injection:** Ability to inject dynamic, custom context (e.g., "I'm in a meeting until 5 PM") into the LLM prompt to guide responses.
*   **Multi-Service Integration:** Connects to Google Calendar and Google Tasks for scheduling and to-do list management.
*   **Auditing & Logging:** Persistent logging of all agent actions and system events using a local SQLite database.

## 🏗️ Architecture & Structure

The project is modular, with the primary user interface and control logic residing in the `apps/web-control-center` directory.

*   **`apps/web-control-center`:** The main Next.js frontend application. This is the dashboard where the user monitors the agent's status, views the live feed, and manages settings.
*   **`apps/core-engine`:** Contains the backend logic responsible for handling the WhatsApp API connection, state management, and orchestrating the LLM calls. This is the core operational engine.
*   **`packages/cli`:** A dedicated package for command-line utilities, allowing users to interact with the assistant suite from the terminal (e.g., running scheduled tasks or initial setup).
*   **`packages/`:** (General) Holds shared utility libraries, models, or common components used across the suite.

## 🛠️ Setup and Installation Guide

Follow these steps to get the entire suite running locally.

### Prerequisites
*   Node.js (LTS recommended)
*   npm or yarn
*   Ollama installed and running (for local LLM access)
*   WhatsApp Web access for linking the device.

### 1. Install Dependencies
Navigate to the root directory and install all required packages:
```bash
npm install
# or
yarn install
```

### 2. Start the Backend Core Engine
The core engine must be running first to handle the WhatsApp connection and API calls.
```bash
# Assuming the core engine is in a dedicated directory
npm run dev --prefix apps/core-engine
```

### 3. Start the Web Control Center (Frontend)
In a separate terminal, start the frontend dashboard:
```bash
npm run dev --prefix apps/web-control-center
```
The dashboard will typically be accessible at `http://localhost:3000`.

### 4. Configure Services
*   **API Keys:** Update environment variables (`.env`) in the root directory with necessary credentials (Google API keys, etc.).
*   **LLM Model:** Ensure the required model (e.g., `gemma4`) is pulled and running via Ollama: `ollama pull gemma4`.

#### Google Calendar and Tasks OAuth

To connect Google Calendar and Google Tasks from **Settings → Calendar & Tasks**, create a Google OAuth **Web application** client and add this authorized redirect URI in Google Cloud Console:

```
http://localhost:3001/api/calendar/google-auth/callback
```

Then either place the downloaded OAuth client JSON at `apps/core-engine/credentials.json`, or set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the environment that starts the core engine. Restart the engine and choose **Re-authenticate Google** in Settings. The generated `token.json` stays local and is ignored by Git.

## 📚 Project Documentation

For a detailed, technical breakdown of the system's components, please refer to the [Project Summary](/Users/ttthangasenthilraja/Documents/wa-assistant-suite/project summary.md).

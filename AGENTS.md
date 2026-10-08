# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

***

## 🏗️ Architectural Overview

The WhatsApp AI Assistant Suite employs a layered, decoupled architecture designed for real-time, autonomous communication handling. The core loop involves receiving a message, evaluating its context against defined policies, generating a suggested response, and presenting it for optional human approval before transmission.

**Primary Architectural Modules:**

1.  **`apps/core-engine` (Backend/Orchestration Layer):**
    *   **Responsibility:** The operational brain. It manages the WhatsApp API connection, streams incoming messages, performs state management, and orchestrates all external service calls (LLM, Calendar).
    *   **Flow:** Acts as the central message router. It processes incoming messages and determines if a response should be generated or if the interaction should be logged for human review.
2.  **`apps/web-control-center` (Client/Presentation Layer):**
    *   **Responsibility:** The user dashboard (Next.js frontend). It provides a single pane of glass for monitoring the agent's activity, viewing message logs, and managing configuration parameters.
    *   **Interaction:** Communicates with the `core-engine` API via defined endpoints to fetch status, save settings, and view the approval queue.
3.  **`packages/` (Shared Utilities/Business Logic):**
    *   **Responsibility:** Houses non-UI/non-API specific logic, such as common data models, validation functions, and service adapters.

**System Domains and Interactions:**

The system's intelligence is built around four core service domains, each managed by a specific configuration within the `web-control-center` and consumed by the `core-engine`:

*   **🧠 LLM Integration (Primary Intelligence):**
    *   **Function:** Generates response drafts. Supports a multi-provider strategy (Ollama, Gemini, Codex, OpenAI, Grok).
    *   **Configuration Focus:** Needs the correct provider selected, model name, and necessary API key/base URL. The `core-engine` logic must prioritize the configured provider and gracefully handle API failures.
*   **📅 Calendar &amp; Task Management:**
    *   **Function:** Reads scheduling data and writes tasks. The system supports pluggable backends (Google Calendar, macOS Calendar, Outlook) to handle diverse operating system/cloud environments.
    *   **Interaction:** The LLM prompt can be dynamically enriched with upcoming appointments or reminders to ensure contextually relevant responses.
*   **👥 Contact Policies (The Governance Layer):**
    *   **Function:** Enforces custom business logic per contact. This is a critical pre-processing step before response generation.
    *   **Key Rules:**
        *   **Tone Enforcement:** Overrides default LLM tone to *Formal*, *Casual*, or *Auto*.
        *   **Information Restriction:** Defines the `Information Level` (`Full`, `Limited`, `Minimal`) for sensitive topics.
        *   **Topic Guardrails:** Maintains a list of `Restricted Topics` that trigger a refusal response.
        *   **Approval Workflow:** Determines if a message *must* be flagged in the Approval Queue, regardless of policy, for manual review.
*   **✅ Approval Queue (Human-in-the-Loop):**
    *   **Function:** Acts as a mandatory choke point for message sending. If a policy requires approval, the message and the AI draft must wait here for explicit `Approve` or `Reject` actions from the user.

***

## 🛠️ Core Development Commands

These commands are necessary for setting up, running, and maintaining the system. All commands should generally be run from the repository root, unless otherwise specified.

| Task | Command | Description |
| :--- | :--- | :--- |
| **Setup** | `npm install` | Installs all front-end and back-end dependencies defined in `package.json`. |
| **Backend Run** | `npm run dev --prefix apps/core-engine` | Starts the main API and WhatsApp connection logic. This process must remain running. |
| **Frontend Run** | `npm run dev --prefix apps/web-control-center` | Starts the monitoring dashboard and UI client. |
| **LLM Model Prep** | `ollama pull <model_name>` | Pulls and downloads the required local model (e.g., `ollama pull gemma4:latest`). |
| **Debugging/Linting** | `npm run lint` | Runs linting checks across the codebase. |
| **Testing** | `npm run test` | Executes the full suite of unit and integration tests. |
| **Targeted Test** | `npm run test:path apps/module-name` | (If available) Runs tests for a specific module or path. |

***

## 💡 System Context Notes

*   **State Management:** Sensitive credentials (API Keys) and persistent rules (Contact Policies) are stored in a local SQLite database managed by the `core-engine`.
*   **Error Handling:** The system must be designed to manage provider failures gracefully. If the primary LLM provider fails, the fallback mechanism should use the secondary provider if one is configured, or log a detailed failure state to the dashboard.
*   **Communication Flow:** All interactions between the client and the core engine should be managed through the established REST/WebSocket API endpoints to ensure state consistency and prevent race conditions, especially in the Approval Queue.

***

### Critical Files for Implementation
- apps/web-control-center/app/settings/page.js
- README.md
- apps/core-engine/
- package.json
- project summary.md
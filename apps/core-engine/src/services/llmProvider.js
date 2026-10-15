/**
 * llmProvider.js
 * Abstraction layer for all supported LLM providers.
 * Providers: ollama | gemini | claude | openai | grok
 *
 * Returns a unified interface:
 *   chat({ model, messages, tools }) → { message: { content, tool_calls } }
 */

import { Ollama } from 'ollama';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Cached config ──────────────────────────────────────────────────────────────
let _cachedConfig = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 10_000; // re-read DB every 10 seconds

export async function getLLMConfig() {
    if (!_cachedConfig || Date.now() - _cacheTime > CACHE_TTL_MS) {
        let conf = await prisma.lLMConfig.findUnique({ where: { id: 1 } });
        if (!conf) {
            conf = await prisma.lLMConfig.create({
                data: { id: 1, provider: 'ollama', modelName: 'gemma4:latest' }
            });
        }
        _cachedConfig = conf;
        _cacheTime = Date.now();
    }
    return _cachedConfig;
}

export function invalidateLLMCache() {
    _cachedConfig = null;
}

// ── Provider clients (lazy) ───────────────────────────────────────────────────
let _ollamaClient = null;
function getOllamaClient() {
    if (!_ollamaClient) _ollamaClient = new Ollama({ host: 'http://localhost:11434' });
    return _ollamaClient;
}

// ── Unified chat function ─────────────────────────────────────────────────────

/**
 * Sends a chat completion request to the configured LLM provider.
 * Returns an object that looks like Ollama's response for consistency:
 *   { message: { content: string, tool_calls?: [...] } }
 */
export async function llmChat({ messages, tools = [] }) {
    const config = await getLLMConfig();
    const { provider, modelName, apiKey, baseUrl } = config;

    console.log(`🧠 [LLM] Provider: ${provider}, Model: ${modelName}`);

    switch (provider) {
        case 'ollama':
            return ollamaChat({ model: modelName, messages, tools });

        case 'gemini':
            return geminiChat({ apiKey, model: modelName, messages, tools });

        case 'claude':
            return claudeChat({ apiKey, model: modelName, messages, tools });

        case 'openai':
            return openaiChat({ apiKey, model: modelName, messages, tools, baseUrl });

        case 'grok':
            return openaiChat({
                apiKey,
                model: modelName,
                messages,
                tools,
                baseUrl: baseUrl || 'https://api.x.ai/v1'
            });

        default:
            throw new Error(`Unknown LLM provider: ${provider}`);
    }
}

// ── Ollama ────────────────────────────────────────────────────────────────────
async function ollamaChat({ model, messages, tools }) {
    const ollama = getOllamaClient();
    return ollama.chat({ model, messages, tools });
}

// ── Shared helpers for vendor message conversion ─────────────────────────────

/** Parse tool-call arguments that may already be objects or JSON strings. */
function parseToolArgs(args) {
    if (args == null) return {};
    if (typeof args === 'object') return args;
    if (typeof args === 'string') {
        try { return JSON.parse(args); } catch { return {}; }
    }
    return {};
}

/** Coerce tool result payloads into a plain object (Gemini functionResponse). */
function toFunctionResponseObject(content) {
    if (content != null && typeof content === 'object') return content;
    if (typeof content === 'string') {
        try {
            const parsed = JSON.parse(content);
            if (parsed != null && typeof parsed === 'object') return parsed;
            return { result: parsed };
        } catch {
            return { result: content };
        }
    }
    return { result: content ?? null };
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
async function geminiChat({ apiKey, model, messages, tools }) {
    if (!apiKey) throw new Error('Gemini API key not configured.');
    const genAI = new GoogleGenerativeAI(apiKey);

    const systemMsg = messages.find(m => m.role === 'system');

    // Convert tool definitions to Gemini format
    const geminiFunctionDeclarations = (tools || []).map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
    }));

    // systemInstruction MUST be set on getGenerativeModel so the SDK formats it
    // as a Content object. Passing a raw string via startChat() is sent unformatted
    // and Google returns 400 Invalid value at 'system_instruction'.
    const modelParams = {
        model: model || 'gemini-1.5-flash'
    };
    if (systemMsg?.content) {
        modelParams.systemInstruction = systemMsg.content;
    }
    if (geminiFunctionDeclarations.length > 0) {
        modelParams.tools = [{ functionDeclarations: geminiFunctionDeclarations }];
    }

    const geminiModel = genAI.getGenerativeModel(modelParams);

    // Convert unified (Ollama-style) messages → Gemini Content[]
    const contents = [];
    let pendingToolNames = [];

    for (const m of messages) {
        if (m.role === 'system') continue;

        if (m.role === 'user') {
            const text = m.content ?? '';
            const last = contents[contents.length - 1];
            // Merge consecutive plain user texts (Gemini prefers strict turns)
            if (last?.role === 'user' && last.parts.every(p => p.text != null && !p.functionResponse)) {
                last.parts.push({ text });
            } else {
                contents.push({ role: 'user', parts: [{ text }] });
            }
            pendingToolNames = [];
        } else if (m.role === 'assistant') {
            const parts = [];
            pendingToolNames = [];

            if (m.tool_calls?.length) {
                for (const tc of m.tool_calls) {
                    const name = tc.function?.name || tc.name;
                    const args = parseToolArgs(tc.function?.arguments ?? tc.arguments);
                    parts.push({ functionCall: { name, args } });
                    pendingToolNames.push(name);
                }
            }
            if (m.content) {
                parts.push({ text: m.content });
            }
            if (parts.length === 0) {
                parts.push({ text: '' });
            }
            contents.push({ role: 'model', parts });
        } else if (m.role === 'tool') {
            // Pair tool results with preceding assistant tool_calls by order
            const name = pendingToolNames.shift() || 'unknown';
            const frPart = {
                functionResponse: {
                    name,
                    response: toFunctionResponseObject(m.content)
                }
            };
            const last = contents[contents.length - 1];
            if (last?.role === 'user' && last.parts.some(p => p.functionResponse)) {
                last.parts.push(frPart);
            } else {
                contents.push({ role: 'user', parts: [frPart] });
            }
        }
    }

    if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: '' }] });
    }

    const result = await geminiModel.generateContent({ contents });
    const response = result.response;

    // Check for function calls
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const fnCallParts = parts.filter(p => p.functionCall);

    if (fnCallParts.length > 0) {
        const tool_calls = fnCallParts.map((p, i) => ({
            id: `gemini_call_${i}`,
            function: { name: p.functionCall.name, arguments: p.functionCall.args || {} }
        }));
        const textPart = parts.find(p => p.text)?.text || '';
        return { message: { content: textPart, tool_calls } };
    }

    // response.text() throws when the candidate has no text parts
    let text = '';
    try {
        text = response.text() || '';
    } catch {
        text = parts.filter(p => p.text).map(p => p.text).join('') || '';
    }
    return { message: { content: text, tool_calls: [] } };
}

// ── Anthropic Claude ──────────────────────────────────────────────────────────
async function claudeChat({ apiKey, model, messages, tools }) {
    if (!apiKey) throw new Error('Anthropic API key not configured.');
    const anthropic = new Anthropic({ apiKey });

    const systemMsg = messages.find(m => m.role === 'system')?.content || '';

    // Convert unified messages → Anthropic messages (tool_use / tool_result)
    const claudeMessages = [];
    let pendingToolIds = [];

    for (const m of messages) {
        if (m.role === 'system') continue;

        if (m.role === 'user') {
            claudeMessages.push({ role: 'user', content: m.content || '' });
            pendingToolIds = [];
        } else if (m.role === 'assistant') {
            if (m.tool_calls?.length) {
                const content = [];
                if (m.content) content.push({ type: 'text', text: m.content });
                pendingToolIds = [];
                m.tool_calls.forEach((tc, i) => {
                    const name = tc.function?.name || tc.name;
                    const id = tc.id || `toolu_${i}_${name}`;
                    pendingToolIds.push(id);
                    content.push({
                        type: 'tool_use',
                        id,
                        name,
                        input: parseToolArgs(tc.function?.arguments ?? tc.arguments)
                    });
                });
                claudeMessages.push({ role: 'assistant', content });
            } else {
                claudeMessages.push({ role: 'assistant', content: m.content || '' });
                pendingToolIds = [];
            }
        } else if (m.role === 'tool') {
            const toolUseId = pendingToolIds.shift() || 'toolu_unknown';
            const toolResult = {
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? null)
            };
            const last = claudeMessages[claudeMessages.length - 1];
            if (last?.role === 'user' && Array.isArray(last.content)) {
                last.content.push(toolResult);
            } else {
                claudeMessages.push({ role: 'user', content: [toolResult] });
            }
        }
    }

    // Anthropic requires strictly alternating user/assistant roles
    const merged = [];
    for (const msg of claudeMessages) {
        const last = merged[merged.length - 1];
        if (last && last.role === msg.role) {
            const a = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
            const b = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            if (typeof last.content === 'string' && typeof msg.content === 'string') {
                last.content = `${last.content}\n${msg.content}`;
            } else if (Array.isArray(last.content) && Array.isArray(msg.content)) {
                last.content = last.content.concat(msg.content);
            } else {
                last.content = `${a}\n${b}`;
            }
        } else {
            merged.push(msg);
        }
    }

    const claudeTools = (tools || []).map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
    }));

    const response = await anthropic.messages.create({
        model: model || 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: systemMsg || undefined,
        messages: merged.length > 0 ? merged : [{ role: 'user', content: '' }],
        tools: claudeTools.length > 0 ? claudeTools : undefined
    });

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
        const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('') || '';
        const tool_calls = toolUseBlocks.map(b => ({
            id: b.id,
            function: { name: b.name, arguments: b.input || {} }
        }));
        return { message: { content: text, tool_calls } };
    }

    const text = response.content.find(b => b.type === 'text')?.text || '';
    return { message: { content: text, tool_calls: [] } };
}

// ── OpenAI / Grok (OpenAI-compatible) ────────────────────────────────────────
async function openaiChat({ apiKey, model, messages, tools, baseUrl }) {
    if (!apiKey) throw new Error('OpenAI/Grok API key not configured.');
    const openai = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });

    const openaiTools = (tools || []).map(t => ({
        type: 'function',
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
        }
    }));

    // Convert unified messages → OpenAI chat messages with proper tool_call_id pairing
    const formatted = [];
    let pendingToolIds = [];

    for (const m of messages) {
        if (m.role === 'tool') {
            const toolCallId = pendingToolIds.shift() || 'tool_call_0';
            formatted.push({
                role: 'tool',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? null),
                tool_call_id: toolCallId
            });
            continue;
        }

        if (m.role === 'assistant' && m.tool_calls?.length) {
            pendingToolIds = m.tool_calls.map((tc, i) => tc.id || `call_${i}_${tc.function?.name || 'fn'}`);
            formatted.push({
                role: 'assistant',
                content: m.content || null,
                tool_calls: m.tool_calls.map((tc, i) => ({
                    id: pendingToolIds[i],
                    type: 'function',
                    function: {
                        name: tc.function?.name || tc.name,
                        arguments: typeof tc.function?.arguments === 'string'
                            ? tc.function.arguments
                            : JSON.stringify(tc.function?.arguments ?? {})
                    }
                }))
            });
            continue;
        }

        pendingToolIds = [];
        formatted.push({
            role: m.role,
            content: m.content ?? ''
        });
    }

    const response = await openai.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: formatted,
        tools: openaiTools.length > 0 ? openaiTools : undefined
    });

    const choice = response.choices[0].message;

    if (choice.tool_calls && choice.tool_calls.length > 0) {
        const tool_calls = choice.tool_calls.map(tc => ({
            id: tc.id,
            function: {
                name: tc.function.name,
                arguments: (() => {
                    try { return JSON.parse(tc.function.arguments); } catch { return {}; }
                })()
            }
        }));
        return { message: { content: choice.content || '', tool_calls } };
    }

    return { message: { content: choice.content || '', tool_calls: [] } };
}

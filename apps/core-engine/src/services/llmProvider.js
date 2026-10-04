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

// ── Google Gemini ─────────────────────────────────────────────────────────────
async function geminiChat({ apiKey, model, messages, tools }) {
    if (!apiKey) throw new Error('Gemini API key not configured.');
    const genAI = new GoogleGenerativeAI(apiKey);

    // Convert tool definitions to Gemini format
    const geminiFunctionDeclarations = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
    }));

    const geminiModel = genAI.getGenerativeModel({
        model: model || 'gemini-1.5-flash',
        tools: geminiFunctionDeclarations.length > 0
            ? [{ functionDeclarations: geminiFunctionDeclarations }]
            : []
    });

    // Convert OpenAI-style messages to Gemini history + latest user message
    const systemMsg = messages.find(m => m.role === 'system');
    const history = [];
    let lastUserContent = '';

    for (const m of messages) {
        if (m.role === 'system') continue;
        if (m.role === 'user') {
            if (history.length > 0 && history[history.length - 1].role === 'user') {
                history[history.length - 1].parts.push({ text: m.content });
            } else {
                history.push({ role: 'user', parts: [{ text: m.content }] });
            }
            lastUserContent = m.content;
        } else if (m.role === 'assistant') {
            history.push({ role: 'model', parts: [{ text: m.content || '' }] });
        } else if (m.role === 'tool') {
            history.push({ role: 'function', parts: [{ text: m.content }] });
        }
    }

    const chat = geminiModel.startChat({
        history: history.slice(0, -1),
        systemInstruction: systemMsg ? systemMsg.content : undefined
    });

    const result = await chat.sendMessage(lastUserContent);
    const response = result.response;

    // Check for function calls
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const fnCallParts = parts.filter(p => p.functionCall);

    if (fnCallParts.length > 0) {
        const tool_calls = fnCallParts.map(p => ({
            function: { name: p.functionCall.name, arguments: p.functionCall.args }
        }));
        return { message: { content: '', tool_calls } };
    }

    return { message: { content: response.text(), tool_calls: [] } };
}

// ── Anthropic Claude ──────────────────────────────────────────────────────────
async function claudeChat({ apiKey, model, messages, tools }) {
    if (!apiKey) throw new Error('Anthropic API key not configured.');
    const anthropic = new Anthropic({ apiKey });

    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const filtered = messages.filter(m => m.role !== 'system').map(m => {
        if (m.role === 'tool') return { role: 'user', content: m.content };
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' };
    });

    const claudeTools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
    }));

    const response = await anthropic.messages.create({
        model: model || 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: systemMsg,
        messages: filtered,
        tools: claudeTools.length > 0 ? claudeTools : undefined
    });

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
        const tool_calls = toolUseBlocks.map(b => ({
            function: { name: b.name, arguments: b.input }
        }));
        return { message: { content: '', tool_calls } };
    }

    const text = response.content.find(b => b.type === 'text')?.text || '';
    return { message: { content: text, tool_calls: [] } };
}

// ── OpenAI / Grok (OpenAI-compatible) ────────────────────────────────────────
async function openaiChat({ apiKey, model, messages, tools, baseUrl }) {
    if (!apiKey) throw new Error('OpenAI/Grok API key not configured.');
    const openai = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });

    const openaiTools = tools.map(t => ({
        type: 'function',
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
        }
    }));

    const formatted = messages.map(m => {
        if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: 'tool_call_0' };
        return m;
    });

    const response = await openai.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: formatted,
        tools: openaiTools.length > 0 ? openaiTools : undefined
    });

    const choice = response.choices[0].message;

    if (choice.tool_calls && choice.tool_calls.length > 0) {
        const tool_calls = choice.tool_calls.map(tc => ({
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

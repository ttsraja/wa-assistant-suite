import { Ollama } from 'ollama';
import { getUpcomingSchedule, recordUserNote } from './google.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ollama = new Ollama({ host: 'http://localhost:11434' });
const MODEL_NAME = 'gemma4:latest';
const conversationContext = new Map();

const agentTools = [
    {
        type: 'function',
        function: {
            name: 'getUpcomingSchedule',
            description: "Fetch Thanga's busy/free schedule slots for today and the next 7 days from Google Calendar.",
            parameters: { type: 'object', properties: { queryScope: { type: 'string', description: "Always set to 'next_7_days'" } }, required: ["queryScope"] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'recordUserNote',
            description: "Record an urgent message, brief note, or meeting request left by the sender.",
            parameters: {
                type: 'object',
                properties: {
                    senderId: { type: 'string' },
                    senderName: { type: 'string' },
                    noteType: { type: 'string', description: "Either 'urgent_message', 'brief_note', or 'meeting_request'." },
                    messageSummary: { type: 'string' },
                    requestedDueDateTime: { type: 'string' }
                },
                required: ["senderId", "senderName", "noteType", "messageSummary"]
            }
        }
    }
];

export async function handleIncomingMessage(msg, botState, io) {
    let rawName = msg._data?.notifyName || '';
    if (!rawName) {
        try {
            const contact = await msg.getContact().catch(() => null);
            if (contact && (contact.isBusiness || contact.isEnterprise)) return;
            rawName = contact?.pushname || contact?.name || '';
        } catch (e) {
            rawName = '';
        }
    }

    const firstName = rawName.trim().split(' ')[0] || '';
    const userId = msg.from;
    const displayName = firstName || rawName || userId.replace('@c.us', '');

    console.log(`📩 Received WhatsApp message from ${displayName} (${userId}): "${msg.body}"`);

    io.emit('live_log', {
        id: Date.now() + Math.random(),
        from: displayName,
        message: msg.body,
        isBot: false,
        paused: botState.status !== 'ON',
        timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    });

    if (botState.status !== 'ON') {
        console.log(`⏸️ Agent is paused (status=${botState.status}). Skipping auto-reply.`);
        return;
    }

    const isNewSession = !conversationContext.has(userId);
    if (isNewSession) {
        conversationContext.set(userId, [{ role: 'system', content: buildSystemPrompt(firstName, botState.customContext) }]);
    }

    const history = conversationContext.get(userId);
    history.push({ role: 'user', content: msg.body });

    let response = await ollama.chat({ model: MODEL_NAME, messages: history, tools: agentTools });
    let toolsUsedList = [];

    while (response.message.tool_calls && response.message.tool_calls.length > 0) {
        history.push(response.message);

        for (const toolCall of response.message.tool_calls) {
            const rawFnName = toolCall.function.name;
            toolsUsedList.push(rawFnName);
            let fnArgs = typeof toolCall.function.arguments === 'string' ? JSON.parse(toolCall.function.arguments || '{}') : toolCall.function.arguments;

            fnArgs.senderId = userId;
            fnArgs.senderName = firstName || rawName || 'Unknown Contact';
            fnArgs.messageSummary = fnArgs.messageSummary || msg.body;

            console.log(`⚙️ Executing tool: ${rawFnName}`, fnArgs);

            let toolResult;
            if (rawFnName.includes('Schedule')) toolResult = await getUpcomingSchedule();
            else if (rawFnName.includes('Note')) toolResult = await recordUserNote(fnArgs);
            else toolResult = "ERROR: Unknown tool.";

            history.push({ role: 'tool', content: String(toolResult) });
        }
        response = await ollama.chat({ model: MODEL_NAME, messages: history, tools: agentTools });
    }

    const replyText = response.message.content.trim();
    history.push({ role: 'assistant', content: replyText });

    try {
        await msg.reply(replyText);
    } catch (replyErr) {
        console.warn('msg.reply() failed, falling back to direct sendMessage:', replyErr.message);
        await msg.client.sendMessage(userId, replyText);
    }
    console.log(`🤖 Sent reply to ${displayName}: "${replyText}"`);

    io.emit('live_log', {
        id: Date.now() + Math.random(),
        from: 'AI Assistant',
        message: replyText,
        isBot: true,
        toolsUsed: toolsUsedList,
        timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    });

    await prisma.conversationLog.create({
        data: { chatId: userId, senderName: firstName || displayName, message: msg.body, response: replyText, toolsUsed: JSON.stringify(toolsUsedList) }
    });
}

function buildSystemPrompt(firstName, customContext) {
    const displayTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });
    return `You are Thanga's intelligent, context-aware executive assistant on WhatsApp. SENDER: "${firstName || 'Unknown'}". CURRENT CONTEXT: Local Time: ${displayTime} IST. THANGA'S STATUS: "${customContext || 'Busy at work'}". ROLE: You are an AI Assistant. Refer to your boss in the third person as "Thanga".`;
}
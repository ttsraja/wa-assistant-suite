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

function getAvailabilityContext() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const displayTime = istNow.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
    });
    const hour = istNow.getUTCHours() + 5 + (istNow.getUTCMinutes() >= 30 ? 0.5 : 0);
    const adjustedHour = hour % 24;
    const defaultStatus = (adjustedHour >= 18.5)
        ? "Thanga is working late / still caught up at work."
        : "Thanga is currently busy at work and will respond after 06:30 PM IST.";
    return { displayTime, defaultStatus };
}

function buildSystemPrompt(firstName, customContext) {
    const timeContext = getAvailabilityContext();
    const userStatusText = customContext ? customContext : timeContext.defaultStatus;

    return `You are Thanga's intelligent, context-aware executive assistant on WhatsApp.

SENDER: The sender's name is "${firstName || 'Unknown'}".

CURRENT CONTEXT & STATUS (CRITICAL):
- Local Time: ${timeContext.displayTime} IST.
- THANGA'S CURRENT WORK/LIFE STATUS: "${userStatusText}"
- Inform the sender about this status naturally when they ask for Thanga or request his time.

ROLE CLARIFICATION (CRITICAL):
- You are an AI Assistant, NOT Thanga. If the sender addresses you directly as Thanga, state politely that you are his virtual assistant handling messages while he is occupied. NEVER pretend to be Thanga. Always refer to your boss in the third person as "Thanga".

CALENDAR & FREE SLOT SUGGESTIONS:
- You have access to Thanga's calendar for the NEXT 7 DAYS via the 'getUpcomingSchedule' tool.
- When people ask when Thanga is free, call 'getUpcomingSchedule', review his busy slots over the next 7 days, and suggest 1-2 clear free time slots to them.

TOOL CALLING RULES:
1. If the sender leaves a note/message or requests a callback, YOU MUST CALL 'recordUserNote'.
2. If the sender asks for his calendar, availability, or free slots for today or the upcoming week, YOU MUST CALL 'getUpcomingSchedule'.

GREETING RULES:
- Greet the user ONLY on the FIRST message of a conversation session.
- If replying to an ongoing conversation, NEVER say "Hi", "Hello", or "Vanakkam". Answer directly.

PRIVACY:
- Never reveal meeting titles or subject names. Only say "busy in a meeting" or "free".

LANGUAGE:
- Mirror the sender's language style (Tamil, Tanglish, or English). Keep it short, human, and use emojis.`;
}

export async function handleIncomingMessage(msg, botState, io) {
    const userId = msg.from;

    // Get sender name safely without calling getChat()
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
    const displayName = firstName || rawName || userId.replace('@c.us', '');

    console.log(`\n📩 [Message from ${displayName} (${userId})]: ${msg.body}`);

    // Emit incoming message to dashboard
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

    // Handle media messages without calling getChat()
    if (msg.hasMedia) {
        await msg.reply("Hey! Thanga is tied up right now and can't view media files. Please send a text message. 😊");
        return;
    }

    // Send typing indicator safely
    try {
        const chat = await msg.getChat();
        await chat.sendStateTyping();
    } catch (e) { /* ignore – typing is cosmetic */ }

    const isNewSession = !conversationContext.has(userId);

    if (isNewSession) {
        conversationContext.set(userId, [
            { role: 'system', content: buildSystemPrompt(firstName, botState.customContext) }
        ]);
    } else {
        // Refresh system prompt on every message so time & status stay current
        const history = conversationContext.get(userId);
        if (history.length > 0 && history[0].role === 'system') {
            history[0].content = buildSystemPrompt(firstName, botState.customContext);
        }
    }

    const history = conversationContext.get(userId);

    // /reset command
    if (msg.body.trim().toLowerCase() === '/reset') {
        conversationContext.delete(userId);
        await msg.reply('✨ Memory reset for this chat.');
        return;
    }

    history.push({ role: 'user', content: msg.body });

    let toolsUsedList = [];

    try {
        let response = await ollama.chat({ model: MODEL_NAME, messages: history, tools: agentTools });

        while (response.message.tool_calls && response.message.tool_calls.length > 0) {
            history.push(response.message);

            for (const toolCall of response.message.tool_calls) {
                const rawFnName = toolCall.function.name;
                toolsUsedList.push(rawFnName);

                let fnArgs = toolCall.function.arguments || {};
                if (typeof fnArgs === 'string') {
                    try { fnArgs = JSON.parse(fnArgs); } catch (e) { fnArgs = {}; }
                }

                fnArgs.senderId = userId;
                fnArgs.senderName = firstName || rawName || 'Unknown Contact';
                fnArgs.messageSummary = fnArgs.messageSummary || msg.body;

                console.log(`\n💥 [TRIGGERED] Model called tool: "${rawFnName}"`, fnArgs);

                let toolResult;
                try {
                    if (rawFnName === 'getUpcomingSchedule' || rawFnName.includes('Schedule')) {
                        // Send a warm interim reply on first schedule check
                        if (isNewSession) {
                            await msg.reply(`${firstName ? 'Hi ' + firstName + '! ' : ''}Give me a moment, checking Thanga's schedule... 🗓️`);
                        }
                        toolResult = await getUpcomingSchedule();
                    } else if (rawFnName === 'recordUserNote' || rawFnName.includes('Note')) {
                        toolResult = await recordUserNote(fnArgs);
                    } else {
                        toolResult = "ERROR: Unknown tool.";
                    }
                } catch (toolErr) {
                    console.error(`Tool Error for ${rawFnName}:`, toolErr.message);
                    toolResult = "ERROR: Action failed.";
                }

                history.push({
                    role: 'tool',
                    content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
                });
            }

            response = await ollama.chat({ model: MODEL_NAME, messages: history, tools: agentTools });
        }

        const replyText = response.message.content.trim();
        history.push({ role: 'assistant', content: replyText });

        // Send reply
        try {
            await msg.reply(replyText);
        } catch (replyErr) {
            console.warn('msg.reply() failed, falling back to sendMessage:', replyErr.message);
            await msg.client.sendMessage(userId, replyText);
        }

        console.log(`🤖 [Response to ${displayName}]: ${replyText}`);

        // Emit bot reply to dashboard
        io.emit('live_log', {
            id: Date.now() + Math.random(),
            from: 'AI Assistant',
            message: replyText,
            isBot: true,
            toolsUsed: toolsUsedList,
            timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
        });

        // Persist to DB (non-blocking — don't let DB errors kill the reply flow)
        prisma.conversationLog.create({
            data: {
                chatId: userId,
                senderName: firstName || displayName,
                message: msg.body,
                response: replyText,
                toolsUsed: JSON.stringify(toolsUsedList)
            }
        }).catch(e => console.error('DB log error (non-fatal):', e.message));

    } catch (error) {
        console.error('Error in Ollama agent:', error.message || error);
        try {
            await msg.reply("Thanga is tied up right now and will get back to you as soon as he is free. 😊");
        } catch (e) { /* ignore fallback failure */ }
    }
}
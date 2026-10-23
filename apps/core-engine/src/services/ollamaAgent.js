import { llmChat } from './llmProvider.js';
import { getUpcomingSchedule, recordUserNote } from './calendarProvider.js';
import { getContactPolicy, buildPolicyPromptOverlay, createPendingApproval, markApprovalSent } from './contactPolicy.js';
import { prisma } from '../db.js';
const conversationContext = new Map();

// ── Approval dispatch registry ─────────────────────────────────────────────────
// Maps approvalId → { msg, userId } so the server can send approved messages
export const pendingDispatch = new Map();

// ── Tool definitions (provider-agnostic schema) ───────────────────────────────
const agentTools = [
    {
        type: 'function',
        function: {
            name: 'getUpcomingSchedule',
            description: "Fetch Thanga's busy/free schedule for today and the next 7 days.",
            parameters: { type: 'object', properties: { queryScope: { type: 'string', description: "Always 'next_7_days'" } }, required: ['queryScope'] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'recordUserNote',
            description:
                "Record ONE urgent message, brief note, or meeting request from the sender for Thanga. " +
                "Call at most ONCE per user message. Never retry or call again after success or NOTE_ALREADY_RECORDED.",
            parameters: {
                type: 'object',
                properties: {
                    senderId: { type: 'string' },
                    senderName: { type: 'string' },
                    noteType: { type: 'string', description: "'urgent_message', 'brief_note', or 'meeting_request'" },
                    messageSummary: { type: 'string' },
                    requestedDueDateTime: { type: 'string' }
                },
                required: ['senderId', 'senderName', 'noteType', 'messageSummary']
            }
        }
    }
];

// ── Time / availability context ───────────────────────────────────────────────
function getAvailabilityContext() {
    const now = new Date();
    const displayTime = now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
    });
    const istHour = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
    const hour = parseInt(istHour, 10);
    const defaultStatus = (hour >= 18 || hour < 9)
        ? 'Thanga is working late / still caught up at work.'
        : 'Thanga is currently busy at work and will respond after 06:30 PM IST.';
    return { displayTime, defaultStatus };
}

// ── Base system prompt ────────────────────────────────────────────────────────
function buildSystemPrompt(firstName, customContext, policyOverlay = '') {
    const { displayTime, defaultStatus } = getAvailabilityContext();
    const userStatusText = customContext || defaultStatus;

    return `You are Thanga's intelligent, context-aware executive assistant on WhatsApp.

SENDER: The sender's name is "${firstName || 'Unknown'}".

CURRENT CONTEXT & STATUS (CRITICAL):
- Local Time: ${displayTime} IST.
- THANGA'S CURRENT WORK/LIFE STATUS: "${userStatusText}"
- Inform the sender about this status naturally when they ask for Thanga or request his time.

ROLE CLARIFICATION (CRITICAL):
- You are an AI Assistant, NOT Thanga. If the sender addresses you directly as Thanga, state politely that you are his virtual assistant handling messages while he is occupied. NEVER pretend to be Thanga. Always refer to your boss in the third person as "Thanga".

CALENDAR & FREE SLOT SUGGESTIONS:
- You have access to Thanga's calendar for the NEXT 7 DAYS via the 'getUpcomingSchedule' tool.
- When people ask when Thanga is free, call 'getUpcomingSchedule', review his busy slots, and suggest 1-2 clear free time slots.
- IMPORTANT: You CANNOT create, book, or block calendar events. You can only CHECK availability and RECORD a meeting request note for Thanga to action. Never tell someone you have "confirmed", "booked", or "blocked" a meeting — always say you have "noted the request" and that Thanga will confirm directly.

TOOL CALLING RULES:
1. If the sender leaves a note/message, requests a callback, or wants to arrange a meeting, call 'recordUserNote' EXACTLY ONCE to log it for Thanga.
2. NEVER call 'recordUserNote' more than once for the same user message. If the tool returns success or NOTE_ALREADY_RECORDED, do not call it again — just reply to the user.
3. If the sender asks for his calendar, availability, or free slots, call 'getUpcomingSchedule' (once is enough unless they ask again later).
4. After recording a meeting request, say: "I've noted your request for [time] and passed it to Thanga — he'll confirm with you directly." 🙏
5. Do not invent extra tool calls, retries, or "updates" to the same note.

GREETING RULES:
- Greet the user ONLY on the FIRST message of a conversation session.
- If replying to an ongoing conversation, NEVER say "Hi", "Hello", or "Vanakkam". Answer directly.

PRIVACY:
- Never reveal meeting titles or subject names. Only say "busy in a meeting" or "free".

LANGUAGE:
- Mirror the sender's language style (Tamil, Tanglish, or English). Keep it short, human, and use emojis.${policyOverlay}`;
}

// ── Main message handler ───────────────────────────────────────────────────────
export async function handleIncomingMessage(msg, botState, io) {
    const userId = msg.from;

    // Safe name resolution (no getChat call)
    let rawName = msg._data?.notifyName || '';
    if (!rawName) {
        try {
            const contact = await msg.getContact().catch(() => null);
            if (contact && (contact.isBusiness || contact.isEnterprise)) return;
            rawName = contact?.pushname || contact?.name || '';
        } catch { rawName = ''; }
    }
    const firstName = rawName.trim().split(' ')[0] || '';
    const displayName = firstName || rawName || userId.replace('@c.us', '');

    console.log(`\n📩 [Message from ${displayName} (${userId})]: ${msg.body}`);

    // Emit to dashboard (always, even if paused)
    io.emit('live_log', {
        id: Date.now() + Math.random(),
        from: displayName,
        contactId: userId,
        message: msg.body,
        isBot: false,
        paused: botState.status !== 'ON',
        timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    });

    if (botState.status !== 'ON') {
        console.log(`⏸️ Agent paused. Skipping reply.`);
        return;
    }

    // Media guard
    if (msg.hasMedia) {
        await msg.reply("Hey! Thanga is tied up right now and can't view media files. Please send a text message. 😊");
        return;
    }

    // Typing indicator
    try {
        const chat = await msg.getChat();
        await chat.sendStateTyping();
    } catch { /* cosmetic */ }

    // Load per-contact policy
    const policy = await getContactPolicy(userId);
    const policyOverlay = buildPolicyPromptOverlay(policy);

    // ── Approval-required contacts ─────────────────────────────────────────────
    if (policy?.requiresApproval) {
        console.log(`🔒 Contact ${displayName} requires approval. Queuing message.`);

        // Generate a draft reply first (so owner can edit it)
        let aiDraft = null;
        try {
            const draftHistory = [
                { role: 'system', content: buildSystemPrompt(firstName, botState.customContext, policyOverlay) },
                { role: 'user', content: msg.body }
            ];
            const draftResp = await llmChat({ messages: draftHistory, tools: agentTools });
            aiDraft = draftResp.message.content?.trim() || null;
        } catch (e) {
            console.warn('Draft generation failed:', e.message);
        }

        const approval = await createPendingApproval({
            contactId: userId,
            senderName: displayName,
            message: msg.body,
            aiDraft
        });

        // Register for dispatch when approved from UI
        pendingDispatch.set(approval.id, { msg, userId });

        // Notify dashboard
        io.emit('approval_request', {
            id: approval.id,
            from: displayName,
            contactId: userId,
            message: msg.body,
            aiDraft,
            timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
        });

        // Send holding message to sender
        await msg.reply("Thanks for reaching out! Your message has been received and Thanga will get back to you personally. 🙏");
        return;
    }

    // ── Normal reply flow ──────────────────────────────────────────────────────
    const isNewSession = !conversationContext.has(userId);

    if (isNewSession) {
        conversationContext.set(userId, [
            { role: 'system', content: buildSystemPrompt(firstName, botState.customContext, policyOverlay) }
        ]);
    } else {
        const history = conversationContext.get(userId);
        if (history[0]?.role === 'system') {
            history[0].content = buildSystemPrompt(firstName, botState.customContext, policyOverlay);
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
    // Per-inbound-message tool guardrails (LLM may retry the same tool in a loop)
    let noteWritesThisMessage = 0;
    let scheduleFetchesThisMessage = 0;
    let toolRounds = 0;
    const MAX_TOOL_ROUNDS = 4;
    const MAX_NOTE_WRITES_PER_MESSAGE = 1;
    const MAX_SCHEDULE_FETCHES_PER_MESSAGE = 2;

    try {
        let response = await llmChat({ messages: history, tools: agentTools });

        while (response.message.tool_calls && response.message.tool_calls.length > 0) {
            toolRounds += 1;
            if (toolRounds > MAX_TOOL_ROUNDS) {
                console.warn(`Tool loop cap reached (${MAX_TOOL_ROUNDS}) for ${userId} — stopping further tool calls.`);
                history.push({
                    role: 'tool',
                    content: 'TOOL_LOOP_LIMIT: Too many tool rounds for this message. Stop calling tools and reply to the user now.'
                });
                // One final text-only completion without tools
                response = await llmChat({ messages: history, tools: [] });
                break;
            }

            history.push(response.message);

            for (const toolCall of response.message.tool_calls) {
                const rawFnName = toolCall.function?.name || toolCall.name || '';
                toolsUsedList.push(rawFnName);

                let fnArgs = toolCall.function?.arguments ?? toolCall.arguments ?? {};
                if (typeof fnArgs === 'string') {
                    try { fnArgs = JSON.parse(fnArgs); } catch { fnArgs = {}; }
                }

                fnArgs.senderId = userId;
                fnArgs.senderName = firstName || rawName || 'Unknown Contact';
                fnArgs.messageSummary = fnArgs.messageSummary || msg.body;

                console.log(`\n💥 [TOOL] ${rawFnName}`, fnArgs);

                let toolResult;
                try {
                    const isScheduleTool = rawFnName === 'getUpcomingSchedule' || /schedule/i.test(rawFnName);
                    const isNoteTool = rawFnName === 'recordUserNote' || /note/i.test(rawFnName);

                    if (isScheduleTool) {
                        if (scheduleFetchesThisMessage >= MAX_SCHEDULE_FETCHES_PER_MESSAGE) {
                            toolResult = 'SCHEDULE_ALREADY_FETCHED: Calendar was already checked for this message. Use the previous result and reply to the user.';
                        } else {
                            scheduleFetchesThisMessage += 1;
                            if (isNewSession && scheduleFetchesThisMessage === 1) {
                                await msg.reply(`${firstName ? 'Hi ' + firstName + '! ' : ''}Give me a moment, checking Thanga's schedule... 🗓️`);
                            }
                            toolResult = await getUpcomingSchedule();
                        }
                    } else if (isNoteTool) {
                        if (noteWritesThisMessage >= MAX_NOTE_WRITES_PER_MESSAGE) {
                            console.warn(`📌 Skipping duplicate recordUserNote for ${userId} (already wrote ${noteWritesThisMessage} this message)`);
                            toolResult =
                                'NOTE_ALREADY_RECORDED: recordUserNote was already called once for this user message. ' +
                                'Do NOT call it again. Acknowledge the note to the user and finish.';
                        } else {
                            noteWritesThisMessage += 1;
                            toolResult = await recordUserNote(fnArgs);
                            // If provider-level dedupe fired, still counts as the one allowed write attempt
                            if (typeof toolResult === 'string' && toolResult.startsWith('NOTE_ALREADY_RECORDED')) {
                                console.log(`📌 Provider dedupe for ${userId}`);
                            }
                        }
                    } else {
                        toolResult = 'ERROR: Unknown tool.';
                    }
                } catch (toolErr) {
                    console.error(`Tool Error (${rawFnName}):`, toolErr.message);
                    toolResult = 'ERROR: Action failed.';
                }

                history.push({ role: 'tool', content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult) });
            }

            // After the one allowed note write, remove recordUserNote so the model cannot re-select it.
            // Schedule tool remains available if still needed this turn.
            let toolsForNext = agentTools;
            if (noteWritesThisMessage >= MAX_NOTE_WRITES_PER_MESSAGE) {
                toolsForNext = agentTools.filter((t) => t.function?.name !== 'recordUserNote');
            }
            if (scheduleFetchesThisMessage >= MAX_SCHEDULE_FETCHES_PER_MESSAGE) {
                toolsForNext = toolsForNext.filter((t) => t.function?.name !== 'getUpcomingSchedule');
            }
            response = await llmChat({ messages: history, tools: toolsForNext });
        }

        const replyText = response.message.content?.trim() || "I'll pass your message to Thanga. 🙏";
        history.push({ role: 'assistant', content: replyText });

        // Send reply
        try {
            await msg.reply(replyText);
        } catch (replyErr) {
            console.warn('msg.reply() failed, using sendMessage:', replyErr.message);
            await msg.client.sendMessage(userId, replyText);
        }

        console.log(`🤖 [Response to ${displayName}]: ${replyText}`);

        io.emit('live_log', {
            id: Date.now() + Math.random(),
            from: 'AI Assistant',
            contactId: userId,
            message: replyText,
            isBot: true,
            toolsUsed: toolsUsedList,
            timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
        });

        // Non-blocking DB persist
        prisma.conversationLog.create({
            data: { chatId: userId, senderName: firstName || displayName, message: msg.body, response: replyText, toolsUsed: JSON.stringify(toolsUsedList) }
        }).catch(e => console.error('DB log error (non-fatal):', e.message));

    } catch (error) {
        console.error('Error in agent loop:', error.message || error);
        try {
            await msg.reply("Thanga is tied up right now and will get back to you as soon as he is free. 😊");
        } catch { /* ignore */ }
    }
}

// ── Dispatch an approved message from the UI ───────────────────────────────────
export async function dispatchApprovedReply(approvalId, replyText, client, io) {
    const entry = pendingDispatch.get(approvalId);
    if (!entry) throw new Error(`No pending dispatch found for approval ID ${approvalId}`);

    const { msg, userId } = entry;
    pendingDispatch.delete(approvalId);

    try {
        await msg.reply(replyText);
    } catch {
        await client.sendMessage(userId, replyText);
    }

    await markApprovalSent(approvalId);

    io.emit('live_log', {
        id: Date.now() + Math.random(),
        from: 'AI Assistant (Approved)',
        contactId: userId,
        message: replyText,
        isBot: true,
        timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    });

    console.log(`✅ Dispatched approved reply for ${userId}: "${replyText}"`);
}
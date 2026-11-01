/**
 * contactPolicy.js
 * Per-contact tone, information level, topic restrictions, and approval workflow.
 */

import { prisma } from '../db.js';

// ── Cache ──────────────────────────────────────────────────────────────────────
const _policyCache = new Map(); // contactId → { policy, cachedAt }
const CACHE_TTL_MS = 15_000;

export async function getContactPolicy(contactId) {
    const now = Date.now();
    const cached = _policyCache.get(contactId);
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.policy;

    const policy = await prisma.contactPolicy.findUnique({ where: { contactId } });
    _policyCache.set(contactId, { policy, cachedAt: now });
    return policy; // null = no custom policy (use defaults)
}

export function invalidatePolicyCache(contactId) {
    if (contactId) _policyCache.delete(contactId);
    else _policyCache.clear();
}

// ── System prompt overlay based on policy ─────────────────────────────────────

/**
 * Returns additional system prompt instructions to inject for a specific contact.
 * These are appended to the base system prompt in ollamaAgent.js.
 */
export function buildPolicyPromptOverlay(policy) {
    if (!policy) return '';

    const lines = [];

    // ── Tone
if (policy.tone && policy.tone !== 'auto') {
        const toneMap = {
            formal: 'Use strictly formal, professional language. No emojis. No casual abbreviations.',
            casual: 'Use casual, friendly language. Emojis are welcome. Keep it conversational.',
            tamil: 'Respond in Tamil (தமிழ்) language wherever possible. Mirror the sender\'s Tamil usage.',
            tanglish: 'Respond in Tanglish (Tamil + English mix). Mirror the sender\'s style naturally.'
        };
        if (toneMap[policy.tone]) {
            lines.push(
                `\nTONE OVERRIDE (per-contact — overrides Master Agent global response tone): ${toneMap[policy.tone]}`
            );
        }
    }

    // ── Information Level
    if (policy.infoLevel === 'limited') {
        lines.push(`\nINFORMATION POLICY: Share only general availability (busy/free). Do NOT reveal specific schedule details, project names, or internal information. Redirect deeper questions to "contact Thanga directly."`);
    } else if (policy.infoLevel === 'minimal') {
        lines.push(`\nINFORMATION POLICY: Be extremely brief. Do NOT provide any schedule details. Simply confirm Thanga is unavailable and will respond later. Do not engage in extended conversation.`);
    }

    // ── Restricted Topics
    if (policy.restrictedTopics) {
        let topics = [];
        try { topics = JSON.parse(policy.restrictedTopics); } catch { topics = []; }
        if (topics.length > 0) {
            lines.push(`\nRESTRICTED TOPICS: If the sender asks about any of the following topics, politely decline and say you are not able to help with that: ${topics.join(', ')}.`);
        }
    }

    // ── Custom Instructions
    if (policy.customInstructions && policy.customInstructions.trim()) {
        lines.push(`\nSPECIAL INSTRUCTIONS FOR THIS CONTACT:\n${policy.customInstructions.trim()}`);
    }

    return lines.join('\n');
}

// ── Approval workflow ──────────────────────────────────────────────────────────

/**
 * Checks if this contact's message contains any restricted topics.
 * Returns the matched topics array (empty if none).
 */
export function getRestrictedTopicMatches(policy, messageText) {
    if (!policy?.restrictedTopics) return [];
    let topics = [];
    try { topics = JSON.parse(policy.restrictedTopics); } catch { return []; }
    const lower = messageText.toLowerCase();
    return topics.filter(t => lower.includes(t.toLowerCase()));
}

/**
 * Creates a pending approval record in the DB.
 * Returns the saved PendingApproval row.
 */
export async function createPendingApproval({ contactId, senderName, message, aiDraft }) {
    return prisma.pendingApproval.create({
        data: { contactId, senderName, message, aiDraft, status: 'pending' }
    });
}

/**
 * Retrieves all pending approvals, optionally filtered by status.
 */
export async function getPendingApprovals(status = 'pending') {
    return prisma.pendingApproval.findMany({
        where: { status },
        orderBy: { createdAt: 'desc' }
    });
}

/**
 * Approves a pending approval — updates status and returns it.
 * If editedResponse is provided, the aiDraft is updated with the owner's edit.
 */
export async function approveApproval(id, editedResponse) {
    return prisma.pendingApproval.update({
        where: { id },
        data: {
            status: 'approved',
            ...(editedResponse ? { aiDraft: editedResponse } : {})
        }
    });
}

/**
 * Rejects a pending approval.
 */
export async function rejectApproval(id) {
    return prisma.pendingApproval.update({ where: { id }, data: { status: 'rejected' } });
}

/**
 * Marks approval as sent (after message is dispatched).
 */
export async function markApprovalSent(id) {
    return prisma.pendingApproval.update({ where: { id }, data: { status: 'sent' } });
}

// ── CRUD helpers for the settings UI ─────────────────────────────────────────

export async function getAllContactPolicies() {
    return prisma.contactPolicy.findMany({ orderBy: { displayName: 'asc' } });
}

export async function upsertContactPolicy(data) {
    const { contactId, ...rest } = data;
    invalidatePolicyCache(contactId);
    return prisma.contactPolicy.upsert({
        where: { contactId },
        update: { ...rest, updatedAt: new Date() },
        create: { contactId, ...rest }
    });
}

export async function deleteContactPolicy(contactId) {
    invalidatePolicyCache(contactId);
    return prisma.contactPolicy.delete({ where: { contactId } });
}

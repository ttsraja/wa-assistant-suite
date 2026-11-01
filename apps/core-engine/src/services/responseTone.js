/**
 * Global Master Agent response tone.
 * Applied via system prompt so it works for every LLM vendor
 * (ollama | gemini | claude | openai | grok) without provider branching.
 *
 * Per-contact ContactPolicy.tone still injects a TONE OVERRIDE when not "auto"
 * and takes precedence for that contact.
 */

export const RESPONSE_TONE_VALUES = Object.freeze([
    'auto',
    'formal',
    'casual',
    'friendly',
    'concise',
    'tamil',
    'tanglish',
]);

export const RESPONSE_TONE_LABELS = Object.freeze({
    auto: 'Auto — mirror sender style',
    formal: 'Formal / professional',
    casual: 'Casual',
    friendly: 'Warm & friendly',
    concise: 'Concise / brief',
    tamil: 'Tamil (தமிழ்)',
    tanglish: 'Tanglish',
});

const TONE_INSTRUCTIONS = Object.freeze({
    auto: '',
    formal:
        'Use strictly formal, professional language. No emojis. No slang or casual abbreviations. Prefer complete sentences.',
    casual:
        'Use casual, conversational language. Light emojis are welcome. Keep it natural and approachable.',
    friendly:
        'Use a warm, supportive, friendly tone. Be polite and encouraging. Light emojis are fine. Stay professional enough for WhatsApp business context.',
    concise:
        'Keep every reply short and high-signal. Prefer 1–3 short sentences. Avoid filler, long lists, and unnecessary preamble.',
    tamil:
        'Respond in Tamil (தமிழ்) wherever possible. Mirror the sender’s Tamil usage. Keep replies natural and brief.',
    tanglish:
        'Respond in Tanglish (Tamil + English mix). Mirror the sender’s style naturally. Keep replies short and human.',
});

/**
 * Normalize unknown / empty values to a safe default.
 * @param {unknown} value
 * @returns {typeof RESPONSE_TONE_VALUES[number]}
 */
export function normalizeResponseTone(value) {
    const v = String(value ?? 'auto').trim().toLowerCase();
    return RESPONSE_TONE_VALUES.includes(v) ? v : 'auto';
}

/**
 * System-prompt fragment for the global Master Agent tone.
 * Empty string when auto (base prompt already mirrors sender language).
 * @param {unknown} tone
 * @returns {string}
 */
export function buildGlobalToneOverlay(tone) {
    const key = normalizeResponseTone(tone);
    const instruction = TONE_INSTRUCTIONS[key] || '';
    if (!instruction) return '';
    return `\nGLOBAL RESPONSE TONE (Master Agent default): ${instruction}`;
}

/**
 * True when a per-contact policy tone should override the global default.
 * @param {{ tone?: string } | null | undefined} policy
 */
export function contactToneOverridesGlobal(policy) {
    if (!policy?.tone) return false;
    const t = String(policy.tone).trim().toLowerCase();
    return t !== '' && t !== 'auto';
}

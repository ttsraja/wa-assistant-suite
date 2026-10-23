/**
 * calendarProvider.js
 * Abstraction for calendar (read availability) and tasks (write notes).
 * Providers: google | macos | windows
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../db.js';
import { getUpcomingSchedule as googleCalendar, recordUserNote as googleTasks } from './google.js';
const execAsync = promisify(exec);

// ── Cached config ──────────────────────────────────────────────────────────────
let _cachedConfig = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 10_000;

export async function getCalendarConfig() {
    if (!_cachedConfig || Date.now() - _cacheTime > CACHE_TTL_MS) {
        let conf = await prisma.calendarConfig.findUnique({ where: { id: 1 } });
        if (!conf) {
            conf = await prisma.calendarConfig.create({
                data: { id: 1, calendarProvider: 'google', tasksProvider: 'google' }
            });
        }
        _cachedConfig = conf;
        _cacheTime = Date.now();
    }
    return _cachedConfig;
}

export function invalidateCalendarCache() {
    _cachedConfig = null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getUpcomingSchedule() {
    const config = await getCalendarConfig();
    console.log(`📅 [Calendar] Provider: ${config.calendarProvider}`);

    switch (config.calendarProvider) {
        case 'google':
            return googleCalendar();
        case 'macos':
            return macOSCalendar();
        case 'windows':
            return windowsCalendar();
        default:
            return googleCalendar();
    }
}

// ── Note write guardrails (dedupe / anti-loop) ─────────────────────────────────
// LLMs sometimes call recordUserNote repeatedly for the same inbound message.
// Cache successful (and skipped) fingerprints briefly so backends are not spammed.
const recentNoteWrites = new Map(); // fingerprint → { at, result }
const NOTE_DEDUPE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const NOTE_DEDUPE_MAX_ENTRIES = 500;

function normalizeNoteText(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .slice(0, 400);
}

export function noteFingerprint(args = {}) {
    const sender = String(args.senderId || args.senderName || 'unknown').trim().toLowerCase();
    const type = String(args.noteType || 'GENERAL_NOTE').trim().toUpperCase();
    const summary = normalizeNoteText(args.messageSummary || args.summary || '');
    return `${sender}|${type}|${summary}`;
}

/** Test helper — clear in-memory note dedupe cache. */
export function resetNoteDedupeForTests() {
    recentNoteWrites.clear();
}

function pruneRecentNoteWrites(now = Date.now()) {
    for (const [key, entry] of recentNoteWrites) {
        if (!entry || now - entry.at > NOTE_DEDUPE_TTL_MS) recentNoteWrites.delete(key);
    }
    // Bound memory if traffic is high
    if (recentNoteWrites.size > NOTE_DEDUPE_MAX_ENTRIES) {
        const overflow = recentNoteWrites.size - NOTE_DEDUPE_MAX_ENTRIES;
        const keys = recentNoteWrites.keys();
        for (let i = 0; i < overflow; i++) {
            const next = keys.next();
            if (next.done) break;
            recentNoteWrites.delete(next.value);
        }
    }
}

export async function recordUserNote(args) {
    const config = await getCalendarConfig();
    console.log(`📌 [Tasks] Provider: ${config.tasksProvider}`);

    const now = Date.now();
    pruneRecentNoteWrites(now);
    const fingerprint = noteFingerprint(args);
    const prior = recentNoteWrites.get(fingerprint);
    if (prior && now - prior.at <= NOTE_DEDUPE_TTL_MS) {
        console.log(`📌 [Tasks] Dedupe hit — skipping duplicate note (${fingerprint.slice(0, 80)}…)`);
        return (
            'NOTE_ALREADY_RECORDED: An identical note from this sender was already saved recently. ' +
            'Do NOT call recordUserNote again for this message. Continue with a normal user reply. ' +
            `Prior result: ${prior.result}`
        );
    }

    let result;
    switch (config.tasksProvider) {
        case 'google':
            result = await googleTasks(args);
            break;
        case 'macos':
            result = await macOSReminder(args);
            break;
        case 'windows':
            result = await windowsTask(args);
            break;
        default:
            result = await googleTasks(args);
    }

    // Cache both success and soft failures so retries in the same loop don't multi-write.
    // Hard provider errors that start with ERROR: still get cached briefly to stop thrashing.
    recentNoteWrites.set(fingerprint, { at: now, result: typeof result === 'string' ? result : JSON.stringify(result) });
    return result;
}

// ── macOS Calendar (via AppleScript) ──────────────────────────────────────────
async function macOSCalendar() {
    try {
        // Fetch events from today through the next 7 days using AppleScript
        const script = `
tell application "Calendar"
    set today to current date
    set endDate to today + (7 * days)
    set allEvents to {}
    repeat with cal in calendars
        set evList to (every event of cal whose start date ≥ today and start date ≤ endDate)
        repeat with ev in evList
            set props to {summary:"[Meeting]", startDate:(start date of ev), endDate:(end date of ev)}
            set end of allEvents to props
        end repeat
    end repeat
    set result to ""
    repeat with ev in allEvents
        set result to result & (startDate of ev as string) & " to " & (endDate of ev as string) & linefeed
    end repeat
    return result
end tell
`.trim();

        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length === 0) return 'No events found in macOS Calendar for the next 7 days.';

        const slots = lines.slice(0, 20).map(l => `• Busy: ${l}`).join('\n');
        return `📅 macOS Calendar — Next 7 Days:\n${slots}`;
    } catch (e) {
        console.error('macOS Calendar error:', e.message);
        return `Could not read macOS Calendar: ${e.message}. Make sure Calendar app access is granted in System Preferences > Privacy > Automation.`;
    }
}

// ── macOS Reminders (via AppleScript) ─────────────────────────────────────────
async function macOSReminder(args) {
    try {
        const { senderName = 'Unknown', messageSummary = 'Note', noteType = 'NOTE' } = args;
        const title = `[${noteType}] Message from ${senderName}`;
        const body = messageSummary.replace(/'/g, "\\'");

        const script = `
tell application "Reminders"
    set newList to list "WhatsApp Assistant"
    make new reminder at end of reminders of newList with properties {name:"${title.replace(/'/g, "\\'")}", body:"${body}"}
end tell
`.trim();

        await execAsync(`osascript -e '${script}'`);
        return `✅ Reminder created in macOS Reminders: "${title}"`;
    } catch (e) {
        // Try creating the list first if it doesn't exist
        try {
            const fallback = `tell application "Reminders" to make new reminder with properties {name:"${(args.messageSummary || 'Note').replace(/'/g, "\\'")}", body:"From: ${args.senderName}"}`;
            await execAsync(`osascript -e '${fallback}'`);
            return `✅ Reminder created in macOS Reminders (default list).`;
        } catch (e2) {
            return `Could not create macOS Reminder: ${e2.message}. Check Reminders app permissions.`;
        }
    }
}

// ── Windows Calendar (via PowerShell) ─────────────────────────────────────────
async function windowsCalendar() {
    try {
        const script = `
$today = Get-Date
$end = $today.AddDays(7)
$outlook = New-Object -ComObject Outlook.Application
$ns = $outlook.GetNamespace('MAPI')
$cal = $ns.GetDefaultFolder(9)
$items = $cal.Items
$items.IncludeRecurrences = $true
$items.Sort('[Start]')
$filter = "[Start] >= '$($today.ToString('g'))' AND [End] <= '$($end.ToString('g'))'"
$filtered = $items.Restrict($filter)
foreach ($item in $filtered) { Write-Host "$($item.Start) - $($item.End): [Meeting]" }
`.trim();

        const { stdout } = await execAsync(`powershell -Command "${script}"`, { shell: true });
        if (!stdout.trim()) return 'No events found in Outlook Calendar for the next 7 days.';
        return `📅 Outlook Calendar — Next 7 Days:\n${stdout.trim()}`;
    } catch (e) {
        return `Could not read Outlook Calendar: ${e.message}. Ensure Outlook is installed and accessible.`;
    }
}

// ── Windows Tasks (via PowerShell / Outlook Tasks) ────────────────────────────
async function windowsTask(args) {
    try {
        const { senderName = 'Unknown', messageSummary = 'Note', noteType = 'NOTE' } = args;
        const subject = `[${noteType}] Message from ${senderName}`;
        const body = messageSummary.replace(/"/g, '\\"');

        const script = `
$outlook = New-Object -ComObject Outlook.Application
$task = $outlook.CreateItem(3)
$task.Subject = "${subject}"
$task.Body = "${body}"
$task.Save()
`.trim();

        await execAsync(`powershell -Command "${script}"`, { shell: true });
        return `✅ Task created in Outlook Tasks: "${subject}"`;
    } catch (e) {
        return `Could not create Outlook Task: ${e.message}. Ensure Outlook is installed.`;
    }
}

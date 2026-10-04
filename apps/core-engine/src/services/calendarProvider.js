/**
 * calendarProvider.js
 * Abstraction for calendar (read availability) and tasks (write notes).
 * Providers: google | macos | windows
 */

import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getUpcomingSchedule as googleCalendar, recordUserNote as googleTasks } from './google.js';

const prisma = new PrismaClient();
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

export async function recordUserNote(args) {
    const config = await getCalendarConfig();
    console.log(`📌 [Tasks] Provider: ${config.tasksProvider}`);

    switch (config.tasksProvider) {
        case 'google':
            return googleTasks(args);
        case 'macos':
            return macOSReminder(args);
        case 'windows':
            return windowsTask(args);
        default:
            return googleTasks(args);
    }
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

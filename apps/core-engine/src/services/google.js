import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveConfigPath(filename) {
    const cwdPath = path.resolve(process.cwd(), filename);
    if (fs.existsSync(cwdPath)) return cwdPath;
    const coreEnginePath = path.resolve(__dirname, '../../', filename);
    if (fs.existsSync(coreEnginePath)) return coreEnginePath;
    return cwdPath;
}

const credentialsPath = resolveConfigPath('credentials.json');
const tokenPath = resolveConfigPath('token.json');

async function getAuthClient() {
    if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
        throw new Error("Google credentials or token missing.");
    }
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
}

export async function recordUserNote(rawArgs) {
    try {
        const auth = await getAuthClient();
        const tasksApi = google.tasks({ version: 'v1', auth });

        const senderId = rawArgs.senderId || 'Unknown ID';
        const senderName = rawArgs.senderName || 'Unknown Contact';
        const noteType = (rawArgs.noteType || 'GENERAL_NOTE').toUpperCase();
        const messageSummary = rawArgs.messageSummary || rawArgs.summary || 'No content provided.';
        const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        const requestedDueDateTime = rawArgs.requestedDueDateTime || rawArgs.dueDateTime || null;
        let taskDetails = `Sender: ${senderName} (${senderId})\nReceived: ${timestamp}\n\nNote:\n${messageSummary}`;

        const requestBody = {
            title: `📌 [${noteType}] Message from ${senderName}`,
            notes: taskDetails,
            status: 'needsAction'
        };

        if (requestedDueDateTime) {
            try {
                const dueDate = new Date(requestedDueDateTime);
                if (!isNaN(dueDate.getTime())) {
                    requestBody.due = dueDate.toISOString();
                    const formattedDue = dueDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
                    requestBody.notes = `⏰ REQUESTED ACTION TIME: ${formattedDue}\n\n` + requestBody.notes;
                }
            } catch (e) { }
        }

        const res = await tasksApi.tasks.insert({ tasklist: '@default', requestBody });
        return `Successfully created a Google Task for Thanga from ${senderName}.`;
    } catch (err) {
        return "ERROR: Could not create Google Task.";
    }
}

export async function getUpcomingSchedule() {
    try {
        const auth = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth });

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfPeriod = new Date(startOfDay);
        endOfPeriod.setDate(startOfDay.getDate() + 7);
        endOfPeriod.setHours(23, 59, 59, 999);

        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startOfDay.toISOString(),
            timeMax: endOfPeriod.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = res.data.items;
        if (!events || events.length === 0) return "Thanga has no scheduled meetings or busy slots for the next 7 days. He is completely free.";

        const scheduleByDate = {};
        events.forEach(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const end = new Date(event.end.dateTime || event.end.date);
            const dateKey = start.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', month: 'short', day: 'numeric' });
            const startTime = start.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
            const endTime = end.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

            if (!scheduleByDate[dateKey]) scheduleByDate[dateKey] = [];
            scheduleByDate[dateKey].push(`Busy: ${startTime} to ${endTime}`);
        });

        let output = "Thanga's Busy Slots for the Next 7 Days:\n";
        for (const [date, slots] of Object.entries(scheduleByDate)) {
            output += `\n📅 ${date}:\n  - ${slots.join('\n  - ')}`;
        }
        return output;
    } catch (err) {
        return "ERROR: Could not retrieve calendar events.";
    }
}
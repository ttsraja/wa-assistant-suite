import fs from 'fs';
import { google } from 'googleapis';
import { getEnginePort, getPaths } from '../paths.js';

const CALLBACK_PATH = '/api/calendar/google-auth/callback';

function credentialsPath() {
    return getPaths().credentialsPath;
}

function tokenPath() {
    return getPaths().tokenPath;
}

function getOAuthCredentials() {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    if (clientId && clientSecret) return { clientId, clientSecret };

    const credPath = credentialsPath();
    if (!fs.existsSync(credPath)) {
        throw new Error(
            'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, or add credentials.json to the app data directory (apps/core-engine in dev).'
        );
    }

    const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const client = credentials.installed || credentials.web;
    if (!client?.client_id || !client?.client_secret) {
        throw new Error('credentials.json must contain an installed or web Google OAuth client.');
    }

    return { clientId: client.client_id, clientSecret: client.client_secret };
}

function createOAuthClient() {
    const { clientId, clientSecret } = getOAuthCredentials();
    const port = getEnginePort();
    const redirectUri =
        process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:${port}${CALLBACK_PATH}`;
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGoogleAuthUrl() {
    const oauthClient = createOAuthClient();
    const url = oauthClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/tasks',
        ],
    });

    return { url };
}

export async function handleGoogleAuthCallback(code) {
    const oauthClient = createOAuthClient();
    const { tokens } = await oauthClient.getToken(code);

    if (!tokens.access_token && !tokens.refresh_token) {
        throw new Error('Google did not return an access or refresh token.');
    }

    fs.writeFileSync(tokenPath(), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function isGoogleConfigured() {
    try {
        getOAuthCredentials();
        return fs.existsSync(tokenPath());
    } catch {
        return false;
    }
}

export function getGoogleAuthClient() {
    const tPath = tokenPath();
    if (!fs.existsSync(tPath)) {
        throw new Error('Google OAuth token is missing. Authenticate Google Calendar in Settings first.');
    }

    const oauthClient = createOAuthClient();
    const tokens = JSON.parse(fs.readFileSync(tPath, 'utf8'));
    oauthClient.setCredentials(tokens);
    return oauthClient;
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CALLBACK_PATH = '/api/calendar/google-auth/callback';

function resolveConfigPath(filename) {
    const cwdPath = path.resolve(process.cwd(), filename);
    if (fs.existsSync(cwdPath)) return cwdPath;

    const coreEnginePath = path.resolve(__dirname, '../../', filename);
    if (fs.existsSync(coreEnginePath)) return coreEnginePath;

    return cwdPath;
}

const credentialsPath = resolveConfigPath('credentials.json');
const tokenPath = resolveConfigPath('token.json');

function getOAuthCredentials() {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    if (clientId && clientSecret) return { clientId, clientSecret };

    if (!fs.existsSync(credentialsPath)) {
        throw new Error('Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, or add credentials.json to apps/core-engine.');
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const client = credentials.installed || credentials.web;
    if (!client?.client_id || !client?.client_secret) {
        throw new Error('credentials.json must contain an installed or web Google OAuth client.');
    }

    return { clientId: client.client_id, clientSecret: client.client_secret };
}

function createOAuthClient() {
    const { clientId, clientSecret } = getOAuthCredentials();
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:3001${CALLBACK_PATH}`;
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

    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function isGoogleConfigured() {
    try {
        getOAuthCredentials();
        return fs.existsSync(tokenPath);
    } catch {
        return false;
    }
}

export function getGoogleAuthClient() {
    if (!fs.existsSync(tokenPath)) {
        throw new Error('Google OAuth token is missing. Authenticate Google Calendar in Settings first.');
    }

    const oauthClient = createOAuthClient();
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oauthClient.setCredentials(tokens);
    return oauthClient;
}

# KLINSMD 4 PRO IV

**FLIRT SMART. STAY CONFIDENT. NEVER SIMP.**

A mobile-first Kenyan AI flirting assistant built with HTML/CSS/JavaScript, Express, Supabase and OpenRouter.

## Included features

- Girl/boy setup and person-name entry
- Unique session name, six-digit recovery code and private recovery key
- Persistent Supabase conversation history
- Separate new-chat flow; new chats never load an old conversation
- Recovery restores the original name, gender, messages and preferences
- Kenyan English, Kiswahili, Sheng and mixed-language prompting
- AUTO, SMOOTH, EGO, SHENG, ROMANTIC, BRAG, MYSTERY, SAVAGE and NATURAL modes
- One concise reply with language/tone/interest analysis
- Copy reply, change mode, clear-by-deleting, and create a separate conversation
- Server-side OpenRouter and Supabase secrets

## Important security notes

The six-digit code is **not** the only recovery factor. Recovery requires:
1. The session name
2. The six-digit code
3. The 32-character private recovery key

Save all three when a conversation is created. The recovery key is shown only once. The server stores bcrypt hashes of the code and recovery key, and a SHA-256 hash of the active access token.

The Supabase service-role secret is used only by the server. Never put it in `public/`, frontend JavaScript, GitHub, or a `VITE_`/`NEXT_PUBLIC_` variable. The SQL schema disables direct browser access and provides persistent recovery-attempt throttling.

For a public production launch, add monitoring and periodic cleanup of old `recovery_attempts` rows, and consider Supabase Auth if users need account-based multi-device ownership.

## 1. Create Supabase database

1. Create a project at https://supabase.com.
2. Open **SQL Editor**.
3. Paste and run `supabase/schema.sql`.
4. Open **Project Settings → API**.
5. Copy the Project URL and the **service_role secret** (or current secret key). Keep the secret private.

## 2. Create OpenRouter API key

1. Open https://openrouter.ai/settings/keys.
2. Create an API key.
3. Use `openrouter/free` as the model. It routes requests to currently available free models.
4. Free models have rate limits and may be busy or unavailable. Current free-model details: https://openrouter.ai/collections/free-models

## 3. Configure locally (Android)

Install a code editor such as Acode, and use Termux if you want a terminal.

```bash
pkg update
pkg install nodejs-lts git
```

Download/clone this project, then:

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in your actual values:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SECRET
OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY
OPENROUTER_MODEL=openrouter/free
APP_ORIGIN=http://localhost:3000
SESSION_TOKEN_DAYS=30
```

Access tokens expire after 30 days and are rotated when a conversation is recovered. Recovery attempts are throttled in Supabase to five attempts per IP/session key per 15 minutes.

Start locally:

```bash
npm run dev
```

Open the local address shown by Vercel CLI (normally http://localhost:3000).

## 4. Deploy with GitHub + Vercel

1. Create a GitHub repository, for example `klinsmd-4-pro-iv`.
2. Upload the project files and folders to the repository. Do not upload `.env`.
3. In Vercel choose **Add New → Project**, import your GitHub repository.
4. Framework preset: **Other**. Root directory: `./`.
5. Add these Environment Variables in Vercel → Project → Settings → Environment Variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL` = `openrouter/free`
   - `APP_ORIGIN` = your exact deployed origin, e.g. `https://your-project.vercel.app`
6. Deploy. After deployment, open `/api/health`. It should return `{"ok":true,"configured":true,"missing":[]}`.
7. If you change environment variables, redeploy.

## 5. Test checklist

- Create a Girl chat and save all three credentials.
- Submit a Kiswahili message and check the reply.
- Refresh the page: the same session should load.
- Open the site in a private/incognito browser and use recovery credentials: the same history should return.
- Click New Conversation: it should return to the welcome screen and never auto-load the previous chat.
- Create another chat: confirm it has a different identity and history.
- Delete the active chat: it should no longer be recoverable.
- Inspect GitHub: verify no `.env` or API key was committed.

## 6. Troubleshooting

- **`Server is not configured`**: one or more Vercel environment variables are missing or the deployment needs a redeploy.
- **AI unavailable**: free model capacity/rate limits vary. Try again later or select a currently listed `:free` model in `OPENROUTER_MODEL`.
- **Supabase insert/read errors**: rerun the schema and confirm the server uses the correct project URL and secret key.
- **Origin not allowed**: set `APP_ORIGIN` to the exact deployed origin, with no trailing slash, then redeploy.
- **Vercel 404**: confirm `vercel.json`, `api/index.js`, and `public/index.html` are at the repository root in the expected folders.

## Architecture

```text
Browser (public/)
   |
   | HTTPS /api/*
   v
Vercel Node Function (api/index.js / Express)
   |                         |
   | Supabase server key     | OpenRouter API key
   v                         v
Supabase Postgres         OpenRouter AI
(conversation records)    (chat completion)
```

## Notes / production hardening

This is a functional starter implementation, not a security audit. Before sharing widely:
- Add persistent IP/session recovery throttling and abuse monitoring.
- Add expiry/rotation for access tokens and a session revocation flow.
- Consider Supabase Auth for user-owned accounts and multi-device management.
- Add automated tests, error monitoring, backup/retention policies and a privacy notice.
- Do not promise that an AI can accurately know someone's feelings; its interest/tone labels are tentative interpretations.

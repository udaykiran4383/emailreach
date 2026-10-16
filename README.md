# 📧 EmailReach - Mass Email Outreach Platform

A production-ready, full-stack SaaS application for creating, sending, and tracking personalized email campaigns with Gmail integration.

> **Status**: ✅ Production Ready | **Tech**: Next.js 16 + Supabase + Gmail API

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone <your-repo>
cd email-outreach-app
npm install
```

### 2. Environment Setup
Create `.env.local`:
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-key
SUPABASE_SERVICE_ROLE_KEY=your-key
NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL=http://localhost:3000/auth/callback

# Gmail OAuth (from Google Cloud Console)
GMAIL_CLIENT_ID=your-id
GMAIL_CLIENT_SECRET=your-secret
GMAIL_REDIRECT_URI=http://localhost:3000/api/gmail/callback

# Optional: Set to 'true' for personal templates (dev only)
# NEXT_PUBLIC_USE_PERSONAL_TEMPLATES=true

# Optional: mailbox verification (first one configured wins)
# Self-hosted Reacher: docker run -p 8080:8080 reacherhq/backend:latest
# REACHER_URL=http://localhost:8080
# REACHER_SECRET=your-reacher-secret     # sent as x-reacher-secret header
# EMAIL_VERIFIER_API_KEY=your-millionverifier-key
# ENABLE_SMTP_VERIFY=true                # local SMTP RCPT probe

# Optional: Hunter.io for finding HR / CEO / CTO / tech lead emails
# HUNTER_API_KEY=your-hunter-key
```

> **Reacher needs outbound port 25.** Most home ISPs and serverless hosts (Vercel, Netlify) block it, so
> Reacher can't reach mail servers from there and every check comes back `unknown`. Run the container
> on a VPS that allows port 25 and point `REACHER_URL` at it (set `REACHER_SECRET` so it isn't open to everyone).
> If Reacher is unreachable, verification falls back to MillionVerifier, then the SMTP probe, then MX-only checks.

### 3. Start Development
```bash
npm run dev
# Open http://localhost:3000
```

### 4. Run Database Migration
Execute `/scripts/01_create_schema.sql` in Supabase SQL Editor.

---

## ✨ Features

- ✅ **User Authentication** - Sign up, login with Supabase Auth
- ✅ **Campaign Management** - Create, edit, send email campaigns
- ✅ **Email Templates** - Personalized with `{{name}}`, `{{company}}`, `{{role}}` variables
- ✅ **Gmail Integration** - OAuth 2.0 to send via your Gmail
- ✅ **CSV Upload** - Bulk upload recipients
- ✅ **Analytics Dashboard** - Track sent, failed, replied, and reply rates
- ✅ **Reply Detection** - Automatic sync of email responses
- ✅ **Follow-up Automation** - Configure automatic follow-up emails
- ✅ **Email Verification** - Skip risky/invalid email addresses

---

## 🏗️ Tech Stack

- **Frontend**: React 19, Next.js 16, TypeScript
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL) with RLS
- **Auth**: Supabase Auth + Gmail OAuth 2.0
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Deployment**: Vercel-ready

---

## 📁 Project Structure

```
email-outreach-app/
├── app/
│   ├── page.tsx              # Landing page
│   ├── auth/                 # Login, Signup, Callback
│   ├── dashboard/            # Main app
│   │   ├── campaigns/[id]/   # Campaign detail
│   │   └── settings/         # Gmail connection
│   └── api/                  # API routes
├── lib/
│   ├── supabase/             # Supabase clients
│   ├── auth/                 # Auth helpers
│   ├── email/                # Email sending logic
│   ├── gmail/                # Gmail API wrapper
│   └── config/               # Template configs
├── components/ui/            # shadcn/ui components
├── scripts/                  # SQL migrations
└── proxy.ts                  # Auth proxy (Next 16 "middleware")
```

---

## 🚀 Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

### Production vs Personal Templates
- **Production**: Don't set `NEXT_PUBLIC_USE_PERSONAL_TEMPLATES` (shows generic templates)
- **Personal**: Set to `true` in `.env.local` (shows your custom templates)

---

## 📊 Database Schema

| Table | Purpose |
|-------|---------|
| `campaigns` | Campaign metadata and templates |
| `email_recipients` | Recipients per campaign |
| `gmail_credentials` | OAuth tokens |
| `email_logs` | Event tracking |
| `blocked_emails` | Invalid email addresses |
| `replies` | Detected replies |

All tables have Row Level Security (RLS) enabled.

---

## 🛠️ Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

---

## 📄 License

MIT

---

**Ready to send?** Start at `http://localhost:3000` 🚀

---

## ⏱️ Background sending (Chronos scheduler)

EmailReach sends drip-style, with a random delay between emails, a daily cap and a send window, so a campaign can run
for hours. Serverless functions can't stay running that long, so something has to call `GET /api/cron` regularly.
The vendored [Chronos](scheduler/README.md) scheduler in `scheduler/` does that.

Set a secret in the app's `.env.local`:

```bash
CRON_SECRET=some-long-random-string   # /api/cron rejects calls without it
```

**Lite mode** (recommended for local or a single server). It runs one process with no extra infrastructure:

```bash
npm run scheduler:install
cp scheduler/.env.example scheduler/.env   # same CRON_SECRET; EMAILREACH_URL=http://localhost:3000
npm run scheduler:lite
```

**Full mode** runs etcd leader election, Kafka-distributed workers, Redis idempotency and Prometheus metrics:

```bash
cd scheduler && CRON_SECRET=... docker compose -f deploy/docker-compose.yml up --build
```

| Variable | Default | Purpose |
|---|---|---|
| `EMAILREACH_URL` | `http://localhost:3000` | App URL (`http://host.docker.internal:3000` from Docker) |
| `CRON_SECRET` | — | Must match the app |
| `EMAILREACH_TICK_SECONDS` | `60` | Polling interval. The app still enforces its own limits and delays. |

A hosted alternative is any external cron (for example cron-job.org) that calls
`/api/cron` every minute with the header `Authorization: Bearer $CRON_SECRET`.

---

## 🧹 Inbox Cleanup

**Dashboard → Inbox Cleanup** bulk-cleans old marketing mail from the connected Gmail account.

- **Scan mailbox** shows approximate counts (Gmail estimates) for Promotions, Social, old Updates, Forums, Newsletters, old unread, large & old, and very old non-Primary mail, with an optional age filter.
- **Review senders** groups a 500-message sample by sender so you can trash only specific senders; **Move all to Trash** cleans a whole category.
- Mail is moved to **Trash**, never permanently deleted (Gmail empties Trash after 30 days). Every action has an **Undo** that restores the same messages.
- Never touched: starred, important, sent, drafts, chats, anything labelled `emailreach-keep`, your own address, and every campaign contact who replied.

**Setup:** cleanup needs the `https://www.googleapis.com/auth/gmail.modify` scope (it replaces `gmail.readonly`; it cannot permanently delete). Add it to your Google Cloud OAuth consent screen's scopes, then **reconnect Gmail** in Settings — existing connections only have read access and the app will prompt you to reconnect.

---

## 🧪 Testing

| Command | What it runs |
|---|---|
| `npm run test:unit` | Vitest unit tests for the pure `lib/` logic (verification, extraction, spam check, sequences, jobs, AI reply rules, tokens…). No network, ~1s. |
| `npm run test:coverage` | Same, with a coverage report in `coverage/`. |
| `npm run typecheck` | `tsc --noEmit` over the app. |
| `npm run test:e2e` | Playwright end-to-end suite against a throwaway local Postgres + PostgREST, a fake Supabase auth/storage gateway, and mocked Gmail, Claude, job boards and company sites. Never sends real email. Needs `postgresql@17` and `postgrest` (`brew install postgresql@17 postgrest`), or set `E2E_PG_BIN` / `E2E_POSTGREST_BIN` to other binaries. |

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests and a production build on every push and PR, builds `scheduler/` and `mcp/`, then runs the full e2e suite on Ubuntu (runner's PostgreSQL + a pinned PostgREST release).

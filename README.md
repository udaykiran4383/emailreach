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
```

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
└── middleware.ts             # Auth middleware
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

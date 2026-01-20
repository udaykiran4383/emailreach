# EmailReach - Mass Email Outreach Platform Setup Guide

## Overview

EmailReach is a production-ready mass email outreach application built with Next.js, Supabase, and Gmail API. It enables users to create, manage, and track email campaigns with reply tracking, analytics, and automated follow-ups.

## Prerequisites

1. **Supabase Project**: You need a Supabase account and project
2. **Gmail API Credentials**: OAuth 2.0 credentials for Gmail API
3. **Node.js 18+**: For running the application

## Installation

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd emailreach
npm install
```

### 2. Environment Variables Setup

Create a `.env.local` file in the project root with the following variables:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Gmail OAuth Configuration
GMAIL_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-google-client-secret
GMAIL_REDIRECT_URI=http://localhost:3000/api/gmail/callback

# Dev Redirect URL (for local testing)
NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL=http://localhost:3000/auth/callback
```

### 3. Gmail API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Web application)
5. Add authorized redirect URIs:
   - `http://localhost:3000/api/gmail/callback` (development)
   - `https://your-domain.com/api/gmail/callback` (production)
6. Copy the Client ID and Client Secret

### 4. Supabase Configuration

The database schema is automatically set up in `/scripts/01_create_schema.sql`. The migration includes:

- **campaigns** table: Store email campaigns
- **email_recipients** table: Store recipient information with tracking
- **gmail_credentials** table: Securely store OAuth credentials
- **email_logs** table: Track email events (sent, opened, replied, etc.)

All tables have Row Level Security (RLS) enabled to ensure users can only access their own data.

## Features

### 1. Authentication
- Email/password authentication via Supabase
- Secure token management with automatic refresh
- Protected routes via middleware

### 2. Campaign Management
- Create, edit, and delete campaigns
- Define email templates with personalization variables
- Track campaign status (draft, scheduled, sent, archived)

### 3. Email Upload & Preview
- Upload recipient lists via CSV
- Support for custom variables (name, company, role)
- Email preview with real-time personalization

### 4. Gmail Integration
- OAuth 2.0 authentication with Gmail
- Send emails through user's Gmail account
- Secure credential storage

### 5. Email Sending
- Batch email sending with personalization
- Automatic template variable substitution
- Error handling and retry logic
- Message ID tracking for reply detection

### 6. Reply Tracking
- Automatic tracking of email replies
- Reply detection via Gmail thread analysis
- Reply rate analytics

### 7. Analytics Dashboard
- Real-time campaign statistics
- Open rate tracking
- Reply rate analysis
- Send status breakdown
- Performance charts

### 8. Automated Follow-ups
- Configurable follow-up delays per campaign
- Automatic follow-up email sending
- Follow-up reply tracking

## Project Structure

```
emailreach/
├── app/
│   ├── auth/                    # Authentication pages
│   │   ├── login/
│   │   ├── signup/
│   │   └── callback/
│   ├── api/                     # API routes
│   │   ├── campaigns/          # Campaign endpoints
│   │   ├── gmail/              # Gmail OAuth endpoints
│   │   └── ...
│   ├── dashboard/              # Protected dashboard
│   │   ├── campaigns/          # Campaign pages
│   │   ├── settings/           # Gmail settings
│   │   └── components/
│   ├── globals.css             # Global styles
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Homepage
├── lib/
│   ├── supabase/              # Supabase client utilities
│   ├── auth/                  # Authentication helpers
│   ├── email/                 # Email sending & tracking
│   ├── gmail/                 # Gmail API client
│   └── templates.ts           # Template utilities
├── components/                 # Reusable components
├── scripts/                    # Database migrations
├── proxy.ts                    # Auth middleware
└── package.json
```

## Development

### Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Database Migrations

Run SQL migrations from the scripts folder:

```bash
# Database schema is auto-created on first setup
```

## Deployment

### Vercel Deployment

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add environment variables in Vercel settings
4. Deploy!

### Production Gmail OAuth

Update these values in production:

```env
GMAIL_REDIRECT_URI=https://your-domain.com/api/gmail/callback
NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URI=https://your-domain.com/auth/callback
```

## API Endpoints

### Campaigns
- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns` - List user's campaigns
- `DELETE /api/campaigns/[id]` - Delete campaign

### Recipients
- `POST /api/campaigns/[id]/recipients` - Upload recipients
- `GET /api/campaigns/[id]/recipients` - List recipients

### Email Sending
- `POST /api/campaigns/[id]/send` - Send campaign

### Analytics
- `GET /api/campaigns/[id]/analytics` - Get campaign analytics

### Gmail
- `GET /api/gmail/auth` - Start OAuth flow
- `GET /api/gmail/callback` - OAuth callback
- `GET /api/gmail/credentials` - List connected Gmail accounts
- `DELETE /api/gmail/credentials/[id]` - Disconnect Gmail account

### Follow-ups
- `POST /api/campaigns/[id]/follow-ups` - Send follow-up emails
- `GET /api/campaigns/[id]/follow-ups` - Get follow-up statistics

## Security Considerations

1. **Row Level Security**: All database tables use RLS to ensure users can only access their own data
2. **Environment Variables**: Sensitive keys are stored securely and never exposed to the client
3. **OAuth Tokens**: Gmail refresh tokens are encrypted in the database
4. **Input Validation**: All user inputs are validated before processing
5. **CORS**: API routes enforce proper CORS headers

## Troubleshooting

### Gmail OAuth Issues
- Ensure redirect URI matches exactly in Google Cloud Console
- Check that Gmail API is enabled in Google Cloud Console
- Verify OAuth credentials are correctly set in environment variables

### Database Connection Issues
- Verify Supabase URL and keys are correct
- Check that RLS policies allow the operation
- Review browser console for detailed error messages

### Email Sending Issues
- Ensure Gmail account is connected via Settings page
- Verify recipients have valid email addresses
- Check spam folder for sent emails

## Support

For issues or questions, check the repository issues page or contact support.

## License

MIT License - see LICENSE file for details

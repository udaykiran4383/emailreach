# EmailReach Architecture Overview

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                       │
├─────────────────────────────────────────────────────────────┤
│ Pages:                                                        │
│ ├─ app/page.tsx (Landing)                                   │
│ ├─ app/auth/login/page.tsx                                  │
│ ├─ app/auth/signup/page.tsx                                 │
│ ├─ app/auth/callback/route.ts                               │
│ ├─ app/dashboard/page.tsx                                   │
│ ├─ app/dashboard/layout.tsx                                 │
│ ├─ app/dashboard/settings/page.tsx                          │
│ └─ app/dashboard/campaigns/[id]/page.tsx                    │
│                                                               │
│ Components:                                                   │
│ ├─ DashboardClient (state management)                       │
│ ├─ CampaignList (campaign listing)                          │
│ ├─ CreateCampaignModal (campaign creation)                  │
│ ├─ RecipientUpload (CSV upload)                             │
│ ├─ EmailPreview (template preview)                          │
│ ├─ CampaignAnalytics (metrics dashboard)                    │
│ ├─ GmailSettings (OAuth integration)                        │
│ └─ Navbar (navigation)                                      │
└─────────────────────────────────────────────────────────────┘
                           ↕️
┌─────────────────────────────────────────────────────────────┐
│              API Routes (Next.js Server)                     │
├─────────────────────────────────────────────────────────────┤
│ Campaigns:                                                    │
│ ├─ POST /api/campaigns (create)                             │
│ ├─ GET /api/campaigns (list)                                │
│ ├─ GET/DELETE /api/campaigns/[id]                           │
│ ├─ POST /api/campaigns/[id]/send (send emails)              │
│ ├─ POST /api/campaigns/[id]/recipients (upload)             │
│ ├─ GET /api/campaigns/[id]/analytics (metrics)              │
│ └─ POST /api/campaigns/[id]/follow-ups (automation)         │
│                                                               │
│ Gmail OAuth:                                                  │
│ ├─ GET /api/gmail/auth (initiate OAuth)                     │
│ ├─ GET /api/gmail/callback (handle callback)                │
│ ├─ GET/POST /api/gmail/credentials (manage)                 │
│ └─ DELETE /api/gmail/credentials/[id]                       │
└─────────────────────────────────────────────────────────────┘
                           ↕️
┌─────────────────────────────────────────────────────────────┐
│              Business Logic (Services)                       │
├─────────────────────────────────────────────────────────────┤
│ lib/auth/actions.ts (authentication)                         │
│ lib/email/sender.ts (email personalization & sending)        │
│ lib/email/tracker.ts (tracking & analytics)                  │
│ lib/email/follow-ups.ts (follow-up automation)               │
│ lib/gmail/client.ts (Gmail API wrapper)                      │
│ lib/templates.ts (template utilities)                        │
└─────────────────────────────────────────────────────────────┘
                           ↕️
┌─────────────────────────────────────────────────────────────┐
│         Supabase (Database & Authentication)                 │
├─────────────────────────────────────────────────────────────┤
│ Tables:                                                       │
│ ├─ auth.users (via Supabase Auth)                           │
│ ├─ campaigns                                                 │
│ ├─ email_recipients                                          │
│ ├─ gmail_credentials                                         │
│ └─ email_logs                                                │
│                                                               │
│ Indexes (Performance):                                       │
│ ├─ campaigns(user_id, status)                               │
│ ├─ email_recipients(campaign_id, status, email)             │
│ ├─ gmail_credentials(user_id)                               │
│ └─ email_logs(recipient_id, event_type)                     │
│                                                               │
│ Security (RLS):                                              │
│ ├─ Users see only their campaigns                           │
│ ├─ Users see only their recipients                          │
│ ├─ Users see only their Gmail credentials                   │
│ └─ Users see only their email logs                          │
└─────────────────────────────────────────────────────────────┘
                           ↕️
┌─────────────────────────────────────────────────────────────┐
│           External Services (Gmail API)                      │
├─────────────────────────────────────────────────────────────┤
│ OAuth 2.0 (User authentication)                              │
│ Gmail API v1 (send emails)                                   │
│ Gmail labels/threads (reply detection)                       │
└─────────────────────────────────────────────────────────────┘
```

## 🔐 Security Architecture

### Authentication Flow
1. User signs up → Supabase Auth creates user
2. User confirms email → Redirected to /auth/callback
3. Callback route → Sets session cookie
4. Proxy middleware → Refreshes token on each request
5. Protected routes → Check user via getUser() action
6. Redirect to login if unauthorized

### Authorization (Row Level Security)
```sql
-- Campaigns: Only user can see their campaigns
WHERE auth.uid() = user_id

-- Email Recipients: Only through campaign ownership
WHERE campaign.user_id = auth.uid()

-- Gmail Credentials: One per user (UNIQUE constraint)
WHERE auth.uid() = user_id

-- Email Logs: Through recipient ownership
WHERE recipient.campaign.user_id = auth.uid()
```

### Gmail OAuth
1. User clicks "Connect Gmail"
2. Redirects to Google OAuth consent
3. User approves scopes (send, read)
4. Google redirects to /api/gmail/callback
5. Code exchanged for tokens
6. Tokens stored in gmail_credentials table (encrypted at rest by Supabase)
7. Tokens used to send emails via Gmail API

## 📊 Data Models

### Campaigns
- Stores campaign metadata and templates
- Tracks status (draft → scheduled → sent → archived)
- One-to-many relationship with email_recipients

### Email Recipients
- Individual recipients per campaign
- Tracks personalization variables (name, company, role)
- Tracks status: pending → sent → replied
- Stores Gmail message/thread IDs for tracking

### Gmail Credentials
- One credential set per user
- Encrypted storage of access_token and refresh_token
- Expiry tracking for token refresh

### Email Logs
- Event tracking (sent, opened, replied, failed, follow_up_sent)
- Timestamp and metadata per event
- Used for analytics and debugging

## 🔄 Email Sending Flow

```
User clicks "Send Now"
    ↓
API validates campaign ownership
    ↓
Fetch Gmail credentials
    ↓
Fetch pending recipients
    ↓
For each recipient:
    ├─ Personalize template
    ├─ Create Gmail message
    ├─ Send via Gmail API
    ├─ Store message ID
    ├─ Update status to "sent"
    └─ Log event
    ↓
Update campaign status to "sent"
    ↓
Return summary (sent_count, failed_count)
```

## 📈 Analytics Pipeline

```
Campaign Status:
├─ Total Recipients
├─ Sent Count
├─ Failed Count
├─ Reply Count
└─ Reply Rate (%) = (Reply Count / Sent Count) * 100

Recipient Breakdown:
├─ Pending (not sent yet)
├─ Sent (awaiting reply)
├─ Replied (responded)
└─ Failed (send error)

Timeline:
├─ Sent At (timestamp)
├─ Replied At (timestamp)
├─ Follow-up Sent At
└─ Days Since Send
```

## 🚀 Deployment Architecture

### Local Development
```
Frontend + Backend (Next.js)
    ↓
Local Supabase (or cloud)
    ↓
Gmail API (via OAuth)
```

### Production (Vercel)
```
Vercel Functions (Frontend + API)
    ↓
Supabase (Cloud)
    ↓
Gmail API
```

### Environment Setup
```
Frontend (.env.local):
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL

Backend (Function Secrets):
- SUPABASE_SERVICE_ROLE_KEY
- GMAIL_CLIENT_ID
- GMAIL_CLIENT_SECRET
- GMAIL_REDIRECT_URI
```

## 🔧 Performance Optimizations

### Database
- Indexes on frequently queried columns (user_id, status)
- RLS policies prevent unnecessary rows
- Pagination ready (add LIMIT/OFFSET)

### API
- Server-side filtering (RLS)
- Selective column queries (.select())
- Connection pooling via Supabase

### Frontend
- Server-rendered pages where possible
- Client components only for interactive elements
- SWR-ready fetch patterns (can add swr library)

## 📝 Error Handling Strategy

### Client Side
- Toast notifications for user feedback
- Error boundaries in components
- Validation before API calls

### Server Side
- Try-catch blocks in API routes
- Supabase error handling
- Meaningful error messages
- Proper HTTP status codes (400, 401, 404, 500)

### Gmail API
- Token refresh on expiry
- Retry logic for failed sends
- Error logging to email_logs table

## 🔄 Future Enhancement Points

1. **Queue System**: Add Bull or RabbitMQ for async email sending
2. **Webhooks**: Gmail webhooks for automatic reply detection
3. **Multi-account**: Support multiple Gmail accounts per user
4. **Templates Library**: Pre-built email templates
5. **A/B Testing**: Split test subject lines
6. **Scheduled Sends**: Background job processor
7. **Bounce Handling**: Automatic bounced recipient detection
8. **Compliance**: GDPR/CAN-SPAM audit trail
9. **Integrations**: Slack, Zapier, Make.com connectors
10. **Analytics Export**: CSV/PDF reports

## 📚 Tech Stack Summary

- **Frontend**: React 19, Next.js 16 (App Router), TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui components
- **Backend**: Next.js API Routes, TypeScript
- **Database**: Supabase (PostgreSQL), RLS
- **Auth**: Supabase Auth + OAuth 2.0
- **Email**: Gmail API v1
- **Deployment**: Vercel
- **Package Manager**: npm

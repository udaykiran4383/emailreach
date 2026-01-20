# EmailReach - Troubleshooting Guide

## 🔴 Critical Issues & Solutions

### 1. "Module not found: Can't resolve '@supabase/ssr'"
**Cause**: Missing dependency  
**Solution**:
```bash
npm install @supabase/ssr
```

### 2. "Module not found: Can't resolve 'googleapis'"
**Cause**: Missing Gmail API package  
**Solution**:
```bash
npm install googleapis
```

### 3. Blank page after login (redirect loop)
**Cause**: Proxy/middleware not refreshing session  
**Solution**:
- Check that `proxy.ts` exists (not `middleware.ts`)
- Verify matcher pattern includes dashboard routes
- Check Supabase credentials are correct

### 4. "NEXT_PUBLIC_SUPABASE_URL is empty"
**Cause**: Environment variables not set  
**Solution**:
```bash
# In .env.local (development)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# In Vercel dashboard (production)
# Add same variables in Settings → Environment Variables
```

### 5. "RLS policy violation" when creating campaign
**Cause**: User ID not matching or RLS policy too restrictive  
**Solution**:
- Ensure user is authenticated (check auth.uid())
- Verify RLS policy exists: `SELECT * FROM information_schema.table_constraints WHERE table_name='campaigns'`
- Manually test with SQL editor in Supabase dashboard

### 6. Gmail connection returns "Unauthorized"
**Cause**: Wrong OAuth credentials or redirect URI  
**Solution**:
- Verify `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` are correct
- Check `GMAIL_REDIRECT_URI` matches Google Console settings
- Ensure OAuth consent screen is configured in Google Cloud Console
- Test redirect URI format: `http://localhost:3000/api/gmail/callback` (dev) or `https://your-domain.com/api/gmail/callback` (prod)

### 7. "Campaign not found" when viewing campaign
**Cause**: Campaign ID doesn't exist or RLS blocking access  
**Solution**:
- Check campaign ID in URL is correct UUID format
- Verify campaign is owned by current user
- Check RLS policy: `SELECT * FROM campaigns WHERE id = 'campaign-id'`

### 8. CSV upload fails silently
**Cause**: File encoding or format issue  
**Solution**:
- Ensure CSV headers: `email,name,company,role`
- Use UTF-8 encoding
- Test with sample CSV:
```csv
email,name,company,role
john@example.com,John Doe,Acme Corp,CEO
jane@example.com,Jane Smith,TechCorp,CTO
```

### 9. Emails not sending after clicking "Send Now"
**Cause**: Gmail credentials not connected or no pending recipients  
**Solution**:
- Check Gmail account is connected in settings
- Verify recipients uploaded with "pending" status
- Check email templates are filled in (subject, body)
- Look at logs in Supabase → email_logs table

### 10. TypeScript errors about async params
**Cause**: Next.js 16 requires awaiting params  
**Solution**:
```typescript
// ❌ Wrong
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const id = params.id

// ✅ Correct
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
```

---

## 🟡 Common Issues & Solutions

### Sign up page shows "User already exists"
**Cause**: Email already registered  
**Solution**:
- Use different email address, or
- Reset user in Supabase dashboard → Authentication → Users

### Campaign saves but doesn't appear in list
**Cause**: RLS policy or refresh timing  
**Solution**:
- Manually refresh page (F5)
- Check dashboard console for errors
- Verify campaign in Supabase → campaigns table

### "Unauthorized" error on dashboard
**Cause**: Session expired or missing auth cookie  
**Solution**:
- Sign in again
- Check browser cookies include `sb-` cookies
- Verify NEXT_PUBLIC_SUPABASE_URL is correct

### Analytics show 0 recipients
**Cause**: Recipients not uploaded or wrong campaign ID  
**Solution**:
- Check email_recipients table has rows for campaign
- Verify recipients have status 'sent' or 'replied'
- Query: `SELECT COUNT(*) FROM email_recipients WHERE campaign_id = 'id'`

### Gmail "Invalid Credentials" error
**Cause**: Access token expired or invalid  
**Solution**:
- Disconnect and reconnect Gmail account
- Check token_expiry in gmail_credentials table
- Implement token refresh in sender.ts (currently basic)

### Follow-ups not sending
**Cause**: Follow-up automation not running (no cron job)  
**Solution**:
- Currently requires manual trigger or external cron (e.g., EasyCron)
- Endpoint: `POST /api/campaigns/[id]/follow-ups`
- Set up with: `node scripts/send-followups.js` (you'll need to create this)

### Dashboard navbar not showing
**Cause**: Component not imported or layout issue  
**Solution**:
- Check navbar.tsx exists at `/app/dashboard/components/navbar.tsx`
- Verify import in dashboard/layout.tsx: `import DashboardNavbar from './components/navbar'`
- Check component is rendering in layout

### Recipient email shows "undefined"
**Cause**: Recipient object missing email field  
**Solution**:
- Verify CSV has email column
- Check email_recipients table schema
- Query: `SELECT id, email FROM email_recipients LIMIT 1`

---

## 🟢 Performance Issues

### Dashboard slow to load
**Cause**: Too many campaigns or missing indexes  
**Solution**:
- Add indexes (already in schema):
```sql
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_email_recipients_campaign_id ON email_recipients(campaign_id);
```
- Implement pagination in dashboard-client.tsx
- Use `.select('id,name,status,created_at')` instead of `*`

### Email sending slow
**Cause**: Sequential sending for many recipients  
**Solution**:
- Current: Sends 1 at a time (safe for Gmail limits)
- Future: Implement job queue (Bull, RabbitMQ, Inngest)
- Add rate limiting per recipient

### High database queries
**Cause**: N+1 queries or missing `.select()`  
**Solution**:
- Use explicit `.select('columns')` not `*`
- Join queries when possible
- Monitor in Supabase → Query Performance

---

## 🔧 Development Debugging

### Enable Debug Logging
```typescript
// In lib/auth/actions.ts or api routes
console.log("[v0] User:", user)
console.log("[v0] Campaign:", campaign)
console.log("[v0] Gmail credentials:", gmailCredential)
```

### Test Database Queries
```bash
# Supabase SQL Editor
SELECT * FROM campaigns WHERE user_id = 'your-user-id' LIMIT 1;
SELECT COUNT(*) FROM email_recipients WHERE campaign_id = 'campaign-id';
```

### Test API Endpoints
```bash
# Test campaign creation
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","subject":"Hello","body":"Body"}'

# Test campaign list
curl http://localhost:3000/api/campaigns
```

### Check Authentication
```typescript
// In any page.tsx
const user = await getUser()
console.log("[v0] Current user:", user)
```

---

## 📋 Pre-Deployment Checklist

- [ ] All environment variables set in Vercel
- [ ] Database migrations executed (`scripts/01_create_schema.sql`)
- [ ] Gmail OAuth credentials created in Google Cloud Console
- [ ] GMAIL_REDIRECT_URI updated to production domain
- [ ] Supabase project set to production region
- [ ] RLS policies reviewed and tested
- [ ] Test account created and email verified
- [ ] Gmail connection tested in staging
- [ ] Sample campaign created and sent
- [ ] Analytics page loads without errors
- [ ] Sign out works correctly
- [ ] No console errors in browser DevTools

---

## 🆘 Emergency Troubleshooting

### If everything is broken:

1. **Check Supabase connection**
   ```bash
   # Verify credentials
   echo $NEXT_PUBLIC_SUPABASE_URL
   echo $NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```

2. **Check database schema**
   ```sql
   -- Supabase SQL Editor
   SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public';
   ```

3. **Check auth state**
   - Supabase Dashboard → Authentication → Users
   - Should see your test user(s)

4. **Check network requests**
   - Browser DevTools → Network tab
   - Look for failed API requests
   - Check request/response details

5. **Reset everything**
   - Delete test user in Supabase
   - Clear browser cookies and cache
   - Restart dev server: `npm run dev`
   - Sign up again from scratch

---

## 📞 Getting Help

1. **Check logs**
   - Browser console: `F12`
   - Server logs: Terminal where `npm run dev` runs
   - Supabase logs: Dashboard → Logs

2. **Review documentation**
   - Supabase: https://supabase.com/docs
   - Gmail API: https://developers.google.com/gmail/api
   - Next.js: https://nextjs.org/docs

3. **Test in isolation**
   - Create test file: `test-api.ts`
   - Test database query directly
   - Test Gmail API separately

4. **Ask for help**
   - Include error message
   - Share relevant code snippet
   - Specify which step fails

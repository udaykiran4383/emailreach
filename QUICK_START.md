# ⚡ EmailReach - Quick Start (5 Minutes)

## 1️⃣ Set Environment Variables

Create `.env.local`:
```bash
# Supabase - Get from Dashboard
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-KEY
NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL=http://localhost:3000/auth/callback

# Gmail - Get from Google Cloud Console
GMAIL_CLIENT_ID=YOUR-CLIENT-ID
GMAIL_CLIENT_SECRET=YOUR-CLIENT-SECRET
GMAIL_REDIRECT_URI=http://localhost:3000/api/gmail/callback
```

## 2️⃣ Start the App

```bash
npm run dev
# Open http://localhost:3000
```

## 3️⃣ Run Database Migration

**Option A: Automatic** (Supabase cloud)
- Database tables auto-create on first query

**Option B: Manual** (SQL Editor)
- Copy `/scripts/01_create_schema.sql`
- Paste in Supabase SQL Editor
- Execute

## 4️⃣ Test Sign Up

```
1. Click "Get Started"
2. Enter email: test@example.com
3. Enter password: (8+ chars)
4. Click "Sign Up"
5. Verify email (check inbox)
6. Click verification link
7. Redirected to dashboard
✅ Success!
```

## 5️⃣ Create First Campaign

```
1. Click "+ New Campaign"
2. Enter:
   - Name: "Welcome Email"
   - Subject: "Hello {{name}}!"
   - Body: "Welcome to {{company}}"
3. Click "Create"
4. Click on campaign
✅ Success!
```

## 6️⃣ Connect Gmail

```
1. Go to Settings
2. Click "Connect Gmail"
3. Choose account
4. Click "Allow"
5. See "Connected: your@gmail.com"
✅ Success!
```

## 7️⃣ Upload Recipients

```
1. On campaign page, click Recipients tab
2. Create CSV file:
   email,name,company
   john@test.com,John,Acme
   jane@test.com,Jane,TechCorp

3. Upload file
4. See recipients listed
✅ Success!
```

## 8️⃣ Send Email

```
1. On campaign page, click Preview tab
2. See template preview
3. Click "Send Now"
4. See "Emails sent: 2"
5. Check Gmail (Sent folder)
✅ Success!
```

## 9️⃣ View Analytics

```
1. Click Analytics tab
2. See:
   - Sent: 2
   - Replies: 0
   - Reply Rate: 0%
✅ Success!
```

---

## 🔗 Important URLs

| Page | URL |
|------|-----|
| Landing | http://localhost:3000 |
| Sign Up | http://localhost:3000/auth/signup |
| Sign In | http://localhost:3000/auth/login |
| Dashboard | http://localhost:3000/dashboard |
| Campaign | http://localhost:3000/dashboard/campaigns/[ID] |
| Settings | http://localhost:3000/dashboard/settings |

---

## 📁 Key Files to Know

| File | Purpose |
|------|---------|
| `app/page.tsx` | Landing page |
| `app/dashboard/page.tsx` | Main dashboard |
| `lib/auth/actions.ts` | Login/signup logic |
| `lib/email/sender.ts` | Email sending |
| `app/api/campaigns/route.ts` | Campaign API |
| `scripts/01_create_schema.sql` | Database setup |
| `proxy.ts` | Session refresh |

---

## 🔧 Debugging Commands

```bash
# See logs in terminal
npm run dev

# Check database
# In Supabase SQL Editor:
SELECT * FROM campaigns LIMIT 1;
SELECT * FROM email_recipients LIMIT 1;

# Clear cache
rm -rf .next

# Reinstall packages
rm -rf node_modules
npm install
```

---

## ❌ Common Mistakes

| ❌ Don't | ✅ Do |
|---------|------|
| Forget `.env.local` | Set all env vars |
| Run migration manually | Let Supabase handle it |
| Use wrong redirect URI | Match Google Console settings |
| Skip email verification | Click verification link |
| Upload wrong CSV format | Use: email,name,company |

---

## ✅ Pre-Deployment Checklist

- [ ] All env vars set in Vercel
- [ ] Database schema created (run migration)
- [ ] Gmail OAuth credentials ready
- [ ] Test sign up works
- [ ] Test email sending works
- [ ] Gmail connection works
- [ ] Analytics loads
- [ ] No console errors

---

## 🚀 Deploy to Vercel

```bash
# 1. Push to GitHub
git add .
git commit -m "Initial commit"
git push origin main

# 2. In Vercel Dashboard:
# - Connect GitHub repo
# - Add environment variables
# - Deploy

# 3. Update in Google Cloud Console:
# - Add production redirect URI:
#   https://YOUR-VERCEL-DOMAIN.vercel.app/api/gmail/callback
```

---

## 📞 Help

- Read `SETUP_GUIDE.md` for detailed instructions
- Check `TROUBLESHOOTING.md` for common issues
- Review `ARCHITECTURE.md` for system design
- Use `VERIFICATION_CHECKLIST.md` to verify everything works

---

**You're all set! 🎉 Start with Step 1 and follow through Step 9.**

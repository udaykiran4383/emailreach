# EmailReach MCP server

Lets Claude (Claude Code, Claude Desktop, any MCP client) work with your EmailReach data:

| Tool | What it does |
|---|---|
| `list_campaigns` | Your campaigns with status and counts |
| `get_campaign_stats` | Sent / replies / opens / bounces for one campaign |
| `find_contacts` | HR, tech leads, CTOs, CEOs at up to 3 companies |
| `search_jobs` | Open roles at target companies |
| `add_recipients` | Add contacts to a campaign (does **not** send) |
| `get_pipeline` | Your application pipeline by stage |
| `list_replies` | Recent replies and their classification |

The token only works on those routes. It can't send email, change settings or touch your Gmail — sending always starts from the app.

## Setup

1. Run `scripts/13_resume_links.sql` in Supabase (creates the `api_tokens` table).
2. In EmailReach → Settings → **API tokens**, create a token and copy it (shown once).
3. Build the server:

   ```bash
   cd mcp && npm install && npm run build
   ```

4. Add it to Claude Code (from the repo root):

   ```bash
   claude mcp add emailreach \
     --env EMAILREACH_URL=http://localhost:3000 \
     --env EMAILREACH_TOKEN=erk_your_token \
     -- node mcp/dist/index.js
   ```

   Or in a JSON MCP config (Claude Desktop, `.mcp.json`):

   ```json
   {
     "mcpServers": {
       "emailreach": {
         "command": "node",
         "args": ["/absolute/path/to/emailreach/mcp/dist/index.js"],
         "env": {
           "EMAILREACH_URL": "http://localhost:3000",
           "EMAILREACH_TOKEN": "erk_your_token"
         }
       }
     }
   }
   ```

Then ask things like *"find the CTO and HR contacts at acme.com and stripe.com and add the verified ones to my Backend Roles campaign"*.

## Notes

- With `SUPABASE_JWT_SECRET` set in the app's env (Supabase → Settings → API → JWT secret), token requests run under row-level security exactly like a logged-in session. Without it, the app falls back to the service-role client on these routes, which all filter by your user id.
- Revoke a token any time from Settings; `last used` shows when it was last called.

# Stratos VP CRM — Deployment Runbook (App Engine)

**This is the active plan.** The Cloud Run version is in `DEPLOY.md` and is
blocked: it needs the `constraints/iam.allowedPolicyMemberDomains` org policy
relaxed, and nobody at Stratos currently holds the org-level role to do that.

App Engine serves publicly without needing that permission, so it sidesteps the
problem entirely. Same code, same Firebase project, same database, same login.

| Piece | Where it runs |
|---|---|
| React front end + Express API | App Engine Standard, one service |
| Firestore, Auth, Storage | Unchanged — project `gen-lang-client-0128987745` |

Note: Firebase Hosting is **not** used in this setup. App Engine serves the
static front end itself, which the Express server was already doing.

---

## Already done — don't redo

- Firestore and Storage rules deployed and enforcing @gostratos.vc access
- Blaze billing enabled
- gcloud CLI installed and authenticated
- Secrets stored in Secret Manager (kept as a backup copy of the values)

---

## Step 1 — Fill in env.yaml

Open `env.yaml` in the project folder and replace the two placeholders with
your real values:

```yaml
env_variables:
  API_KEY: "your Gemini API key"
  GOOGLE_CLIENT_SECRET: "your OAuth client secret starting GOCSPX-"
```

This file is gitignored and never committed.

There is deliberately **no** `FIREBASE_SERVICE_ACCOUNT` here. On App Engine the
server authenticates to Firestore using App Engine's own identity, so the
private key file isn't needed at all — one less secret to manage.

---

## Step 2 — Create the App Engine application (one time only)

```powershell
cd "$env:USERPROFILE\dev\CRM-APP-main"
```

```powershell
gcloud app create --region=us-central
```

**The region is permanent and cannot be changed later.** `us-central` is the
right choice unless you have a reason to be elsewhere.

If it says an application already exists, skip this step.

---

## Step 3 — Deploy

```powershell
gcloud app deploy app.yaml
```

It shows a summary and asks to continue — answer **Y**.

First deploy takes 5–10 minutes. It installs dependencies, runs the build, and
starts the server. It may ask to enable APIs along the way — answer **Y**.

When it finishes it prints your URL, which will be something like:

```
https://gen-lang-client-0128987745.uc.r.appspot.com
```

Test it:

```powershell
curl https://gen-lang-client-0128987745.uc.r.appspot.com/api/health
```

You want `{"status":"ok"}`.

---

## Step 4 — Let Google sign-in work on that URL

Firebase Console → **Authentication** → **Settings** → **Authorized domains**
→ **Add domain** → paste the appspot.com hostname from Step 3.

Without this, the site loads but sign-in fails.

---

## Step 5 — Test properly, before touching DNS

Open the appspot.com URL and check:

- Google sign-in works with your gostratos.vc account
- Companies and investors load
- You can add or edit something and it saves
- A page with the map still renders
- The AI features work (auto-populate from notes, company scan)

**This is the real checkpoint.** Nothing has changed for your users yet — the
AI Studio CRM is still running untouched.

---

## Step 6 — Point crm.gostratos.vc at it

1. Google Cloud Console → **App Engine** → **Settings** → **Custom domains**
2. **Add a custom domain** → `crm.gostratos.vc`
3. Verify ownership if prompted, then add the DNS records it gives you at
   whoever manages gostratos.vc DNS
4. SSL provisions automatically, usually within an hour

Then two more things, or sign-in breaks on the new domain:

**a)** Firebase Console → Authentication → Settings → Authorized domains →
add `crm.gostratos.vc`

**b)** https://console.cloud.google.com/apis/credentials → your Web OAuth
client → add:
- Authorized JavaScript origins: `https://crm.gostratos.vc`
- Authorized redirect URIs: `https://crm.gostratos.vc/auth/callback`

---

## Step 7 — Test again on the real domain

Same checks as Step 5. Once it passes, you're live and can stop using the
AI Studio link.

---

## Redeploying later

```powershell
cd "$env:USERPROFILE\dev\CRM-APP-main"
gcloud app deploy app.yaml
```

That's the whole thing — App Engine builds from source, so there's no separate
local build step.

To see logs when something misbehaves:

```powershell
gcloud app logs tail -s default
```

---

## Still outstanding

**The `/api` routes don't check who's calling.** Anyone who finds the URL can
call `/api/analyze` or `/api/sync-all-emails` and burn your Gemini quota. Your
CRM *data* is protected by the Firestore rules, but the endpoints are open.
The fix is middleware that verifies each caller's Firebase ID token. This is
the top item once you're live.

**Cold starts.** `min_instances` is 0, so the first request after a quiet
period takes a few seconds to wake up. If that annoys the team, change
`min_instances` to `1` in `app.yaml` and redeploy — it costs a few dollars a
month to keep one instance warm.

**The Cloud Run service** (`stratos-crm`) is deployed but unreachable. It costs
nothing sitting idle. Delete it once App Engine is proven:
`gcloud run services delete stratos-crm --region us-central1`

---

## Rolling back

The AI Studio deployment is untouched and still live. If App Engine misbehaves,
keep using the AI Studio link while we sort it out.

To roll back to a previous App Engine version:
`gcloud app versions list` then `gcloud app services set-traffic default --splits=VERSION_ID=1`

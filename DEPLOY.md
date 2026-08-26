> **STATUS: BLOCKED — see `DEPLOY-APPENGINE.md` for the active plan.**
>
> This Cloud Run setup is built and deployed but cannot be made publicly
> reachable: the org policy `constraints/iam.allowedPolicyMemberDomains`
> forbids granting `roles/run.invoker` to `allUsers`, and no one at Stratos
> currently holds the org-level role needed to change it. Kept here because
> everything works the moment that access is granted.

# Stratos VP CRM — Deployment Runbook

Migrated off Google AI Studio to Firebase Hosting + Cloud Run.
Everything runs in the **same** Firebase project you already use, so the
database, the user accounts, and the uploaded documents are untouched.

| Piece | Where it runs |
|---|---|
| React front end (static) | Firebase Hosting CDN |
| Express API (`server.ts`) | Cloud Run service `stratos-crm` |
| Firestore, Auth, Storage | Unchanged — project `gen-lang-client-0128987745` |

Firebase Hosting serves the static site and forwards `/api/**` to Cloud Run,
so the browser only ever talks to one origin: `https://crm.gostratos.vc`.

---

## Step 0 — Values you need to collect first

Get these from AI Studio's Secrets panel and the Google Cloud Console.
You cannot finish Step 4 without them.

- **Gemini API key** — AI Studio Secrets, saved as `API_KEY`
- **Google Maps API key** — GCP Console → APIs & Services → Credentials
- **OAuth client secret** — GCP Console → Credentials → the OAuth 2.0 Web
  client `944675465188-ijrq0n2v...` → client secret
- **Firebase service account JSON** — Firebase Console → Project settings →
  Service accounts → *Generate new private key*

Paste the Maps key into `.env.production` now (replace
`PASTE_YOUR_MAPS_KEY_HERE`). The other three go into Secret Manager in Step 3.

---

## Step 1 — Enable billing (required for Cloud Run)

Firebase Console → ⚙ → Usage and billing → Details & settings → **Modify plan**
→ switch to **Blaze (pay as you go)**.

Hosting and Firestore stay on the free allowances. At your usage this bill
rounds to roughly nothing, but Cloud Run cannot be used without it.

---

## Step 2 — Install the CLIs and sign in

```powershell
npm install -g firebase-tools
```

Install the Google Cloud CLI from
https://cloud.google.com/sdk/docs/install (Windows installer), then:

```powershell
gcloud auth login
gcloud config set project gen-lang-client-0128987745

firebase login
```

Enable the services Cloud Run needs:

```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

---

## Step 3 — Store the server-side secrets

These never touch the browser and never get committed. PowerShell adds a
trailing newline when piping, so write each value to a temp file first.

```powershell
cd "$env:USERPROFILE\dev\CRM-APP-main"

# Gemini API key
"PASTE_GEMINI_KEY" | Out-File -NoNewline -Encoding ascii tmp.txt
gcloud secrets create gemini-api-key --data-file=tmp.txt

# OAuth client secret
"PASTE_OAUTH_CLIENT_SECRET" | Out-File -NoNewline -Encoding ascii tmp.txt
gcloud secrets create google-oauth-client-secret --data-file=tmp.txt

# Firebase service account (point at the JSON file you downloaded)
gcloud secrets create firebase-service-account --data-file="$env:USERPROFILE\Downloads\PASTE-SERVICE-ACCOUNT.json"

Remove-Item tmp.txt
```

Let the Cloud Run service read them:

```powershell
$PROJECT_NUMBER = "944675465188"
$SA = "$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
foreach ($s in @("gemini-api-key","google-oauth-client-secret","firebase-service-account")) {
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
}
```

---

## Step 4 — Deploy the API to Cloud Run

```powershell
gcloud run deploy stratos-crm `
  --source . `
  --region us-central1 `
  --allow-unauthenticated `
  --memory 1Gi `
  --timeout 300 `
  --set-env-vars "NODE_ENV=production,VITE_APP_URL=https://crm.gostratos.vc,GOOGLE_CLIENT_ID=944675465188-ijrq0n2vngum7q5ackn1rs1ijlu9363k.apps.googleusercontent.com" `
  --set-secrets "API_KEY=gemini-api-key:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret:latest,FIREBASE_SERVICE_ACCOUNT=firebase-service-account:latest"
```

First deploy takes 5–10 minutes (Cloud Build builds the image). It prints a
service URL ending in `.run.app`. Sanity check:

```powershell
curl https://YOUR-SERVICE-URL.run.app/api/health
```

Expect `{"status":"ok"}`.

`--allow-unauthenticated` is required — Firebase Hosting calls Cloud Run as an
anonymous client. See the security note at the bottom.

---

## Step 5 — Build and deploy the front end

```powershell
npm install
npm run build
firebase deploy --only hosting,firestore:rules,storage
```

This publishes to `https://gen-lang-client-0128987745.web.app`. Open it and
confirm Google sign-in works and your companies load. **Test here before
touching DNS.**

---

## Step 6 — Point crm.gostratos.vc at it

Firebase Console → Hosting → **Add custom domain** → `crm.gostratos.vc`.
Firebase gives you DNS records; add them wherever gostratos.vc DNS is managed.
SSL provisions automatically, usually within an hour.

Then, in **Firebase Console → Authentication → Settings → Authorized domains**,
add `crm.gostratos.vc`. Google sign-in will fail on the new domain until you do.

Also add the redirect URI to the OAuth client (GCP Console → Credentials →
your Web client):

- Authorized JavaScript origins: `https://crm.gostratos.vc`
- Authorized redirect URIs: `https://crm.gostratos.vc/auth/callback`

---

## Step 7 — Redeploying later

```powershell
npm run build
firebase deploy --only hosting                                  # front end only
gcloud run deploy stratos-crm --source . --region us-central1   # API only
```

Once this is stable, wire up continuous deployment so a push to `main` ships
automatically: Cloud Run → your service → **Set up continuous deployment**
(connect the GitHub repo), and `firebase init hosting:github` for the front end.

---

## Known issue to resolve next: the API is unauthenticated

The Cloud Run service must accept anonymous requests for Firebase Hosting to
forward to it, and `server.ts` does **not** currently verify who is calling.
Firestore and Storage are now locked down, so your CRM *data* is safe — but
anyone who finds the URL can call `/api/analyze`, `/api/extract`, or
`/api/sync-all-emails` directly and burn your Gemini quota.

The fix is an Express middleware that verifies the caller's Firebase ID token
on every `/api/*` route, plus sending that token from the browser's `fetch`
calls. This is the top follow-up item after cutover.

---

## Rolling back

The AI Studio deployment is untouched and still live. Nothing here modifies it.
If the new site misbehaves, keep using the AI Studio link while we fix it.
The original open ruleset is preserved at `firestore.rules.bak-open` for
reference — do not redeploy it.

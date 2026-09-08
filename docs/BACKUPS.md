# Backups

Three layers, each covering what the one before it cannot.

| Layer | Protects against | Lives in | Runs |
|---|---|---|---|
| `staging` database | A mistake made through the CRM | Same project | Manual script |
| Cloud Storage exports | Losing the project, IAM accidents, someone acting badly in the console | Separate bucket | Nightly cron |
| Audit trail | Not knowing what was deleted or by whom | `audit` collection | On every delete |

A backup inside the thing it is backing up is a copy, not a backup. That is
why the second layer exists, and it is the one that answers "what if someone
goes rogue".

---

## 1. The staging copy

    gcloud auth application-default login
    node scripts/copy-to-staging.cjs --dry-run    # counts, writes nothing
    node scripts/copy-to-staging.cjs              # do it
    node scripts/copy-to-staging.cjs --verify     # compare both sides

Readable at:

    https://console.firebase.google.com/project/gen-lang-client-0128987745/firestore/databases/staging/data

The script reads the list of collections from production every run rather than
holding one. It previously named seven, one of which never existed, while the
app had grown to thirteen — so the 8,383-record contacts directory was outside
the backup and nobody would have found out until they needed it. A hardcoded
list is a backup that silently stops being one.

## 2. Nightly export to Cloud Storage — one-time setup

Everything below is done once, by somebody with project admin. After that the
nightly cron handles it.

**Create a bucket in a different location from the database**, so a regional
failure cannot take both:

    gcloud storage buckets create gs://stratos-crm-backups \
      --project=gen-lang-client-0128987745 \
      --location=us-east1 \
      --uniform-bucket-level-access

**Keep 90 days of exports and no more.** Retention costs money; unbounded
retention costs money forever:

    cat > /tmp/lifecycle.json <<'JSON'
    {"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}
    JSON
    gcloud storage buckets update gs://stratos-crm-backups --lifecycle-file=/tmp/lifecycle.json

**Let the App Engine service account export and write there:**

    PROJECT=gen-lang-client-0128987745
    SA=$PROJECT@appspot.gserviceaccount.com

    gcloud projects add-iam-policy-binding $PROJECT \
      --member="serviceAccount:$SA" \
      --role="roles/datastore.importExportAdmin"

    gcloud storage buckets add-iam-policy-binding gs://stratos-crm-backups \
      --member="serviceAccount:$SA" \
      --role="roles/storage.objectAdmin"

**Tell the app where to write.** Add to `env.yaml`:

    BACKUP_BUCKET: "stratos-crm-backups"

Without it the job runs, writes nothing, and says so in the logs rather than
failing silently.

**Deploy:**

    gcloud app deploy
    gcloud app deploy cron.yaml

**Check it worked**, the morning after the first run:

    gcloud storage ls gs://stratos-crm-backups/firestore/
    gcloud app logs read -s default --limit=50 | grep firestore-export

## 3. Point-in-time recovery

Separate from exports and worth having as well: PITR keeps a rolling window
that can be read back at any microsecond within it, with no job to run.

    gcloud firestore databases update \
      --database=ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86 \
      --enable-pitr

Check what is currently set:

    gcloud firestore databases describe \
      --database=ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86

## Restoring

From an export, into a **new** database — never over the live one, because a
restore that goes wrong on top of production leaves nothing to try again with:

    gcloud firestore import gs://stratos-crm-backups/firestore/2026-09-08 \
      --database=restore-test

Verify there, then move data across deliberately.

Note the reason `scripts/copy-to-staging.cjs` exists at all: a previous
`gcloud firestore import` failed because the data contains at least one field
larger than Firestore's 1500-byte index limit, which the import path enforces
strictly and the SDK does not. If an import fails that way, the SDK copy is the
route through.

## What the audit trail now holds

Deleting a company or an investor writes the whole record to `audit` first,
with who did it and when, and only then removes it. The rules deny update and
delete on `audit`, so it cannot be tidied up afterwards by whoever did it.

That turns "we seem to have lost some companies" into "these forty were deleted
on Tuesday by this account, and here they are".

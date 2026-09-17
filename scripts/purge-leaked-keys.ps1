<#
    Removes the five env.yaml backup files from EVERY commit in this
    repository's history, then (with -Push) force-pushes the rewritten history
    to GitHub.

    Read this before running it.

    This rewrites history. Every commit from 7cfdbe7 onward gets a new SHA.
    Anyone else holding a clone will have to re-clone; their existing one will
    not merge cleanly. A backup bundle of the current state is written outside
    the repository first, so nothing is unrecoverable.

    It also does NOT make the leaked keys safe. They were public for days and
    were scanned. Rotating them is the fix; this is cleanup so the values are
    not sitting in the history of a repository people can read.

        powershell -ExecutionPolicy Bypass -File scripts\purge-leaked-keys.ps1
        powershell -ExecutionPolicy Bypass -File scripts\purge-leaked-keys.ps1 -Push
#>

param(
    [switch]$Push
)

# git writes progress to stderr constantly; "Stop" would treat that as fatal.
$ErrorActionPreference = "Continue"
$env:FILTER_BRANCH_SQUELCH_WARNING = "1"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
Write-Host ""
Write-Host "Repository: $repo"
Write-Host ""

$targets = @(
    "env.yaml.bak-20260914-143207",
    "env.yaml.bak-20260914-143321",
    "env.yaml.bak-20260914-143852",
    "env.yaml.bak-20260914-152456",
    "env.yaml.before-backup"
)

# --- refuse to run on a dirty tree ------------------------------------------
# filter-branch checks out every commit in turn. Uncommitted work would be
# destroyed with no way back.
# --untracked-files=no deliberately: filter-branch rewrites commits and never
# touches untracked files, and this script is itself an untracked file the
# first time you run it. Only uncommitted changes to TRACKED files are a risk.
$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    Write-Host "STOPPED: you have uncommitted changes to tracked files." -ForegroundColor Yellow
    Write-Host "         Commit or stash them first, then run this again."
    Write-Host ""
    $dirty | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    exit 1
}

# --- what we are about to change --------------------------------------------
Write-Host "Commits currently carrying one of these files:" -ForegroundColor Cyan
$before = git log --all --oneline -- $targets
if (-not $before) {
    Write-Host "  none - the history is already clean. Nothing to do."
    Write-Host ""
    exit 0
}
$before | ForEach-Object { Write-Host "  $_" }
Write-Host ""

# --- backup ------------------------------------------------------------------
$stamp     = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $env:LOCALAPPDATA "StratosCRM\repo-backups"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
$bundle = Join-Path $backupDir "gostratos-before-purge-$stamp.bundle"

git bundle create $bundle --all
if ($LASTEXITCODE -ne 0) {
    Write-Host "STOPPED: could not write the backup bundle. Nothing has been changed." -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "Backup of the CURRENT history written to:" -ForegroundColor DarkGray
Write-Host "  $bundle" -ForegroundColor DarkGray
Write-Host "  (restore with: git clone $bundle recovered)" -ForegroundColor DarkGray
Write-Host ""

# --- the rewrite -------------------------------------------------------------
# index-filter edits each commit's index without checking files out, which is
# far faster than tree-filter and is all that is needed to drop a path.
$quoted = ($targets | ForEach-Object { '"' + $_ + '"' }) -join ' '
$filter = "git rm --cached --ignore-unmatch -- $quoted"

Write-Host "Rewriting history..." -ForegroundColor Cyan
git filter-branch --force --index-filter $filter -- --all
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "STOPPED: the rewrite failed. Your history has not been pushed." -ForegroundColor Red
    Write-Host "         Restore from the bundle above if the repo looks wrong."
    exit 1
}

# --- drop every reference to the old objects ---------------------------------
# filter-branch keeps the originals under refs/original/ and the reflog still
# points at them, so without this the old commits stay reachable locally and
# git gc will not remove them.
Write-Host ""
Write-Host "Clearing the old references..." -ForegroundColor Cyan
git for-each-ref --format="%(refname)" refs/original/ | ForEach-Object { git update-ref -d $_ }
git reflog expire --expire=now --all
git gc --prune=now
Write-Host ""

# --- get the loose copies out of the working tree ----------------------------
# These are untracked now, but they still hold the old keys in plain text.
$moved = 0
foreach ($t in $targets) {
    if (Test-Path $t) {
        Move-Item -Path $t -Destination (Join-Path $backupDir "$t.$stamp") -Force
        $moved++
    }
}
if ($moved -gt 0) {
    Write-Host "Moved $moved leftover backup file(s) out of the repository into" -ForegroundColor DarkGray
    Write-Host "  $backupDir" -ForegroundColor DarkGray
    Write-Host ""
}

# --- verify ------------------------------------------------------------------
Write-Host "Verifying..." -ForegroundColor Cyan
$after = git log --all --oneline -- $targets
if ($after) {
    Write-Host "FAILED: these files are still present in history:" -ForegroundColor Red
    $after | ForEach-Object { Write-Host "  $_" }
    exit 1
}
Write-Host "PASS: no commit in this repository contains those files any more." -ForegroundColor Green
Write-Host ""

# --- push --------------------------------------------------------------------
if (-not $Push) {
    Write-Host "Local history is clean. NOTHING HAS BEEN PUSHED YET." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "GitHub still has the old commits. When you are ready, run:"
    Write-Host ""
    Write-Host "    powershell -ExecutionPolicy Bypass -File scripts\purge-leaked-keys.ps1 -Push"
    Write-Host ""
    exit 0
}

Write-Host "Force-pushing the rewritten history to GitHub..." -ForegroundColor Cyan
git push --force --all
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "The push failed. Your local history is clean but GitHub is unchanged." -ForegroundColor Red
    Write-Host "A branch protection rule on main will block a force-push; if that is"
    Write-Host "the reason, turn it off in the repository settings and run this again."
    exit 1
}

Write-Host ""
Write-Host "Done. GitHub now has the rewritten history." -ForegroundColor Green
Write-Host ""
Write-Host "Two things this does NOT do:" -ForegroundColor Yellow
Write-Host "  1. The old commits still exist on GitHub as unreferenced objects."
Write-Host "     They are reachable by their exact SHA until GitHub garbage-collects."
Write-Host "     To have those purged, ask GitHub Support to remove the cached views."
Write-Host "  2. It does not make the leaked keys safe. Rotate them."
Write-Host ""

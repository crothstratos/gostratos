<#
    Pauses every scheduled job in the project, immediately.

    Use this when something is spending money and you want it to stop now,
    without deciding which job is responsible. Pausing takes effect at once —
    there is no deploy, no build, and nothing to wait for.

    What pausing does NOT survive: `gcloud app deploy cron.yaml` recreates
    every job in that file in the running state. If you want a job to stay off
    permanently, take it out of cron.yaml. This script is the emergency brake,
    not the setting.

        .\scripts\pause-nightly.ps1            pause everything
        .\scripts\pause-nightly.ps1 -List      just show what exists

    Reverse it with scripts\resume-nightly.ps1.
#>

param(
    [switch]$List,
    [string]$Project = "gen-lang-client-0128987745"
)

$ErrorActionPreference = "Stop"

function Test-GcloudAuth {
    param([string[]]$Output)
    $text = ($Output -join "`n")
    # gcloud cannot show its reauth prompt when its output is being captured,
    # so an expired CLI login surfaces here as "cannot prompt during
    # non-interactive execution" rather than as anything about logging in.
    if ($text -match "Reauthentication failed" -or
        $text -match "cannot prompt during non-interactive" -or
        $text -match "credentials are no longer valid" -or
        $text -match "You do not currently have an active account" -or
        $text -match "invalid_grant" -or
        $text -match "Your current credentials are invalid") {

        Write-Host ""
        Write-Host "  Your gcloud sign-in has expired." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Run this, then try again:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "      gcloud auth login" -ForegroundColor White
        Write-Host ""
        Write-Host "  Note: this is NOT the same as 'gcloud auth application-default login'."
        Write-Host "  That one signs in local scripts that read Firestore. This one signs in"
        Write-Host "  the gcloud command itself, which is what this script uses."
        Write-Host ""
        Write-Host "  No terminal handy? Pause the jobs in the console instead:" -ForegroundColor Cyan
        Write-Host "  https://console.cloud.google.com/cloudscheduler"
        Write-Host ""
        return $true
    }
    return $false
}

Write-Host ""
Write-Host "Project: $Project" -ForegroundColor Cyan
Write-Host ""

# name comes back as projects/<p>/locations/<loc>/jobs/<id>; the location is
# needed for every later call and is only available here.
$raw = gcloud scheduler jobs list --project=$Project --format="value(name,state)" 2>&1

if ($LASTEXITCODE -ne 0) {
    if (Test-GcloudAuth $raw) { exit 1 }
    Write-Host "Could not list scheduled jobs." -ForegroundColor Red
    Write-Host $raw
    exit 1
}

$jobs = @()
foreach ($line in $raw) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split "\s+"
    $path  = $parts[0]
    $state = if ($parts.Length -gt 1) { $parts[1] } else { "UNKNOWN" }
    if ($path -match "projects/[^/]+/locations/([^/]+)/jobs/(.+)$") {
        $jobs += [PSCustomObject]@{
            Id       = $Matches[2]
            Location = $Matches[1]
            State    = $state
        }
    }
}

if ($jobs.Count -eq 0) {
    Write-Host "No scheduled jobs found. Nothing is running on a schedule." -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host ("{0,-34} {1,-16} {2}" -f "JOB", "LOCATION", "STATE")
Write-Host ("-" * 68)
foreach ($j in $jobs) {
    $colour = if ($j.State -eq "PAUSED") { "DarkGray" } else { "White" }
    Write-Host ("{0,-34} {1,-16} {2}" -f $j.Id, $j.Location, $j.State) -ForegroundColor $colour
}
Write-Host ""

if ($List) { exit 0 }

$running = $jobs | Where-Object { $_.State -ne "PAUSED" }
if ($running.Count -eq 0) {
    Write-Host "Everything is already paused." -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "Pausing $($running.Count) job(s)..." -ForegroundColor Yellow
Write-Host ""

$failed = 0
$script:explained = $false
foreach ($j in $running) {
    Write-Host ("  {0,-34} " -f $j.Id) -NoNewline
    $out = gcloud scheduler jobs pause $j.Id --location=$j.Location --project=$Project --quiet 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "paused" -ForegroundColor Green
    } else {
        Write-Host "FAILED" -ForegroundColor Red
        $failed++
        # Checked once. A sign-in that lapsed mid-run fails every remaining
        # job for the same reason, and printing it once is the useful amount.
        if (-not $script:explained -and (Test-GcloudAuth $out)) { $script:explained = $true }
    }
}

Write-Host ""
if ($failed -gt 0) {
    Write-Host "$failed job(s) could not be paused. Pause them by hand at:" -ForegroundColor Red
    Write-Host "  https://console.cloud.google.com/cloudscheduler?project=$Project"
    exit 1
}

Write-Host "All scheduled jobs are paused. Nothing will run tonight." -ForegroundColor Green
Write-Host ""
Write-Host "Remember: deploying cron.yaml will start them again." -ForegroundColor Yellow
Write-Host "Resume deliberately with: .\scripts\resume-nightly.ps1"
Write-Host ""

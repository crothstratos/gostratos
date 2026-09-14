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

Write-Host ""
Write-Host "Project: $Project" -ForegroundColor Cyan
Write-Host ""

# name comes back as projects/<p>/locations/<loc>/jobs/<id>; the location is
# needed for every later call and is only available here.
$raw = gcloud scheduler jobs list --project=$Project --format="value(name,state)" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not list scheduled jobs." -ForegroundColor Red
    Write-Host $raw
    Write-Host ""
    Write-Host "If that is a credentials error, run:  gcloud auth login" -ForegroundColor Yellow
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
foreach ($j in $running) {
    Write-Host ("  {0,-34} " -f $j.Id) -NoNewline
    gcloud scheduler jobs pause $j.Id --location=$j.Location --project=$Project --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "paused" -ForegroundColor Green
    } else {
        Write-Host "FAILED" -ForegroundColor Red
        $failed++
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

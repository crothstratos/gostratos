<#
    Starts the scheduled jobs again.

    By default it resumes only the jobs that cost nothing to run — the nightly
    backup, the monthly portfolio snapshot, and the weekly website diff. The
    jobs that call Gemini stay paused unless you ask for them by name, because
    those are the ones that ran up a bill and turning them all back on with one
    command is how that happens twice.

        .\scripts\resume-nightly.ps1                 resume the free jobs
        .\scripts\resume-nightly.ps1 -All            resume everything, including AI
        .\scripts\resume-nightly.ps1 -Job backup     resume one job by name fragment
#>

param(
    [switch]$All,
    [string]$Job,
    [string]$Project = "gen-lang-client-0128987745"
)

$ErrorActionPreference = "Stop"

# Jobs that make no model calls. Matched on a fragment of the job id, because
# App Engine derives those ids from the cron URL and they carry a prefix.
$FREE = @("firestore-export", "portfolio-snapshot", "site-diff")

Write-Host ""
Write-Host "Project: $Project" -ForegroundColor Cyan

$raw = gcloud scheduler jobs list --project=$Project --format="value(name,state)" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not list scheduled jobs." -ForegroundColor Red
    Write-Host $raw
    exit 1
}

$jobs = @()
foreach ($line in $raw) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split "\s+"
    if ($parts[0] -match "projects/[^/]+/locations/([^/]+)/jobs/(.+)$") {
        $jobs += [PSCustomObject]@{
            Id       = $Matches[2]
            Location = $Matches[1]
            State    = if ($parts.Length -gt 1) { $parts[1] } else { "UNKNOWN" }
        }
    }
}

if ($jobs.Count -eq 0) {
    Write-Host "No scheduled jobs found." -ForegroundColor Yellow
    exit 0
}

$wanted = $jobs | Where-Object {
    if ($Job)  { return $_.Id -like "*$Job*" }
    if ($All)  { return $true }
    foreach ($f in $FREE) { if ($_.Id -like "*$f*") { return $true } }
    return $false
}

$skipped = $jobs | Where-Object { $wanted -notcontains $_ }

Write-Host ""
if ($wanted.Count -eq 0) {
    Write-Host "Nothing matched. Jobs available:" -ForegroundColor Yellow
    foreach ($j in $jobs) { Write-Host ("  {0}  [{1}]" -f $j.Id, $j.State) }
    exit 0
}

foreach ($j in $wanted) {
    Write-Host ("  {0,-34} " -f $j.Id) -NoNewline
    if ($j.State -ne "PAUSED") {
        Write-Host "already running" -ForegroundColor DarkGray
        continue
    }
    gcloud scheduler jobs resume $j.Id --location=$j.Location --project=$Project --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "resumed" -ForegroundColor Green }
    else { Write-Host "FAILED" -ForegroundColor Red }
}

if ($skipped.Count -gt 0) {
    Write-Host ""
    Write-Host "Left paused (these call Gemini):" -ForegroundColor Yellow
    foreach ($j in $skipped) { Write-Host ("  {0}  [{1}]" -f $j.Id, $j.State) }
    Write-Host ""
    Write-Host "Turn one on deliberately with:  .\scripts\resume-nightly.ps1 -Job <name>"
}
Write-Host ""

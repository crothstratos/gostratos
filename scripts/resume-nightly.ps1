<#
    Starts scheduled jobs again.

    By default it resumes only the jobs that cost nothing — the nightly backup,
    the monthly portfolio snapshot, the weekly website diff. The jobs that call
    Gemini stay paused unless you name one, because those are what ran up a
    bill and restoring everything with one keystroke is how that happens twice.

        .\scripts\resume-nightly.ps1                      resume the free jobs
        .\scripts\resume-nightly.ps1 -List                show state, change nothing
        .\scripts\resume-nightly.ps1 -Job investor        resume one by name
        .\scripts\resume-nightly.ps1 -All                 resume everything
#>

param(
    [switch]$All,
    [switch]$List,
    [string]$Job,
    [string]$Project = "gen-lang-client-0128987745"
)

# See the note in pause-nightly.ps1: gcloud writes advisories to stderr, and
# under "Stop" PowerShell treats those as fatal. Failure is $LASTEXITCODE.
$ErrorActionPreference = "Continue"

# Jobs that make no model calls. Matched on a fragment, because App Engine
# derives Scheduler ids from the cron URL and prefixes them.
$FREE = @("firestore-export", "portfolio-snapshot", "site-diff")

function Show-AuthHelp {
    param([string]$Text)
    if ($Text -match "Reauthentication failed|cannot prompt during non-interactive|credentials are no longer valid|do not currently have an active account|invalid_grant") {
        Write-Host ""
        Write-Host "  Your gcloud sign-in has expired." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "      gcloud auth login" -ForegroundColor White
        Write-Host ""
        Write-Host "  Or use the console: https://console.cloud.google.com/cloudscheduler?project=$Project" -ForegroundColor Cyan
        Write-Host ""
        return $true
    }
    return $false
}

Write-Host ""
Write-Host "Project: $Project" -ForegroundColor Cyan

$errFile = [System.IO.Path]::GetTempFileName()
$json = & gcloud scheduler jobs list --project=$Project --format=json 2>$errFile
$stderr = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue)
Remove-Item $errFile -ErrorAction SilentlyContinue

if ($LASTEXITCODE -ne 0) {
    if (Show-AuthHelp $stderr) { exit 1 }
    Write-Host "Could not list scheduled jobs." -ForegroundColor Red
    Write-Host $stderr
    exit 1
}

try { $all = ($json | Out-String | ConvertFrom-Json) } catch { $all = @() }
if ($null -eq $all) { $all = @() }

$jobs = @()
foreach ($j in $all) {
    if ($j.name -match "projects/[^/]+/locations/([^/]+)/jobs/(.+)$") {
        $jobs += [PSCustomObject]@{ Id = $Matches[2]; Location = $Matches[1]; State = $j.state }
    }
}

if ($jobs.Count -eq 0) {
    Write-Host "No scheduled jobs found." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

Write-Host ""
Write-Host ("{0,-36} {1}" -f "JOB", "STATE")
Write-Host ("-" * 56)
foreach ($j in $jobs) {
    $colour = if ($j.State -eq "PAUSED") { "DarkGray" } else { "White" }
    Write-Host ("{0,-36} {1}" -f $j.Id, $j.State) -ForegroundColor $colour
}
Write-Host ""

if ($List) { exit 0 }

$wanted = @()
foreach ($j in $jobs) {
    if ($Job) { if ($j.Id -like "*$Job*") { $wanted += $j }; continue }
    if ($All) { $wanted += $j; continue }
    foreach ($f in $FREE) { if ($j.Id -like "*$f*") { $wanted += $j; break } }
}

if ($wanted.Count -eq 0) {
    Write-Host "Nothing matched." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

foreach ($j in $wanted) {
    Write-Host ("  {0,-36} " -f $j.Id) -NoNewline
    if ($j.State -ne "PAUSED") { Write-Host "already running" -ForegroundColor DarkGray; continue }
    $e = [System.IO.Path]::GetTempFileName()
    & gcloud scheduler jobs resume $j.Id --location=$j.Location --project=$Project --quiet 1>$null 2>$e
    $msg = (Get-Content $e -Raw -ErrorAction SilentlyContinue)
    Remove-Item $e -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -eq 0) { Write-Host "resumed" -ForegroundColor Green }
    else { Write-Host "FAILED" -ForegroundColor Red; Show-AuthHelp $msg | Out-Null }
}

$stillPaused = $jobs | Where-Object { $wanted -notcontains $_ }
if ($stillPaused.Count -gt 0) {
    Write-Host ""
    Write-Host "Left alone (these call Gemini):" -ForegroundColor Yellow
    foreach ($j in $stillPaused) { Write-Host ("  {0}" -f $j.Id) }
    Write-Host ""
    Write-Host "Turn one on deliberately:  .\scripts\resume-nightly.ps1 -Job <name>"
}
Write-Host ""

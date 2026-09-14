<#
    Pauses every scheduled job in the project, immediately.

    Use this when something is spending money and you want it to stop now,
    without first working out which job is responsible. Pausing takes effect at
    once — no build, no deploy, nothing to wait for.

        .\scripts\pause-nightly.ps1                 pause everything
        .\scripts\pause-nightly.ps1 -List           show what exists, change nothing
        .\scripts\pause-nightly.ps1 -Keep backup    pause all but the backup

    What pausing does NOT survive: `gcloud app deploy cron.yaml` recreates every
    job listed in that file, running. If you want a job off permanently, take it
    out of cron.yaml. This is the emergency brake, not the setting.

    Reverse it with scripts\resume-nightly.ps1.
#>

param(
    [switch]$List,
    [string]$Keep = "firestore-export",
    [string]$Project = "gen-lang-client-0128987745"
)

<#
    Deliberately NOT "Stop".

    gcloud writes progress and advisory notes to stderr — "We are using the App
    Engine app location (us-central1) as the default location" is a warning,
    not a failure. Under ErrorActionPreference = Stop, PowerShell turns any
    stderr line from a native command into a terminating NativeCommandError, so
    the script died on a message that was telling it things were fine.

    Native commands report failure through $LASTEXITCODE, and that is what is
    checked below.
#>
$ErrorActionPreference = "Continue"

function Show-AuthHelp {
    param([string]$Text)
    # gcloud cannot show its reauth prompt when output is captured, so an
    # expired sign-in arrives as "cannot prompt during non-interactive
    # execution" rather than as anything about signing in.
    if ($Text -match "Reauthentication failed|cannot prompt during non-interactive|credentials are no longer valid|do not currently have an active account|invalid_grant") {
        Write-Host ""
        Write-Host "  Your gcloud sign-in has expired." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "      gcloud auth login" -ForegroundColor White
        Write-Host ""
        Write-Host "  Not the same as 'gcloud auth application-default login' — that one"
        Write-Host "  signs in local scripts that read Firestore; this one signs in gcloud."
        Write-Host ""
        Write-Host "  Or pause the jobs in the console, which needs no terminal:" -ForegroundColor Cyan
        Write-Host "  https://console.cloud.google.com/cloudscheduler?project=$Project"
        Write-Host ""
        return $true
    }
    return $false
}

Write-Host ""
Write-Host "Project: $Project" -ForegroundColor Cyan
Write-Host ""

# JSON rather than text, and stderr sent to its own file, so advisory warnings
# cannot end up parsed as though they were rows.
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
        $jobs += [PSCustomObject]@{
            Id       = $Matches[2]
            Location = $Matches[1]
            State    = $j.state
        }
    }
}

if ($jobs.Count -eq 0) {
    Write-Host "No scheduled jobs found. Nothing runs on a schedule." -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host ("{0,-36} {1,-14} {2}" -f "JOB", "LOCATION", "STATE")
Write-Host ("-" * 70)
foreach ($j in $jobs) {
    $colour = if ($j.State -eq "PAUSED") { "DarkGray" } else { "White" }
    Write-Host ("{0,-36} {1,-14} {2}" -f $j.Id, $j.Location, $j.State) -ForegroundColor $colour
}
Write-Host ""

if ($List) { exit 0 }

# The backup is kept running by default. "Stop the automation" and "stop the
# backups" are different instructions and only one of them is usually meant.
$target = $jobs | Where-Object { $_.State -ne "PAUSED" -and ($Keep -eq "" -or $_.Id -notlike "*$Keep*") }
$kept   = $jobs | Where-Object { $Keep -ne "" -and $_.Id -like "*$Keep*" }

if ($target.Count -eq 0) {
    Write-Host "Nothing left to pause." -ForegroundColor Green
    if ($kept.Count -gt 0) {
        Write-Host ""
        foreach ($j in $kept) { Write-Host ("  still running on purpose: {0}" -f $j.Id) -ForegroundColor Cyan }
    }
    Write-Host ""
    exit 0
}

Write-Host "Pausing $($target.Count) job(s)..." -ForegroundColor Yellow
Write-Host ""

$failed = 0
$explained = $false
foreach ($j in $target) {
    Write-Host ("  {0,-36} " -f $j.Id) -NoNewline
    $e = [System.IO.Path]::GetTempFileName()
    & gcloud scheduler jobs pause $j.Id --location=$j.Location --project=$Project --quiet 1>$null 2>$e
    $msg = (Get-Content $e -Raw -ErrorAction SilentlyContinue)
    Remove-Item $e -ErrorAction SilentlyContinue

    if ($LASTEXITCODE -eq 0) {
        Write-Host "paused" -ForegroundColor Green
    } else {
        Write-Host "FAILED" -ForegroundColor Red
        $failed++
        # Once, not once per job: a sign-in that lapsed mid-run fails every
        # remaining job for the same reason.
        if (-not $explained) { $explained = Show-AuthHelp $msg }
    }
}

Write-Host ""
foreach ($j in $kept) {
    Write-Host ("  left running on purpose: {0}" -f $j.Id) -ForegroundColor Cyan
}

Write-Host ""
if ($failed -gt 0) {
    Write-Host "$failed job(s) could not be paused. Pause them by hand:" -ForegroundColor Red
    Write-Host "  https://console.cloud.google.com/cloudscheduler?project=$Project"
    exit 1
}

Write-Host "Done. Nothing on a schedule will spend money tonight." -ForegroundColor Green
Write-Host ""
Write-Host "Note: deploying cron.yaml starts these again." -ForegroundColor Yellow
Write-Host "The permanent stop is the commented-out jobs in cron.yaml."
Write-Host ""

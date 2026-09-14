<#
    Sets or updates keys in env.yaml, safely.

        .\scripts\set-env.ps1 -GranolaApiKey "grn_..."
        .\scripts\set-env.ps1 -GranolaWebhookSecret "whsec_..."
        .\scripts\set-env.ps1 -Show

    env.yaml holds the deployed secrets and is gitignored, so a bad edit is not
    recoverable from git. Every run therefore takes a timestamped backup first,
    and the script refuses to write anything it cannot verify afterwards.

    Running it twice is safe: a key already present is updated in place rather
    than added a second time, and a parameter left blank is skipped entirely —
    which is how you set the API key now and the webhook secret later.
#>

param(
    [string]$GranolaApiKey,
    [string]$GranolaWebhookSecret,
    [string]$InternalDomains,
    [switch]$Show
)

# gcloud writes advisories to stderr; under "Stop" PowerShell treats those as
# fatal. Failure here is checked explicitly instead.
$ErrorActionPreference = "Continue"

$envPath = Join-Path $PSScriptRoot "..\env.yaml"
$envPath = [System.IO.Path]::GetFullPath($envPath)

if (-not (Test-Path $envPath)) {
    Write-Host ""
    Write-Host "  env.yaml not found at $envPath" -ForegroundColor Red
    Write-Host "  Copy env.yaml.example to env.yaml first." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

function Show-Keys {
    param([string[]]$Lines)
    Write-Host ""
    Write-Host ("{0,-28} {1}" -f "KEY", "VALUE") -ForegroundColor Cyan
    Write-Host ("-" * 52)
    foreach ($l in $Lines) {
        if ($l -match '^\s{2}([A-Z0-9_]+):\s*(.*)$') {
            $k = $Matches[1]
            $v = $Matches[2].Trim(' ', '"', "'")
            # Never print a secret in full. Enough to confirm it is the right
            # one, not enough to leak it into a screenshot or a scrollback.
            if ($v.Length -gt 12) { $shown = $v.Substring(0, 6) + "..." + $v.Substring($v.Length - 4) }
            elseif ($v.Length -gt 0) { $shown = "set" }
            else { $shown = "(empty)" }
            Write-Host ("{0,-28} {1}" -f $k, $shown)
        }
    }
    Write-Host ""
}

$lines = @(Get-Content -Path $envPath -Encoding UTF8)

if ($Show) { Show-Keys $lines; exit 0 }

# Only the parameters actually supplied. A blank one is not an instruction to
# blank the key — it means "not this time".
$wanted = [ordered]@{}
if ($GranolaApiKey)        { $wanted["GRANOLA_API_KEY"]        = $GranolaApiKey.Trim() }
if ($GranolaWebhookSecret) { $wanted["GRANOLA_WEBHOOK_SECRET"] = $GranolaWebhookSecret.Trim() }
if ($InternalDomains)      { $wanted["GRANOLA_INTERNAL_DOMAINS"] = $InternalDomains.Trim() }

if ($wanted.Count -eq 0) {
    Write-Host ""
    Write-Host "  Nothing to do — no values were given." -ForegroundColor Yellow
    Write-Host "  Try:  .\scripts\set-env.ps1 -GranolaApiKey ""grn_...""" -ForegroundColor Yellow
    Show-Keys $lines
    exit 0
}

# Catch the commonest paste mistake before it reaches a deploy.
foreach ($k in @($wanted.Keys)) {
    $v = $wanted[$k]
    if ($v -match '^(grn_|whsec_)?\.\.\.$' -or $v -match 'PASTE' -or $v -match 'YOUR_') {
        Write-Host ""
        Write-Host "  $k still looks like a placeholder: '$v'" -ForegroundColor Red
        Write-Host "  Paste the real value and run again. Nothing was changed." -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}
if ($wanted.Contains("GRANOLA_API_KEY") -and -not $wanted["GRANOLA_API_KEY"].StartsWith("grn_")) {
    Write-Host ""
    Write-Host "  That does not look like a Granola API key — they start with 'grn_'." -ForegroundColor Yellow
    Write-Host "  Nothing was changed. Check you copied the whole key." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
if ($wanted.Contains("GRANOLA_WEBHOOK_SECRET") -and -not $wanted["GRANOLA_WEBHOOK_SECRET"].StartsWith("whsec_")) {
    Write-Host ""
    Write-Host "  That does not look like a signing secret — they start with 'whsec_'." -ForegroundColor Yellow
    Write-Host "  Nothing was changed." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# --- back up before touching it
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$envPath.bak-$stamp"
Copy-Item -Path $envPath -Destination $backup -Force
Write-Host ""
Write-Host "  Backed up to $(Split-Path -Leaf $backup)" -ForegroundColor DarkGray

# --- set or update each key
$result  = New-Object System.Collections.Generic.List[string]
$done    = @{}
foreach ($line in $lines) {
    $replaced = $false
    foreach ($k in $wanted.Keys) {
        if ($line -match "^\s{2}$k\s*:") {
            $result.Add("  $k" + ': "' + $wanted[$k] + '"')
            $done[$k] = "updated"
            $replaced = $true
            break
        }
    }
    if (-not $replaced) { $result.Add($line) }
}

# Anything not already present is appended after the last indented key, which
# keeps it inside env_variables even if the file gains a trailing comment.
$toAdd = @($wanted.Keys | Where-Object { -not $done.ContainsKey($_) })
if ($toAdd.Count -gt 0) {
    $lastKey = -1
    for ($i = 0; $i -lt $result.Count; $i++) {
        if ($result[$i] -match '^\s{2}[A-Z0-9_]+\s*:') { $lastKey = $i }
    }
    if ($lastKey -lt 0) {
        Write-Host "  Could not find the env_variables block in env.yaml." -ForegroundColor Red
        Write-Host "  Nothing was changed; your backup is at $backup" -ForegroundColor Yellow
        exit 1
    }
    $block = New-Object System.Collections.Generic.List[string]
    # The header only the first time. Setting the API key now and the webhook
    # secret after step 4 are two separate runs, and each adding its own
    # heading leaves the file with two identical section markers.
    if (-not ($result -match '^\s*#\s*-+\s*Granola')) {
        $block.Add("")
        $block.Add("  # ---- Granola ----")
    }
    foreach ($k in $toAdd) {
        $block.Add("  $k" + ': "' + $wanted[$k] + '"')
        $done[$k] = "added"
    }
    $result.InsertRange($lastKey + 1, $block)
}

<#
    Written without a byte-order mark, deliberately.

    Windows PowerShell's Out-File -Encoding UTF8 prepends a BOM, and a BOM at
    the top of a YAML file makes the first key unparseable — so the deploy
    fails on a file that looks perfectly correct in every editor.
#>
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($envPath, ($result -join "`n") + "`n", $utf8NoBom)

# --- verify what landed, and roll back if it did not
$after = @(Get-Content -Path $envPath -Encoding UTF8)
$bad = @()
foreach ($k in $wanted.Keys) {
    $line = $after | Where-Object { $_ -match "^\s{2}$k\s*:" } | Select-Object -First 1
    if (-not $line) { $bad += $k; continue }
    if ($line -notmatch [regex]::Escape($wanted[$k])) { $bad += $k }
}
if ($bad.Count -gt 0) {
    Copy-Item -Path $backup -Destination $envPath -Force
    Write-Host ""
    Write-Host "  Write did not verify for: $($bad -join ', ')" -ForegroundColor Red
    Write-Host "  env.yaml has been restored from the backup. Nothing changed." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

foreach ($k in $wanted.Keys) {
    Write-Host ("  {0,-28} {1}" -f $k, $done[$k]) -ForegroundColor Green
}
Show-Keys $after

Write-Host "  env.yaml is gitignored, so nothing here will be committed." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Deploy for it to take effect:" -ForegroundColor Cyan
Write-Host "      gcloud app deploy --quiet"
Write-Host ""

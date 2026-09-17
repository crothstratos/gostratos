# Tests the Gemini API key in env.yaml.
#
# Answers one question: does the key the deployed CRM uses still work, and can
# it reach the model the app asks for? It never prints the key itself.
#
#   powershell -ExecutionPolicy Bypass -File scripts\test-gemini-key.ps1

$ErrorActionPreference = "Continue"

# PowerShell 5.1 still negotiates TLS 1.0 by default, which Google refuses.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$envFile = Join-Path $PSScriptRoot "..\env.yaml"
if (-not (Test-Path $envFile)) {
    Write-Host "env.yaml not found next to this script. Expected: $envFile"
    exit 1
}

$key = $null
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s+API_KEY\s*:\s*"?([^"\s#]+)"?') { $key = $Matches[1] }
}

if (-not $key) {
    Write-Host "PROBLEM: there is no API_KEY line in env.yaml."
    Write-Host "         The auto-populate feature cannot work without one."
    exit 1
}

Write-Host ("Key in env.yaml : " + $key.Substring(0, 4) + "..." + " (" + $key.Length + " characters)")
Write-Host ""

$wanted = "gemini-3.8-flash"
$url = "https://generativelanguage.googleapis.com/v1beta/models?key=$key"

try {
    $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 30
    $names = @($response.models | ForEach-Object { $_.name -replace '^models/', '' })

    Write-Host "RESULT: the key WORKS. Google accepted it."
    Write-Host ("        $($names.Count) models are visible to it.")
    Write-Host ""

    if ($names -contains $wanted) {
        Write-Host "RESULT: $wanted is available to this key."
        Write-Host ""
        Write-Host "So the key is not the problem. Tell Claude this and it will"
        Write-Host "look at the app instead."
    }
    else {
        Write-Host "PROBLEM: $wanted is NOT available to this key."
        Write-Host "         That is what is breaking auto-populate."
        Write-Host ""
        Write-Host "Flash models this key CAN use:"
        $names | Where-Object { $_ -like "*flash*" } | Sort-Object | ForEach-Object { Write-Host "  $_" }
    }
}
catch {
    $status = ""
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }

    Write-Host "RESULT: Google REJECTED the key. HTTP $status"
    Write-Host ""

    $body = ""
    try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
    }
    catch { }

    if ($body) {
        Write-Host ($body -replace [regex]::Escape($key), "<your key, hidden>")
    }
    else {
        Write-Host $_.Exception.Message
    }

    Write-Host ""
    Write-Host "This is what is breaking auto-populate. A new key is made at"
    Write-Host "https://aistudio.google.com/apikey and goes on the API_KEY line"
    Write-Host "in env.yaml, then needs a deploy to take effect."
}

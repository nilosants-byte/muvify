$ErrorActionPreference = "Stop"

$root = "C:\Users\Danilo\Documents\dev\personal-app-backend"
$mobile = Join-Path $root "mobile-app"
$outBase = "C:\Users\Danilo\Documents\testes app"

function Wait-Http200 {
  param(
    [string]$Url,
    [int]$TimeoutSec = 240
  )

  $start = Get-Date
  while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 6
      if ($resp.StatusCode -eq 200) {
        return $true
      }
    } catch {
      # Keep waiting
    }
    Start-Sleep -Milliseconds 800
  }

  throw "Timeout aguardando HTTP 200 de $Url"
}

function Stop-IfRunning {
  param([System.Diagnostics.Process]$Proc)
  if ($null -ne $Proc -and -not $Proc.HasExited) {
    Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
  }
}

foreach ($mode in @("dark", "light")) {
  Write-Host "=== Captura runtime ($mode) ==="

  $outDir = Join-Path $outBase "muvify-prints-$mode"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  Get-ChildItem -Path $outDir -Filter "*.png" -ErrorAction SilentlyContinue | Remove-Item -Force

  $mockOut = Join-Path $outDir "mock.out.log"
  $mockErr = Join-Path $outDir "mock.err.log"
  $expoOut = Join-Path $outDir "expo.out.log"
  $expoErr = Join-Path $outDir "expo.err.log"
  $capOut = Join-Path $outDir "capture.out.log"
  $capErr = Join-Path $outDir "capture.err.log"

  foreach ($log in @($mockOut, $mockErr, $expoOut, $expoErr, $capOut, $capErr)) {
    if (Test-Path $log) { Remove-Item $log -Force }
  }

  $mock = $null
  $expo = $null

  try {
    $mock = Start-Process -FilePath node `
      -ArgumentList "scripts/mock-mobile-api.js" `
      -WorkingDirectory $root `
      -PassThru `
      -WindowStyle Hidden `
      -RedirectStandardOutput $mockOut `
      -RedirectStandardError $mockErr

    Wait-Http200 -Url "http://127.0.0.1:3000/api/health" -TimeoutSec 120 | Out-Null

    $expoArgs = "/c set EXPO_PUBLIC_THEME_MODE=$mode&&npm run web -- --port 8081 --clear"
    $expo = Start-Process -FilePath cmd.exe `
      -ArgumentList $expoArgs `
      -WorkingDirectory $mobile `
      -PassThru `
      -WindowStyle Hidden `
      -RedirectStandardOutput $expoOut `
      -RedirectStandardError $expoErr

    Wait-Http200 -Url "http://127.0.0.1:8081" -TimeoutSec 360 | Out-Null

    Push-Location $mobile
    try {
      $env:EXPO_PUBLIC_THEME_MODE = $mode
      $env:CAPTURE_OUT_DIR = $outDir
      node scripts/capture-official-34-screens.mjs *> $capOut 2> $capErr
      if ($LASTEXITCODE -ne 0) {
        throw "Falha em capture-official-34-screens para modo $mode"
      }
    } finally {
      Remove-Item Env:EXPO_PUBLIC_THEME_MODE -ErrorAction SilentlyContinue
      Remove-Item Env:CAPTURE_OUT_DIR -ErrorAction SilentlyContinue
      Pop-Location
    }
  } finally {
    Stop-IfRunning -Proc $expo
    Stop-IfRunning -Proc $mock
    Start-Sleep -Seconds 2
  }

  $count = (Get-ChildItem -Path $outDir -Filter "*.png" -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Host "Tema $mode finalizado com $count screenshots em $outDir"
}

Write-Host "Captura runtime dark/light concluída."

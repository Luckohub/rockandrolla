<#
  Rockanrola - local server on http://localhost:8080 (requires Node.js 18+).
    powershell -ExecutionPolicy Bypass -File scripts\serve.ps1 [-Port 8080]
#>
param([int]$Port = 8080)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path (Join-Path $Root 'web\engine\rockanrola.wasm'))) {
  Write-Warning 'Falta web\engine\rockanrola.wasm: ejecutá primero scripts\build.ps1'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js no está instalado. Alternativa: python -m http.server 8080 --directory web'
}
node (Join-Path $Root 'scripts\serve.mjs') $Port (Join-Path $Root 'web')

<#
  Rockanrola - publica la PÁGINA DE INVITADO en Cloudflare Pages (gratis,
  https://<proyecto>.pages.dev). Nunca publica el motor ni la ROM.

    powershell -ExecutionPolicy Bypass -File scripts\publish-cloudflare.ps1 -Project rockanrola

  Requiere Node.js. La primera vez Wrangler (CLI oficial de Cloudflare,
  vía npx) abre el navegador para iniciar sesión en tu cuenta de Cloudflare.
#>
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Out = Join-Path $Root 'build\public'

node (Join-Path $Root 'scripts\prepare-public.mjs') $Out
if ($LASTEXITCODE -ne 0) { throw 'La copia pública no pasó la verificación: no se publica nada.' }

$bad = Get-ChildItem $Out -Recurse -File | Where-Object { $_.Extension -match '^\.(wasm|sfc|smc|zip)$' }
if ($bad) { throw "Se encontraron archivos del juego en la copia pública: $($bad.Name -join ', ')" }

if ($DryRun) { Write-Host "Prueba sin publicar: la copia está en $Out"; return }

Write-Host "Publicando $Out en Cloudflare Pages, proyecto '$Project'..."
npx --yes wrangler@4 pages deploy $Out --project-name $Project --branch main
if ($LASTEXITCODE -ne 0) { throw "Wrangler terminó con error ($LASTEXITCODE)." }
Write-Host "Listo. Poné la dirección https://$Project.pages.dev/ en web\config.js (guestUrl) para que tus invitaciones apunten ahí."

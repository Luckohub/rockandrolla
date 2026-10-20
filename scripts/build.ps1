<#
  Rockanrola - reproducible WebAssembly build on Windows 11.

  Uses the pinned official Emscripten image in Docker Desktop, so nothing is
  installed globally on the host. Run from any folder:

    powershell -ExecutionPolicy Bypass -File scripts\build.ps1            # web module
    powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Tests     # + ROM-free tests
    powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Clean
#>
param(
  [switch]$Tests,
  [switch]$Bench,
  [switch]$Clean,
  [int]$Jobs = 4
)
$ErrorActionPreference = 'Stop'

# Pinned toolchain. Change only together with docs/DEPENDENCIAS.md.
$EmsdkImage = 'emscripten/emsdk:6.0.10'
$UpstreamCommit = '4f4a9a62cecd349ae7acdce8c4b75532f3733ca3'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker no está instalado. Instalá Docker Desktop (ver README) o usá el método con emsdk local.'
}
docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop no está en ejecución. Abrilo y volvé a intentar.' }

$upstream = Join-Path $Root 'third_party\rnrr-recomp'
if (-not (Test-Path (Join-Path $upstream 'runtime'))) {
  Write-Host 'Descargando el submódulo de la recompilación...'
  git -C $Root submodule update --init --recursive
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo inicializar el submódulo third_party/rnrr-recomp.' }
}
$head = (git -C $upstream rev-parse HEAD).Trim()
if ($head -ne $UpstreamCommit) {
  Write-Warning "third_party/rnrr-recomp está en $head; la versión verificada es $UpstreamCommit."
}

$targets = @()
if ($Clean) { $targets += 'clean' } else {
  $targets += 'web'
  if ($Tests) { $targets += 'tests' }
  if ($Bench) { $targets += 'bench' }
}

$cmd = "emcc --version | head -n 1 && make -C port -j$Jobs $($targets -join ' ')"
if ($Tests -and -not $Clean) {
  $cmd += ' && cd build/tests && fail=0 && for t in *.js; do if node "$t" > "$t.log" 2>&1; then echo "PASS $t"; else echo "FAIL $t (ver build/tests/$t.log)"; fail=1; fi; done && exit $fail'
}

Write-Host "Usando $EmsdkImage"
docker run --rm -v "${Root}:/src" -w /src $EmsdkImage bash -c $cmd
if ($LASTEXITCODE -ne 0) { throw "La compilación o las pruebas fallaron (código $LASTEXITCODE)." }

if (-not $Clean) {
  $wasm = Join-Path $Root 'web\engine\rockanrola.wasm'
  $size = [math]::Round((Get-Item $wasm).Length / 1MB, 2)
  Write-Host "Listo: web\engine\rockanrola.wasm ($size MB). Ejecutá scripts\serve.ps1 y abrí http://localhost:8080"
}

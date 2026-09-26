$ErrorActionPreference = 'Continue'

Write-Output "=== elevated ==="
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
Write-Output ''
Write-Output "=== VS installs WITH VC++ tools AND a Win11 SDK ==="
& $vswhere -all -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.Windows11SDK.22621 -format value -property installationPath

Write-Output ''
Write-Output "=== VS installs WITH VC++ tools AND any Win10 SDK ==="
& $vswhere -all -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.Windows10SDK.19041 -format value -property installationPath

Write-Output ''
Write-Output "=== Windows Kits roots ==="
foreach ($root in @((Join-Path ${env:ProgramFiles(x86)} 'Windows Kits'), (Join-Path $env:ProgramFiles 'Windows Kits'))) {
  Write-Output ("  {0}: {1}" -f $root, (Test-Path $root))
}

Write-Output ''
Write-Output "=== vs_installer.exe present (for a modify command) ==="
$setup = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\setup.exe'
Write-Output ("  {0}: {1}" -f $setup, (Test-Path $setup))

Write-Output ''
Write-Output "=== VC++ tools present? ==="
$vc = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC'
if (Test-Path $vc) { Get-ChildItem $vc -Directory | Select-Object -ExpandProperty Name } else { Write-Output '  MISSING' }
$ErrorActionPreference = 'Continue'

$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits'
Write-Output "=== $kits contents ==="
Get-ChildItem $kits -ErrorAction SilentlyContinue | Select-Object Mode, Name

Write-Output ''
Write-Output "=== $kits\10 ==="
$ten = Join-Path $kits '10'
if (Test-Path $ten) {
  Get-ChildItem $ten -ErrorAction SilentlyContinue | Select-Object Mode, Name
  Write-Output ''
  Write-Output "=== $kits\10\Include ==="
  $inc = Join-Path $ten 'Include'
  if (Test-Path $inc) { Get-ChildItem $inc | Select-Object -ExpandProperty Name } else { Write-Output '  MISSING' }
  Write-Output "=== $kits\10\Lib ==="
  $lib = Join-Path $ten 'Lib'
  if (Test-Path $lib) { Get-ChildItem $lib | Select-Object -ExpandProperty Name } else { Write-Output '  MISSING' }
  Write-Output "=== $kits\10\bin ==="
  $bin = Join-Path $ten 'bin'
  if (Test-Path $bin) { Get-ChildItem $bin | Select-Object -ExpandProperty Name } else { Write-Output '  MISSING' }
} else {
  Write-Output '  MISSING'
}

Write-Output ''
Write-Output "=== uninstallers / SDK-ish Microsoft entries ==="
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'Windows SDK|Windows Software Development Kit|Visual Studio Build Tools' } |
  Select-Object DisplayName, DisplayVersion | Format-Table -AutoSize | Out-String | Write-Output
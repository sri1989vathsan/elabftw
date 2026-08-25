$ErrorActionPreference = 'Stop'

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw 'Go 1.22 or newer is required to build the folder opener.'
}

$Source = $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA 'eLabFTW Folder Opener'
$Executable = Join-Path $InstallDir 'elabftw-folder-opener.exe'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Push-Location $Source
try {
    go build -trimpath -ldflags '-s -w' -o $Executable .
} finally {
    Pop-Location
}

$Protocol = 'HKCU:\Software\Classes\elabftw-folder'
New-Item -Force -Path $Protocol | Out-Null
Set-Item -Path $Protocol -Value 'URL:eLabFTW Folder Opener'
New-ItemProperty -Force -Path $Protocol -Name 'URL Protocol' -Value '' | Out-Null
$Command = Join-Path $Protocol 'shell\open\command'
New-Item -Force -Path $Command | Out-Null
Set-Item -Path $Command -Value ('"{0}" "%1"' -f $Executable)

Write-Host "Installed: $Executable"
Write-Host 'Click a local folder shortcut in eLabFTW and allow the browser to open eLabFTW Folder Opener.'

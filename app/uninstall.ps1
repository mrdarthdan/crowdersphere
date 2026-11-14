# CrowderSphere uninstaller (run from Settings > Apps > Installed apps).
# Removes the program, its shortcuts and its Windows registration. Your posts are never deleted.
param([switch]$FromTemp, [switch]$Quiet)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$AppName = 'CrowderSphere'
$RegKey  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CrowderSphere'
$PsExe   = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"

# Run from a temp copy so the install folder can be deleted
if (-not $FromTemp) {
    $tmp = Join-Path $env:TEMP 'CrowderSphere-uninstall.ps1'
    Copy-Item -LiteralPath $MyInvocation.MyCommand.Path -Destination $tmp -Force
    $argList = "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$tmp`" -FromTemp"
    if ($Quiet) { $argList += ' -Quiet' }
    Start-Process -FilePath $PsExe -ArgumentList $argList -WorkingDirectory $env:TEMP -WindowStyle Hidden
    exit 0
}
[Environment]::CurrentDirectory = $env:TEMP
Set-Location -LiteralPath $env:TEMP

$installDir = $null
if (Test-Path $RegKey) { try { $installDir = (Get-ItemProperty -Path $RegKey).InstallLocation } catch {} }
if (-not $installDir) { $installDir = Join-Path $env:LOCALAPPDATA "Programs\$AppName" }

if (-not $Quiet) {
    $r = [System.Windows.Forms.MessageBox]::Show(
        "Remove CrowderSphere from this computer?`n`nYour posts are NOT deleted - they stay in your posts folder.",
        "Uninstall $AppName", 'YesNo', 'Question')
    if ($r -ne 'Yes') { exit 0 }
}

try {
    # Close the app if it's running
    try {
        Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains('server.ps1') -and $_.CommandLine.Contains($installDir) } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {}
    Get-Process -Name $AppName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800

    foreach ($lnk in (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"),
                     (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk")) {
        if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
    }
    if (Test-Path -LiteralPath $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force }
    if (Test-Path $RegKey) { Remove-Item -Path $RegKey -Recurse -Force }

    if (-not $Quiet) {
        $settingsDir = Join-Path $env:APPDATA 'CrowderSphere'
        if (Test-Path -LiteralPath $settingsDir) {
            $r2 = [System.Windows.Forms.MessageBox]::Show(
                "Also forget your WordPress connection and settings?`n`nChoose No if you might reinstall later.",
                "Uninstall $AppName", 'YesNo', 'Question')
            if ($r2 -eq 'Yes') { Remove-Item -LiteralPath $settingsDir -Recurse -Force }
        }
        [void][System.Windows.Forms.MessageBox]::Show('CrowderSphere has been removed.', "Uninstall $AppName", 'OK', 'Information')
    }
} catch {
    [void][System.Windows.Forms.MessageBox]::Show("Uninstall didn't finish:`n`n$($_.Exception.Message)", "Uninstall $AppName", 'OK', 'Error')
}
try { Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force } catch {}

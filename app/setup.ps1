# CrowderSphere Setup - a small installer window.
# Installs for the current user (no admin rights), builds "CrowderSphere.exe" with the C# compiler
# that ships with Windows, adds Start menu / Desktop shortcuts, and registers the app in
# Settings > Apps > Installed apps so it can be uninstalled like any other program.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$AppName  = 'CrowderSphere'
$RegKey   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CrowderSphere'
$OldName  = 'Blog Writer'   # the app's previous name - an old install is replaced automatically
$OldRegKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BlogWriter'
$SrcRoot  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SrcApp   = Join-Path $SrcRoot 'app'
$Version  = (Get-Content -LiteralPath (Join-Path $SrcApp 'version.txt') -Raw).Trim()
$PsExe    = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"

function Show-Error([string]$msg) {
    [void][System.Windows.Forms.MessageBox]::Show($msg, "$AppName Setup", 'OK', 'Error')
}

# ---------------------------------------------------------------- existing install?
$existing = $null
if (Test-Path $RegKey) { try { $existing = Get-ItemProperty -Path $RegKey } catch {} }
$oldInstall = $null
if (Test-Path $OldRegKey) { try { $oldInstall = Get-ItemProperty -Path $OldRegKey } catch {} }
$defaultDir = Join-Path $env:LOCALAPPDATA "Programs\$AppName"
if ($existing -and $existing.InstallLocation) { $defaultDir = $existing.InstallLocation }

# ---------------------------------------------------------------- install steps
function Stop-RunningCopy([string]$dir) {
    try {
        Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains('server.ps1') -and $_.CommandLine.Contains($dir) } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {}
}

function Build-Launcher([string]$dest) {
    $exe = Join-Path $dest "$AppName.exe"
    $csc = @("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
             "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $csc) { return $null }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if (Test-Path -LiteralPath $exe) { Remove-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue }
    $null = & $csc /nologo /target:winexe /optimize+ "/out:$exe" "/win32icon:$dest\app\crowdersphere.ico" `
        /reference:System.Windows.Forms.dll "$dest\app\launcher.cs" 2>&1
    $ok = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $exe))
    $ErrorActionPreference = $old
    if ($ok) { return $exe } else { return $null }
}

function New-AppShortcut([string]$lnk, [string]$dest, [string]$exe) {
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($lnk)
    if ($exe) { $s.TargetPath = $exe }
    else {
        $s.TargetPath = $PsExe
        $s.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dest\app\server.ps1`""
        $s.WindowStyle = 7
    }
    $s.WorkingDirectory = $dest
    $s.IconLocation = "$dest\app\crowdersphere.ico,0"
    $s.Description = 'Write and publish WordPress posts'
    $s.Save()
}

function Register-App([string]$dest) {
    if (-not (Test-Path $RegKey)) { New-Item -Path $RegKey -Force | Out-Null }
    $kb = [int]((Get-ChildItem -LiteralPath $dest -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
    $uninst = "`"$PsExe`" -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dest\app\uninstall.ps1`""
    $vals = [ordered]@{
        DisplayName = $AppName; DisplayVersion = $Version; Publisher = 'CrowderSphere'
        DisplayIcon = "$dest\app\crowdersphere.ico"; InstallLocation = $dest
        UninstallString = $uninst; QuietUninstallString = "$uninst -Quiet"
        InstallDate = (Get-Date).ToString('yyyyMMdd'); Comments = 'Write blog posts on your PC and publish them to WordPress'
    }
    foreach ($k in $vals.Keys) { New-ItemProperty -Path $RegKey -Name $k -Value $vals[$k] -PropertyType String -Force | Out-Null }
    foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Path $RegKey -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
    New-ItemProperty -Path $RegKey -Name 'EstimatedSize' -Value $kb -PropertyType DWord -Force | Out-Null
}

function Remove-OldInstall([string]$dest) {
    if (-not $oldInstall) { return }
    $oldDir = $oldInstall.InstallLocation
    if ($oldDir) { Stop-RunningCopy $oldDir }
    Get-Process -Name $OldName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    foreach ($lnk in (Join-Path ([Environment]::GetFolderPath('Desktop')) "$OldName.lnk"),
                     (Join-Path ([Environment]::GetFolderPath('Programs')) "$OldName.lnk")) {
        if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue }
    }
    $oldSettings = Join-Path $env:APPDATA 'BlogWriter'
    $newSettings = Join-Path $env:APPDATA 'CrowderSphere'
    if ((Test-Path -LiteralPath $oldSettings) -and -not (Test-Path -LiteralPath $newSettings)) {
        Copy-Item -LiteralPath $oldSettings -Destination $newSettings -Recurse -Force
    }
    if ($oldDir -and (Test-Path -LiteralPath $oldDir) -and ($oldDir.TrimEnd('\') -ne $dest.TrimEnd('\'))) {
        Start-Sleep -Milliseconds 500
        Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -Path $OldRegKey -Recurse -Force -ErrorAction SilentlyContinue
}

function Install-App([string]$dest, [bool]$desktop, [scriptblock]$report) {
    & $report 'Closing CrowderSphere if it is open...'
    if ($existing -and $existing.InstallLocation) { Stop-RunningCopy $existing.InstallLocation }
    Stop-RunningCopy $dest
    Get-Process -Name $AppName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600

    & $report 'Copying files...'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $srcFull = (Resolve-Path -LiteralPath $SrcRoot).Path.TrimEnd('\')
    $dstFull = (Resolve-Path -LiteralPath $dest).Path.TrimEnd('\')
    if ($srcFull -ne $dstFull) {
        & robocopy.exe $SrcApp (Join-Path $dest 'app') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Copying files failed (robocopy code $LASTEXITCODE)." }
        $readme = Join-Path $SrcRoot 'README.md'
        if (Test-Path -LiteralPath $readme) { Copy-Item -LiteralPath $readme -Destination $dest -Force }
    }
    Get-ChildItem -LiteralPath $dest -Recurse -File | Unblock-File

    & $report 'Building CrowderSphere.exe...'
    $exe = Build-Launcher $dest

    & $report 'Adding shortcuts...'
    New-AppShortcut (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk") $dest $exe
    $deskLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
    if ($desktop) { New-AppShortcut $deskLnk $dest $exe }
    elseif (Test-Path -LiteralPath $deskLnk) { Remove-Item -LiteralPath $deskLnk -Force }

    & $report 'Registering with Windows...'
    Register-App $dest
    if ($oldInstall) { & $report "Removing the old $OldName install..."; Remove-OldInstall $dest }
    return $exe
}

# ---------------------------------------------------------------- window
$form = New-Object System.Windows.Forms.Form
$form.Text = "$AppName Setup"
$form.ClientSize = New-Object System.Drawing.Size(540, 360)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$form.BackColor = [System.Drawing.Color]::White
$icoPath = Join-Path $SrcApp 'crowdersphere.ico'
if (Test-Path $icoPath) { $form.Icon = New-Object System.Drawing.Icon($icoPath) }

$header = New-Object System.Windows.Forms.Panel
$header.Dock = 'Top'; $header.Height = 92
$header.BackColor = [System.Drawing.Color]::FromArgb(47, 91, 211)
$form.Controls.Add($header)

if (Test-Path $icoPath) {
    $pic = New-Object System.Windows.Forms.PictureBox
    $pic.Image = (New-Object System.Drawing.Icon($icoPath, 64, 64)).ToBitmap()
    $pic.SizeMode = 'Zoom'; $pic.Size = New-Object System.Drawing.Size(56, 56); $pic.Location = New-Object System.Drawing.Point(22, 18)
    $header.Controls.Add($pic)
}
$h1 = New-Object System.Windows.Forms.Label
$h1.Text = $AppName; $h1.ForeColor = [System.Drawing.Color]::White
$h1.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 17)
$h1.AutoSize = $true; $h1.Location = New-Object System.Drawing.Point(90, 16)
$header.Controls.Add($h1)
$h2 = New-Object System.Windows.Forms.Label
$h2.ForeColor = [System.Drawing.Color]::FromArgb(220, 228, 250); $h2.AutoSize = $true
$h2.Location = New-Object System.Drawing.Point(92, 54)
if ($existing -and $existing.DisplayVersion) { $h2.Text = "Update from version $($existing.DisplayVersion) to $Version" }
elseif ($oldInstall) { $h2.Text = "Replaces $OldName $($oldInstall.DisplayVersion) - your posts and settings carry over" }
else { $h2.Text = "Version $Version  -  write posts on your PC, publish to WordPress" }
$header.Controls.Add($h2)

$lblDir = New-Object System.Windows.Forms.Label
$lblDir.Text = 'Install folder'; $lblDir.AutoSize = $true; $lblDir.Location = New-Object System.Drawing.Point(24, 112)
$form.Controls.Add($lblDir)
$txtDir = New-Object System.Windows.Forms.TextBox
$txtDir.Text = $defaultDir; $txtDir.Location = New-Object System.Drawing.Point(24, 134); $txtDir.Width = 400
$form.Controls.Add($txtDir)
$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = 'Browse...'; $btnBrowse.Location = New-Object System.Drawing.Point(432, 132); $btnBrowse.Width = 84
$form.Controls.Add($btnBrowse)
$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'Choose where to install CrowderSphere'
    if ($dlg.ShowDialog($form) -eq 'OK') { $txtDir.Text = Join-Path $dlg.SelectedPath $AppName }
})

$chkDesk = New-Object System.Windows.Forms.CheckBox
$chkDesk.Text = 'Add a shortcut to my desktop'; $chkDesk.Checked = $true; $chkDesk.AutoSize = $true
$chkDesk.Location = New-Object System.Drawing.Point(24, 172)
$form.Controls.Add($chkDesk)
$chkRun = New-Object System.Windows.Forms.CheckBox
$chkRun.Text = 'Start CrowderSphere when setup finishes'; $chkRun.Checked = $true; $chkRun.AutoSize = $true
$chkRun.Location = New-Object System.Drawing.Point(24, 198)
$form.Controls.Add($chkRun)

$note = New-Object System.Windows.Forms.Label
$note.Text = 'Installs just for you - no administrator rights needed. Your posts and your WordPress connection are kept when you update. Remove it any time from Settings > Apps.'
$note.ForeColor = [System.Drawing.Color]::FromArgb(100, 100, 100)
$note.Location = New-Object System.Drawing.Point(24, 232); $note.Size = New-Object System.Drawing.Size(492, 40)
$form.Controls.Add($note)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(24, 280); $progress.Size = New-Object System.Drawing.Size(492, 8)
$progress.Style = 'Marquee'; $progress.MarqueeAnimationSpeed = 30; $progress.Visible = $false
$form.Controls.Add($progress)
$status = New-Object System.Windows.Forms.Label
$status.AutoSize = $true; $status.Location = New-Object System.Drawing.Point(24, 294)
$status.ForeColor = [System.Drawing.Color]::FromArgb(60, 60, 60)
$form.Controls.Add($status)

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = $(if ($existing -or $oldInstall) { 'Update' } else { 'Install' })
$btnInstall.Location = New-Object System.Drawing.Point(330, 318); $btnInstall.Size = New-Object System.Drawing.Size(90, 30)
$btnInstall.BackColor = [System.Drawing.Color]::FromArgb(47, 91, 211); $btnInstall.ForeColor = [System.Drawing.Color]::White
$btnInstall.FlatStyle = 'Flat'; $btnInstall.FlatAppearance.BorderSize = 0
$form.Controls.Add($btnInstall)
$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = 'Cancel'; $btnCancel.Location = New-Object System.Drawing.Point(426, 318); $btnCancel.Size = New-Object System.Drawing.Size(90, 30)
$form.Controls.Add($btnCancel)
$form.AcceptButton = $btnInstall
$form.CancelButton = $btnCancel
$btnCancel.Add_Click({ $form.Close() })

$script:done = $false
$script:exePath = $null
$btnInstall.Add_Click({
    if ($script:done) {
        if ($chkRun.Checked) {
            $dest = $txtDir.Text.Trim()
            if ($script:exePath) { Start-Process -FilePath $script:exePath }
            else { Start-Process $PsExe -ArgumentList "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dest\app\server.ps1`"" -WindowStyle Hidden }
        }
        $form.Close(); return
    }
    $dest = $txtDir.Text.Trim()
    if (-not $dest -or -not [IO.Path]::IsPathRooted($dest)) { Show-Error 'Please choose a full folder path to install to.'; return }
    foreach ($c in $btnInstall, $btnCancel, $btnBrowse, $txtDir, $chkDesk) { $c.Enabled = $false }
    $progress.Visible = $true
    $report = { param($m) $status.Text = $m; [System.Windows.Forms.Application]::DoEvents() }
    try {
        $script:exePath = Install-App $dest $chkDesk.Checked $report
        $script:done = $true
        $progress.Visible = $false
        $status.ForeColor = [System.Drawing.Color]::FromArgb(31, 122, 77)
        $status.Text = $(if ($existing) { "Updated to version $Version." } elseif ($oldInstall) { "$OldName is now CrowderSphere $Version." } else { 'CrowderSphere is installed. Find it in your Start menu.' })
        $btnInstall.Text = 'Finish'; $btnInstall.Enabled = $true
        $chkDesk.Visible = $false
    } catch {
        $progress.Visible = $false
        $status.ForeColor = [System.Drawing.Color]::FromArgb(180, 35, 24)
        $status.Text = 'Setup did not finish.'
        Show-Error ("Setup ran into a problem:`n`n" + $_.Exception.Message)
        foreach ($c in $btnInstall, $btnCancel, $btnBrowse, $txtDir, $chkDesk) { $c.Enabled = $true }
    }
})

try { [void]$form.ShowDialog() }
catch { Show-Error $_.Exception.Message }

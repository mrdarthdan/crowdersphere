# CrowderSphere - local server
# Runs a small web server on http://localhost:47821/ that the editor window talks to.
# Posts are stored as plain folders on disk; WordPress is reached through its REST API
# using an Application Password (stored encrypted with Windows DPAPI).

$ErrorActionPreference = 'Stop'
# Startup safety net: if anything fails before the editor is up, write it to the log and say so on screen
$script:EarlyLog = Join-Path (Join-Path $env:APPDATA 'CrowderSphere') 'log.txt'
trap {
    $m = "STARTUP FAILED: $($_.Exception.Message)  (line $($_.InvocationInfo.ScriptLineNumber))"
    try { [IO.Directory]::CreateDirectory((Split-Path $script:EarlyLog)) | Out-Null
          [IO.File]::AppendAllText($script:EarlyLog, ("{0:yyyy-MM-dd HH:mm:ss}  {1}`r`n" -f (Get-Date), $m)) } catch {}
    try { Add-Type -AssemblyName System.Windows.Forms
          [void][System.Windows.Forms.MessageBox]::Show("CrowderSphere couldn't start.`n`n$m`n`nDetails are in $script:EarlyLog", 'CrowderSphere', 'OK', 'Error') } catch {}
    exit 1
}
try { [IO.Directory]::CreateDirectory((Split-Path $script:EarlyLog)) | Out-Null
      [IO.File]::AppendAllText($script:EarlyLog, ("{0:yyyy-MM-dd HH:mm:ss}  Launching (PowerShell {1}, user {2})`r`n" -f (Get-Date), $PSVersionTable.PSVersion, $env:USERNAME)) } catch {}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$AppDir       = Split-Path -Parent $MyInvocation.MyCommand.Path
$UiDir        = Join-Path $AppDir 'ui'
$Port         = 47821
$BaseUrl      = "http://localhost:$Port/"
$Utf8         = New-Object System.Text.UTF8Encoding($false)
$Token        = [guid]::NewGuid().ToString('N')
$AppVersion   = '1.0'
try { $AppVersion = ([IO.File]::ReadAllText((Join-Path $AppDir 'version.txt'))).Trim() } catch {}
$DataDir      = Join-Path $env:APPDATA 'CrowderSphere'
$SettingsPath = Join-Path $DataDir 'settings.json'
$LogPath      = Join-Path $DataDir 'log.txt'
# Carry settings over from the app's previous name (Blog Writer)
$OldDataDir = Join-Path $env:APPDATA 'BlogWriter'
if (-not (Test-Path $DataDir) -and (Test-Path $OldDataDir)) {
    try { Copy-Item -LiteralPath $OldDataDir -Destination $DataDir -Recurse -Force } catch {}
}
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }

function Write-Log([string]$msg) {
    try { [IO.File]::AppendAllText($LogPath, ("{0:yyyy-MM-dd HH:mm:ss}  {1}`r`n" -f (Get-Date), $msg), $Utf8) } catch {}
}

# ---------------------------------------------------------------- helpers

function Set-Prop($obj, [string]$name, $value) {
    if ($obj.PSObject.Properties[$name]) { $obj.$name = $value }
    else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}
function Get-Prop($obj, [string]$name, $default = $null) {
    if ($obj -and $obj.PSObject.Properties[$name] -and $null -ne $obj.$name) { return $obj.$name }
    return $default
}
function Now-Iso { return (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss') }
function Write-Text([string]$path, [string]$text) { [IO.File]::WriteAllText($path, $text, $Utf8) }
function Read-Text([string]$path) { return [IO.File]::ReadAllText($path, $Utf8) }
function To-Json($obj) { return (ConvertTo-Json -InputObject $obj -Depth 20 -Compress) }

# ---------------------------------------------------------------- settings

function Load-Settings {
    $s = $null
    if (Test-Path $SettingsPath) {
        try { $s = (Read-Text $SettingsPath) | ConvertFrom-Json } catch { $s = $null }
    }
    if (-not $s) { $s = New-Object PSObject }
    if (-not (Get-Prop $s 'postsDir')) {
        Set-Prop $s 'postsDir' (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Blog Posts')
    }
    foreach ($p in 'siteUrl', 'username', 'passwordEnc') { if ($null -eq (Get-Prop $s $p)) { Set-Prop $s $p '' } }
    if (-not (Get-Prop $s 'restStyle')) { Set-Prop $s 'restStyle' 'pretty' }
    if (-not (Get-Prop $s 'maxImageWidth')) { Set-Prop $s 'maxImageWidth' 1920 }
    return $s
}
function Save-Settings { Write-Text $SettingsPath (ConvertTo-Json -InputObject $script:S -Depth 5) }

function Get-Password {
    if (-not $script:S.passwordEnc) { return '' }
    $ss = ConvertTo-SecureString $script:S.passwordEnc
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Set-Password([string]$plain) {
    if (-not $plain) { $script:S.passwordEnc = ''; return }
    $script:S.passwordEnc = (ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString)
}

$script:S = Load-Settings

# ---------------------------------------------------------------- posts on disk

function Get-PostsRoot {
    $root = $script:S.postsDir
    if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
    return $root
}
function Test-SafeName([string]$n) { return ($n -and $n -match '^[A-Za-z0-9._-]+$' -and $n -notmatch '^\.+$') }
function Get-PostDir([string]$id) {
    if (-not (Test-SafeName $id)) { throw "Bad post id" }
    $d = Join-Path (Get-PostsRoot) $id
    if (-not (Test-Path $d)) { throw "That post folder no longer exists: $d" }
    return $d
}
function Make-Slug([string]$title) {
    $s = ($title + '').ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
    $s = [regex]::Replace($s, '\p{Mn}', '')
    $s = [regex]::Replace($s, '[^a-z0-9]+', '-').Trim('-')
    if ($s.Length -gt 50) { $s = $s.Substring(0, 50).Trim('-') }
    if (-not $s) { $s = 'untitled' }
    return $s
}
function New-PostFolder([string]$title) {
    $root = Get-PostsRoot
    $base = (Get-Date).ToString('yyyy-MM-dd') + '-' + (Make-Slug $title)
    $id = $base; $n = 2
    while (Test-Path (Join-Path $root $id)) { $id = "$base-$n"; $n++ }
    $dir = Join-Path $root $id
    New-Item -ItemType Directory -Path (Join-Path $dir 'images') -Force | Out-Null
    return $id
}
function New-Meta {
    return [pscustomobject]@{
        title = ''; excerpt = ''; categories = @(); tags = ''; featured = ''
        created = (Now-Iso); modified = (Now-Iso)
        wpId = $null; wpLink = ''; wpStatus = ''; published = ''; scheduled = ''
        media = (New-Object PSObject)
    }
}
function Load-Meta([string]$dir) {
    $p = Join-Path $dir 'post.json'
    $m = $null
    if (Test-Path $p) { try { $m = (Read-Text $p) | ConvertFrom-Json } catch { $m = $null } }
    $def = New-Meta
    if (-not $m) { return $def }
    foreach ($prop in $def.PSObject.Properties) {
        if (-not $m.PSObject.Properties[$prop.Name]) { Set-Prop $m $prop.Name $prop.Value }
    }
    if ($null -eq $m.media) { $m.media = New-Object PSObject }
    return $m
}
function Save-Meta([string]$dir, $meta) { Write-Text (Join-Path $dir 'post.json') (ConvertTo-Json -InputObject $meta -Depth 10) }

function Get-PostList {
    $root = Get-PostsRoot
    $list = New-Object System.Collections.ArrayList
    foreach ($d in (Get-ChildItem -LiteralPath $root -Directory)) {
        if (-not (Test-Path (Join-Path $d.FullName 'post.json'))) { continue }
        if (-not (Test-SafeName $d.Name)) { continue }
        $m = Load-Meta $d.FullName
        [void]$list.Add([ordered]@{
            id = $d.Name; title = $m.title; modified = $m.modified; created = $m.created
            wpStatus = $m.wpStatus; wpLink = $m.wpLink; published = $m.published; scheduled = $m.scheduled
        })
    }
    return ,@($list | Sort-Object { $_.modified } -Descending)
}

function Save-Post($body) {
    $id = Get-Prop $body 'id'
    $bm = Get-Prop $body 'meta' (New-Object PSObject)
    if (-not $id) { $id = New-PostFolder (Get-Prop $bm 'title' '') }
    $dir = Get-PostDir $id
    $meta = Load-Meta $dir
    foreach ($f in 'title', 'excerpt', 'tags', 'featured') {
        if ($bm.PSObject.Properties[$f]) { Set-Prop $meta $f ([string]$bm.$f) }
    }
    if ($bm.PSObject.Properties['categories']) { Set-Prop $meta 'categories' @($bm.categories) }
    $meta.modified = Now-Iso
    if ($body.PSObject.Properties['html']) { Write-Text (Join-Path $dir 'post.html') ([string]$body.html) }
    Save-Meta $dir $meta
    return [ordered]@{ id = $id; meta = $meta }
}

function Save-Image([string]$id, [string]$name, [byte[]]$bytes) {
    $dir = Get-PostDir $id
    $imgDir = Join-Path $dir 'images'
    if (-not (Test-Path $imgDir)) { New-Item -ItemType Directory -Path $imgDir | Out-Null }
    $ext = [IO.Path]::GetExtension($name).ToLowerInvariant()
    if ($ext -eq '.jpeg') { $ext = '.jpg' }
    if ('.jpg', '.png', '.gif', '.webp' -notcontains $ext) { throw "Unsupported image type '$ext'. Use JPG, PNG, GIF or WebP." }
    $base = [IO.Path]::GetFileNameWithoutExtension($name).ToLowerInvariant()
    $base = [regex]::Replace($base, '[^a-z0-9_-]+', '-').Trim('-')
    if ($base.Length -gt 60) { $base = $base.Substring(0, 60) }
    if (-not $base) { $base = 'image' }
    $file = "$base$ext"; $n = 2
    while (Test-Path (Join-Path $imgDir $file)) { $file = "$base-$n$ext"; $n++ }
    [IO.File]::WriteAllBytes((Join-Path $imgDir $file), $bytes)
    return "images/$file"
}

function Get-ExportPath([string]$dir, [string]$name) {
    $name = $name.Trim()
    if ($name.Length -gt 120 -or $name -notmatch "^[A-Za-z0-9][A-Za-z0-9 ._()'&,-]*\.docx$" -or $name.Contains('..')) {
        throw "Bad export file name"
    }
    return (Join-Path $dir $name)
}

function Get-Mime([string]$path) {
    switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.jpg' { 'image/jpeg' } '.jpeg' { 'image/jpeg' } '.png' { 'image/png' }
        '.gif' { 'image/gif' } '.webp' { 'image/webp' } '.ico' { 'image/x-icon' }
        '.html' { 'text/html; charset=utf-8' } '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' } '.svg' { 'image/svg+xml' }
        default { 'application/octet-stream' }
    }
}

# ---------------------------------------------------------------- WordPress REST API

function Get-WpUrl([string]$route, [string]$query) {
    $site = ($script:S.siteUrl + '').Trim().TrimEnd('/')
    if (-not $site) { throw "Set your WordPress site address in Settings first." }
    if ($site -notmatch '^https?://') { $site = "https://$site" }
    if ($script:S.restStyle -eq 'query') {
        $u = "$site/?rest_route=$route"; if ($query) { $u += "&$query" }
    } else {
        $u = "$site/wp-json$route"; if ($query) { $u += "?$query" }
    }
    return $u
}

function Invoke-Wp([string]$method, [string]$route, [string]$query, $body, [string]$contentType, $headers) {
    if (-not $script:S.username -or -not $script:S.passwordEnc) { throw "Add your WordPress username and application password in Settings first." }
    $req = [Net.HttpWebRequest]::Create((Get-WpUrl $route $query))
    $req.Method = $method
    $req.Accept = 'application/json'
    $req.UserAgent = 'CrowderSphere/' + $AppVersion + ' (Windows)'
    $req.Timeout = 120000
    $req.ReadWriteTimeout = 600000
    $auth = [Convert]::ToBase64String($Utf8.GetBytes(($script:S.username + ':' + (Get-Password))))
    $req.Headers['Authorization'] = "Basic $auth"
    if ($headers) { foreach ($k in $headers.Keys) { $req.Headers[$k] = $headers[$k] } }
    if ($null -ne $body) {
        if ($body -is [string]) {
            $bytes = $Utf8.GetBytes($body)
            if (-not $contentType) { $contentType = 'application/json; charset=utf-8' }
        } else { $bytes = [byte[]]$body }
        $req.ContentType = $contentType
        $req.ContentLength = $bytes.Length
        $st = $req.GetRequestStream(); $st.Write($bytes, 0, $bytes.Length); $st.Close()
    }
    try {
        $resp = $req.GetResponse()
    } catch {
        $we = $_.Exception
        while ($we -and -not ($we -is [Net.WebException])) { $we = $we.InnerException }
        if ($we -and $we.Response) {
            $code = [int]$we.Response.StatusCode
            $txt = (New-Object IO.StreamReader($we.Response.GetResponseStream(), $Utf8)).ReadToEnd()
            $msg = $txt
            try { $j = $txt | ConvertFrom-Json; if ($j.message) { $msg = $j.message } } catch {
                $msg = [regex]::Replace($txt, '<[^>]+>', ' '); $msg = [regex]::Replace($msg, '\s+', ' ').Trim()
            }
            if ($msg.Length -gt 300) { $msg = $msg.Substring(0, 300) + '...' }
            if ($code -eq 401) { $msg += ' (Check the username and application password in Settings.)' }
            $ex = New-Object Exception("WordPress said (HTTP $code): $msg")
            $ex.Data['status'] = $code
            throw $ex
        }
        $inner = if ($we) { $we.Message } else { $_.Exception.Message }
        throw "Couldn't reach $($script:S.siteUrl): $inner"
    }
    $txt = (New-Object IO.StreamReader($resp.GetResponseStream(), $Utf8)).ReadToEnd()
    $resp.Close()
    $i = $txt.IndexOfAny([char[]]'{[')
    if ($i -lt 0) { throw "WordPress sent back something that isn't API data. Is the site address right?" }
    if ($i -gt 0) { $txt = $txt.Substring($i) }
    return ($txt | ConvertFrom-Json)
}

function Test-Wp {
    $tries = @($script:S.restStyle)
    $tries += @('pretty', 'query' | Where-Object { $_ -ne $script:S.restStyle })
    $firstErr = $null
    foreach ($style in $tries) {
        $script:S.restStyle = $style
        try {
            $me = Invoke-Wp 'GET' '/wp/v2/users/me' 'context=edit' $null $null $null
            Save-Settings
            $caps = Get-Prop $me 'capabilities'
            $canPublish = $true
            if ($caps -and $caps.PSObject.Properties['publish_posts']) { $canPublish = [bool]$caps.publish_posts }
            return [ordered]@{ ok = $true; name = $me.name; canPublish = $canPublish }
        } catch {
            if (-not $firstErr) { $firstErr = $_.Exception.Message }
            $st = $_.Exception.Data['status']
            if ($st -eq 401 -or $st -eq 403) { $script:S.restStyle = $tries[0]; throw $_.Exception.Message }
        }
    }
    $script:S.restStyle = $tries[0]
    throw $firstErr
}

function Get-Categories {
    $r = Invoke-Wp 'GET' '/wp/v2/categories' 'per_page=100&orderby=name&hide_empty=false' $null $null $null
    $out = New-Object System.Collections.ArrayList
    foreach ($c in @($r)) { [void]$out.Add([ordered]@{ id = $c.id; name = [Net.WebUtility]::HtmlDecode($c.name); parent = $c.parent }) }
    return ,$out.ToArray()
}

function Add-Category([string]$name) {
    $r = Invoke-Wp 'POST' '/wp/v2/categories' $null (To-Json @{ name = $name }) $null $null
    return [ordered]@{ id = $r.id; name = [Net.WebUtility]::HtmlDecode($r.name); parent = $r.parent }
}

function Resolve-TagIds([string]$tagText) {
    $ids = New-Object System.Collections.ArrayList
    foreach ($raw in ($tagText -split ',')) {
        $name = $raw.Trim()
        if (-not $name) { continue }
        $found = $null
        $r = Invoke-Wp 'GET' '/wp/v2/tags' ('per_page=100&search=' + [Uri]::EscapeDataString($name)) $null $null $null
        foreach ($t in @($r)) {
            if ([Net.WebUtility]::HtmlDecode($t.name) -ieq $name) { $found = $t.id; break }
        }
        if (-not $found) {
            $t = Invoke-Wp 'POST' '/wp/v2/tags' $null (To-Json @{ name = $name }) $null $null
            $found = $t.id
        }
        [void]$ids.Add([int]$found)
    }
    return ,$ids.ToArray()
}

function Ensure-Media([string]$dir, $meta, [string]$rel) {
    $path = Join-Path $dir ($rel -replace '/', '\')
    if (-not (Test-Path -LiteralPath $path)) { throw "Image file is missing: $rel" }
    $fi = Get-Item -LiteralPath $path
    $prev = $meta.media.PSObject.Properties[$rel]
    if ($prev -and $prev.Value.size -eq $fi.Length -and [string]$prev.Value.mtime -eq [string]$fi.LastWriteTimeUtc.Ticks) {
        return $prev.Value
    }
    $bytes = [IO.File]::ReadAllBytes($path)
    $headers = @{ 'Content-Disposition' = ('attachment; filename="' + $fi.Name + '"') }
    $r = Invoke-Wp 'POST' '/wp/v2/media' $null $bytes (Get-Mime $path) $headers
    $entry = [pscustomobject]@{ id = $r.id; url = $r.source_url; size = $fi.Length; mtime = [string]$fi.LastWriteTimeUtc.Ticks }
    Set-Prop $meta.media $rel $entry
    Save-Meta $dir $meta   # remember uploads even if a later step fails
    return $entry
}

# WordPress gives date_gmt as "2026-11-17T15:00:00" (UTC, no zone); store it as ISO UTC with a Z
function To-UtcIso([string]$wpGmt) {
    if (-not $wpGmt) { return '' }
    $d = [datetime]::Parse($wpGmt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]'AdjustToUniversal, AssumeUniversal')
    return $d.ToString('yyyy-MM-ddTHH:mm:ss') + 'Z'
}

function Publish-Post([string]$id, [string]$status, [string]$html, [string]$scheduleAt = '') {
    $dir = Get-PostDir $id
    $meta = Load-Meta $dir
    if (-not $meta.title.Trim()) { throw "Give the post a title before sending it to WordPress." }
    if ($html) { Write-Text (Join-Path $dir 'post.html') $html } else { $html = Read-Text (Join-Path $dir 'post.html') }

    # 1. Upload every local image the post uses, then point the HTML at the uploaded copies
    $content = $html
    $rels = New-Object System.Collections.Generic.List[string]
    foreach ($m in [regex]::Matches($html, 'src="(images/[^"]+)"')) {
        if (-not $rels.Contains($m.Groups[1].Value)) { $rels.Add($m.Groups[1].Value) }
    }
    foreach ($rel in $rels) {
        $media = Ensure-Media $dir $meta $rel
        $content = $content.Replace("src=""$rel""", "src=""$($media.url)"" class=""wp-image-$($media.id)""")
    }
    $content = [regex]::Replace($content, '\s(contenteditable|data-[a-z-]+)="[^"]*"', '')

    # 2. Featured image
    $featuredId = 0
    if ($meta.featured) {
        $fm = Ensure-Media $dir $meta $meta.featured
        $featuredId = [int]$fm.id
    }

    # 3. Taxonomy
    $tagIds = Resolve-TagIds ([string]$meta.tags)
    $cats = @(@($meta.categories) | Where-Object { $null -ne $_ } | ForEach-Object { [int]$_ })

    if ($status -eq 'keep') { $status = if ($meta.wpStatus) { $meta.wpStatus } else { 'draft' } }
    if ('draft', 'publish', 'pending', 'private', 'future' -notcontains $status) { $status = 'draft' }

    $payload = [ordered]@{
        title = $meta.title; content = $content; excerpt = $meta.excerpt; status = $status
        categories = $cats; tags = $tagIds; featured_media = $featuredId
    }
    # Scheduling: WordPress holds a "future" post and publishes it itself at date_gmt
    $wasScheduled = ($meta.wpStatus -eq 'future')
    if ($status -eq 'future') {
        $when = [datetime]::MinValue
        $ok = [datetime]::TryParse($scheduleAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]'AdjustToUniversal, AssumeUniversal', [ref]$when)
        if (-not $ok) { throw "Pick a date and time to schedule the post for." }
        if ($when -le [datetime]::UtcNow.AddMinutes(1)) { throw "The scheduled time has to be in the future." }
        $payload['date_gmt'] = $when.ToString('yyyy-MM-ddTHH:mm:ss')
    } elseif ($status -eq 'publish' -and $wasScheduled) {
        # "Publish now" on a scheduled post: move its date to now, or WordPress would keep it scheduled
        $payload['date_gmt'] = [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss')
    } elseif ($status -eq 'draft' -and $wasScheduled) {
        $payload['date_gmt'] = $null   # forget the old schedule
    }
    $json = To-Json $payload

    $r = $null
    if ($meta.wpId) {
        try { $r = Invoke-Wp 'POST' "/wp/v2/posts/$($meta.wpId)" $null $json $null $null }
        catch {
            $st = $_.Exception.Data['status']
            if ($st -eq 404 -or $st -eq 410) { $r = $null } else { throw }
        }
    }
    if (-not $r) { $r = Invoke-Wp 'POST' '/wp/v2/posts' $null $json $null $null }

    $meta.wpId = $r.id
    $meta.wpLink = $r.link
    $meta.wpStatus = $r.status
    $meta.scheduled = if ($r.status -eq 'future') { To-UtcIso ([string]$r.date_gmt) } else { '' }
    $meta.published = Now-Iso
    $meta.modified = $meta.published
    Save-Meta $dir $meta
    return [ordered]@{ id = $id; meta = $meta }
}

# Scheduled posts go live on WordPress by themselves; once their time has passed, ask WordPress
# for the real status so the post list stops saying "Scheduled".
function Sync-Scheduled {
    $changed = @()
    if (-not $script:S.username -or -not $script:S.passwordEnc) { return ,$changed }
    $root = Get-PostsRoot
    foreach ($d in (Get-ChildItem -LiteralPath $root -Directory)) {
        if (-not (Test-Path (Join-Path $d.FullName 'post.json'))) { continue }
        $m = Load-Meta $d.FullName
        if ($m.wpStatus -ne 'future' -or -not $m.wpId) { continue }
        $due = $true
        if ($m.scheduled) {
            $t = [datetime]::MinValue
            if ([datetime]::TryParse([string]$m.scheduled, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]'AdjustToUniversal, AssumeUniversal', [ref]$t)) {
                $due = ($t -le [datetime]::UtcNow)
            }
        }
        if (-not $due) { continue }
        try { $r = Invoke-Wp 'GET' "/wp/v2/posts/$($m.wpId)" 'context=edit' $null $null $null }
        catch { Write-Log "Sync-Scheduled $($d.Name): $($_.Exception.Message)"; continue }
        if ($r.status -ne $m.wpStatus) {
            $m.wpStatus = $r.status
            if ($r.link) { $m.wpLink = $r.link }
            $m.scheduled = if ($r.status -eq 'future') { To-UtcIso ([string]$r.date_gmt) } else { '' }
            Save-Meta $d.FullName $m
            $changed += $d.Name
        }
    }
    return ,$changed
}

# ---------------------------------------------------------------- windows bits

function Open-AppWindow([string]$url) {
    $edge = $null
    foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
                   'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
                   'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe') {
        try { $edge = (Get-ItemProperty -Path $k -ErrorAction Stop).'(default)' } catch {}
        if ($edge) { break }
    }
    if (-not $edge) {
        foreach ($c in "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") {
            if (Test-Path $c) { $edge = $c; break }
        }
    }
    if ($edge -and (Test-Path $edge)) {
        Start-Process -FilePath $edge -ArgumentList "--app=$url", '--window-size=1440,960'
    } else {
        Start-Process $url
    }
}

function Pick-Folder([string]$start) {
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Opacity = 0
    $owner.StartPosition = 'CenterScreen'
    $owner.Show(); $owner.Activate()
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'Choose the folder where CrowderSphere keeps your posts'
    $dlg.ShowNewFolderButton = $true
    if ($start -and (Test-Path $start)) { $dlg.SelectedPath = $start }
    try {
        if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.SelectedPath }
        return $null
    } finally { $owner.Close(); $owner.Dispose() }
}

# ---------------------------------------------------------------- HTTP plumbing

function Send-Bytes($ctx, [byte[]]$bytes, [string]$type, [int]$status = 200) {
    $r = $ctx.Response
    $r.StatusCode = $status
    $r.ContentType = $type
    $r.Headers['Cache-Control'] = 'no-store'
    $r.Headers['X-Content-Type-Options'] = 'nosniff'
    $r.ContentLength64 = $bytes.Length
    $r.OutputStream.Write($bytes, 0, $bytes.Length)
}
function Send-Json($ctx, $obj, [int]$status = 200) {
    Send-Bytes $ctx ($Utf8.GetBytes((To-Json $obj))) 'application/json; charset=utf-8' $status
}
function Read-Body($ctx) {
    $ms = New-Object IO.MemoryStream
    $ctx.Request.InputStream.CopyTo($ms)
    return ,$ms.ToArray()
}
function Read-JsonBody($ctx) {
    $b = Read-Body $ctx
    if ($b.Length -eq 0) { return (New-Object PSObject) }
    return ($Utf8.GetString($b) | ConvertFrom-Json)
}
function Public-Settings {
    return [ordered]@{
        siteUrl = $script:S.siteUrl; username = $script:S.username
        hasPassword = [bool]$script:S.passwordEnc; postsDir = $script:S.postsDir
        maxImageWidth = [int]$script:S.maxImageWidth; version = $AppVersion
        prefs = (Get-Prop $script:S 'prefs' (New-Object PSObject))
    }
}

$script:LastSeen = (Get-Date).AddSeconds(90)   # grace period while the window opens
$script:ByeAt = $null

function Handle-Request($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $q = $req.QueryString
    $method = $req.HttpMethod
    $script:ByeAt = $null

    if ($path -eq '/' -or $path -eq '/index.html') {
        $html = (Read-Text (Join-Path $UiDir 'index.html')).Replace('__API_TOKEN__', $Token)
        Send-Bytes $ctx ($Utf8.GetBytes($html)) 'text/html; charset=utf-8'
        return
    }
    if ($path -eq '/favicon.ico') {
        $ico = Join-Path $AppDir 'crowdersphere.ico'
        if (Test-Path $ico) { Send-Bytes $ctx ([IO.File]::ReadAllBytes($ico)) 'image/x-icon' } else { Send-Bytes $ctx ([byte[]]@()) 'image/x-icon' 404 }
        return
    }
    if ($path -match '^/((vendor/)?[a-z0-9-]+\.js)$') {
        $jsFile = Join-Path $UiDir ($Matches[1] -replace '/', '\')
        if (Test-Path -LiteralPath $jsFile) { Send-Bytes $ctx ([IO.File]::ReadAllBytes($jsFile)) 'application/javascript; charset=utf-8' }
        else { Send-Bytes $ctx ([byte[]]@()) 'text/plain' 404 }
        return
    }
    if ($path -like '/files/*') {
        $parts = $path.Substring(7).Split('/') | ForEach-Object { [Uri]::UnescapeDataString($_) }
        if ($parts.Count -ne 3 -or $parts[1] -ne 'images' -or -not (Test-SafeName $parts[0]) -or -not (Test-SafeName $parts[2])) {
            Send-Bytes $ctx ([byte[]]@()) 'text/plain' 404; return
        }
        $f = Join-Path (Join-Path (Join-Path (Get-PostsRoot) $parts[0]) 'images') $parts[2]
        if (Test-Path -LiteralPath $f) { Send-Bytes $ctx ([IO.File]::ReadAllBytes($f)) (Get-Mime $f) }
        else { Send-Bytes $ctx ([byte[]]@()) 'text/plain' 404 }
        return
    }
    if ($path -notlike '/api/*') { Send-Bytes $ctx ($Utf8.GetBytes('Not found')) 'text/plain' 404; return }

    # Every API call must carry the per-session token (stops other web pages poking the local server)
    $tok = $req.Headers['X-Token']; if (-not $tok) { $tok = $q['t'] }
    if ($tok -ne $Token) { Send-Json $ctx @{ error = 'Session expired - close and reopen CrowderSphere.' } 403; return }
    if ($method -eq 'GET') {} elseif ($method -ne 'POST') { Send-Json $ctx @{ error = 'Method not allowed' } 405; return }

    $script:LastSeen = Get-Date
    switch ($path) {
        '/api/heartbeat' { Send-Json $ctx @{ ok = $true } }
        '/api/bye'       { $script:ByeAt = Get-Date; Send-Json $ctx @{ ok = $true } }
        '/api/settings'  {
            if ($method -eq 'POST') {
                $b = Read-JsonBody $ctx
                foreach ($f in 'siteUrl', 'username') { if ($b.PSObject.Properties[$f]) { $script:S.$f = ([string]$b.$f).Trim() } }
                if ($b.PSObject.Properties['postsDir'] -and ([string]$b.postsDir).Trim()) { $script:S.postsDir = ([string]$b.postsDir).Trim() }
                if ($b.PSObject.Properties['maxImageWidth']) { $script:S.maxImageWidth = [int]$b.maxImageWidth }
                if ($b.PSObject.Properties['appPassword'] -and ([string]$b.appPassword).Trim()) { Set-Password ([string]$b.appPassword).Trim() }
                if ($b.PSObject.Properties['clearPassword'] -and $b.clearPassword) { Set-Password '' }
                if ($b.PSObject.Properties['prefs'] -and $null -ne $b.prefs) { Set-Prop $script:S 'prefs' $b.prefs }
                if ($b.PSObject.Properties['siteUrl']) { $script:S.restStyle = 'pretty' }
                Save-Settings
                [void](Get-PostsRoot)
            }
            Send-Json $ctx (Public-Settings)
        }
        '/api/test'       { Send-Json $ctx (Test-Wp) }
        '/api/posts'      { Send-Json $ctx @{ posts = (Get-PostList); postsDir = $script:S.postsDir } }
        '/api/post'       {
            if ($method -eq 'POST') { Send-Json $ctx (Save-Post (Read-JsonBody $ctx)); return }
            $dir = Get-PostDir $q['id']
            $hp = Join-Path $dir 'post.html'
            $html = if (Test-Path $hp) { Read-Text $hp } else { '' }
            Send-Json $ctx ([ordered]@{ id = $q['id']; meta = (Load-Meta $dir); html = $html })
        }
        '/api/delete'     {
            $dir = Get-PostDir $q['id']
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($dir, 'OnlyErrorDialogs', 'SendToRecycleBin')
            Send-Json $ctx @{ ok = $true }
        }
        '/api/image'      {
            $src = Save-Image $q['id'] $q['name'] (Read-Body $ctx)
            Send-Json $ctx @{ src = $src }
        }
        '/api/export'     {
            $dir = Get-PostDir $q['id']
            $file = Get-ExportPath $dir ([string]$q['name'])
            try { [IO.File]::WriteAllBytes($file, (Read-Body $ctx)) }
            catch {
                if ($_.Exception.Message -match 'another process') { throw "Close '$([IO.Path]::GetFileName($file))' in Word first, then export again." }
                throw
            }
            Send-Json $ctx @{ path = $file; name = [IO.Path]::GetFileName($file) }
        }
        '/api/openfile'   {
            $dir = Get-PostDir $q['id']
            $file = Get-ExportPath $dir ([string]$q['name'])
            if (-not (Test-Path -LiteralPath $file)) { throw "That file isn't there any more - export it again." }
            Start-Process -FilePath $file
            Send-Json $ctx @{ ok = $true }
        }
        '/api/categories' {
            if ($method -eq 'POST') { $b = Read-JsonBody $ctx; Send-Json $ctx (Add-Category ([string]$b.name)) }
            else { Send-Json $ctx @{ categories = (Get-Categories) } }
        }
        '/api/publish'    {
            $b = Read-JsonBody $ctx
            Send-Json $ctx (Publish-Post ([string]$b.id) ([string]$b.status) ([string]$b.html) ([string](Get-Prop $b 'scheduleAt' '')))
        }
        '/api/sync-scheduled' { Send-Json $ctx @{ changed = (Sync-Scheduled) } }
        '/api/open'       {
            $target = if ($q['id']) { Get-PostDir $q['id'] } else { Get-PostsRoot }
            Start-Process explorer.exe -ArgumentList ('"' + $target + '"')
            Send-Json $ctx @{ ok = $true }
        }
        '/api/browse'     { Send-Json $ctx @{ path = (Pick-Folder $q['start']) } }
        '/api/openurl'    {
            $u = [string]$q['url']
            if ($u -match '^https?://') { Start-Process $u }
            Send-Json $ctx @{ ok = $true }
        }
        default           { Send-Json $ctx @{ error = "Unknown API call $path" } 404 }
    }
}

# ---------------------------------------------------------------- main loop

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($BaseUrl)
$started = $false
try { $listener.Start(); $started = $true } catch { Write-Log "Listener start failed: $($_.Exception.Message)" }
if (-not $started) {
    # Is another copy already running and answering? Then just open a window on it.
    $alive = $false
    try { $wc = New-Object System.Net.WebClient; [void]$wc.DownloadString($BaseUrl); $alive = $true } catch {}
    if ($alive) { Open-AppWindow $BaseUrl; exit 0 }
    # Otherwise an old copy is stuck holding the port: stop it and try again.
    Write-Log 'Port busy but nothing answering - stopping stuck copies.'
    try {
        Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
            Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('server.ps1') } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {}
    Start-Sleep -Seconds 1
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($BaseUrl)
    $listener.Start()   # if this still fails, the startup safety net reports why
}
Write-Log "Started on $BaseUrl"
Open-AppWindow $BaseUrl

$running = $true
while ($running) {
    $ar = $listener.BeginGetContext($null, $null)
    while (-not $ar.AsyncWaitHandle.WaitOne(500)) {
        $now = Get-Date
        if ($script:ByeAt -and ($now - $script:ByeAt).TotalSeconds -gt 5) { $running = $false; break }
        if (($now - $script:LastSeen).TotalSeconds -gt 240) { $running = $false; break }
    }
    if (-not $running) { break }
    $ctx = $listener.EndGetContext($ar)
    try {
        Handle-Request $ctx
    } catch {
        $msg = $_.Exception.Message
        Write-Log "ERROR $($ctx.Request.Url.AbsolutePath): $msg"
        try { Send-Json $ctx @{ error = $msg } 500 } catch {}
    } finally {
        try { $ctx.Response.OutputStream.Close() } catch {}
    }
}
Write-Log 'Window closed - stopping.'
try { $listener.Stop(); $listener.Close() } catch {}

#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes the ESET security product, ESET Inspect Connector and ESET Management Agent,
    then reinstalls everything with an ESET PROTECT installer.

.DESCRIPTION
    Order of operations:
      1. Security product (Endpoint Security, Server Security, ...)
      2. ESET Inspect Connector
      3. ESET Management Agent
      4. Download and run the ESET PROTECT installer

    The security product is removed first. If that fails, nothing else is touched and the
    device stays protected and managed. If no ESET software is found, the script installs directly.

    Every product is tried without a password first, then with each supplied password.

    Handled cases:
      1618       Another MSI installation is running. Waits up to -MsiBusyWaitSec.
      1624       Stale transform reference in the MSI cache. Removes it (embedded
                 transforms are kept) and retries.
      5003/5009  Installer could not download packages from repository.eset.com. Retries.

    Every run removes and reinstalls ESET. Do not schedule it as a recurring task.

.PARAMETER Url
    ESET PROTECT installer URL (https://redirector.eset.systems/li-handler/?uuid=...). Required.
    Use an installer containing ESET Server Security for Windows Server.

.PARAMETER UninstallPassword
    Uninstall passwords, separated by "|".

.PARAMETER LogPath
    Folder for the MSI uninstall logs. Default: none, the logs are deleted after use.
    When set, the logs are masked in the private working folder first and then copied there,
    so no password reaches -LogPath. A folder that does not exist yet is created with access
    for SYSTEM and Administrators only.

.EXAMPLE
    .\Reinstall-Eset.ps1 -Url "https://redirector.eset.systems/li-handler/?uuid=epi_win-..." -UninstallPassword "pw1|pw2"

.NOTES
    Exit codes:
      0   Success. Check the log for "REBOOT REQUIRED".
      1   Unexpected error
      2   Missing or invalid parameter
      10  Installer download failed
      11  Installer signature invalid or not signed by ESET
      20  Installation failed
      30  Uninstallation failed
#>

[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$Url               = '',
    [string]$UninstallPassword = '',
    [string]$LogPath           = '',
    [string]$Arguments         = '--silent --accepteula',
    [int]$DownloadRetries      = 3,
    [int]$InstallRetries       = 5,
    [int]$DownloadTimeoutSec   = 300,
    [int]$MsiBusyWaitSec       = 600,
    [bool]$RemoveInspectConnector = $true,
    [bool]$RemoveAgent         = $true,
    [bool]$ScheduleReboot      = $false,
    [int]$RebootDelaySec       = 600
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# Private working folder: a standard user must not be able to swap the installer
# between download and start, or read MSI logs (C:\Windows\Temp is writable for users)
$WorkDir       = Join-Path $env:ProgramData ('EsetReinstall_' + [guid]::NewGuid().ToString('N'))
$InstallerPath = Join-Path $WorkDir 'eset_install.exe'

$UninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    # Write-Host keeps log lines out of function return values
    Write-Host ("[{0}] [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, (Hide-Secret $Message))
}

function Hide-Secret {
    param([string]$Text)
    foreach ($pw in $script:Passwords) {
        if ($pw) { $Text = $Text -replace [regex]::Escape($pw), '********' }
    }
    $Text
}

function Get-PasswordList {
    # Blank first, then parameter values
    $list = New-Object System.Collections.Generic.List[string]
    $list.Add('')

    foreach ($pw in ($UninstallPassword -split '\|')) {
        if ($pw) { $list.Add($pw) }
    }

    $list | Select-Object -Unique
}

function New-PrivateDirectory {
    # Access for SYSTEM (S-1-5-18) and Administrators (S-1-5-32-544) only; SIDs work on any OS language
    param([string]$Path)
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed on '$Path' (exit code $LASTEXITCODE)" }
    # Anything created before the lock-down could be owned (and later swapped) by a standard user
    if (Get-ChildItem -LiteralPath $Path -Force) { throw "Folder '$Path' was not empty after locking it down" }
}

function Close-MsiLog {
    # The log is written in the private folder and masked there before a copy reaches -LogPath,
    # because a verbose MSI log can contain the PASSWORD property
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    if ($LogPath) {
        Set-Content -Path $Path -Value (Hide-Secret (Get-Content -Path $Path -Raw)) -Encoding Unicode
        Copy-Item -LiteralPath $Path -Destination $LogPath -Force
    }
    Remove-Item $Path -Force -ErrorAction SilentlyContinue
}

function Test-EsetSignature {
    param([string]$Path)
    $sig = Get-AuthenticodeSignature -FilePath $Path
    $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
    Write-Log "Installer signature: $($sig.Status) | $subject"
    $sig.Status -eq 'Valid' -and $subject -match '\bO="?ESET\b'
}

function Get-InstallerId {
    param([string]$Uri)
    if ($Uri -match 'uuid=([^&]+)') { return $Matches[1] }
    $Uri
}

function Get-EsetProducts {
    # Reads each key separately so broken entries from other software are skipped
    foreach ($root in $UninstallRoots) {
        foreach ($key in (Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
            try {
                $name = [string]$key.GetValue('DisplayName')
                if ($name -notlike 'ESET*' -or $key.PSChildName -notmatch '^\{[0-9A-Fa-f-]{36}\}$') { continue }

                $kind = if ($name -match 'Management Agent|Remote Administrator Agent') { 'Agent' }
                        elseif ($name -match 'Inspect Connector') { 'Connector' }
                        else { 'Security' }

                [pscustomobject]@{
                    Name    = $name
                    Version = [string]$key.GetValue('DisplayVersion')
                    Code    = $key.PSChildName
                    Kind    = $kind
                }
            }
            catch { }
        }
    }
}

function Get-PackedGuid {
    # Converts a product code to the packed form used under HKLM:\SOFTWARE\Classes\Installer\Products
    param([string]$Guid)
    $h = $Guid.Trim('{}') -replace '-', ''
    $r = (-join $h.Substring(0, 8)[7..0]) + (-join $h.Substring(8, 4)[3..0]) + (-join $h.Substring(12, 4)[3..0])
    for ($i = 16; $i -lt 32; $i += 2) { $r += [string]$h[$i + 1] + [string]$h[$i] }
    $r
}

function Repair-Transform {
    # Drops transforms that point to missing files, keeps embedded ones (":1031.mst")
    param([string]$ProductCode)
    $key = "HKLM:\SOFTWARE\Classes\Installer\Products\$(Get-PackedGuid $ProductCode)"
    $value = (Get-ItemProperty -Path $key -Name Transforms -ErrorAction SilentlyContinue).Transforms
    if (-not $value) { return $false }

    $keep = ($value -split ';' | Where-Object { $_ -like ':*' -or (Test-Path $_) }) -join ';'
    if ($keep -eq $value) { return $false }

    Set-ItemProperty -Path $key -Name Transforms -Value $keep
    Write-Log "Removed stale transform reference: '$value' -> '$keep'" 'WARN'
    $true
}

function Invoke-Msi {
    # Runs msiexec, waits while another installation holds the MSI mutex (1618)
    param([string]$ArgumentList)
    $waited = 0
    while ($true) {
        $rc = (Start-Process -FilePath 'msiexec.exe' -ArgumentList $ArgumentList -NoNewWindow -PassThru -Wait).ExitCode
        if ($rc -ne 1618 -or $waited -ge $MsiBusyWaitSec) { return $rc }
        Write-Log "Another installation is running (1618), waiting 30 s ($waited/$MsiBusyWaitSec s)." 'WARN'
        Start-Sleep -Seconds 30
        $waited += 30
    }
}

function Remove-EsetProduct {
    # Returns 'Ok', 'Reboot' or 'Failed'
    param($Product)

    Write-Log "Uninstalling $($Product.Name) $($Product.Version) $($Product.Code)"
    $msiLog = Join-Path $WorkDir ("eset_uninstall_{0}_{1}.log" -f ($Product.Code -replace '[{}]', ''), (Get-Date -Format 'yyyyMMdd_HHmmss'))
    $rc = -1

    foreach ($pw in $script:Passwords) {
        $label   = if ($pw) { 'password ' + ([array]::IndexOf(@($script:Passwords), $pw)) } else { 'no password' }
        $msiArgs = "/x $($Product.Code) /qn /norestart /l*v `"$msiLog`""
        if ($pw) { $msiArgs += " PASSWORD=`"$pw`" MsiHiddenProperties=PASSWORD" }

        $rc = Invoke-Msi $msiArgs
        if ($rc -eq 1624 -and (Repair-Transform $Product.Code)) {
            $rc = Invoke-Msi $msiArgs
        }

        Write-Log "  $label -> $rc"
        if ($rc -in 0, 1605) { Close-MsiLog $msiLog; return 'Ok' }
        if ($rc -eq 3010)    { Close-MsiLog $msiLog; return 'Reboot' }
        if ($rc -in 1618, 1624) { break }
    }

    if ($rc -eq 1618) {
        Write-Log 'Windows Installer stayed busy. Check for hung msiexec processes (Get-Process msiexec).' 'ERROR'
    }
    elseif (Test-Path $msiLog) {
        Select-String -Path $msiLog -Pattern '^ERROR:|Error \d{4}|Fehler \d{4}|Password is incorrect|Return value 3' |
            Where-Object { $_.Line -notmatch 'PASSWORD=|Property\(S\)' } |
            Select-Object -First 8 |
            ForEach-Object { Write-Log "  MSI: $($_.Line.Trim())" 'ERROR' }
    }
    Close-MsiLog $msiLog
    'Failed'
}

function Get-Installer {
    param([string]$Uri, [string]$OutFile)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    for ($i = 1; $i -le [Math]::Max(1, $DownloadRetries); $i++) {
        try {
            Write-Log "Downloading installer (attempt $i): $Uri"
            Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec $DownloadTimeoutSec
            if ((Test-Path $OutFile) -and (Get-Item $OutFile).Length -gt 0) {
                Write-Log "Downloaded $((Get-Item $OutFile).Length) bytes."
                return $true
            }
        }
        catch {
            Write-Log "Download failed: $($_.Exception.Message)" 'WARN'
        }
        Start-Sleep -Seconds ([Math]::Pow(2, $i))
    }
    $false
}

function Install-Eset {
    # Returns the installer exit code
    $rc = -1
    for ($i = 1; $i -le [Math]::Max(1, $InstallRetries); $i++) {
        Write-Log "Running installer (attempt $i): $InstallerPath $Arguments"
        $rc = (Start-Process -FilePath $InstallerPath -ArgumentList $Arguments -NoNewWindow -PassThru -Wait).ExitCode
        Write-Log "Installer exit code: $rc"
        if ($rc -notin 5003, 5009) { break }
        Write-Log 'Installer could not download packages from repository.eset.com, retrying in 30 s.' 'WARN'
        Start-Sleep -Seconds 30
    }
    $rc
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------

$script:Passwords = @('')
$rebootNeeded = $false

try {
    if (-not $Url) {
        Write-Log 'Parameter -Url is missing.' 'ERROR'
        exit 2
    }

    New-PrivateDirectory $WorkDir
    if ($LogPath -and -not (Test-Path $LogPath)) { New-PrivateDirectory $LogPath }

    $script:Passwords = @(Get-PasswordList)
    $installerId = Get-InstallerId $Url
    Write-Log "Installer: $installerId | Passwords to try: $($script:Passwords.Count) (incl. blank)"

    # --- Uninstall, step by step ---
    $products = @(Get-EsetProducts)

    if ($products.Count -eq 0) {
        Write-Log 'No ESET software found, installing directly.'
    }
    else {
        foreach ($p in $products) { Write-Log "Found: $($p.Name) $($p.Version) ($($p.Kind))" }

        # 1. Security product
        foreach ($p in ($products | Where-Object Kind -eq 'Security')) {
            switch (Remove-EsetProduct $p) {
                'Reboot' { $rebootNeeded = $true }
                'Failed' {
                    Write-Log "Could not remove $($p.Name). Nothing else was changed, the device is still protected and managed." 'ERROR'
                    exit 30
                }
            }
        }

        # 2. Inspect Connector (failure is not fatal)
        if ($RemoveInspectConnector) {
            foreach ($p in ($products | Where-Object Kind -eq 'Connector')) {
                switch (Remove-EsetProduct $p) {
                    'Reboot' { $rebootNeeded = $true }
                    'Failed' { Write-Log "Could not remove $($p.Name), continuing." 'WARN' }
                }
            }
        }

        # 3. Management Agent
        if ($RemoveAgent) {
            foreach ($p in ($products | Where-Object Kind -eq 'Agent')) {
                switch (Remove-EsetProduct $p) {
                    'Reboot' { $rebootNeeded = $true }
                    'Failed' {
                        Write-Log "Could not remove $($p.Name). The security product is already removed: the device is UNPROTECTED but still managed. Deploy the security product with an ESET PROTECT software install task, or fix the agent password and rerun." 'ERROR'
                        exit 30
                    }
                }
            }
        }

        Start-Sleep -Seconds 10
    }

    # --- Install ---
    if (-not (Get-Installer -Uri $Url -OutFile $InstallerPath)) {
        Write-Log 'Installer download failed. The device has NO ESET protection.' 'ERROR'
        exit 10
    }

    if (-not (Test-EsetSignature $InstallerPath)) {
        Write-Log 'Installer is not validly signed by ESET, not running it. The device has NO ESET protection.' 'ERROR'
        exit 11
    }

    $exitCode = Install-Eset

    switch ($exitCode) {
        { $_ -in 0, 3010 } {
            if ($rebootNeeded -or $exitCode -eq 3010) {
                Write-Log 'Installation successful. REBOOT REQUIRED.' 'WARN'
                if ($ScheduleReboot) {
                    Write-Log "Reboot scheduled in $RebootDelaySec s."
                    & shutdown.exe /r /t $RebootDelaySec /c "ESET has been updated. The computer will restart in $([int]($RebootDelaySec / 60)) minutes."
                }
            }
            else {
                Write-Log 'Installation successful.'
            }
            exit 0
        }
        { $_ -in 5003, 5009 } {
            Write-Log "Installation failed ($exitCode): packages could not be downloaded from repository.eset.com (HTTP port 80). Check firewall, proxy and web filtering. The device has NO ESET protection." 'ERROR'
        }
        5006 {
            Write-Log 'Installation failed (5006): a package in this installer is not available for this OS, e.g. an Endpoint Security installer on Windows Server. Use a matching installer.' 'ERROR'
        }
        5013 {
            $eraaLog = Get-ChildItem (Join-Path $env:TEMP 'eset') -Filter 'installer_*_eraa.log' -ErrorAction SilentlyContinue |
                       Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($eraaLog -and (Select-String -Path $eraaLog.FullName -Pattern 'CheckAgentSetupPasswordWin' -Quiet)) {
                Write-Log 'Installation failed (5013): the existing Management Agent is password protected. Disable "Password protect setup" in the agent policy or pass the agent password.' 'ERROR'
            }
            else {
                Write-Log 'Installation failed (5013): agent configuration failed. See the logs below.' 'ERROR'
            }
        }
        default {
            Write-Log "Installation failed with exit code $exitCode." 'ERROR'
        }
    }

    Write-Log "Logs: $env:TEMP\eset\bts\bootstrapper_*.log and $env:TEMP\eset\installer_*_eraa.log" 'ERROR'
    exit 20
}
catch {
    Write-Log "Unexpected error: $($_.Exception.Message)" 'ERROR'
    Write-Log $_.ScriptStackTrace 'ERROR'
    exit 1
}
finally {
    Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}

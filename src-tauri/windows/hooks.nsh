; CrowderSphere additions to the Windows installer (Tauri NSIS hooks).
;
; Version 1 (the PowerShell app) was installed to %LOCALAPPDATA%\Programs\CrowderSphere and used the
; same "Installed apps" entry name as version 2, so installing version 2 replaced its uninstall entry
; and left its program files behind. Clean those up after every install or update. Posts and settings
; (the posts folder and %APPDATA%\CrowderSphere) are never touched.

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $R9 "$LOCALAPPDATA\Programs\CrowderSphere"
  ; server.ps1 only exists in a version 1 install, so this never matches anything else
  ${If} ${FileExists} "$R9\app\server.ps1"
    DetailPrint "Removing CrowderSphere version 1 program files from $R9"
    ${If} "$INSTDIR" == "$R9"
      ; version 2 was installed into the same folder: remove only version 1's files
      RMDir /r "$R9\app"
    ${Else}
      RMDir /r "$R9"
    ${EndIf}
    ; Version 1's shortcuts started the old program; point any that are left at this one
    ${If} ${FileExists} "$DESKTOP\CrowderSphere.lnk"
      CreateShortcut "$DESKTOP\CrowderSphere.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${EndIf}
    ${If} ${FileExists} "$SMPROGRAMS\CrowderSphere.lnk"
      CreateShortcut "$SMPROGRAMS\CrowderSphere.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${EndIf}
  ${EndIf}
!macroend

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef PublishDir
  #define PublishDir "..\release\Moye"
#endif

[Setup]
AppId={{786D8F80-3AC2-4EA1-A739-1790FC2187DE}
AppName=墨页 Moye
AppVersion={#AppVersion}
AppPublisher=Moye contributors
AppPublisherURL=https://github.com/SakuraEdge/moye-markdown
AppSupportURL=https://github.com/SakuraEdge/moye-markdown/issues
AppUpdatesURL=https://github.com/SakuraEdge/moye-markdown/releases
DefaultDirName={localappdata}\Programs\Moye
DefaultGroupName=墨页 Moye
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\release
OutputBaseFilename=Moye-Setup-{#AppVersion}-windows-x64
SetupIconFile=..\native\Assets\moye.ico
UninstallDisplayIcon={app}\Moye.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ChangesAssociations=yes
LicenseFile=..\LICENSE
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked
Name: "defaultmd"; Description: "将墨页设为 .md 默认应用（安装后在 Windows 设置中确认）"; GroupDescription: "文件关联："; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\墨页 Moye"; Filename: "{app}\Moye.exe"
Name: "{autodesktop}\墨页 Moye"; Filename: "{app}\Moye.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\Moye.Markdown"; ValueType: string; ValueName: ""; ValueData: "Markdown 文档"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Moye.Markdown\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Moye.exe,0"
Root: HKCU; Subkey: "Software\Classes\Moye.Markdown\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Moye.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: none; ValueName: "Moye.Markdown"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: none; ValueName: "Moye.Markdown"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Moye\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "墨页 Moye"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Moye\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Markdown 编辑器"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "Moye.Markdown"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "Moye.Markdown"
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Moye"; ValueData: "Software\Moye\Capabilities"; Flags: uninsdeletevalue

[Run]
Filename: "ms-settings:defaultapps?registeredAppUser=Moye"; Flags: shellexec nowait skipifsilent; Tasks: defaultmd; Description: "设置 .md 默认应用"
Filename: "{app}\Moye.exe"; Description: "启动墨页 Moye"; Flags: nowait postinstall skipifsilent unchecked

#ifndef AppVersion
  #define AppVersion "1.0.2"
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
UsePreviousAppDir=yes
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
Source: "{#PublishDir}\installed-files.txt"; DestName: "moye-new-files.txt"; Flags: dontcopy

[Icons]
Name: "{group}\墨页 Moye"; Filename: "{app}\Moye.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\墨页 Moye"; Filename: "{app}\Moye.exe"; WorkingDir: "{app}"; Tasks: desktopicon

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

[Code]
var
  OldFiles, NewFiles: TStringList;

function GetFileAttributesW(FileName: string): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';

function SafeOwnedPath(Relative: string): Boolean;
var
  Root, Full, Parent, Lower: string;
begin
  Result := False;
  if Relative = '' then Exit;
  if (Pos('..', Relative) > 0) or
     (Pos(':', Relative) > 0) or (Relative[1] = '\') or
     (Relative[1] = '/') then Exit;
  if (Pos('/', Relative) > 0) or (Pos('\\', Relative) > 0) or
     (Pos('.\', Relative) > 0) or (Pos(' \', Relative) > 0) or
     (Trim(Relative) <> Relative) or (Relative[Length(Relative)] = '.') then Exit;
  Lower := Lowercase(Relative);
  if (Pos('data\', Lower) = 1) or (Pos('source\', Lower) = 1) or
     (Pos('backups\', Lower) = 1) then Exit;
  Root := AddBackslash(ExpandFileName(ExpandConstant('{app}')));
  Full := ExpandFileName(Root + Relative);
  if CompareText(Copy(Full, 1, Length(Root)), Root) <> 0 then Exit;
  Parent := ExtractFileDir(Full);
  while Length(Parent) >= Length(RemoveBackslashUnlessRoot(Root)) do begin
    if (GetFileAttributesW(Parent) and $400) <> 0 then Exit;
    if CompareText(AddBackslash(Parent), Root) = 0 then Break;
    Parent := ExtractFileDir(Parent);
  end;
  if (GetFileAttributesW(Full) and $400) <> 0 then Exit;
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): string;
var
  I, Separator: Integer;
  Line: string;
begin
  Result := '';
  OldFiles := TStringList.Create;
  NewFiles := TStringList.Create;
  if FileExists(ExpandConstant('{app}\installed-files.txt')) then
    OldFiles.LoadFromFile(ExpandConstant('{app}\installed-files.txt'));
  ExtractTemporaryFile('moye-new-files.txt');
  NewFiles.LoadFromFile(ExpandConstant('{tmp}\moye-new-files.txt'));
  for I := 0 to NewFiles.Count - 1 do begin
    Line := NewFiles[I];
    Separator := Pos('|', Line);
    NewFiles[I] := Lowercase(Copy(Line, Separator + 1, Length(Line)));
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  I, Separator: Integer;
  Line, Hash, Relative, Full: string;
begin
  if CurStep <> ssPostInstall then Exit;
  for I := 0 to OldFiles.Count - 1 do begin
    Line := OldFiles[I];
    Separator := Pos('|', Line);
    if Separator <> 65 then Continue;
    Hash := Copy(Line, 1, 64);
    Relative := Copy(Line, Separator + 1, Length(Line));
    if (NewFiles.IndexOf(Lowercase(Relative)) >= 0) or not SafeOwnedPath(Relative) then Continue;
    Full := ExpandConstant('{app}\') + Relative;
    if not FileExists(Full) then Continue;
    try
      if CompareText(GetSHA256OfFile(Full), Hash) = 0 then begin
        if DeleteFile(Full) then Log('Removed obsolete owned program file: ' + Relative);
      end else Log('Preserved changed file: ' + Relative);
    except
      Log('Preserved unavailable file: ' + Relative);
    end;
  end;
end;

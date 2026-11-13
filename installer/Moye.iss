#ifndef AppVersion
  #define AppVersion "4.0.2"
#endif
#ifndef AppReleaseVersion
  #define AppReleaseVersion "1.0.2"
#endif
#ifndef PublishDir
  #define PublishDir "..\release\MiniMark"
#endif

[Setup]
AppId={{786D8F80-3AC2-4EA1-A739-1790FC2187DE}
AppName=Mini Mark
AppVersion={#AppVersion}
AppVerName=Mini Mark Rev v{#AppReleaseVersion}
AppPublisher=Mini Mark contributors
AppPublisherURL=https://github.com/SakuraEdge/mini-mark
AppSupportURL=https://github.com/SakuraEdge/mini-mark/issues
AppUpdatesURL=https://github.com/SakuraEdge/mini-mark/releases
DefaultDirName={localappdata}\Programs\MiniMark
UsePreviousAppDir=yes
DefaultGroupName=Mini Mark
UsePreviousGroup=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\release
OutputBaseFilename=MiniMark-Setup-{#AppVersion}-windows-x64
SetupIconFile=..\native\Assets\mini-mark.ico
UninstallDisplayIcon={app}\MiniMark.exe
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
Name: "defaultmd"; Description: "将 Mini Mark 设为 .md 默认应用（安装后在 Windows 设置中确认）"; GroupDescription: "文件关联："; Flags: unchecked
Name: "defaultyaml"; Description: "将 Mini Mark 设为 .yaml/.yml 默认应用（安装后在 Windows 设置中确认）"; GroupDescription: "文件关联："; Flags: unchecked
Name: "defaulthtml"; Description: "将 Mini Mark 设为 .html/.htm 默认应用（安装后在 Windows 设置中确认）"; GroupDescription: "文件关联："; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PublishDir}\installed-files.txt"; DestName: "moye-new-files.txt"; Flags: dontcopy
#ifdef PatchList
Source: "{#PatchList}"; DestName: "moye-patch-files.txt"; Flags: dontcopy
#endif

[Icons]
Name: "{group}\Mini Mark"; Filename: "{app}\MiniMark.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Mini Mark"; Filename: "{app}\MiniMark.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\Moye.Markdown"; ValueType: string; ValueName: ""; ValueData: "Markdown 文档"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Moye.Markdown\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\wwwroot\document-icons\markdown.ico"",0"
Root: HKCU; Subkey: "Software\Classes\Moye.Markdown\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\MiniMark.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: none; ValueName: "Moye.Markdown"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: none; ValueName: "Moye.Markdown"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.mdown\OpenWithProgids"; ValueType: none; ValueName: "Moye.Markdown"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\Moye.Yaml"; ValueType: string; ValueName: ""; ValueData: "YAML 文档"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Moye.Yaml\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\wwwroot\document-icons\yaml.ico"",0"
Root: HKCU; Subkey: "Software\Classes\Moye.Yaml\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\MiniMark.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\.yaml\OpenWithProgids"; ValueType: none; ValueName: "Moye.Yaml"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.yml\OpenWithProgids"; ValueType: none; ValueName: "Moye.Yaml"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\MiniMark.Html"; ValueType: string; ValueName: ""; ValueData: "HTML 文档"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\MiniMark.Html\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\wwwroot\document-icons\html.ico"",0"
Root: HKCU; Subkey: "Software\Classes\MiniMark.Html\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\MiniMark.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\.html\OpenWithProgids"; ValueType: none; ValueName: "MiniMark.Html"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.htm\OpenWithProgids"; ValueType: none; ValueName: "MiniMark.Html"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Moye\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Mini Mark"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Moye\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Markdown / YAML / HTML 编辑器"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "Moye.Markdown"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "Moye.Markdown"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mdown"; ValueData: "Moye.Markdown"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".yaml"; ValueData: "Moye.Yaml"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".yml"; ValueData: "Moye.Yaml"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".html"; ValueData: "MiniMark.Html"
Root: HKCU; Subkey: "Software\Moye\Capabilities\FileAssociations"; ValueType: string; ValueName: ".htm"; ValueData: "MiniMark.Html"
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Moye"; ValueData: "Software\Moye\Capabilities"; Flags: uninsdeletevalue

[Run]
Filename: "ms-settings:defaultapps?registeredAppUser=Moye"; Flags: shellexec nowait skipifsilent; Tasks: defaultmd or defaultyaml or defaulthtml; Description: "设置文档默认应用"
Filename: "{app}\MiniMark.exe"; Description: "启动 Mini Mark"; Flags: nowait postinstall skipifsilent unchecked

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
#ifdef PatchList
  PatchFiles, RequiredFiles: TStringList;
  Hash, Relative, Full: string;
#endif
begin
  Result := '';
  OldFiles := TStringList.Create;
  NewFiles := TStringList.Create;
  if FileExists(ExpandConstant('{app}\installed-files.txt')) then
    OldFiles.LoadFromFile(ExpandConstant('{app}\installed-files.txt'));
  ExtractTemporaryFile('moye-new-files.txt');
  NewFiles.LoadFromFile(ExpandConstant('{tmp}\moye-new-files.txt'));
#ifdef PatchList
  PatchFiles := TStringList.Create;
  RequiredFiles := TStringList.Create;
  ExtractTemporaryFile('moye-patch-files.txt');
  PatchFiles.LoadFromFile(ExpandConstant('{tmp}\moye-patch-files.txt'));
  RequiredFiles.LoadFromFile(ExpandConstant('{tmp}\moye-new-files.txt'));
  for I := 0 to RequiredFiles.Count - 1 do begin
    Line := RequiredFiles[I];
    Separator := Pos('|', Line);
    Hash := Copy(Line, 1, 64);
    Relative := Copy(Line, Separator + 1, Length(Line));
    if PatchFiles.IndexOf(Lowercase(Relative)) >= 0 then Continue;
    Full := ExpandConstant('{app}\') + Relative;
    if (Separator <> 65) or not SafeOwnedPath(Relative) or not FileExists(Full) then begin
      Result := '此修复包需要完整的旧版应用，请使用完整安装包。';
      Exit;
    end;
    if CompareText(GetSHA256OfFile(Full), Hash) <> 0 then begin
      Result := '现有程序文件与修复包不匹配，请使用完整安装包。';
      Exit;
    end;
  end;
#endif
  for I := 0 to NewFiles.Count - 1 do begin
    Line := NewFiles[I];
    Separator := Pos('|', Line);
    NewFiles[I] := Lowercase(Copy(Line, Separator + 1, Length(Line)));
  end;
end;

procedure RemoveLegacyShortcut(Path: string);
var
  Shell, Shortcut: Variant;
  Target, ReadablePath: string;
begin
  if not FileExists(Path) then Exit;
  try
    ReadablePath := ExpandConstant('{tmp}\mini-mark-legacy.lnk');
    if not FileCopy(Path, ReadablePath, False) then Exit;
    Shell := CreateOleObject('WScript.Shell');
    Shortcut := Shell.CreateShortcut(ReadablePath);
    Target := Shortcut.TargetPath;
    if (CompareText(Target, ExpandConstant('{app}\Moye.exe')) = 0) or
       (CompareText(Target, ExpandConstant('{app}\MiniMark.exe')) = 0) then
      DeleteFile(Path);
  except
    Log('Preserved legacy shortcut: ' + Path);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  I, Separator: Integer;
  Line, Hash, Relative, Full: string;
begin
  if CurStep <> ssPostInstall then Exit;
  RemoveLegacyShortcut(ExpandConstant('{autodesktop}\墨页 Moye.lnk'));
  RemoveLegacyShortcut(ExpandConstant('{userprograms}\墨页 Moye\墨页 Moye.lnk'));
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

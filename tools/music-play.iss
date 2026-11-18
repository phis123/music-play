; music-play v1.0.0 Windows 安装程序（Inno Setup 6）
; 用 E:\android-toolchain\inno\ISCC.exe 编译

#define AppName "music-play"
#define AppVersion "1.0.0"
#define AppPublisher "phis123"
#define AppExe "music-play.exe"
; 打包前把 SourceDir 指到「应用目录副本」（务必排除用户曲库，否则安装包会超过 4GB 无法编译）
#define SourceDir "E:\music-play"

[Setup]
AppId={{2A7F3C51-9D64-4E8B-A317-C1B7E0D5F0A1}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName=E:\music-play
DisableDirPage=no
DefaultGroupName=music-play
DisableProgramGroupPage=yes
OutputDir=out
OutputBaseFilename=music-play-Setup-{#AppVersion}
SetupIconFile={#SourceDir}\app.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
AllowNoIcons=yes

[Languages]
Name: "cn"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\music-play"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\music-play"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "立即启动 music-play"; Flags: nowait postinstall skipifsilent

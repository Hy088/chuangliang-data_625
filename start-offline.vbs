' 数据看板离线启动器 (Windows 双击即用)
' 自动启动本地静态服务并打开浏览器

Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName) & "\"
url  = "http://127.0.0.1:8788/"

' 1) 先检查服务是否已在运行
If IsServiceUp(url) Then
    ws.Run url, 1, False
    WScript.Quit 0
End If

' 2) 启动服务（按优先级：node -> python -> powershell）
Dim cmd, svcCmd
svcCmd = ""

If CommandExists("node") Then
    svcCmd = "cmd /c """"node """" & base & "serve.js"""""""
ElseIf fso.FileExists("C:\Users\EDY\.workbuddy\binaries\node\versions\22.22.2\node.exe") Then
    svcCmd = "cmd /c """""""" & base & "serve.js"""""""""""
ElseIf CommandExists("python") Or CommandExists("python3") Then
    svcCmd = "cmd /c """"cd /d """" & base & """" && python -m http.server 8788"""""""
Else
    svcCmd = "powershell -ExecutionPolicy Bypass -File """" & base & "serve_offline.ps1"""""
End If

If svcCmd <> "" Then
    ws.Run svcCmd, 0, False
End If

' 3) 等待服务起来（最多 12 秒）
For i = 1 To 24
    WScript.Sleep 500
    If IsServiceUp(url) Then Exit For
Next

' 4) 打开浏览器
ws.Run url, 1, False

Function IsServiceUp(u)
    On Error Resume Next
    Set xhr = CreateObject("MSXML2.XMLHTTP")
    xhr.Open "GET", u, False
    xhr.Send
    If Err.Number = 0 And xhr.Status = 200 Then
        IsServiceUp = True
    Else
        IsServiceUp = False
    End If
    On Error GoTo 0
End Function

Function CommandExists(name)
    On Error Resume Next
    Dim path
    path = ws.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" & name & ".exe\")
    If Err.Number = 0 And path <> "" Then
        CommandExists = True
    Else
        CommandExists = False
    End If
    On Error GoTo 0
End Function

' Hidden launcher for sync-sales-excel.cmd - Task Scheduler runs this with wscript.exe so no console window appears.
' Passes the batch exit code back so the task's "Last Run Result" shows real failures.
' Keep this file ASCII-only (the folder path is taken from this script's own location, not typed here).
Option Explicit
Dim fso, sh, dir, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
rc = sh.Run("cmd.exe /c """ & dir & "\sync-sales-excel.cmd""", 0, True)
WScript.Quit rc

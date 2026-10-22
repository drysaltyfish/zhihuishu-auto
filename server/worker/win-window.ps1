param(
  [Parameter(Mandatory=$true)][ValidateSet('hide','show')][string]$Action,
  [string]$ProfilePath = ''
)
# 把刷课用的 Chrome 窗口藏起来/叫出来：
#  hide = 去掉任务栏按钮(WS_EX_TOOLWINDOW) + 移到屏幕外；窗口仍是 visible，
#         页面里的 document.visibilityState 不会变成 hidden（避免被反爬判定）。
#  show = 恢复任务栏按钮 + 移回屏幕内 + 置前。
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ZhsWin {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$GWL_EXSTYLE = -20
$WS_EX_TOOLWINDOW = 0x00000080
$SWP_NOSIZE = 0x0001
$SWP_NOZORDER = 0x0004
$SWP_FRAMECHANGED = 0x0020
$SWP_SHOWWINDOW = 0x0040
$HWND_TOP = [IntPtr]::Zero

$procs = @(Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($ProfilePath) {
  $matched = @()
  foreach ($p in $procs) {
    try {
      $cl = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.Id)).CommandLine
      if ($cl -and ($cl.IndexOf($ProfilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0)) { $matched += $p }
    } catch {}
  }
  if ($matched.Count -gt 0) { $procs = $matched }
}
if ($procs.Count -eq 0) { Write-Output 'no-window'; exit 3 }

$done = 0
foreach ($p in $procs) {
  $h = [IntPtr]$p.MainWindowHandle
  $ex = [ZhsWin]::GetWindowLong($h, $GWL_EXSTYLE)
  if ($Action -eq 'hide') {
    [void][ZhsWin]::SetWindowLong($h, $GWL_EXSTYLE, ($ex -bor $WS_EX_TOOLWINDOW))
    [void][ZhsWin]::SetWindowPos($h, $HWND_TOP, -32000, -32000, 0, 0, ($SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_FRAMECHANGED))
  } else {
    [void][ZhsWin]::SetWindowLong($h, $GWL_EXSTYLE, ($ex -band (-bnot $WS_EX_TOOLWINDOW)))
    [void][ZhsWin]::SetWindowPos($h, $HWND_TOP, 120, 80, 0, 0, ($SWP_NOSIZE -bor $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW))
    [void][ZhsWin]::ShowWindow($h, 9)
    [void][ZhsWin]::SetForegroundWindow($h)
  }
  $done++
}
Write-Output ("ok " + $done)

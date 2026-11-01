# Lumen system helper for Windows. Started once by the server; reads one command per line on stdin,
# writes one JSON line per command on stdout. Uses Core Audio for real system volume.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public class LumenAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Volume {
    get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); }
  }
  public static bool Mute {
    get { bool mute; Marshal.ThrowExceptionForHR(Vol().GetMute(out mute)); return mute; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); }
  }
}

// TV / monitor backlight over DDC/CI (only some screens allow this; many TVs don't over HDMI)
public static class LumenDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PHYSICAL_MONITOR { public IntPtr hPhysicalMonitor; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szPhysicalMonitorDescription; }
  delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr lprcMonitor, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint count);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint size, [Out] PHYSICAL_MONITOR[] arr);
  [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr h, out uint min, out uint cur, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr h, uint value);
  [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint size, PHYSICAL_MONITOR[] arr);
  // returns how many screens accepted the change
  public static int SetAll(int percent) {
    int ok = 0;
    var mons = new System.Collections.Generic.List<IntPtr>();
    MonitorEnumProc cb = (h, dc, r, d) => { mons.Add(h); return true; };
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cb, IntPtr.Zero);
    foreach (var m in mons) {
      uint n;
      if (!GetNumberOfPhysicalMonitorsFromHMONITOR(m, out n) || n == 0) continue;
      var arr = new PHYSICAL_MONITOR[n];
      if (!GetPhysicalMonitorsFromHMONITOR(m, n, arr)) continue;
      foreach (var p in arr) {
        uint mn, cur, mx;
        if (GetMonitorBrightness(p.hPhysicalMonitor, out mn, out cur, out mx) && mx > mn) {
          uint v = (uint)(mn + (mx - mn) * percent / 100.0 + 0.5);
          if (SetMonitorBrightness(p.hPhysicalMonitor, v)) ok++;
        }
      }
      DestroyPhysicalMonitors(n, arr);
    }
    return ok;
  }
}

public class LumenInput {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);
  public static void ScreenOff() { IntPtr r; SendMessageTimeout((IntPtr)0xFFFF, 0x0112, (IntPtr)0xF170, (IntPtr)2, 0x0002, 1000, out r); }
  public static void Key(byte vk, bool ext) {
    uint f = ext ? 1u : 0u;
    keybd_event(vk, 0, f, UIntPtr.Zero);
    keybd_event(vk, 0, f | 2u, UIntPtr.Zero);
  }
  public static void Combo(byte mod, byte vk, bool ext) {
    keybd_event(mod, 0, 0, UIntPtr.Zero);
    Key(vk, ext);
    keybd_event(mod, 0, 2u, UIntPtr.Zero);
  }
  public static bool Focus(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);   // Alt tap lets a background process take the foreground
    keybd_event(0x12, 0, 2u, UIntPtr.Zero);
    return SetForegroundWindow(h);
  }
}
'@

$keys = @{
  'up' = @(0x26, $true); 'down' = @(0x28, $true); 'left' = @(0x25, $true); 'right' = @(0x27, $true)
  'enter' = @(0x0D, $false); 'escape' = @(0x1B, $false); 'space' = @(0x20, $false); 'backspace' = @(0x08, $false)
  'tab' = @(0x09, $false); 'f11' = @(0x7A, $false); 'browserback' = @(0xA6, $true)
  'mediaplaypause' = @(0xB3, $true); 'volup' = @(0xAF, $true); 'voldown' = @(0xAE, $true); 'volmute' = @(0xAD, $true)
}

$script:reqId = 0
function Out-Json($obj) { if ($obj -is [hashtable] -and $script:reqId) { $obj.id = $script:reqId }; [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
# Keep a level between 0 and 1 WITHOUT [math]::Min/Max: with a whole number like 0 or 1 in the call,
# PowerShell picks the whole-number version and rounds the volume to 0 or 1 (silent or full).
function Clamp01([double]$v) { if ($v -lt 0) { return [double]0 }; if ($v -gt 1) { return [double]1 }; return $v }
function Num([string]$s) { return [double]::Parse($s, [System.Globalization.CultureInfo]::InvariantCulture) }
function State { @{ ok = $true; level = [math]::Round([LumenAudio]::Volume, 3); muted = [LumenAudio]::Mute } }

Out-Json @{ ready = $true }
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $line = $line.Trim(); $script:reqId = 0
  if ($line.StartsWith('#')) { $sp = $line.IndexOf(' '); if ($sp -gt 1) { $script:reqId = [int]$line.Substring(1, $sp - 1); $line = $line.Substring($sp + 1) } }
  $parts = $line.Split(' ', 2)
  $cmd = $parts[0]; $arg = if ($parts.Length -gt 1) { $parts[1] } else { '' }
  try {
    switch ($cmd) {
      'GETVOL' { Out-Json (State) }
      'SETVOL' { [LumenAudio]::Volume = [float](Clamp01 (Num $arg)); if ([LumenAudio]::Mute) { [LumenAudio]::Mute = $false }; Out-Json (State) }
      'VOLSTEP' {
        $v = [float](Clamp01 ([double][LumenAudio]::Volume + (Num $arg)))
        [LumenAudio]::Volume = $v; if ([LumenAudio]::Mute) { [LumenAudio]::Mute = $false }; Out-Json (State)
      }
      'BRIGHT' { # 1-100 → TV/monitor backlight where the screen allows it
        $pct = [int][math]::Round((Clamp01 ((Num $arg) / 100)) * 100)
        $n = 0; try { $n = [LumenDisplay]::SetAll($pct) } catch { $n = 0 }
        Out-Json @{ ok = $true; screens = $n; level = $pct }
      }
      'MUTE' { [LumenAudio]::Mute = -not [LumenAudio]::Mute; Out-Json (State) }
      'KEY' {
        if ($arg -eq 'altleft') { [LumenInput]::Combo(0x12, 0x25, $true) }
        elseif ($arg -eq 'altright') { [LumenInput]::Combo(0x12, 0x27, $true) }
        elseif ($keys.ContainsKey($arg)) { $k = $keys[$arg]; [LumenInput]::Key([byte]$k[0], [bool]$k[1]) }
        else { throw "unknown key $arg" }
        Out-Json @{ ok = $true }
      }
      'TYPE' {
        $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg))
        $escaped = [regex]::Replace($text, '[+^%~(){}\[\]]', '{$0}')
        [System.Windows.Forms.SendKeys]::SendWait($escaped)
        Out-Json @{ ok = $true }
      }
      'MOVE' { $xy = $arg.Split(' '); [LumenInput]::mouse_event(0x0001, [int]$xy[0], [int]$xy[1], 0, [UIntPtr]::Zero); Out-Json @{ ok = $true } }
      'CLICK' {
        if ($arg -eq 'right') { [LumenInput]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero); [LumenInput]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero) }
        else { [LumenInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [LumenInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
        Out-Json @{ ok = $true }
      }
      'SCROLL' { [LumenInput]::mouse_event(0x0800, 0, 0, [int]$arg, [UIntPtr]::Zero); Out-Json @{ ok = $true } }
      'MINIMIZE' {
        # Minimise the Lumen TV window so an opened app is visible (it comes back on FOCUS).
        $ps = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "$arg*" -and $_.MainWindowTitle -notlike "$arg Setup*" -and $_.MainWindowTitle -notlike "$arg Remote*" }
        foreach ($p in $ps) { [LumenInput]::ShowWindow($p.MainWindowHandle, 6) | Out-Null }
        Out-Json @{ ok = $true; count = @($ps).Count }
      }
      'FOCUSPID' {
        $p = Get-Process -Id ([int]$arg) -ErrorAction SilentlyContinue
        $ok = $false
        if ($p) { $p.Refresh(); if ($p.MainWindowHandle -ne 0) { $ok = [LumenInput]::Focus($p.MainWindowHandle) } }
        Out-Json @{ ok = $true; focused = $ok }
      }
      'FOCUS' {
        $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "$arg*" -and $_.MainWindowTitle -notlike "$arg Setup*" -and $_.MainWindowTitle -notlike "$arg Remote*" } | Select-Object -First 1
        $ok = $false; if ($p) { $ok = [LumenInput]::Focus($p.MainWindowHandle) }
        Out-Json @{ ok = $ok }
      }
      'SCREENOFF' { [LumenInput]::ScreenOff(); Out-Json @{ ok = $true } }   # sleep timer: turns the screen off (any key or mouse turns it on)
      'PING' { Out-Json @{ ok = $true } }
      default { Out-Json @{ ok = $false; error = "unknown command $cmd" } }
    }
  } catch { Out-Json @{ ok = $false; error = $_.Exception.Message } }
}

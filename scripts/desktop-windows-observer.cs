// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Read-only qualification tool. Never shipped in or used to supervise the app.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class BambiWindowsObserver
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Entry
    {
        public uint Size, Usage, Pid; public UIntPtr Heap;
        public uint Module, Threads, Parent; public int Priority; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Executable;
    }
    [StructLayout(LayoutKind.Sequential)] struct Time { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] struct Memory
    {
        public uint Size, Faults;
        public UIntPtr PeakWorkingSet, WorkingSet, PeakPaged, Paged, PeakNonPaged, NonPaged, Pagefile, PeakPagefile, PrivateUsage;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint length);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out Time created, out Time exited, out Time kernel, out Time user);
    [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr process, ref Memory memory, uint size);
    delegate bool WindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int count);
    static ulong Number(Time value) { return ((ulong)value.High << 32) | value.Low; }
    static string Json(string value) { return value == null ? "null" : "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\""; }
    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--server")
        {
            Console.OutputEncoding = new UTF8Encoding(false); Console.WriteLine("{\"ready\":true}");
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                try { if (Main(line.Split(' ')) != 0) Console.WriteLine("{\"error\":\"Invalid observation request\"}"); }
                catch (Exception error) { Console.WriteLine("{\"error\":" + Json(error.Message) + "}"); }
            }
            return 0;
        }
        if (Environment.OSVersion.Platform != PlatformID.Win32NT || IntPtr.Size != 8 || args.Length < 1 || args.Length > 2 || (args.Length == 2 && args[1] != "--windows")) return 64;
        HashSet<uint> selected = new HashSet<uint>();
        foreach (string value in args[0].Split(',')) { uint pid; if (!uint.TryParse(value, out pid) || pid == 0) return 64; selected.Add(pid); }
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) return 65;
        List<Entry> entries = new List<Entry>();
        try
        {
            Entry entry = new Entry(); entry.Size = (uint)Marshal.SizeOf(typeof(Entry));
            if (Process32FirstW(snapshot, ref entry)) do { entries.Add(entry); } while (Process32NextW(snapshot, ref entry));
        }
        finally { CloseHandle(snapshot); }
        bool changed;
        do { changed = false; foreach (Entry entry in entries) if (selected.Contains(entry.Parent) && selected.Add(entry.Pid)) changed = true; } while (changed);
        if (args.Length == 2)
        {
            StringBuilder windows = new StringBuilder("["); bool firstWindow = true;
            EnumWindows(delegate(IntPtr window, IntPtr parameter) {
                uint pid; GetWindowThreadProcessId(window, out pid);
                if (selected.Contains(pid)) {
                    StringBuilder title = new StringBuilder(1024); GetWindowTextW(window, title, title.Capacity);
                    if (title.Length != 0) { if (!firstWindow) windows.Append(','); firstWindow = false; windows.Append("{\"pid\":").Append(pid).Append(",\"title\":").Append(Json(title.ToString())).Append('}'); }
                }
                return true;
            }, IntPtr.Zero);
            Console.OutputEncoding = new UTF8Encoding(false); Console.WriteLine(windows.Append(']').ToString()); return 0;
        }
        StringBuilder output = new StringBuilder("[");
        bool first = true;
        foreach (Entry entry in entries)
        {
            if (!selected.Contains(entry.Pid)) continue;
            string image = null, creation = null; ulong cpu = 0, rss = 0, commit = 0;
            // Request query rights only; never request termination or mutation.
            IntPtr process = OpenProcess(0x1000 | 0x0400, false, entry.Pid);
            if (process != IntPtr.Zero) try
            {
                uint length = 32768; StringBuilder path = new StringBuilder((int)length);
                if (QueryFullProcessImageNameW(process, 0, path, ref length)) image = path.ToString();
                Time created, exited, kernel, user;
                if (GetProcessTimes(process, out created, out exited, out kernel, out user)) { creation = Number(created).ToString(CultureInfo.InvariantCulture); cpu = Number(kernel) + Number(user); }
                Memory memory = new Memory(); memory.Size = (uint)Marshal.SizeOf(typeof(Memory));
                if (GetProcessMemoryInfo(process, ref memory, memory.Size)) { rss = memory.WorkingSet.ToUInt64(); commit = memory.PrivateUsage.ToUInt64(); }
            }
            finally { CloseHandle(process); }
            if (!first) output.Append(','); first = false;
            output.Append("{\"pid\":").Append(entry.Pid).Append(",\"parent\":").Append(entry.Parent)
                .Append(",\"executable\":").Append(Json(image)).Append(",\"created\":").Append(Json(creation))
                .Append(",\"cpu100ns\":").Append(cpu).Append(",\"rssBytes\":").Append(rss).Append(",\"privateCommitBytes\":").Append(commit).Append('}');
        }
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.WriteLine(output.Append(']').ToString()); return 0;
    }
}

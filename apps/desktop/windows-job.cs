// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Compile on Windows x64. The helper stays outside its job; its own parent
// supervisor and the suspended backend enter the job before backend execution.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Security.AccessControl;
using System.Security.Principal;

public static class BambiWindowsJob
{
    const uint Synchronize = 0x00100000, Terminate = 1, SetQuota = 0x100;
    const uint KillOnClose = 0x2000, Suspended = 4, NoWindow = 0x08000000;
    const uint ExtendedStartup = 0x00080000, UnicodeEnvironment = 0x400;
    const uint Infinite = 0xffffffff, WaitTimeout = 258;
    static IntPtr job, owner, supervisor, backend, lease;

    [StructLayout(LayoutKind.Sequential)] struct Limits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct Io
    {
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits
    {
        public Limits Basic;
        public Io Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup
    {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedBytes;
        public IntPtr ReservedPointer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessMemory
    {
        public uint Size, Faults;
        public UIntPtr PeakWorkingSet, WorkingSet, PeakPaged, Paged, PeakNonPaged, NonPaged, Pagefile, PeakPagefile, PrivateUsage;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ProcessEntry
    {
        public uint Size, Usage, Pid;
        public UIntPtr Heap;
        public uint Module, Threads, ParentPid;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Executable;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr security, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr handle, int info, ref ExtendedLimits limits, uint bytes);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr handle, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);
    [DllImport("psapi.dll", SetLastError = true)] static extern bool GetProcessMemoryInfo(IntPtr process, ref ProcessMemory counters, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref UIntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string exe, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateEventW(IntPtr security, bool manual, bool initial, IntPtr name);
    [DllImport("kernel32.dll")] static extern bool SetEvent(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint milliseconds);

    static void Require(bool ok, string operation)
    {
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
    static ulong Created(IntPtr process)
    {
        FileTime created, exited, kernel, user;
        Require(GetProcessTimes(process, out created, out exited, out kernel, out user), "Read owned process creation time");
        return ((ulong)created.High << 32) | created.Low;
    }
    static uint ParentPid()
    {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        Require(snapshot != new IntPtr(-1), "Inspect own parent");
        try
        {
            ProcessEntry entry = new ProcessEntry(); entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            if (Process32FirstW(snapshot, ref entry)) do
            {
                if (entry.Pid == GetCurrentProcessId()) return entry.ParentPid;
            } while (Process32NextW(snapshot, ref entry));
            throw new InvalidOperationException("Own parent was not found");
        }
        finally { CloseHandle(snapshot); }
    }
    // Windows CommandLineToArgv/CRT quoting: spaces, Unicode, quotes and trailing
    // backslashes remain literal. No command shell participates in this launch.
    public static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes); slashes = 0; result.Append(c);
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    static int SecureData(string path)
    {
        if (!Path.IsPathRooted(path) || path.StartsWith(@"\\") || Path.GetFullPath(path) == Path.GetPathRoot(path))
            throw new InvalidOperationException("Choose a local, dedicated user-data directory");
        DirectoryInfo directory = new DirectoryInfo(Path.GetFullPath(path));
        for (DirectoryInfo ancestor = directory; ancestor != null; ancestor = ancestor.Parent)
            if (ancestor.Exists && (ancestor.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("User-data directories must not traverse Windows reparse points");
        SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
        string marker = Path.Combine(directory.FullName, ".bambi-desktop-profile");
        if (directory.Exists)
        {
            if (!directory.GetAccessControl().GetOwner(typeof(SecurityIdentifier)).Equals(user))
                throw new InvalidOperationException("User-data directory is not owned by the current user");
            if (directory.GetFileSystemInfos().Length != 0 && (!File.Exists(marker) || File.ReadAllText(marker) != "Bambi Local private desktop profile v1\n"))
                throw new InvalidOperationException("Choose an empty dedicated user-data directory; existing unrelated data is retained");
        }
        else directory.Create();
        DirectorySecurity security = new DirectorySecurity();
        security.SetOwner(user); security.SetAccessRuleProtection(true, false);
        foreach (SecurityIdentifier identity in new SecurityIdentifier[] { user, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null) })
            security.AddAccessRule(new FileSystemAccessRule(identity, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        directory.SetAccessControl(security);
        File.WriteAllText(marker, "Bambi Local private desktop profile v1\n", new UTF8Encoding(false));
        return 0;
    }
    static string Json(string value)
    {
        if (value == null) return "null";
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\"";
    }
    static ulong Number(UIntPtr value) { return value.ToUInt64(); }
    static int ProfileAcl(string path)
    {
        FileSystemSecurity acl = Directory.Exists(path) ? (FileSystemSecurity)new DirectoryInfo(path).GetAccessControl() : new FileInfo(path).GetAccessControl();
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.Write("{\"user\":" + Json(WindowsIdentity.GetCurrent().User.Value)
            + ",\"owner\":" + Json(((SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier))).Value)
            + ",\"protected\":" + (acl.AreAccessRulesProtected ? "true" : "false") + ",\"rules\":[");
        bool first = true;
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (!first) Console.Write(","); first = false;
            Console.Write("{\"sid\":" + Json(((SecurityIdentifier)rule.IdentityReference).Value)
                + ",\"type\":" + Json(rule.AccessControlType.ToString()) + ",\"inherited\":" + (rule.IsInherited ? "true" : "false")
                + ",\"rights\":" + Json(rule.FileSystemRights.ToString()) + "}");
        }
        Console.WriteLine("]}"); return 0;
    }
    static int ProcessSnapshot()
    {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        Require(snapshot != new IntPtr(-1), "Read Windows process snapshot");
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.Write("[");
            ProcessEntry entry = new ProcessEntry(); entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            bool first = true;
            if (Process32FirstW(snapshot, ref entry)) do
            {
                IntPtr process = OpenProcess(0x1000 | 0x0400 | 0x0010, false, entry.Pid);
                string executable = null, created = null;
                ulong cpu = 0, rss = 0, privateCommit = 0;
                if (process != IntPtr.Zero) try
                {
                    uint length = 32768; StringBuilder path = new StringBuilder((int)length);
                    if (QueryFullProcessImageNameW(process, 0, path, ref length)) executable = path.ToString();
                    FileTime creation, exited, kernel, user;
                    if (GetProcessTimes(process, out creation, out exited, out kernel, out user))
                    {
                        created = (((ulong)creation.High << 32) | creation.Low).ToString(System.Globalization.CultureInfo.InvariantCulture);
                        cpu = (((ulong)kernel.High << 32) | kernel.Low) + (((ulong)user.High << 32) | user.Low);
                    }
                    ProcessMemory memory = new ProcessMemory(); memory.Size = (uint)Marshal.SizeOf(typeof(ProcessMemory));
                    if (GetProcessMemoryInfo(process, ref memory, memory.Size)) { rss = Number(memory.WorkingSet); privateCommit = Number(memory.PrivateUsage); }
                }
                finally { CloseHandle(process); }
                if (!first) Console.Write(",");
                first = false;
                Console.Write("{\"pid\":" + entry.Pid.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"parent\":" + entry.ParentPid.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"executable\":" + Json(executable) + ",\"created\":" + Json(created)
                    + ",\"cpu100ns\":" + cpu.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"rssBytes\":" + rss.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"privateCommitBytes\":" + privateCommit.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}");
            } while (Process32NextW(snapshot, ref entry));
            Console.WriteLine("]");
            return 0;
        }
        finally { CloseHandle(snapshot); }
    }
    public static int Main(string[] args)
    {
        IntPtr attributes = IntPtr.Zero, handleList = IntPtr.Zero, input = IntPtr.Zero, log = IntPtr.Zero, thread = IntPtr.Zero;
        bool attributesInitialized = false, assignedBackend = false;
        try
        {
            if (Environment.OSVersion.Platform != PlatformID.Win32NT || IntPtr.Size != 8) throw new InvalidOperationException("Windows x64 is required");
            if (args.Length == 2 && args[0] == "--secure-data") return SecureData(args[1]);
            if (args.Length == 1 && args[0] == "--process-snapshot") return ProcessSnapshot();
            if (args.Length == 2 && args[0] == "--profile-acl") return ProfileAcl(args[1]);
            uint ownerPid, supervisorPid;
            if (args.Length < 3 || !uint.TryParse(args[0], out ownerPid) || !uint.TryParse(args[1], out supervisorPid) || ownerPid == 0 || supervisorPid == 0 || supervisorPid != ParentPid())
                throw new InvalidOperationException("A live own supervisor and Electron lease are required");
            owner = OpenProcess(Synchronize | 0x1000, false, ownerPid);
            supervisor = OpenProcess(Synchronize | SetQuota | Terminate | 0x1000, false, supervisorPid);
            Require(owner != IntPtr.Zero && supervisor != IntPtr.Zero, "Open own ownership leases");
            // Reject recycled parent PIDs before taking ownership. The owner is
            // observed only; this helper never terminates the Electron PID.
            if (Created(owner) > Created(supervisor) || Created(supervisor) > Created(GetCurrentProcess())) throw new InvalidOperationException("Ownership lease was replaced");
            Require(WaitForSingleObject(owner, 0) == WaitTimeout && WaitForSingleObject(supervisor, 0) == WaitTimeout, "Ownership lease is already closed");
            job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero); Require(job != IntPtr.Zero, "Create private job");
            ExtendedLimits limits = new ExtendedLimits(); limits.Basic.Flags = KillOnClose;
            Require(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "Set kill-on-close job limit");
            // The helper was created before the supervisor enters this job and
            // stays outside it. Killing/stalling the supervisor cannot retain its
            // backend tree: the helper independently watches Electron and parent.
            Require(AssignProcessToJobObject(job, supervisor), "Assign own supervisor to private job");
            input = CreateFileW("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            Require(input != new IntPtr(-1), "Open private backend input");
            Require(SetHandleInformation(input, 1, 1), "Mark backend input inheritable");
            Require(DuplicateHandle(GetCurrentProcess(), GetStdHandle(-12), GetCurrentProcess(), out log, 0, true, 2), "Duplicate backend log handle");
            UIntPtr bytes = UIntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref bytes);
            attributes = Marshal.AllocHGlobal(checked((int)bytes.ToUInt64()));
            Require(InitializeProcThreadAttributeList(attributes, 1, 0, ref bytes), "Initialize private handle list"); attributesInitialized = true;
            handleList = Marshal.AllocHGlobal(IntPtr.Size * 2); Marshal.WriteIntPtr(handleList, input); Marshal.WriteIntPtr(handleList, IntPtr.Size, log);
            Require(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x20002), handleList, new UIntPtr((uint)(IntPtr.Size * 2)), IntPtr.Zero, IntPtr.Zero), "Restrict inherited backend handles");
            StartupEx startup = new StartupEx(); startup.Startup.Size = (uint)Marshal.SizeOf(typeof(StartupEx)); startup.Attributes = attributes;
            startup.Startup.Flags = 0x100; startup.Startup.Input = input; startup.Startup.Output = log; startup.Startup.Error = log;
            StringBuilder command = new StringBuilder(); for (int i = 2; i < args.Length; i++) { if (i > 2) command.Append(' '); command.Append(Quote(args[i])); }
            Environment.SetEnvironmentVariable("NODE_CHANNEL_FD", null); Environment.SetEnvironmentVariable("NODE_CHANNEL_SERIALIZATION_MODE", null);
            Environment.SetEnvironmentVariable("BAMBI_WINDOWS_JOB_OWNED", "1");
            ProcessInfo child;
            Require(CreateProcessW(args[2], command, IntPtr.Zero, IntPtr.Zero, true, Suspended | NoWindow | ExtendedStartup | UnicodeEnvironment, IntPtr.Zero, Environment.CurrentDirectory, ref startup, out child), "Create suspended packaged backend");
            backend = child.Process; thread = child.Thread;
            Require(AssignProcessToJobObject(job, backend), "Assign suspended backend to private job"); assignedBackend = true;
            Require(ResumeThread(thread) != 0xffffffff, "Resume owned backend"); CloseHandle(thread); thread = IntPtr.Zero;
            lease = CreateEventW(IntPtr.Zero, true, false, IntPtr.Zero); Require(lease != IntPtr.Zero, "Create ownership lease event");
            Thread reader = new Thread(delegate() { try { Console.OpenStandardInput().ReadByte(); } catch (IOException) { } finally { SetEvent(lease); } }); reader.IsBackground = true; reader.Start();
            Console.WriteLine("{\"type\":\"started\",\"pid\":" + child.Pid + ",\"jobPid\":" + GetCurrentProcessId() + "}"); Console.Out.Flush();
            uint result = WaitForMultipleObjects(4, new IntPtr[] { owner, supervisor, backend, lease }, false, Infinite);
            Require(result < 4, "Wait for owned service or lease shutdown");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine("Windows owned-job launcher: " + error.Message); return 1; }
        finally
        {
            // An assignment failure must not leave the created process suspended.
            if (backend != IntPtr.Zero && !assignedBackend) TerminateProcess(backend, 1);
            if (job != IntPtr.Zero) CloseHandle(job);
            foreach (IntPtr handle in new IntPtr[] { thread, backend, input, log, owner, supervisor, lease }) if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
            if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
        }
    }
}

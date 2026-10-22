// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Read-only DXGI inventory. No model/driver changes or memory reservations.
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class BambiWindowsGpu
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Description
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Name;
        public uint Vendor, Device, Subsystem, Revision;
        public UIntPtr DedicatedVideo, DedicatedSystem, SharedSystem;
        public uint LuidLow; public int LuidHigh; public uint Flags;
    }
    [StructLayout(LayoutKind.Sequential)] struct Memory
    {
        public ulong Budget, Usage, AvailableReservation, Reservation;
    }
    [DllImport("dxgi.dll", ExactSpelling = true)] static extern int CreateDXGIFactory1(ref Guid iid, out IntPtr factory);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Enumerate(IntPtr self, uint index, out IntPtr adapter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Describe(IntPtr self, out Description description);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QueryMemory(IntPtr self, uint node, int segment, out Memory memory);
    static Delegate Method(IntPtr instance, int slot, Type signature)
    {
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(instance), slot * IntPtr.Size), signature);
    }
    static string Json(string value)
    {
        StringBuilder text = new StringBuilder("\"");
        foreach (char c in value) {
            if (c == '"' || c == '\\') text.Append('\\').Append(c);
            else if (c < 32) text.Append("\\u").Append(((int)c).ToString("x4"));
            else text.Append(c);
        }
        return text.Append('"').ToString();
    }
    static string Budget(IntPtr adapter, int segment)
    {
        IntPtr newer = IntPtr.Zero;
        try {
            Guid iid = new Guid("645967a4-1392-4310-a798-8053ce3e93fd");
            if (Marshal.QueryInterface(adapter, ref iid, out newer) < 0) return "null";
            Memory memory;
            // IDXGIAdapter3::QueryVideoMemoryInfo follows Adapter2 at slot 14.
            if (((QueryMemory)Method(newer, 14, typeof(QueryMemory)))(newer, 0, segment, out memory) < 0) return "null";
            return memory.Budget.ToString(System.Globalization.CultureInfo.InvariantCulture);
        } finally { if (newer != IntPtr.Zero) Marshal.Release(newer); }
    }
    public static int Main()
    {
        IntPtr factory = IntPtr.Zero;
        try {
            Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
            Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref iid, out factory));
            Enumerate enumerate = (Enumerate)Method(factory, 12, typeof(Enumerate));
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.Write("["); bool first = true;
            for (uint i = 0; i < 32; i++) {
                IntPtr adapter; int result = enumerate(factory, i, out adapter);
                if (result == unchecked((int)0x887a0002)) break; // DXGI_ERROR_NOT_FOUND
                Marshal.ThrowExceptionForHR(result);
                try {
                    Description description;
                    Marshal.ThrowExceptionForHR(((Describe)Method(adapter, 10, typeof(Describe)))(adapter, out description));
                    if ((description.Flags & 2) != 0) continue; // Software adapter.
                    if (!first) Console.Write(","); first = false;
                    Console.Write("{\"name\":" + Json(description.Name)
                        + ",\"dedicatedBytes\":" + description.DedicatedVideo.ToUInt64()
                        + ",\"sharedBytes\":" + description.SharedSystem.ToUInt64()
                        + ",\"localBudgetBytes\":" + Budget(adapter, 0)
                        + ",\"sharedBudgetBytes\":" + Budget(adapter, 1) + "}");
                } finally { Marshal.Release(adapter); }
            }
            Console.WriteLine("]"); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); return 1; }
        finally { if (factory != IntPtr.Zero) Marshal.Release(factory); }
    }
}

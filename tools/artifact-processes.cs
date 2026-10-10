using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Query native process identity without WMI. Permission failures are unknown,
// never evidence that a process has exited.
public static class RogueArtifactProcesses
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size, Usage, ProcessId;
        public UIntPtr DefaultHeap;
        public uint ModuleId, Threads, ParentProcessId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString { public ushort Length, MaximumLength; public IntPtr Buffer; }
    public class State
    {
        public uint Pid, Parent;
        public string Status, Start, Command;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr process, int infoClass, IntPtr info, int size, out int returned);

    public static State Query(uint pid)
    {
        var state = new State { Pid = pid, Status = "unknown" };
        var handle = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (handle == IntPtr.Zero)
        {
            if (Marshal.GetLastWin32Error() == 87) state.Status = "gone";
            return state;
        }
        try
        {
            uint exitCode;
            FileTime created, exited, kernel, user;
            if (!GetExitCodeProcess(handle, out exitCode)) return state;
            if (exitCode != 259) { state.Status = "gone"; return state; }
            if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) return state;
            if (exited.High != 0 || exited.Low != 0) { state.Status = "gone"; return state; }
            state.Status = "alive";
            state.Start = (((ulong)created.High << 32) | created.Low).ToString();
            int size;
            NtQueryInformationProcess(handle, 60, IntPtr.Zero, 0, out size);
            if (size > 0 && size < 1024 * 1024)
            {
                var buffer = Marshal.AllocHGlobal(size);
                try
                {
                    if (NtQueryInformationProcess(handle, 60, buffer, size, out size) == 0)
                    {
                        var text = (UnicodeString)Marshal.PtrToStructure(buffer, typeof(UnicodeString));
                        state.Command = Marshal.PtrToStringUni(text.Buffer, text.Length / 2);
                    }
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            return state;
        }
        finally { CloseHandle(handle); }
    }

    public static State[] Snapshot()
    {
        var handle = CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS
        if (handle == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            if (!Process32FirstW(handle, ref entry)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            var states = new List<State>();
            do
            {
                var state = Query(entry.ProcessId);
                state.Parent = entry.ParentProcessId;
                states.Add(state);
            } while (Process32NextW(handle, ref entry));
            if (Marshal.GetLastWin32Error() != 18) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            // AppContainer process lists can omit other jobs and surviving children.
            // The Windows System process must be visible in a complete snapshot.
            if (!states.Exists(state => state.Pid == 4)) throw new InvalidOperationException("Process list is restricted; recovery deferred");
            return states.ToArray();
        }
        finally { CloseHandle(handle); }
    }
}

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

// No PowerShell callbacks run on background threads. The UI drains these queues
// on its own thread, while network and native processes remain in the worker.
public sealed class BtsHelperEvent {
    public string Kind, Message;
    public long Current, Total;
    public double Speed;
}
public sealed class BtsHelperState {
    private readonly ConcurrentQueue<BtsHelperEvent> events = new ConcurrentQueue<BtsHelperEvent>();
    public volatile bool Cancelled, Finished;
    public volatile int InstallDecision, ExitCode;
    public string LastError;
    public void Report(string kind, string message) {
        if (kind == "error") LastError = message;
        events.Enqueue(new BtsHelperEvent { Kind = kind, Message = message });
    }
    public void Progress(long current, long total, double speed) {
        events.Enqueue(new BtsHelperEvent { Kind = "progress", Current = current, Total = total, Speed = speed });
    }
    public BtsHelperEvent[] Drain() {
        var result = new System.Collections.Generic.List<BtsHelperEvent>();
        BtsHelperEvent item;
        while (events.TryDequeue(out item)) result.Add(item);
        return result.ToArray();
    }
    public void CheckCancelled() {
        if (Cancelled) throw new OperationCanceledException("Vom Benutzer beendet.");
    }
}
public static class BtsHelperDownload {
    public static void Fetch(string url, string pin, string key, string destination) {
        Fetch(url, pin, key, destination, 0, null);
    }
    public static void Fetch(string url, string pin, string key, string destination, long expected, BtsHelperState state) {
        if (state != null) state.CheckCancelled();
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.AllowAutoRedirect = false;
        request.Timeout = 30000;
        request.ReadWriteTimeout = 60000;
        request.Headers["Authorization"] = "Bearer " + key;
        if (request.RequestUri.Scheme == "https") {
            request.ServerCertificateValidationCallback = (sender, certificate, chain, errors) => {
                if (certificate == null) return false;
                using (var sha = SHA256.Create()) {
                    var actual = BitConverter.ToString(sha.ComputeHash(certificate.GetRawCertData())).Replace("-", "").ToLowerInvariant();
                    return actual == pin;
                }
            };
        }
        long offset = File.Exists(destination) ? new FileInfo(destination).Length : 0;
        if (offset > 0) request.AddRange(offset);
        // Abort also interrupts a stalled connect/read, rather than waiting for
        // its network timeout after the user pressed Stop.
        using (var cancel = new Timer(_ => { if (state != null && state.Cancelled) request.Abort(); }, null, 0, 100)) {
            try {
                using (var response = (HttpWebResponse)request.GetResponse()) {
                    if (response.StatusCode != HttpStatusCode.OK && response.StatusCode != HttpStatusCode.PartialContent) throw new IOException("Download abgelehnt.");
                    var append = response.StatusCode == HttpStatusCode.PartialContent && offset > 0;
                    if (append && !(response.Headers["Content-Range"] ?? "").StartsWith("bytes " + offset + "-", StringComparison.Ordinal)) throw new IOException("Ungueltige Download-Fortsetzung.");
                    long current = append ? offset : 0, initial = current;
                    long total = response.ContentLength >= 0 ? response.ContentLength + current : expected;
                    if (expected > 0 && total != expected) throw new IOException("Die Download-Groesse stimmt nicht mit dem Paket ueberein.");
                    var watch = Stopwatch.StartNew();
                    double last = -1;
                    if (state != null) state.Progress(current, total, 0);
                    using (var source = response.GetResponseStream())
                    using (var output = new FileStream(destination, append ? FileMode.Append : FileMode.Create, FileAccess.Write)) {
                        var buffer = new byte[131072];
                        int count;
                        while ((count = source.Read(buffer, 0, buffer.Length)) > 0) {
                            if (state != null) state.CheckCancelled();
                            output.Write(buffer, 0, count); current += count;
                            if (total > 0 && current > total) throw new IOException("Download ist groesser als erwartet.");
                            double seconds = watch.Elapsed.TotalSeconds;
                            if (state != null && seconds - last >= .25) {
                                state.Progress(current, total, (current - initial) / Math.Max(.001, seconds)); last = seconds;
                            }
                        }
                    }
                    if (total > 0 && current != total) throw new IOException("Download unterbrochen. Beim naechsten Start wird er fortgesetzt.");
                    if (state != null) state.Progress(current, total, (current - initial) / Math.Max(.001, watch.Elapsed.TotalSeconds));
                }
            } catch {
                if (state != null) state.CheckCancelled();
                throw;
            }
        }
    }
}
public sealed class BtsHelperProcess : IDisposable {
    private readonly Process process;
    private readonly StreamWriter input;
    private readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
    public static string Quote(string value) {
        // WSL examines option tokens in the raw Windows command line. Quoting
        // every token turns "--status" into a Linux command on affected builds.
        // Leave simple arguments bare; preserve Windows escaping for values
        // that actually need quotes (spaces, empty strings, embedded quotes).
        bool needsQuotes = value.Length == 0;
        foreach (char item in value) if (char.IsWhiteSpace(item) || item == '"') needsQuotes = true;
        if (!needsQuotes) return value;
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char item in value) {
            if (item == '\\') { slashes++; continue; }
            if (item == '"') { result.Append('\\', slashes * 2 + 1); result.Append(item); }
            else { result.Append('\\', slashes); result.Append(item); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    public BtsHelperProcess(string executable, string[] arguments) {
        var start = new ProcessStartInfo(executable);
        var encoded = new System.Collections.Generic.List<string>();
        foreach (string argument in arguments) encoded.Add(Quote(argument));
        start.Arguments = string.Join(" ", encoded.ToArray());
        start.UseShellExecute = false; start.CreateNoWindow = true;
        start.RedirectStandardInput = start.RedirectStandardOutput = start.RedirectStandardError = true;
        start.StandardOutputEncoding = start.StandardErrorEncoding = new UTF8Encoding(false);
        process = new Process { StartInfo = start };
        process.OutputDataReceived += (_, item) => { if (item.Data != null) lines.Enqueue(item.Data.Replace("\0", "")); };
        process.ErrorDataReceived += (_, item) => { if (item.Data != null) lines.Enqueue(item.Data.Replace("\0", "")); };
        if (!process.Start()) throw new IOException("Programm konnte nicht gestartet werden.");
        input = new StreamWriter(process.StandardInput.BaseStream, new UTF8Encoding(false));
        input.AutoFlush = true;
        process.BeginOutputReadLine(); process.BeginErrorReadLine();
    }
    public void Send(string value) { input.WriteLine(value); }
    public void Input(string value) { Send(value); input.Close(); }
    public bool HasExited { get { return process.HasExited; } }
    public int ExitCode { get { process.WaitForExit(); return process.ExitCode; } }
    public string[] Drain() {
        var result = new System.Collections.Generic.List<string>();
        string item;
        while (lines.TryDequeue(out item)) result.Add(item);
        return result.ToArray();
    }
    public void Stop() { if (!process.HasExited) process.Kill(); }
    public void Dispose() { input.Dispose(); Stop(); process.Dispose(); }
}
public static class BtsHelperFiles {
    // Never recurse into junctions/symlinks while deleting the app's own cache.
    public static void RemoveTree(string path) {
        if (!Directory.Exists(path)) return;
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) {
            Directory.Delete(path); return;
        }
        foreach (string child in Directory.GetFileSystemEntries(path)) {
            if ((File.GetAttributes(child) & FileAttributes.Directory) != 0) RemoveTree(child);
            else File.Delete(child);
        }
        Directory.Delete(path);
    }
}

// Read-only, local advice. These estimates never change a user's budget and
// never become telemetry. Keep the calculation separate from Windows sampling.
public sealed class BtsHelperResourceAdvice {
    public bool Available, CanRecommend;
    public int Threads, MemoryMiB;
    public long TotalMiB, AvailableMiB, ReserveMiB;
    public double AverageCpu, PeakCpu;
    public string Reason;
    public DateTime MeasuredAtUtc = DateTime.UtcNow;
    public bool IsFresh { get { var age = DateTime.UtcNow - MeasuredAtUtc; return age >= TimeSpan.Zero && age < TimeSpan.FromSeconds(60); } }
    public static BtsHelperResourceAdvice Unavailable(string reason) {
        return new BtsHelperResourceAdvice { Reason = reason };
    }
    public static BtsHelperResourceAdvice Calculate(int processors, double average, double peak, long total, long free, long commit) {
        if (processors < 1 || processors > 64 || total < 1 || free < 0 || free > total || commit < 0 ||
            double.IsNaN(average) || double.IsNaN(peak) || average < 0 || peak < average || peak > 100)
            return Unavailable("Keine verlaesslichen Lastdaten. Ressourcen bitte selbst waehlen.");
        // Leave at least 35% CPU capacity, half the logical CPUs and at most
        // four helper threads. Use the busiest interval, not just the average.
        int threads = Math.Min(Math.Min(4, processors / 2), processors * Math.Max(0, 65 - (int)Math.Ceiling(peak)) / 100);
        long reserve = (long)Math.Ceiling(Math.Max(2048, Math.Min(8192, total * .20)) / 256) * 256;
        // Separate 1 GiB estimate for WSL/cache overhead. This is not a WSL cap.
        long budget = Math.Min(free, commit) - reserve - 1024;
        int memory = (int)(Math.Max(0, Math.Min(3584, budget)) / 256 * 256);
        return new BtsHelperResourceAdvice {
            // Do not recommend squeezing the model below its normal budget
            // merely to make it fit. Smaller manual abort limits remain valid.
            Available = true, CanRecommend = threads > 0 && memory >= 3584,
            Threads = threads, MemoryMiB = memory, TotalMiB = total, AvailableMiB = free,
            ReserveMiB = reserve, AverageCpu = average, PeakCpu = peak,
            Reason = threads < 1 ? "Zurzeit besser nicht starten: zu wenig freie CPU-Reserve." :
                memory < 3584 ? "Zurzeit besser nicht starten: zu wenig Speicherreserve fuer das Standard-Modellbudget." :
                "Vorsichtiger Vorschlag fuer die weitere Nutzung des Rechners; keine Leistungsgarantie."
        };
    }
}
public sealed class BtsHelperResourceProbe {
    [StructLayout(LayoutKind.Sequential)]
    private struct CpuTime { public uint Low, High; public ulong Ticks { get { return ((ulong)High << 32) | Low; } } }
    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatus {
        public uint Length, Load;
        public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile, TotalVirtual, AvailableVirtual, AvailableExtended;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemTimes(out CpuTime idle, out CpuTime kernel, out CpuTime user);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
    [DllImport("kernel32.dll")]
    private static extern ushort GetActiveProcessorGroupCount();
    private volatile bool cancelled;
    public volatile int Samples;
    public volatile BtsHelperResourceAdvice Result;
    public void Cancel() { cancelled = true; }
    public BtsHelperResourceProbe() {
        var thread = new Thread(Measure);
        thread.IsBackground = true;
        thread.Start();
    }
    public static double CpuPercent(ulong idleBefore, ulong kernelBefore, ulong userBefore, ulong idleAfter, ulong kernelAfter, ulong userAfter) {
        if (idleAfter < idleBefore || kernelAfter < kernelBefore || userAfter < userBefore) throw new InvalidOperationException("CPU-Zaehler ungueltig.");
        // Kernel time already includes idle. Subtract integer counters before
        // converting to double, preserving precision on long-running machines.
        double total = (double)(kernelAfter - kernelBefore) + (double)(userAfter - userBefore);
        ulong idle = idleAfter - idleBefore;
        if (total <= 0 || idle > total) throw new InvalidOperationException("CPU-Zaehler ungueltig.");
        return 100 * (1 - idle / total);
    }
    private static MemoryStatus ReadMemory() {
        var memory = new MemoryStatus();
        memory.Length = (uint)Marshal.SizeOf(typeof(MemoryStatus));
        if (!GlobalMemoryStatusEx(ref memory)) throw new IOException("RAM-Abfrage fehlgeschlagen.");
        return memory;
    }
    private void Measure() {
        try {
            if (GetActiveProcessorGroupCount() != 1) throw new InvalidOperationException("Mehrere CPU-Gruppen werden noch nicht unterstuetzt.");
            CpuTime idle, kernel, user;
            if (!GetSystemTimes(out idle, out kernel, out user)) throw new IOException("CPU-Abfrage fehlgeschlagen.");
            var memory = ReadMemory();
            ulong free = memory.AvailablePhysical, commit = memory.AvailablePageFile;
            double sum = 0, peak = 0;
            for (int sample = 0; sample < 5; sample++) {
                for (int tick = 0; tick < 10; tick++) { if (cancelled) return; Thread.Sleep(100); }
                if (cancelled) return;
                CpuTime nextIdle, nextKernel, nextUser;
                if (!GetSystemTimes(out nextIdle, out nextKernel, out nextUser)) throw new IOException("CPU-Abfrage fehlgeschlagen.");
                double load = CpuPercent(idle.Ticks, kernel.Ticks, user.Ticks, nextIdle.Ticks, nextKernel.Ticks, nextUser.Ticks);
                sum += load; peak = Math.Max(peak, load);
                idle = nextIdle; kernel = nextKernel; user = nextUser;
                var nextMemory = ReadMemory();
                free = Math.Min(free, nextMemory.AvailablePhysical); commit = Math.Min(commit, nextMemory.AvailablePageFile);
                Samples = sample + 1;
            }
            if (!cancelled) Result = BtsHelperResourceAdvice.Calculate(Environment.ProcessorCount, sum / 5, peak,
                (long)(memory.TotalPhysical / 1048576), (long)(free / 1048576), (long)(commit / 1048576));
        } catch (Exception error) {
            if (!cancelled) Result = BtsHelperResourceAdvice.Unavailable("Lastmessung nicht verfuegbar. Ressourcen bitte selbst waehlen. Details: " + error.Message);
        }
    }
}

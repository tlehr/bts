using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("BTS-Sprachhelfer")]
[assembly: AssemblyDescription("Freiwilliger CPU-Sprachhelfer fuer BTS")]
[assembly: AssemblyVersion("1.0.0.0")]

// This small .NET Framework GUI executable carries a per-download ZIP overlay.
// The user's Downloads folder contains only the EXE. Scripts remain readable
// in a temporary directory while the existing PowerShell window is running.
public static class BtsHelperLauncher {
    private const string Magic = "BTSHELPER-EXE-1!";
    private static readonly string[] Names = { "Start.ps1", "Window.ps1", "Worker.ps1", "Plan.ps1", "Runtime.cs", "README.txt", "RUECKNAHME.txt", "helper.json" };
    private static uint ReadUInt32(FileStream file, long position) {
        if (position < 0 || position > file.Length - 4) throw new InvalidDataException("EXE-Kopf ungueltig.");
        file.Position = position;
        var bytes = new byte[4];
        if (file.Read(bytes, 0, 4) != 4) throw new InvalidDataException("EXE-Kopf abgeschnitten.");
        return BitConverter.ToUInt32(bytes, 0);
    }
    private static long ImageDataEnd(FileStream file) {
        if ((ReadUInt32(file, 0) & 65535) != 0x5a4d) throw new InvalidDataException("Keine Windows-EXE.");
        long pe = ReadUInt32(file, 0x3c), optional = pe + 24;
        if (pe < 64 || ReadUInt32(file, pe) != 0x4550) throw new InvalidDataException("PE-Kopf ungueltig.");
        int optionalSize = (int)(ReadUInt32(file, pe + 20) & 65535);
        uint magic = ReadUInt32(file, optional) & 65535;
        int directories = magic == 0x10b ? 96 : magic == 0x20b ? 112 : 0;
        if (directories == 0 || optionalSize < directories || optional + optionalSize > file.Length)
            throw new InvalidDataException("Optionaler PE-Kopf ungueltig.");
        if (ReadUInt32(file, optional + directories - 4) < 5) return file.Length;
        if (optionalSize < directories + 40) throw new InvalidDataException("Zertifikatstabelle fehlt.");
        long certificate = ReadUInt32(file, optional + directories + 32);
        long size = ReadUInt32(file, optional + directories + 36);
        if (certificate == 0 && size == 0) return file.Length;
        // Security Directory uses a file offset, not an RVA. Never search the
        // certificate table or unauthenticated attributes for executable data.
        if (certificate < optional + optionalSize || certificate % 8 != 0 || size < 8 || certificate + size != file.Length)
            throw new InvalidDataException("Zertifikatstabelle ungueltig.");
        return certificate;
    }
    public static byte[] ReadPayload(string executable) {
        using (var file = File.OpenRead(executable)) {
            long end = ImageDataEnd(file);
            var trailer = new byte[56];
            bool found = false;
            // Authenticode can add up to seven alignment bytes before the
            // certificate. Accept only zero padding, entirely outside payload.
            int maximumPadding = end == file.Length ? 0 : 7;
            for (int padding = 0; padding <= maximumPadding && end - padding >= 56; padding++) {
                file.Position = end - padding - 56;
                if (file.Read(trailer, 0, trailer.Length) == trailer.Length && Encoding.ASCII.GetString(trailer, 40, 16) == Magic) {
                    end -= padding; found = true; break;
                }
                file.Position = end - padding - 1;
                if (file.ReadByte() != 0) break;
            }
            if (!found) throw new InvalidDataException("Starter-Paket fehlt. Bitte die EXE erneut vom BTS herunterladen.");
            long length = BitConverter.ToInt64(trailer, 0);
            if (length < 100 || length > 1048576 || length > end - 56) throw new InvalidDataException("Paketgroesse ungueltig.");
            file.Position = end - 56 - length;
            var payload = new byte[(int)length];
            int offset = 0, count;
            while (offset < payload.Length && (count = file.Read(payload, offset, payload.Length - offset)) > 0) offset += count;
            if (offset != payload.Length) throw new InvalidDataException("Starter-Paket wurde abgeschnitten.");
            using (var sha = SHA256.Create()) {
                byte[] actual = sha.ComputeHash(payload);
                for (int i = 0; i < actual.Length; i++) if (actual[i] != trailer[i + 8]) throw new InvalidDataException("Starter-Paket ist beschaedigt.");
            }
            return payload;
        }
    }
    public static void Extract(byte[] payload, string destination) {
        using (var memory = new MemoryStream(payload))
        using (var archive = new ZipArchive(memory, ZipArchiveMode.Read)) {
            var remaining = new HashSet<string>(Names, StringComparer.Ordinal);
            foreach (var entry in archive.Entries) {
                if (!remaining.Remove(entry.FullName) || entry.Length > 262144) throw new InvalidDataException("Unerwartete Starter-Datei.");
                using (var source = entry.Open())
                using (var output = new FileStream(Path.Combine(destination, entry.FullName), FileMode.CreateNew, FileAccess.Write)) {
                    var buffer = new byte[8192]; int count; long total = 0;
                    while ((count = source.Read(buffer, 0, buffer.Length)) > 0) {
                        total += count;
                        if (total > 262144) throw new InvalidDataException("Starter-Datei zu gross.");
                        output.Write(buffer, 0, count);
                    }
                }
            }
            if (remaining.Count != 0) throw new InvalidDataException("Starter-Dateien fehlen.");
        }
    }
    public static void Cleanup(string directory) {
        // Flat, known files only; never traverse a directory link on cleanup.
        foreach (string name in Names) {
            string filename = Path.Combine(directory, name);
            if (File.Exists(filename)) File.Delete(filename);
        }
        Directory.Delete(directory, false);
    }
    [STAThread]
    public static int Main() {
        string directory = null;
        try {
            byte[] payload = ReadPayload(Assembly.GetExecutingAssembly().Location);
            directory = Path.Combine(Path.GetTempPath(), "BTS-Sprachhelfer-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            Extract(payload, directory);
            // Use the Windows installation's PowerShell, not a PATH candidate.
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            var start = new ProcessStartInfo(powershell);
            start.Arguments = "-NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + Path.Combine(directory, "Start.ps1") + "\"";
            start.UseShellExecute = false; start.CreateNoWindow = true; start.WorkingDirectory = directory;
            using (var process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
        } catch (Exception error) {
            MessageBox.Show("Der Sprachhelfer konnte nicht gestartet werden. " + error.Message, "BTS-Sprachhelfer", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        } finally {
            if (directory != null) try { Cleanup(directory); } catch { /* Windows may retain a temporary file; do not touch unrelated paths. */ }
        }
    }
}

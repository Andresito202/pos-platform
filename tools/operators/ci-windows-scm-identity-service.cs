// Isolated GitHub-hosted Windows service identity probe, NOT the Camacho POS service runtime.
// It is intentionally a separate service executable and never opens the commercial SCM channel.
// Run only in a disposable Windows Actions environment. No private material is persisted in git.
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;

public sealed class CamachoHostedScmProbe : ServiceBase {
    private readonly string resultDirectory;
    private Process nativePeer;
    public CamachoHostedScmProbe(string resultDirectory) {
        this.ServiceName = "CamachoPOSLocalService";
        this.resultDirectory = resultDirectory;
        this.CanStop = true;
    }
    protected override void OnStop() {
        if (nativePeer != null) {
            try { if (!nativePeer.HasExited) nativePeer.Kill(); } catch {}
            nativePeer.Dispose();
            nativePeer = null;
        }
    }
    protected override void OnStart(string[] args) {
        try {
            using (var user = WindowsIdentity.GetCurrent()) {
                if (user.Name != @"NT SERVICE\CamachoPOSLocalService")
                    throw new InvalidOperationException("SERVICE_VIRTUAL_IDENTITY_MISMATCH");
                if (Process.GetCurrentProcess().SessionId != 0)
                    throw new InvalidOperationException("SERVICE_SESSION_ZERO_REQUIRED");
                var plaintext = new byte[32];
                using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(plaintext);
                var entropy = Encoding.UTF8.GetBytes("CAMACHO_GITHUB_EPHEMERAL_SERVICE_IDENTITY_V1");
                byte[] ciphertext = null;
                byte[] roundtrip = null;
                try {
                    ciphertext = ProtectedData.Protect(plaintext, entropy, DataProtectionScope.CurrentUser);
                    roundtrip = ProtectedData.Unprotect(ciphertext, entropy, DataProtectionScope.CurrentUser);
                    if (plaintext.Length != roundtrip.Length)
                        throw new InvalidOperationException("SERVICE_DPAPI_LENGTH_MISMATCH");
                    for (int i=0; i<plaintext.Length; i++)
                        if (plaintext[i] != roundtrip[i])
                            throw new InvalidOperationException("SERVICE_DPAPI_ROUNDTRIP_REJECTED");
                    File.WriteAllText(Path.Combine(resultDirectory, "service-dpapi-ciphertext.txt"),
                        Convert.ToBase64String(ciphertext), Encoding.ASCII);
                    File.WriteAllText(Path.Combine(resultDirectory, "service-proof.txt"),
                        "SERVICE_IDENTITY=PASS\nSESSION_ZERO=PASS\nDPAPI_CURRENTUSER=PASS\n", Encoding.ASCII);
                    // Optional GitHub-only native channel proof: actual SCM-owned
                    // Node child process (not the production service) performs
                    // kernel attestation with the interactive desktop peer.
                    var nativeConfig = Path.Combine(resultDirectory, "native-runner.txt");
                    if (File.Exists(nativeConfig)) {
                        var items = File.ReadAllLines(nativeConfig);
                        if (items.Length != 3 || !Path.IsPathRooted(items[0]) ||
                            !Path.IsPathRooted(items[1]) || !Path.IsPathRooted(items[2]) ||
                            !File.Exists(items[0]) || !File.Exists(items[1]) || !File.Exists(items[2]))
                            throw new InvalidOperationException("NATIVE_CI_RUNNER_CONFIG_REJECTED");
                        var start = new ProcessStartInfo(items[0],
                            "\"" + items[1] + "\" service \"" + items[2] + "\"");
                        start.UseShellExecute = false;
                        start.CreateNoWindow = true;
                        nativePeer = Process.Start(start);
                        if (nativePeer == null) throw new InvalidOperationException("NATIVE_SERVICE_CHILD_NOT_STARTED");
                    }
                } finally {
                    Array.Clear(plaintext, 0, plaintext.Length);
                    if (roundtrip != null) Array.Clear(roundtrip, 0, roundtrip.Length);
                    if (ciphertext != null) Array.Clear(ciphertext, 0, ciphertext.Length);
                }
            }
        } catch (Exception e) {
            // Emit only the exception's type, not paths, identity details or crypto material.
            File.WriteAllText(Path.Combine(resultDirectory, "service-failure.txt"),
                e.GetType().Name, Encoding.ASCII);
            throw;
        }
    }
    public static void Main(string[] args) {
        if (args.Length != 1 || !Path.IsPathRooted(args[0])
            || args[0].IndexOfAny(new[] {'"', '\r', '\n'}) >= 0)
            throw new InvalidOperationException("SERVICE_LAB_PATH_INVALID");
        ServiceBase.Run(new CamachoHostedScmProbe(args[0]));
    }
}

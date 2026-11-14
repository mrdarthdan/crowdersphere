// Tiny launcher compiled by install.ps1 into "CrowderSphere.exe".
// It starts the local server (server.ps1) without a console window; the server opens the editor window.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("CrowderSphere")]
[assembly: AssemblyProduct("CrowderSphere")]
[assembly: AssemblyVersion("1.0.0.0")]

static class CrowderSphereLauncher
{
    [STAThread]
    static void Main()
    {
        string dir = Path.GetDirectoryName(Application.ExecutablePath);
        string script = Path.Combine(Path.Combine(dir, "app"), "server.ps1");
        if (!File.Exists(script))
        {
            MessageBox.Show("CrowderSphere can't find its files:\n" + script + "\n\nRun Setup.cmd again.", "CrowderSphere",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        string ps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
        if (!File.Exists(ps)) ps = "powershell.exe";
        var psi = new ProcessStartInfo(ps,
            "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WorkingDirectory = dir;
        try
        {
            var p = Process.Start(psi);
            // If PowerShell dies right away (blocked by security software, policy, etc.), say so instead of doing nothing
            if (p != null && p.WaitForExit(4000) && p.ExitCode != 0)
            {
                MessageBox.Show("CrowderSphere stopped right after starting (exit code " + p.ExitCode + ").\n\n" +
                    "Check the log at %APPDATA%\\CrowderSphere\\log.txt, and Windows Security > Protection history " +
                    "in case it was blocked.", "CrowderSphere", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("Couldn't start CrowderSphere:\n" + ex.Message, "CrowderSphere", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}

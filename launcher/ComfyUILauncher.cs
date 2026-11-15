using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("ComfyUI")]
[assembly: System.Reflection.AssemblyProduct("ComfyUI Launcher")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

static class ComfyUILauncher
{
    const string Url = "http://127.0.0.1:8188";
    static Process server;
    static NotifyIcon tray;
    static string root;
    static string logPath;

    [STAThread]
    static void Main()
    {
        bool first;
        using (var mutex = new Mutex(true, "LNL-ComfyUI-Launcher", out first))
        {
            if (!first)
            {
                // Đã chạy rồi: chỉ mở lại cửa sổ.
                OpenWindow();
                return;
            }
            Application.EnableVisualStyles();
            root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            logPath = Path.Combine(root, "user", "comfyui-launcher.log");
            string py = Path.Combine(root, "venv", "Scripts", "python.exe");
            if (!File.Exists(py) || !File.Exists(Path.Combine(root, "main.py")))
            {
                MessageBox.Show("Không tìm thấy ComfyUI cạnh file này.\nĐặt ComfyUI.exe trong thư mục ComfyUI (có main.py và venv).",
                    "ComfyUI", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            tray = new NotifyIcon();
            try { tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { tray.Icon = SystemIcons.Application; }
            tray.Text = "ComfyUI - đang khởi động...";
            tray.Visible = true;
            var menu = new ContextMenuStrip();
            menu.Items.Add("Mở ComfyUI", null, (s, e) => OpenWindow());
            menu.Items.Add("Mở thư mục model", null, (s, e) => Process.Start("explorer.exe", "\"" + Path.Combine(root, "models") + "\""));
            menu.Items.Add("Mở thư mục ảnh xuất", null, (s, e) => Process.Start("explorer.exe", "\"" + Path.Combine(root, "output") + "\""));
            menu.Items.Add("Xem nhật ký", null, (s, e) => { if (File.Exists(logPath)) Process.Start("notepad.exe", "\"" + logPath + "\""); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Thoát ComfyUI", null, (s, e) => Quit());
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => OpenWindow();

            if (IsUp())
            {
                // Server đã chạy sẵn (mở bằng cách khác): dùng luôn.
                tray.Text = "ComfyUI - đang chạy";
                OpenWindow();
            }
            else
            {
                StartServer(py);
                var waiter = new Thread(() =>
                {
                    for (int i = 0; i < 300; i++)
                    {
                        if (server != null && server.HasExited) break;
                        if (IsUp()) { tray.Text = "ComfyUI - đang chạy"; OpenWindow(); return; }
                        Thread.Sleep(1000);
                    }
                    tray.ShowBalloonTip(8000, "ComfyUI", "ComfyUI không khởi động được. Bấm chuột phải biểu tượng > Xem nhật ký.", ToolTipIcon.Error);
                    tray.Text = "ComfyUI - lỗi khởi động";
                });
                waiter.IsBackground = true;
                waiter.Start();
                tray.ShowBalloonTip(4000, "ComfyUI", "Đang khởi động, cửa sổ sẽ tự mở...", ToolTipIcon.Info);
            }

            Application.ApplicationExit += (s, e) => StopServer();
            Application.Run();
        }
    }

    static void StartServer(string py)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(logPath));
        var psi = new ProcessStartInfo(py, "-s main.py --port 8188 --windows-standalone-build --disable-auto-launch --enable-manager --disable-fast-disk")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        var log = new StreamWriter(logPath, false, new System.Text.UTF8Encoding(false)) { AutoFlush = true };
        server = new Process { StartInfo = psi, EnableRaisingEvents = true };
        DataReceivedEventHandler w = (s, e) => { if (e.Data != null) lock (log) log.WriteLine(e.Data); };
        server.OutputDataReceived += w;
        server.ErrorDataReceived += w;
        server.Start();
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
    }

    static bool IsUp()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(Url + "/system_stats");
            req.Timeout = 1500;
            using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    static void OpenWindow()
    {
        string[] edges = {
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        };
        foreach (var b in edges)
        {
            if (File.Exists(b))
            {
                Process.Start(b, "--app=" + Url + " --window-size=1500,950");
                return;
            }
        }
        Process.Start(Url);
    }

    static void StopServer()
    {
        try
        {
            if (server != null && !server.HasExited)
            {
                // Tắt cả tiến trình con của python.
                Process.Start(new ProcessStartInfo("taskkill", "/PID " + server.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit(5000);
            }
        }
        catch { }
    }

    static void Quit()
    {
        tray.Visible = false;
        StopServer();
        Application.Exit();
    }
}

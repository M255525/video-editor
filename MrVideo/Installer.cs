// 影片先生 一鍵安裝程式
// 以 Windows 內建 .NET Framework csc.exe 編譯（見 build.ps1），零外部相依。
// 行為：把內嵌的 app.zip 解壓到 %LOCALAPPDATA%\影片先生，桌面建立
// 「影片先生」與「影片先生操作手冊」捷徑，詢問是否立即開啟。
// 參數 /S = 靜默安裝（不彈視窗、不開瀏覽器）。
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        bool silent = args.Length > 0 && (args[0].Equals("/S", StringComparison.OrdinalIgnoreCase));
        string appName = "影片先生"; // 影片先生
        try
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), appName);
            Directory.CreateDirectory(dir);

            // 解壓內嵌的 app.zip
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
            {
                if (s == null) throw new Exception("安裝包毀損（找不到 app.zip）");
                using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry e in zip.Entries)
                    {
                        string rel = e.FullName.Replace('\\', '/');
                        if (rel.Length == 0 || rel.EndsWith("/")) continue;
                        string dest = Path.Combine(dir, rel.Replace('/', Path.DirectorySeparatorChar));
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        using (Stream es = e.Open())
                        using (FileStream fs = new FileStream(dest, FileMode.Create, FileAccess.Write))
                        {
                            es.CopyTo(fs);
                        }
                    }
                }
            }

            // 桌面捷徑（.url，開啟預設瀏覽器）
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            WriteUrlShortcut(Path.Combine(desktop, appName + ".url"),
                             Path.Combine(dir, "index.html"), 220);   // 影片圖示
            WriteUrlShortcut(Path.Combine(desktop, appName + "操作手冊.url"),
                             Path.Combine(dir, "manual.html"), 23);   // 說明圖示

            if (!silent)
            {
                DialogResult r = MessageBox.Show(
                    "安裝完成！\n\n" +
                    "安裝位置：" + dir + "\n" +
                    "桌面已建立「" + appName + "」與「" + appName + "操作手冊」捷徑。\n\n" +
                    "是否立即開啟" + appName + "？",
                    appName + " 安裝程式",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (r == DialogResult.Yes)
                {
                    Process.Start(Path.Combine(dir, "index.html"));
                }
            }
            return 0;
        }
        catch (Exception ex)
        {
            if (!silent)
            {
                MessageBox.Show("安裝失敗：" + ex.Message,
                    appName + " 安裝程式", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return 1;
        }
    }

    static void WriteUrlShortcut(string path, string target, int iconIndex)
    {
        string url = new Uri(target).AbsoluteUri;   // 中文路徑自動百分比編碼
        File.WriteAllText(path,
            "[InternetShortcut]\r\n" +
            "URL=" + url + "\r\n" +
            "IconFile=C:\\Windows\\System32\\shell32.dll\r\n" +
            "IconIndex=" + iconIndex + "\r\n");
    }
}

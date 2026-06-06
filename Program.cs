using ArzPaya.SharedLibrary;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace ArzPayaBroadcast.Core.Order
{
    internal class Program
    {
        static async Task Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
                Log($"[UNHANDLED] {e.ExceptionObject}", ConsoleColor.Red);

            try
            {
                Console.Title = System.Reflection.Assembly.GetExecutingAssembly().GetName().Name;

                var signalrUrl = System.Configuration.ConfigurationManager.AppSettings["Url"];
                var apiUrl     = System.Configuration.ConfigurationManager.AppSettings["UrlApi"];

                // ─── SignalR host (Worker + Hub) ───────────────────────────────
                Log($"Building SignalR host → {signalrUrl}", ConsoleColor.Cyan);
                var v1 = Host.CreateDefaultBuilder(args)
                    .ConfigureWebHostDefaults(web =>
                    {
                        web.UseUrls(signalrUrl);
                        web.UseStartup<Startup>();
                        web.ConfigureLogging(l => l.ClearProviders());
                    }).Build();

                // ─── REST API host ─────────────────────────────────────────────
                Log($"Building API host     → {apiUrl}", ConsoleColor.Cyan);
                var v2 = Host.CreateDefaultBuilder(args)
                    .ConfigureWebHostDefaults(web =>
                    {
                        web.UseUrls(apiUrl);
                        web.UseStartup<StartupApi>();
                        web.ConfigureLogging(l => l.ClearProviders());
                    }).Build();

                Log("Starting hosts...", ConsoleColor.White);

                // v1 runs in background; attach fault handler so crashes are visible
                var v1Task = v1.RunAsync();
                _ = v1Task.ContinueWith(
                    t => Log($"[FATAL] SignalR host crashed: {t.Exception?.GetBaseException()}", ConsoleColor.Red),
                    TaskContinuationOptions.OnlyOnFaulted);

                Log($"SignalR host running  → {signalrUrl}", ConsoleColor.Green);
                Log($"API host starting     → {apiUrl}", ConsoleColor.Green);

                // v2 blocks the main thread until the process is stopped
                await v2.RunAsync();
            }
            catch (Exception ex)
            {
                Log($"Startup error: {ex}", ConsoleColor.Red);
            }
        }

        static void Log(string msg, ConsoleColor color)
            => $"[{DateTime.Now:HH:mm:ss.fff}] {msg}".ConsoleWriteLine(color);
    }
}

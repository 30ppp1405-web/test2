using ArzPaya.SharedLibrary;
using Microsoft.AspNetCore.SignalR;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace ArzPayaBroadcast.Core.Order.Hubs
{
    internal class OrderHub : Hub
    {
        private readonly Worker _worker;
        private static readonly object _connectionsLock = new();

        public OrderHub(Worker worker) => _worker = worker;

        public async Task Switch(int extype)
        {
            try
            {
                var id = Context.ConnectionId;
                lock (_connectionsLock)
                {
                    var con = Worker.Connections.FirstOrDefault(c => c.ConnectionId == id);
                    if (con == null)
                    {
                        con = new Connection { ConnectionId = id };
                        Worker.Connections.Add(con);
                    }
                    con.ExchangeType = extype;
                }
                Log($"Switch  {Short(id)} → exchange {extype} | total: {Worker.Connections.Count}", ConsoleColor.Yellow);

                await _worker.SendSnapshotAsync(id, Utility.GetEnum<EnmExChangeType>(extype));
            }
            catch (Exception ex) { Log($"Switch error: {ex.Message}", ConsoleColor.Red); }
        }

        // Client calls this on heartbeat hash mismatch to re-sync
        public async Task GetSnapshot()
        {
            try
            {
                var id = Context.ConnectionId;
                Connection con;
                lock (_connectionsLock)
                {
                    con = Worker.Connections.FirstOrDefault(c => c.ConnectionId == id);
                }
                if (con != null)
                {
                    Log($"GetSnapshot {Short(id)} (hash mismatch)", ConsoleColor.DarkYellow);
                    await _worker.SendSnapshotAsync(id, Utility.GetEnum<EnmExChangeType>(con.ExchangeType));
                }
            }
            catch (Exception ex) { Log($"GetSnapshot error: {ex.Message}", ConsoleColor.Red); }
        }

        public override Task OnConnectedAsync()
        {
            lock (_connectionsLock)
            {
                Worker.Connections.Add(new Connection { ConnectionId = Context.ConnectionId });
            }
            Log($"Connect  {Short(Context.ConnectionId)} | total: {Worker.Connections.Count}", ConsoleColor.Cyan);
            return base.OnConnectedAsync();
        }

        public override Task OnDisconnectedAsync(Exception exception)
        {
            var id = Context.ConnectionId;
            lock (_connectionsLock)
            {
                var con = Worker.Connections.FirstOrDefault(c => c.ConnectionId == id);
                if (con != null) Worker.Connections.Remove(con);
            }
            var reason = exception?.Message ?? "clean";
            Log($"Disconn  {Short(id)} ({reason}) | remaining: {Worker.Connections.Count}", ConsoleColor.DarkCyan);
            return base.OnDisconnectedAsync(exception);
        }

        static void Log(string msg, ConsoleColor color)
            => $"[{DateTime.Now:HH:mm:ss.fff}] Hub    | {msg}".ConsoleWriteLine(color);

        static string Short(string id) => id.Length > 8 ? id[..8] + "…" : id;
    }
}

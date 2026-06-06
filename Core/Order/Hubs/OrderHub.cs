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

        // Client calls Switch after connecting to declare which exchange it wants.
        // Snapshot is sent immediately so client starts from a valid state.
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
                $"{id} switched to exchange {extype}".ConsoleWriteLine(ConsoleColor.Yellow);

                await _worker.SendSnapshotAsync(id, Utility.GetEnum<EnmExChangeType>(extype));
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex.ToString());
            }
        }

        // Client calls this when it detects a heartbeat hash mismatch.
        // Forces a fresh snapshot to recover from missed deltas.
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
                    await _worker.SendSnapshotAsync(id, Utility.GetEnum<EnmExChangeType>(con.ExchangeType));
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex.ToString());
            }
        }

        public override Task OnConnectedAsync()
        {
            lock (_connectionsLock)
            {
                Worker.Connections.Add(new Connection { ConnectionId = Context.ConnectionId });
            }
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
            return base.OnDisconnectedAsync(exception);
        }
    }
}

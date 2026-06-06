using ArzPaya.DataLayer;
using ArzPaya.SharedLibrary;
using ArzPayaBroadcast.Core.Order.Hubs;
using Microsoft.AspNetCore.SignalR;
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ArzPayaBroadcast.Core.Order
{
    internal class Worker : BackgroundService
    {
        private readonly IHubContext<OrderHub> _orderHub;
        private readonly string _connectionString = ConfigurationManager.AppSettings["ArzPayaEntities"];

        // Thread-safe access to the price-level cache
        private static readonly ReaderWriterLockSlim _lock = new();

        // In-memory cache: (exType, orderType) → price → OrderItemCustom
        private static readonly Dictionary<(EnmExChangeType, EnmOrderType), Dictionary<decimal, OrderItemCustom>> _cache = new();

        public static List<Connection> Connections = new();
        public static Dictionary<EnmExChangeType, BestPrice> DataPrice = new();

        // Last observed Change Tracking version
        private long _lastDbVersion = -1;

        // Heartbeat every 50 ticks × 100ms = 5 seconds
        private int _tickCount = 0;
        private const int HeartbeatEvery = 50;

        // Status log every 300 ticks × 100ms = 30 seconds
        private int _statusCount = 0;
        private const int StatusEvery = 300;

        public Worker(IHubContext<OrderHub> orderHub) => _orderHub = orderHub;

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await InitializeAsync();

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(100, stoppingToken);

                    var currentVersion = GetCurrentDbVersion();

                    if (currentVersion > _lastDbVersion)
                    {
                        await Task.WhenAll(Utility.GetExChangeTypes().SelectMany(exType => new Task[]
                        {
                            ProcessOrderAsync(exType, EnmOrderType.Buy),
                            ProcessOrderAsync(exType, EnmOrderType.Sell),
                            ProcessPriceAsync(exType)
                        }));
                        _lastDbVersion = currentVersion;
                    }

                    if (++_tickCount >= HeartbeatEvery)
                    {
                        _tickCount = 0;
                        await BroadcastHeartbeatsAsync();
                    }

                    if (++_statusCount >= StatusEvery)
                    {
                        _statusCount = 0;
                        Log($"alive | DB v{_lastDbVersion} | connections: {Connections.Count}", ConsoleColor.DarkCyan);
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) { Log($"loop error: {ex.Message}", ConsoleColor.Red); }
            }

            Log("Worker stopped.", ConsoleColor.Yellow);
        }

        async Task InitializeAsync()
        {
            try
            {
                Log("initializing...", ConsoleColor.Cyan);
                _lastDbVersion = GetCurrentDbVersion();
                Log($"DB Change Tracking version: {_lastDbVersion}", ConsoleColor.DarkGray);

                foreach (var exType in Utility.GetExChangeTypes())
                {
                    Log($"loading [{exType.GetEnumTitleLatin()}]", ConsoleColor.Gray);

                    foreach (var ot in new[] { EnmOrderType.Buy, EnmOrderType.Sell })
                    {
                        try
                        {
                            var rows = QueryTop25(exType, ot);
                            SetCache((exType, ot), rows.ToDictionary(o => o.p));
                            Log($"  {ot,-4} → {rows.Count} price levels loaded", ConsoleColor.DarkGray);
                        }
                        catch (Exception ex)
                        {
                            Log($"  {ot,-4} → cache error: {ex.Message}", ConsoleColor.Red);
                            SetCache((exType, ot), new Dictionary<decimal, OrderItemCustom>());
                        }
                    }

                    // Populate DataPrice now so HTTP endpoints work before first loop tick
                    await ProcessPriceAsync(exType);
                }

                Log($"initialized. Watching {Utility.GetExChangeTypes().Count()} exchange type(s).", ConsoleColor.Green);
            }
            catch (Exception ex)
            {
                Log($"init failed: {ex}", ConsoleColor.Red);
            }
        }

        async Task ProcessOrderAsync(EnmExChangeType exType, EnmOrderType orderType)
        {
            var key = (exType, orderType);
            var newDict = QueryTop25(exType, orderType).ToDictionary(o => o.p);
            var oldDict = GetCache(key);

            var adds    = newDict.Values.Where(o => !oldDict.ContainsKey(o.p)).ToList();
            var removes = oldDict.Values.Where(o => !newDict.ContainsKey(o.p)).ToList();
            var updates = newDict.Values.Where(o => oldDict.ContainsKey(o.p) && oldDict[o.p].i != o.i).ToList();

            var conns = GetConnections(exType);

            if (adds.Count + removes.Count + updates.Count > 0)
            {
                var tag   = $"[{exType.GetEnumTitleLatin()} {orderType,-4}]";
                var color = orderType == EnmOrderType.Buy ? ConsoleColor.Green : ConsoleColor.Magenta;
                Log($"{tag} +{adds.Count} add  -{removes.Count} rem  ~{updates.Count} upd  → {conns.Count} client(s)", color);
            }
            if (conns.Count > 0)
            {
                var methodName = orderType == EnmOrderType.Buy ? "GetBuys" : "GetSells";
                var tasks = new List<Task>();

                foreach (var o in adds)
                    tasks.Add(_orderHub.Clients.Clients(conns).SendAsync(methodName, o, (int)OrderDeltaType.Add));

                foreach (var o in removes)
                    tasks.Add(_orderHub.Clients.Clients(conns).SendAsync(methodName, o, (int)OrderDeltaType.Remove));

                foreach (var o in updates)
                    tasks.Add(_orderHub.Clients.Clients(conns).SendAsync(methodName, o, (int)OrderDeltaType.Update));

                if (tasks.Count > 0)
                    await Task.WhenAll(tasks);
            }

            SetCache(key, newDict);
        }

        async Task ProcessPriceAsync(EnmExChangeType exType)
        {
            try
            {
                using var db = new ArzPayaEntities(_connectionString);
                var qu = $@"SELECT
                    ISNULL((SELECT MAX(Price) FROM Order{exType.GetEnumTitleLatin()}Buys WITH(NOLOCK) WHERE STATE = 1), 0) AS BuyPrice,
                    ISNULL((SELECT MIN(Price) FROM Order{exType.GetEnumTitleLatin()}Sells WITH(NOLOCK) WHERE STATE = 1), 0) AS SellPrice";
                var pnew = db.Database.SqlQuery<BestPrice>(qu).FirstOrDefault();

                if (!DataPrice.ContainsKey(exType)) DataPrice[exType] = new BestPrice();
                DataPrice[exType].BuyPrice = pnew.BuyPrice;
                DataPrice[exType].SellPrice = pnew.SellPrice;

                try
                {
                    if (!DataPrice.ContainsKey(EnmExChangeType.Unknow))
                        DataPrice[EnmExChangeType.Unknow] = new BestPrice();
                    DataPrice[EnmExChangeType.Unknow].SellPrice = db.Database
                        .SqlQuery<decimal>("SELECT CAST([Value] AS DECIMAL(18,8)) FROM GlobalParameters WHERE [Key]='USDTSell'")
                        .FirstOrDefault();
                    DataPrice[EnmExChangeType.Unknow].BuyPrice = db.Database
                        .SqlQuery<decimal>("SELECT CAST([Value] AS DECIMAL(18,8)) FROM GlobalParameters WHERE [Key]='USDTBuy'")
                        .FirstOrDefault();
                }
                catch (Exception ex) { Console.WriteLine("USDT price error: " + ex.Message); }
            }
            catch (Exception ex) { Console.WriteLine(ex.ToString()); }
        }

        async Task BroadcastHeartbeatsAsync()
        {
            foreach (var exType in Utility.GetExChangeTypes())
            {
                var conns = GetConnections(exType);
                if (conns.Count == 0) continue;

                foreach (var ot in new[] { EnmOrderType.Buy, EnmOrderType.Sell })
                {
                    var hash = ComputeHash(GetCache((exType, ot)));
                    await _orderHub.Clients.Clients(conns).SendAsync("Heartbeat", new HeartbeatMessage
                    {
                        Exchange = exType.GetEnumValue(),
                        OrderType = ot.GetEnumValue(),
                        Hash = hash
                    });
                }
            }
        }

        public async Task SendSnapshotAsync(string connectionId, EnmExChangeType exType)
        {
            Log($"snapshot → {connectionId[..8]}… [{exType.GetEnumTitleLatin()}]", ConsoleColor.Yellow);
            foreach (var ot in new[] { EnmOrderType.Buy, EnmOrderType.Sell })
            {
                var methodName = ot == EnmOrderType.Buy ? "GetBuysSnapshot" : "GetSellsSnapshot";
                var snapshot = GetCache((exType, ot)).Values
                    .OrderBy(o => ot == EnmOrderType.Sell ? o.p : -o.p)
                    .ToList();
                await _orderHub.Clients.Client(connectionId).SendAsync(methodName, snapshot);
                Log($"  {ot,-4} snapshot sent: {snapshot.Count} rows", ConsoleColor.DarkYellow);
            }
        }

        // REST fallback — used by DataController
        public static List<OrderItemCustom> GetSnapshot(EnmExChangeType exType, EnmOrderType orderType)
        {
            _lock.EnterReadLock();
            try
            {
                var key = (exType, orderType);
                return _cache.ContainsKey(key) ? _cache[key].Values.ToList() : new List<OrderItemCustom>();
            }
            finally { _lock.ExitReadLock(); }
        }

        // Returns the global DB Change Tracking version.
        // Falls back to _lastDbVersion+1 (always-poll) when CT is not enabled.
        long GetCurrentDbVersion()
        {
            try
            {
                using var db = new ArzPayaEntities(_connectionString);
                var v = db.Database.SqlQuery<long?>("SELECT CHANGE_TRACKING_CURRENT_VERSION()").FirstOrDefault();
                return v ?? unchecked(_lastDbVersion + 1);
            }
            catch { return unchecked(_lastDbVersion + 1); }
        }

        List<OrderItemCustom> QueryTop25(EnmExChangeType exType, EnmOrderType orderType)
        {
            var orderby = orderType == EnmOrderType.Sell ? "ASC" : "DESC";
            var qu = $"SELECT TOP 25 CHECKSUM_AGG(CHECKSUM(*)) AS i, SUM(ReminedAmount) a, Price p, SUM(ReminedValue) v, {exType.GetEnumValue()} e " +
                     $"FROM Order{exType.GetEnumTitleLatin()}{orderType.GetEnumTitleLatin()}s WITH(NOLOCK) " +
                     $"WHERE State = 1 AND ReminedAmount > 0 GROUP BY Price ORDER BY Price {orderby};";
            using var db = new ArzPayaEntities(_connectionString);
            return db.Database.SqlQuery<OrderItemCustom>(qu).ToList();
        }

        List<string> GetConnections(EnmExChangeType exType)
            => Connections.Where(c => c.ExchangeType == exType.GetEnumValue()).Select(c => c.ConnectionId).ToList();

        Dictionary<decimal, OrderItemCustom> GetCache((EnmExChangeType, EnmOrderType) key)
        {
            _lock.EnterReadLock();
            try
            {
                return _cache.ContainsKey(key)
                    ? new Dictionary<decimal, OrderItemCustom>(_cache[key])
                    : new Dictionary<decimal, OrderItemCustom>();
            }
            finally { _lock.ExitReadLock(); }
        }

        void SetCache((EnmExChangeType, EnmOrderType) key, Dictionary<decimal, OrderItemCustom> data)
        {
            _lock.EnterWriteLock();
            try { _cache[key] = data; }
            finally { _lock.ExitWriteLock(); }
        }

        static string ComputeHash(Dictionary<decimal, OrderItemCustom> data)
        {
            var input = string.Join(",", data.Keys.OrderBy(k => k).Select(k => $"{k}:{data[k].i}"));
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input)))[..8];
        }

        static void Log(string msg, ConsoleColor color)
            => $"[{DateTime.Now:HH:mm:ss.fff}] Worker | {msg}".ConsoleWriteLine(color);
    }
}

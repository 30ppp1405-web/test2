using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace ArzPayaBroadcast.Core.Order
{
    public class OrderItemCustom
    {
        public int i { get; set; }      // checksum of aggregated row
        public decimal p { get; set; }  // price (sort key)
        public decimal a { get; set; }  // sum of amount
        public decimal v { get; set; }  // sum of value
        public int e { get; set; }      // exchange type
    }

    public class Connection
    {
        public int ExchangeType { get; set; }
        public string ConnectionId { get; set; }
    }

    public class BestPrice
    {
        public int ExchangeType { get; set; }
        public decimal BuyPrice { get; set; }
        public decimal SellPrice { get; set; }
    }

    public class HeartbeatMessage
    {
        public int Exchange { get; set; }
        public int OrderType { get; set; }
        public string Hash { get; set; }
    }

    // 1=Add  2=Remove  3=Update(same price, amount/value changed)
    public enum OrderDeltaType
    {
        Add = 1,
        Remove = 2,
        Update = 3
    }
}

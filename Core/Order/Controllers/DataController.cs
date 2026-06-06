using ArzPaya.SharedLibrary;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;

namespace ArzPayaBroadcast.Core.Order.Controllers
{
    [ApiController]
    [Route("orderapi/{action}/{id}")]
    public class DataController : ControllerBase
    {
        [HttpGet]
        public JsonResult getbuys(int id)
        {
            var result = new List<OrderItemCustom>();
            try { result = Worker.GetSnapshot(Utility.GetEnum<EnmExChangeType>(id), EnmOrderType.Buy); }
            catch (Exception ex) { ex.ToString().ConsoleWriteLine(ConsoleColor.Red); }
            return new JsonResult(result);
        }

        [HttpGet]
        public JsonResult getsells(int id)
        {
            var result = new List<OrderItemCustom>();
            try { result = Worker.GetSnapshot(Utility.GetEnum<EnmExChangeType>(id), EnmOrderType.Sell); }
            catch (Exception ex) { ex.ToString().ConsoleWriteLine(ConsoleColor.Red); }
            return new JsonResult(result);
        }

        [HttpGet]
        public JsonResult bestprice(int id)
        {
            var result = new BestPrice();
            try { result = Worker.DataPrice[Utility.GetEnum<EnmExChangeType>(id)]; }
            catch (Exception ex) { ex.ToString().ConsoleWriteLine(ConsoleColor.Red); }
            return new JsonResult(result);
        }
    }
}

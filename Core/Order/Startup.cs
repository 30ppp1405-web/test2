using ArzPayaBroadcast.Core.Order.Hubs;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ArzPayaBroadcast.Core.Order
{
    public class Startup
    {
        public Startup(IConfiguration configuration) => Configuration = configuration;
        public IConfiguration Configuration { get; }

        public void ConfigureServices(IServiceCollection services)
        {
            services.AddCors(options => options.AddPolicy("CorsPolicy", builder =>
                builder.AllowAnyHeader()
                       .AllowAnyMethod()
                       .SetIsOriginAllowed(_ => true)
                       .AllowCredentials()));

            services.AddSignalR();

            // Register as singleton so OrderHub can inject Worker directly,
            // then hand the same instance to the hosting infrastructure.
            services.AddSingleton<Worker>();
            services.AddHostedService(sp => sp.GetRequiredService<Worker>());
        }

        public void Configure(IApplicationBuilder app)
        {
            app.UseCors("CorsPolicy");
            app.UseRouting();
            app.UseEndpoints(endpoints => endpoints.MapHub<OrderHub>("/OrderHub"));
        }
    }
}

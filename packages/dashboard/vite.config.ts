import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import type { IncomingMessage } from "http";
import type { ClientRequest } from "http";

/** Forward real client IP + CF geo headers through Vite → proxy (admin API). */
function attachClientIpProxy(): ProxyOptions {
  return {
    target: "http://127.0.0.1:3000",
    changeOrigin: true,
    xfwd: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq: ClientRequest, req: IncomingMessage) => {
        const header = (name: string): string | undefined => {
          const v = req.headers[name];
          if (Array.isArray(v)) return v[0];
          return typeof v === "string" ? v : undefined;
        };
        const socketIp = req.socket?.remoteAddress?.replace(/^::ffff:/, "") || "";
        const xffFirst = header("x-forwarded-for")?.split(",")[0]?.trim();
        const clientIp =
          header("cf-connecting-ip") ||
          header("true-client-ip") ||
          header("x-real-ip") ||
          xffFirst ||
          (socketIp && socketIp !== "::1" && socketIp !== "127.0.0.1" ? socketIp : "") ||
          socketIp ||
          "";

        if (clientIp) {
          proxyReq.setHeader("x-forwarded-for", clientIp);
          proxyReq.setHeader("x-real-ip", clientIp);
        }
        for (const h of [
          "cf-connecting-ip",
          "cf-ipcountry",
          "true-client-ip",
          "x-vercel-ip-country",
        ] as const) {
          const v = header(h);
          if (v) proxyReq.setHeader(h, v);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/admin": attachClientIpProxy(),
    },
  },
});

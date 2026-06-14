import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA instalable: los meseros agregan la app a la pantalla de inicio
    // y abre a pantalla completa (standalone) como una app nativa.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "AgoraOps POS",
        short_name: "AgoraOps",
        description: "Soluciones de Gestión Integral",
        lang: "es",
        start_url: "/",
        display: "standalone",
        orientation: "any",
        theme_color: "#099dd7",
        background_color: "#F6F7F9",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // El API y los eventos SSE siempre van a red; solo se cachea el shell.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    // PORT permite levantar una segunda instancia (p. ej. preview) sin chocar
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // En desarrollo el API corre en :4000; en producción usar VITE_API_URL
      "/api": "http://localhost:4000",
      // Descargas del servicio de impresión (estático del backend, §1.8.5)
      "/print-service": "http://localhost:4000",
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // En desarrollo el API corre en :4000; en producción usar VITE_API_URL
      "/api": "http://localhost:4000",
    },
  },
});

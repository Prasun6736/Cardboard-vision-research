import { defineConfig } from "vite";

export default defineConfig({
  root: "client",

  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        desktop: "client/index.html",
        phone: "client/phone/index.html",
        audio: "client/audio/index.html",
        history: "client/history/index.html",
      },
    },
  },
});

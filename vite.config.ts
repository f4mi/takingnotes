import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-scroll-area', '@radix-ui/react-slider', '@radix-ui/react-select', '@radix-ui/react-tooltip', '@radix-ui/react-separator', 'react-colorful'],
        },
      },
    },
  },
});

import { defineConfig } from 'vite';

// The repository also hosts the is-a.dev domain registry; `domains/` holds tens
// of thousands of JSON files, so it is kept out of the dev server's watcher.
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: { ignored: ['**/domains/**', '**/node_modules/**', '**/.git/**'] },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.hdr', '**/*.ktx2'],
});

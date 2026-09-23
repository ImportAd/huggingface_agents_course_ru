import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { sourceRoot, translationRoot, exampleRoot, generateCourse } from './scripts/generate.mjs';

export default defineConfig({
  plugins: [react(), {
    name: 'watch-course-source',
    configureServer(server) {
      const units = path.join(sourceRoot, 'units');
      server.watcher.add([units, translationRoot, exampleRoot]);
      let timer, running = false, pending = false;
      const regenerate = async () => {
        if (running) { pending = true; return; }
        running = true;
        try { await generateCourse(); server.ws.send({ type: 'full-reload' }); }
        catch (error) { server.config.logger.error(error.message); }
        finally { running = false; if (pending) { pending = false; timer = setTimeout(regenerate, 300); } }
      };
      server.watcher.on('all', (_event, file) => {
        if ((file.startsWith(units) || file.startsWith(translationRoot) || file.startsWith(exampleRoot) && !file.includes('.venv') && !file.includes('__pycache__')) && /\.(mdx|ya?ml|json|py|txt)$/.test(file)) { clearTimeout(timer); timer = setTimeout(regenerate, 600); }
      });
      server.httpServer?.on('close', () => clearTimeout(timer));
    },
  }],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});

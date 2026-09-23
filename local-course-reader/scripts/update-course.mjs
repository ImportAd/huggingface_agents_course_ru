import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { sourceRoot, generateCourse } from './generate.mjs';

try {
  const run = (args, capture = false) => execFileSync('git', args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
  if (!existsSync(sourceRoot)) run(['clone', '--depth', '1', 'https://github.com/huggingface/agents-course.git', sourceRoot]);
  else {
    if (!existsSync(path.join(sourceRoot, '.git'))) throw new Error('course-source существует, но не является git checkout. Сохраните эту папку под другим именем и повторите.');
    const status = run(['-C', sourceRoot, 'status', '--porcelain'], true).trim();
    if (status) throw new Error('В course-source есть локальные изменения. Сохраните их в git или переместите свои файлы перед обновлением. Скрипт ничего не сбрасывает.');
    run(['-C', sourceRoot, 'pull', '--ff-only']);
  }
  await generateCourse();
  console.log('Курс обновлён. Обновите вкладку браузера. Для preview повторите npm run build.');
} catch (error) { console.error(error.message); process.exitCode = 1; }

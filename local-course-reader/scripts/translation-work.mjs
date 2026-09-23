import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { htmlToDOM } from 'html-react-parser';
import { appRoot, sourceRoot, outputRoot } from './generate.mjs';

const work = path.join(appRoot, '.translation-work');
const translationRoot = path.resolve(appRoot, '../course-translations');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const parser = unified().use(remarkParse).use(remarkGfm);
const [command, ...requested] = process.argv.slice(2);
if (command === 'extract') {
  const en = path.join(sourceRoot, 'units/en');
  const files = (await fs.readdir(en, { recursive: true })).filter((f) => f.endsWith('.mdx') && !existsSync(path.join(sourceRoot, 'units/ru-RU', f)));
  for (const f of files) {
    const id = f.replaceAll('\\', '/').slice(0, -4);
    const source = await fs.readFile(path.join(en, f), 'utf8');
    const rendered = JSON.parse(await fs.readFile(path.join(outputRoot, 'pages/en', `${id}.json`), 'utf8'));
    const allHeadings = (nodes) => nodes.flatMap((n) => [...(/^h[1-6]$/.test(n.name || '') ? [{ id: n.attribs.id }] : []), ...allHeadings(n.children || [])]);
    const headings = allHeadings(htmlToDOM(rendered.html));
    const replacements = [], blocks = [];
    let headingIndex = 0;
    visit(parser.parse(source), (node) => {
      if (node.type === 'code') replacements.push({ start: node.position.start.offset, end: node.position.end.offset, code: true });
      if (node.type === 'heading') {
        const heading = headings[headingIndex++];
        const raw = source.slice(node.position.start.offset, node.position.end.offset);
        if (heading && !/\[\[[^\]]+\]\]/.test(raw)) replacements.push({ start: node.position.end.offset, end: node.position.end.offset, text: ` [[${heading.id}]]` });
      }
    });
    for (const match of source.matchAll(/<CourseFloatingBanner\b[\s\S]*?\/>/g)) replacements.push({ start: match.index, end: match.index + match[0].length, code: true });
    replacements.sort((a, b) => a.start - b.start);
    for (const replacement of replacements) if (replacement.code) {
      const token = `@@SOURCE_BLOCK_${String(blocks.length + 1).padStart(3, '0')}@@`;
      blocks.push({ token, original: source.slice(replacement.start, replacement.end) });
      replacement.text = token;
    }
    let template = source;
    for (const r of replacements.reverse()) template = template.slice(0, r.start) + r.text + template.slice(r.end);
    const destination = path.join(work, 'en', `${id}.mdx`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, template, 'utf8');
    await fs.writeFile(destination + '.json', JSON.stringify({ id, sourceSha256: sha256(source), blocks }, null, 2));
  }
  console.log(`Подготовлен ${files.length} исходник для перевода.`);
} else if (command === 'save') {
  const files = requested.length ? requested.map((id) => `${id}.mdx`) : (await fs.readdir(path.join(work, 'ru'), { recursive: true })).filter((f) => f.endsWith('.mdx'));
  const metadataFile = path.join(translationRoot, 'manifest.json');
  const metadata = existsSync(metadataFile) ? JSON.parse(await fs.readFile(metadataFile, 'utf8')) : { language: 'ru-RU', sourceRepository: 'https://github.com/huggingface/agents-course', sourceRevision: 'b3946b1d09d29c65736e219d48a8a736a2c52154', translator: 'Локальный перевод, подготовленный ИИ-ассистентом и проверенный на структуру и терминологию', lessons: {} };
  for (const f of files) {
    const id = f.replaceAll('\\', '/').slice(0, -4);
    const meta = JSON.parse(await fs.readFile(path.join(work, 'en', `${id}.mdx.json`), 'utf8'));
    let translated = await fs.readFile(path.join(work, 'ru', f), 'utf8');
    const expectedTokens = meta.blocks.map((b) => b.token);
    const actualTokens = [...translated.matchAll(/@@SOURCE_BLOCK_\d+@@/g)].map((m) => m[0]);
    if (JSON.stringify(expectedTokens) !== JSON.stringify(actualTokens)) throw new Error(`${id}: нарушены порядок/полнота исходных блоков`);
    for (const block of meta.blocks) translated = translated.replace(block.token, () => block.original);
    const output = path.join(translationRoot, 'ru-RU', `${id}.mdx`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, translated, 'utf8');
    const translationSha256 = sha256(translated);
    const translatedAt = metadata.lessons[id]?.translationSha256 === translationSha256 ? metadata.lessons[id].translatedAt : new Date().toISOString().slice(0, 10);
    metadata.lessons[id] = { sourceSha256: meta.sourceSha256, translationSha256, translatedAt };
  }
  await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
  console.log(`Сохранено: ${files.length}. Всего переводов: ${Object.keys(metadata.lessons).length}.`);
} else throw new Error('Использование: node scripts/translation-work.mjs extract | save [lesson/id ...]');

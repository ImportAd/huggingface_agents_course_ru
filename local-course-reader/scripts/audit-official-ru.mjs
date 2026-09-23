import fs from 'node:fs/promises';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { sourceRoot } from './generate.mjs';

const parser = unified().use(remarkParse).use(remarkGfm);
const root = path.join(sourceRoot, 'units');
const files = (await fs.readdir(path.join(root, 'ru-RU'), { recursive: true }))
  .filter((f) => f.endsWith('.mdx') && !f.includes('get-your-certificate') && !f.includes('next-units'));
for (const file of files) {
  const stats = [];
  for (const lang of ['en', 'ru-RU']) {
    const source = await fs.readFile(path.join(root, lang, file), 'utf8');
    const ast = parser.parse(source);
    const headings = [], codes = [], urls = [];
    visit(ast, (node) => {
      if (node.type === 'heading') headings.push(node.depth);
      if (node.type === 'code') codes.push(node.value);
      if ((node.type === 'link' || node.type === 'image') && node.url) urls.push(node.url);
    });
    for (const match of source.matchAll(/(?:href|src)=["']([^"']+)/g)) urls.push(match[1]);
    stats.push({ headings, codes, urls, words: source.split(/\s+/).length });
  }
  const [en, ru] = stats;
  const sameCode = en.codes.filter((code, i) => code === ru.codes[i]).length;
  const missingUrls = [...new Set(en.urls)].filter((url) => !ru.urls.includes(url));
  console.log(JSON.stringify({ file: file.replaceAll('\\', '/'), headings: `${en.headings.length}/${ru.headings.length}`, code: `${sameCode}/${en.codes.length}/${ru.codes.length}`, missingUrls: missingUrls.slice(0, 8), missingUrlCount: missingUrls.length, words: `${en.words}/${ru.words}` }));
}

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { renderLesson, escapeHtml } from './renderer.mjs';

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sourceRoot = path.resolve(appRoot, '../course-source');
export const translationRoot = path.resolve(appRoot, '../course-translations');
export const exampleRoot = path.resolve(appRoot, '../first-local-agent');
export const outputRoot = path.join(appRoot, 'public/course');
const slash = (s) => s.replaceAll('\\', '/');
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export function translationStatus(source, translated, metadata) {
  return { sourceChanged: !metadata || sha256(source) !== metadata.sourceSha256, translationChanged: !metadata || sha256(translated) !== metadata.translationSha256 };
}
async function filesUnder(root) {
  if (!existsSync(root)) return [];
  return (await fs.readdir(root, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile()).map((d) => slash(path.relative(root, path.join(d.parentPath, d.name)))).sort(natural);
}
const locals = (node) => node.local ? [node.local] : (node.sections || []).flatMap(locals);
const firstLocal = (node) => locals(node)[0];
const key = (node) => node.local || `group:${firstLocal(node) || node.title}`;

export function buildTree(en, ru, pages) {
  const leafTitles = new Map();
  const groupTitles = new Map();
  const collect = (nodes, lang, depth = 0) => nodes.forEach((n) => {
    const map = n.local ? leafTitles : groupTitles;
    const k = n.local || `${depth}:${firstLocal(n)}`;
    map.set(k, { ...map.get(k), [lang]: n.title });
    if (n.sections) collect(n.sections, lang, depth + 1);
  });
  collect(en, 'en'); collect(ru, 'ru');
  function merge(primary, secondary) {
    const result = structuredClone(primary);
    let previous = -1;
    for (const node of secondary) {
      let i = result.findIndex((n) => n.local && n.local === node.local);
      if (!node.local) i = result.findIndex((n) => !n.local && locals(n).some((id) => locals(node).includes(id)));
      if (i >= 0) {
        if (node.sections) result[i].sections = merge(result[i].sections || [], node.sections);
        previous = i;
      } else {
        const at = previous >= 0 ? previous + 1 : result.length;
        result.splice(at, 0, structuredClone(node)); previous = at;
      }
    }
    return result;
  }
  const merged = merge(en, ru);
  const included = new Set(merged.flatMap(locals));
  const extras = Object.keys(pages).filter((id) => !included.has(id)).sort(natural);
  if (extras.length) merged.push({ title: 'Дополнительные страницы', sections: extras.map((id) => ({ local: id, title: pages[id].titles.en || pages[id].titles.ru })) });
  const seen = new Set();
  const convert = (nodes, depth = 0) => nodes.flatMap((n) => {
    if (n.local) {
      if (!pages[n.local] || seen.has(n.local)) return [];
      seen.add(n.local);
      pages[n.local].titles = { ...pages[n.local].titles, ...leafTitles.get(n.local) };
      return [{ id: n.local }];
    }
    const children = convert(n.sections || [], depth + 1);
    return children.length ? [{ key: `${depth}:${key(n)}`, titles: { en: n.title, ru: n.title, ...groupTitles.get(`${depth}:${firstLocal(n)}`) }, children }] : [];
  });
  return convert(merged);
}

export async function generateCourse() {
  if (!existsSync(path.join(sourceRoot, 'units/en'))) throw new Error('Не найден course-source/units/en. Выполните npm run update-course.');
  const pages = {}, sources = [], diagnostics = [], translationDiagnostics = [];
  const metadataFile = path.join(translationRoot, 'manifest.json');
  const translations = existsSync(metadataFile) ? JSON.parse(await fs.readFile(metadataFile, 'utf8')) : { lessons: {} };
  const adaptationFile = path.join(translationRoot, 'adaptations.json');
  const adaptations = existsSync(adaptationFile) ? JSON.parse(await fs.readFile(adaptationFile, 'utf8')) : { lessons: {} };
  const allFiles = await filesUnder(path.join(sourceRoot, 'units'));
  const assets = new Set((await filesUnder(sourceRoot)).filter((f) => !f.startsWith('.git/') && /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mp3|wav|pdf|ipynb)$/i.test(f)));
  for (const lang of ['en', 'ru-RU']) {
    for (const rel of allFiles.filter((f) => f.startsWith(`${lang}/`) && f.endsWith('.mdx'))) {
      const id = rel.slice(lang.length + 1, -4);
      const source = await fs.readFile(path.join(sourceRoot, 'units', rel), 'utf8');
      const uiLang = lang === 'en' ? 'en' : 'ru';
      const title = source.match(/^#\s+(.+)$/m)?.[1].replace(/\s*\[\[.*?\]\]/g, '').trim() || id.split('/').at(-1);
      pages[id] ||= { id, languages: [], titles: {}, origins: {} };
      pages[id].languages.push(uiLang); pages[id].titles[uiLang] = title;
      pages[id].origins[uiLang] = { kind: 'official' };
      sources.push({ id, language: lang, source });
    }
  }
  for (const rel of (await filesUnder(path.join(translationRoot, 'ru-RU'))).filter((f) => f.endsWith('.mdx'))) {
    const id = rel.slice(0, -4), page = pages[id];
    if (!page?.languages.includes('en')) continue;
    const source = await fs.readFile(path.join(translationRoot, 'ru-RU', rel), 'utf8');
    const original = sources.find((s) => s.id === id && s.language === 'en').source;
    const replacingOfficial = page.languages.includes('ru');
    const record = replacingOfficial ? adaptations.lessons[id] : translations.lessons[id];
    const status = translationStatus(original, source, record);
    if (!replacingOfficial) page.languages.push('ru');
    page.titles.ru = source.match(/^#\s+(.+)$/m)?.[1].replace(/\s*\[\[.*?\]\]/g, '').replace(/[*`]/g, '').trim() || page.titles.en;
    page.origins.ru = { kind: replacingOfficial ? 'local-adaptation' : 'local-translation', ...status, translatedAt: record?.translatedAt };
    if (status.sourceChanged || status.translationChanged) translationDiagnostics.push({ id, ...status });
    if (replacingOfficial) {
      const at = sources.findIndex((s) => s.id === id && s.language === 'ru-RU');
      sources.splice(at, 1);
    }
    sources.push({ id, language: 'ru-RU', source, assetLanguage: 'en' });
  }
  const ids = new Set(Object.keys(pages));
  const readToc = async (lang) => {
    const file = path.join(sourceRoot, 'units', lang, '_toctree.yml');
    return existsSync(file) ? YAML.parse(await fs.readFile(file, 'utf8')) : [];
  };
  const tree = buildTree(await readToc('en'), await readToc('ru-RU'), pages);
  for (const page of Object.values(pages)) if (page.origins.ru?.kind === 'local-adaptation') {
    const source = sources.find((s) => s.id === page.id && s.language === 'ru-RU').source;
    page.titles.ru = source.match(/^#\s+(.+)$/m)?.[1].replace(/\s*\[\[.*?\]\]/g, '').replace(/[*`]/g, '').trim() || page.titles.ru;
  }
  const titlesFile = path.join(translationRoot, 'titles.json');
  if (existsSync(titlesFile)) {
    const titles = JSON.parse(await fs.readFile(titlesFile, 'utf8'));
    const applyTitles = (nodes) => nodes.forEach((node) => {
      if (node.children) {
        if (titles[node.key]) node.titles.ru = titles[node.key];
        applyTitles(node.children);
      }
    });
    applyTitles(tree);
  }
  const usedAssets = new Set();
  const resolveAsset = (url, id, lang) => {
    let decoded;
    try { decoded = decodeURIComponent(url.split(/[?#]/)[0]); } catch { return url; }
    let candidates = [];
    if (/^https?:/.test(url)) {
      const github = decoded.match(/^https?:\/\/(?:raw.githubusercontent.com\/huggingface\/agents-course\/[^/]+\/|github.com\/huggingface\/agents-course\/(?:blob|raw)\/[^/]+\/)(.+)/);
      const dataset = decoded.match(/\/datasets\/agents-course\/course-images\/(?:resolve|blob)\/[^/]+\/(.+)/);
      if (github) candidates.push(github[1]);
      if (dataset) candidates.push(dataset[1], `assets/${dataset[1]}`, `images/${dataset[1]}`, `units/${dataset[1]}`);
    } else {
      candidates = [path.posix.normalize(path.posix.join('units', lang, path.posix.dirname(id), decoded)), decoded.replace(/^\//, '')];
    }
    const local = candidates.find((p) => assets.has(p));
    if (local) { usedAssets.add(local); return `/course/assets/${local.split('/').map(encodeURIComponent).join('/')}`; }
    return /^https?:|^data:|^\/\//.test(url) ? url : `https://raw.githubusercontent.com/huggingface/agents-course/main/units/${lang}/${path.posix.normalize(path.posix.join(path.posix.dirname(id), url))}`;
  };
  await fs.mkdir(outputRoot, { recursive: true });
  for (const { id, language, source, assetLanguage = language } of sources) {
    let rendered;
    try { rendered = await renderLesson(source, { id, language, ids, resolveAsset: (url, pageId) => resolveAsset(url, pageId, assetLanguage) }); }
    catch (error) {
      rendered = { html: `<aside class="component-fallback">Не удалось разобрать страницу. Ниже — полный исходный текст.</aside><pre>${escapeHtml(source)}</pre>`, widgets: [], headings: [], warnings: [error.message], rawFallback: true };
    }
    diagnostics.push(...rendered.warnings.map((message) => ({ page: `${language}/${id}`, message })));
    const output = path.join(outputRoot, 'pages', language, `${id}.json`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify({ id, language, ...rendered }), 'utf8');
    const raw = path.join(outputRoot, 'source', language, `${id}.mdx`);
    await fs.mkdir(path.dirname(raw), { recursive: true });
    await fs.writeFile(raw, source, 'utf8');
  }
  for (const asset of usedAssets) {
    const dest = path.join(outputRoot, 'assets', asset);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(sourceRoot, asset), dest);
  }
  await fs.copyFile(path.join(sourceRoot, 'LICENSE'), path.join(outputRoot, 'LICENSE'));
  const exampleOutput = path.join(outputRoot, 'examples/first-local-agent');
  await fs.mkdir(exampleOutput, { recursive: true });
  for (const name of ['agent.py', 'manual_agent.py', 'requirements.txt', 'README.md', 'test_agent.py']) {
    if (existsSync(path.join(exampleRoot, name))) await fs.copyFile(path.join(exampleRoot, name), path.join(exampleOutput, name));
  }
  let revision = 'unknown';
  try { revision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(); } catch { /* source archives still work */ }
  const manifest = { revision, generatedAt: new Date().toISOString(), tree, pages, diagnostics, translationDiagnostics, counts: { lessons: ids.size, en: sources.filter((s) => s.language === 'en').length, ru: sources.filter((s) => s.language === 'ru-RU').length, localTranslations: Object.values(pages).filter((p) => p.origins.ru?.kind === 'local-translation').length, localAdaptations: Object.values(pages).filter((p) => p.origins.ru?.kind === 'local-adaptation').length, assets: usedAssets.size } };
  await fs.writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Курс: ${ids.size} уроков; EN: ${manifest.counts.en}, RU: ${manifest.counts.ru}. Замечаний рендера: ${diagnostics.length}.`);
  if (translationDiagnostics.length) console.warn(`Переводов для сверки: ${translationDiagnostics.length}. См. translationDiagnostics в manifest.json.`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  generateCourse().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { htmlToDOM } from 'html-react-parser';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { outputRoot, sourceRoot, translationRoot, translationStatus, buildTree } from '../scripts/generate.mjs';
import { renderLesson, resolveCourseLink, prepareMdx } from '../scripts/renderer.mjs';

const manifest = JSON.parse(await fs.readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
const flatten = (nodes) => nodes.flatMap((n) => n.id ? [n.id] : flatten(n.children));
const text = (node) => node.type === 'text' ? node.data : (node.children || []).map(text).join('');
const normalizeEol = (value) => value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
function elements(nodes, tag) {
  return nodes.flatMap((node) => [...(node.name === tag ? [node] : []), ...elements(node.children || [], tag)]);
}

test('все исходные MDX включены один раз; основной порядок соответствует EN', async () => {
  const ids = flatten(manifest.tree);
  assert.equal(ids.length, Object.keys(manifest.pages).length);
  assert.equal(new Set(ids).size, ids.length);
  for (const lang of ['en', 'ru-RU']) {
    const files = (await fs.readdir(path.join(sourceRoot, 'units', lang), { recursive: true })).filter((f) => f.endsWith('.mdx'));
    assert.equal(files.length + (lang === 'ru-RU' ? manifest.counts.localTranslations : 0), manifest.counts[lang === 'en' ? 'en' : 'ru']);
    for (const file of files) assert.ok(ids.includes(file.replaceAll('\\', '/').slice(0, -4)), file);
  }
  const { default: YAML } = await import('yaml');
  const toc = YAML.parse(await fs.readFile(path.join(sourceRoot, 'units/en/_toctree.yml'), 'utf8'));
  const tocIds = (nodes) => nodes.flatMap((n) => n.local ? [n.local] : tocIds(n.sections || []));
  assert.deepEqual(ids.filter((id) => manifest.pages[id].languages.includes('en')), tocIds(toc));
});

test('весь корпус: блоки кода, компоненты и исходные файлы сохранены', async () => {
  let count = 0;
  for (const page of Object.values(manifest.pages)) {
    for (const lang of page.languages) {
      const language = lang === 'ru' ? 'ru-RU' : 'en';
      const relative = `${language}/${page.id}`;
      const root = page.origins[lang].kind.startsWith('local-') ? translationRoot : path.join(sourceRoot, 'units');
      const original = await fs.readFile(path.join(root, `${relative}.mdx`), 'utf8');
      const generated = JSON.parse(await fs.readFile(path.join(outputRoot, 'pages', `${relative}.json`), 'utf8'));
      const copied = await fs.readFile(path.join(outputRoot, 'source', `${relative}.mdx`), 'utf8');
      assert.equal(copied, original, `Изменён источник ${relative}`);
      assert.ok(!generated.rawFallback, `Полный fallback ${relative}`);
      assert.deepEqual(generated.warnings, [], relative);
      const dom = htmlToDOM(generated.html);
      const codes = elements(dom, 'pre').map((node) => text(node).trim());
      visit(unified().use(remarkParse).use(remarkGfm).parse(original), 'code', (node) => {
        assert.ok(codes.includes(node.value.trim()), `Потерян блок кода: ${relative}\n${node.value.slice(0, 100)}`);
      });
      const { widgets } = prepareMdx(original);
      assert.deepEqual(generated.widgets, widgets, relative);
      assert.equal(elements(dom, 'course-widget').length, widgets.length, relative);
      for (const link of elements(dom, 'a')) if (link.attribs.href?.startsWith('/lesson/')) {
        const id = link.attribs.href.slice(8).split(/[?#]/)[0];
        assert.ok(manifest.pages[id], `Ссылка на отсутствующий урок ${relative}: ${id}`);
      }
      count++;
    }
  }
  assert.equal(count, manifest.counts.en + manifest.counts.ru);
});

test('полные, относительные ссылки, языки, расширения и якоря', () => {
  const ids = new Set(Object.keys(manifest.pages));
  const resolve = (url, id = 'unit3/agentic-rag/agent') => resolveCourseLink(url, id, 'en', ids);
  for (const url of [
    'https://huggingface.co/learn/agents-course/en/unit1/tools#how-do-tools-work',
    'https://hf.co/learn/agents-course/ru-RU/unit1/tools#how-do-tools-work',
    'https://huggingface.co/learn/agents-course/unit1/tools#how-do-tools-work',
    '../../unit1/tools.mdx#how-do-tools-work',
    '/learn/agents-course/en/unit1/tools#how-do-tools-work',
  ]) assert.equal(resolve(url), '/lesson/unit1/tools#how-do-tools-work', url);
  assert.equal(resolve('./tools'), '/lesson/unit3/agentic-rag/tools');
  assert.equal(resolve('#anchor'), '#anchor');
  assert.equal(resolve('https://github.com/huggingface/smolagents'), 'https://github.com/huggingface/smolagents');
  assert.equal(resolve('https://huggingface.co/docs/smolagents'), 'https://huggingface.co/docs/smolagents');
});

test('неизвестные компоненты и динамический JSX не исполняются и не теряют содержимое', async () => {
  const source = '# Example [[example]]\n\n<Unknown thing={dangerous()} />\n\n<Tip>\n\n**Keep me**\n\n</Tip>\n\n<Other>\n\nChild content\n\n</Other>\n\n```jsx\n<Question choices={arbitraryCode()} />\n```\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">';
  const result = await renderLesson(source, { id: 'unit0/example', language: 'en', ids: new Set() });
  assert.match(result.html, /dangerous\(\)/);
  assert.match(result.html, /<strong>Keep me<\/strong>/);
  assert.match(result.html, /Child content/);
  assert.match(result.html, /admonition tip/);
  assert.match(result.html, /id="example"/);
  assert.doesNotMatch(result.html, /<script|onerror=/);
  assert.equal(result.widgets.length, 0);
});

test('вложенное оглавление, RU-only и файлы вне metadata', () => {
  const pages = Object.fromEntries(['u/a', 'u/b', 'u/extra', 'new/file'].map((id) => [id, { id, titles: { en: id } }]));
  const en = [{ title: 'Unit', sections: [{ title: 'Nested', sections: [{ local: 'u/a', title: 'A' }, { local: 'u/b', title: 'B' }] }] }];
  const ru = [{ title: 'Раздел', sections: [{ title: 'Вложенный', sections: [{ local: 'u/a', title: 'А' }, { local: 'u/extra', title: 'Дополнение' }, { local: 'u/b', title: 'Б' }] }] }];
  const tree = buildTree(en, ru, pages);
  assert.deepEqual(flatten(tree), ['u/a', 'u/extra', 'u/b', 'new/file']);
  assert.equal(tree[0].titles.ru, 'Раздел');
  assert.equal(tree[0].children[0].titles.ru, 'Вложенный');
});

test('все недостающие переводы: код, URL, якоря, вкладки и ответы совпадают с оригиналом', async () => {
  const metadata = JSON.parse(await fs.readFile(path.join(translationRoot, 'manifest.json'), 'utf8'));
  const parser = unified().use(remarkParse).use(remarkGfm);
  const blocks = (source) => {
    const result = [];
    visit(parser.parse(source), 'code', (node) => result.push({ lang: node.lang, meta: node.meta, value: normalizeEol(node.value) }));
    return result;
  };
  const urls = (source) => [...source.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => m[0]).sort();
  const headings = (html) => [1, 2, 3, 4, 5, 6].flatMap((n) => elements(htmlToDOM(html), `h${n}`).map((h) => h.attribs.id));
  const tabs = (html) => elements(htmlToDOM(html), 'hfoption').map((n) => n.attribs.id);
  let count = 0;
  for (const [id, meta] of Object.entries(metadata.lessons)) {
    const en = await fs.readFile(path.join(sourceRoot, 'units/en', `${id}.mdx`), 'utf8');
    const ru = await fs.readFile(path.join(translationRoot, 'ru-RU', `${id}.mdx`), 'utf8');
    assert.deepEqual(translationStatus(en, ru, meta), { sourceChanged: false, translationChanged: false }, id);
    assert.doesNotMatch(ru, /@@SOURCE_BLOCK_|\uFFFD/, id);
    assert.deepEqual(blocks(ru), blocks(en), `${id}: код`);
    assert.deepEqual(urls(ru), urls(en), `${id}: URL`);
    const rendered = await Promise.all(['en', 'ru-RU'].map(async (lang) => JSON.parse(await fs.readFile(path.join(outputRoot, 'pages', lang, `${id}.json`), 'utf8'))));
    assert.deepEqual(headings(rendered[1].html), headings(rendered[0].html), `${id}: якоря`);
    assert.deepEqual(tabs(rendered[1].html), tabs(rendered[0].html), `${id}: вкладки`);
    const structure = (widgets) => widgets.map((widget) => widget.type === 'Question' ? { type: widget.type, choices: widget.props.choices.map(({ text, explain, ...rest }) => rest) } : widget);
    assert.deepEqual(structure(rendered[1].widgets), structure(rendered[0].widgets), `${id}: компоненты и ответы`);
    for (const widget of rendered[1].widgets.filter((w) => w.type === 'Question')) for (const choice of widget.props.choices) {
      if (choice.explain) assert.match(choice.explain, /[А-Яа-яЁё]/, `${id}: пояснение`);
    }
    count++;
  }
  assert.equal(count, 51);
  assert.equal(manifest.counts.localTranslations, count);
  assert.equal(manifest.counts.ru, manifest.counts.lessons);
  assert.deepEqual(manifest.translationDiagnostics, []);
  const allGroups = (nodes) => nodes.flatMap((n) => n.children ? [n, ...allGroups(n.children)] : []);
  for (const node of allGroups(manifest.tree)) assert.match(node.titles.ru, /[А-Яа-яЁё]/, node.key);
});

test('изменение оригинала и локального перевода обнаруживается независимо', () => {
  const meta = { sourceSha256: 'not-a-match', translationSha256: 'not-a-match' };
  assert.deepEqual(translationStatus('updated', 'changed', meta), { sourceChanged: true, translationChanged: true });
  assert.deepEqual(translationStatus('new', 'new', undefined), { sourceChanged: true, translationChanged: true });
});

test('контрольные хеши одинаковы для LF и CRLF', () => {
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const metadata = {
    sourceSha256: digest('source\nline\n'),
    translationSha256: digest('перевод\nстрока\n'),
  };
  assert.deepEqual(
    translationStatus('source\r\nline\r\n', 'перевод\r\nстрока\r\n', metadata),
    { sourceChanged: false, translationChanged: false },
  );
});

test('локальные актуализации официальных RU отслеживаются и содержат локальный практикум', async () => {
  const adaptations = JSON.parse(await fs.readFile(path.join(translationRoot, 'adaptations.json'), 'utf8'));
  assert.equal(Object.keys(adaptations.lessons).length, 12);
  for (const [id, metadata] of Object.entries(adaptations.lessons)) {
    const en = await fs.readFile(path.join(sourceRoot, 'units/en', `${id}.mdx`), 'utf8');
    const ru = await fs.readFile(path.join(translationRoot, 'ru-RU', `${id}.mdx`), 'utf8');
    assert.deepEqual(translationStatus(en, ru, metadata), { sourceChanged: false, translationChanged: false }, id);
    assert.equal(manifest.pages[id].origins.ru.kind, 'local-adaptation', id);
  }
  assert.equal(manifest.counts.localAdaptations, 12);
  assert.deepEqual(manifest.translationDiagnostics, []);
  const tutorial = await fs.readFile(path.join(translationRoot, 'ru-RU/unit1/tutorial.mdx'), 'utf8');
  for (const marker of ['LangGraph', 'Ollama', 'Ubuntu', 'qwen3:4b-instruct', 'recursion_limit']) assert.match(tutorial, new RegExp(marker));
  assert.doesNotMatch(tutorial, /First_agent_template|InferenceClientModel|продублируйте (?:это )?пространство/i);
  const introduction = await fs.readFile(path.join(translationRoot, 'ru-RU/unit0/introduction.mdx'), 'utf8');
  assert.match(introduction, /дедлайна нет/i);
  assert.doesNotMatch(introduction, /дедлайн(?:ом)? (?:является|установлен).*1 июля 2025/i);
  for (const name of ['agent.py', 'manual_agent.py', 'requirements.txt', 'README.md', 'test_agent.py']) {
    assert.equal(await fs.readFile(path.join(outputRoot, 'examples/first-local-agent', name), 'utf8'), await fs.readFile(path.resolve(outputRoot, '../../../first-local-agent', name), 'utf8'));
  }
});

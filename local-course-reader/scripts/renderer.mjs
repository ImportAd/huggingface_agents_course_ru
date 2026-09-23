import JSON5 from 'json5';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import { toText } from 'hast-util-to-text';

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parser = unified().use(remarkParse).use(remarkGfm);

// Scan balanced JSX attributes; expressions are parsed as static JSON5, never executed.
function endOfValue(text, start, terminator) {
  let quote = '', escaped = false, depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (terminator === '}' && depth === 0) return i; }
    if (c === terminator && depth === 0) return i;
  }
  throw new Error('Незавершённый тег или атрибут');
}

export function parseAttributes(text) {
  const props = {};
  let i = 0;
  while (i < text.length) {
    const match = /^\s*([\w-]+)(?:\s*=\s*)?/.exec(text.slice(i));
    if (!match) break;
    i += match[0].length;
    const key = match[1];
    if (!match[0].includes('=')) { props[key] = true; continue; }
    const c = text[i];
    if (c === '{') {
      const end = endOfValue(text, i, '}');
      props[key] = JSON5.parse(text.slice(i + 1, end));
      i = end + 1;
    } else if (c === '"' || c === "'") {
      let end = i + 1;
      while (end < text.length && (text[end] !== c || text[end - 1] === '\\')) end++;
      props[key] = text.slice(i + 1, end);
      i = end + 1;
    } else {
      const value = /^[^\s/>]+/.exec(text.slice(i));
      if (!value) break;
      props[key] = value[0]; i += value[0].length;
    }
  }
  return props;
}

export function prepareMdx(source) {
  const widgets = [], warnings = [], protectedRanges = [], replacements = [];
  visit(parser.parse(source), (node) => {
    if (node.type === 'code' || node.type === 'inlineCode') protectedRanges.push([node.position.start.offset, node.position.end.offset]);
  });
  const protectedAt = (i) => protectedRanges.some(([a, b]) => i >= a && i < b);
  const pattern = /<\/?[A-Z][\w.]*(?=[\s/>])/g;
  let match;
  while ((match = pattern.exec(source))) {
    if (protectedAt(match.index)) continue;
    const name = match[0].replace(/^<\/?/, '');
    let end;
    try { end = endOfValue(source, pattern.lastIndex, '>'); }
    catch (error) {
      warnings.push(`${name}: ${error.message}`);
      replacements.push([match.index, pattern.lastIndex, escapeHtml(match[0])]);
      continue;
    }
    const raw = source.slice(match.index, end + 1);
    const closing = raw.startsWith('</'), selfClosing = /\/\s*>$/.test(raw);
    let html;
    if (closing) html = '\n</aside>\n';
    else {
      try {
        const props = parseAttributes(raw.slice(name.length + 1).replace(/\/?\s*>$/, ''));
        if (name === 'Question') {
          if (!Array.isArray(props.choices) || !props.choices.length || props.choices.some((c) => typeof c.text !== 'string')) throw new Error('Неизвестный формат choices');
          widgets.push({ type: name, props });
          html = `<course-widget data-index="${widgets.length - 1}"></course-widget>`;
        } else if (name === 'CourseFloatingBanner') {
          widgets.push({ type: name, props });
          html = `<course-widget data-index="${widgets.length - 1}"></course-widget>`;
        } else if (/^(Tip|Note|Warning|Caution|Important)$/i.test(name)) {
          html = `<aside class="admonition ${name.toLowerCase()}"><p class="admonition-title">${escapeHtml(props.tip || name)}</p>${selfClosing ? '</aside>' : ''}`;
        } else {
          warnings.push(`Упрощённый компонент: ${name}`);
          html = `<aside class="component-fallback"><p>Элемент ${escapeHtml(name)} показан в упрощённом виде.</p><pre>${escapeHtml(raw)}</pre>${selfClosing ? '</aside>' : ''}`;
        }
      } catch (error) {
        warnings.push(`${name}: ${error.message}`);
        html = `<aside class="component-fallback"><p>Не удалось воспроизвести ${escapeHtml(name)}. Исходное содержимое:</p><pre>${escapeHtml(raw)}</pre>${selfClosing ? '</aside>' : ''}`;
      }
    }
    replacements.push([match.index, end + 1, `\n\n${html}\n\n`]);
    pattern.lastIndex = end + 1;
  }
  let markdown = source;
  for (const [start, end, html] of replacements.reverse()) markdown = markdown.slice(0, start) + html + markdown.slice(end);
  return { markdown, widgets, warnings };
}

export function resolveCourseLink(href, lessonId, language, ids) {
  if (!href || href.startsWith('#') || /^(mailto:|tel:)/i.test(href)) return href;
  const originalBase = `https://huggingface.co/learn/agents-course/${language}/${lessonId}`;
  let url;
  try { url = new URL(href, originalBase); } catch { return href; }
  if (!['huggingface.co', 'hf.co', 'www.huggingface.co'].includes(url.hostname)) return href;
  const prefix = '/learn/agents-course';
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return href;
  let id = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\//, '').replace(/\.(mdx?|html)$/, '').replace(/\/$/, '');
  id = id.replace(/^(?:(?:main|v[\d.]+)\/)?(?:[a-z]{2}(?:-[A-Z]{2})?)\//, '');
  if (!id || /^(en|ru-RU)$/.test(id)) id = 'unit0/introduction';
  // One upstream introduction spells quiz1 as quizz1.
  if (!ids.has(id) && ids.has(id.replace(/\/quizz(?=\d)/, '/quiz'))) id = id.replace(/\/quizz(?=\d)/, '/quiz');
  if (!ids.has(id)) {
    const direct = href.replace(/^\.\//, '').split(/[?#]/)[0].replace(/\.mdx?$/, '');
    if (ids.has(direct)) id = direct;
  }
  return ids.has(id) ? `/lesson/${id}${url.search}${url.hash}` : url.href;
}

const schema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...defaultSchema.tagNames, 'course-widget', 'hfoptions', 'hfoption', 'iframe', 'figure', 'figcaption', 'video', 'source', 'audio', 'aside'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...defaultSchema.attributes['*'], 'className', 'id', 'title'],
    'course-widget': ['dataIndex'],
    hfoptions: ['id'], hfoption: ['id'],
    iframe: ['src', 'title', 'width', 'height', 'allowFullScreen'],
    img: [...defaultSchema.attributes.img, 'width', 'height'],
    video: ['src', 'controls', 'poster', 'width', 'height'],
    audio: ['src', 'controls'], source: ['src', 'type'],
    th: ['colSpan', 'rowSpan', 'align'], td: ['colSpan', 'rowSpan', 'align'],
  },
};

export async function renderLesson(source, { id, language, ids, resolveAsset = (url) => url }) {
  const { markdown, widgets, warnings } = prepareMdx(source);
  const headings = [];
  function transform() {
    return (tree) => {
      visit(tree, 'element', (node) => {
        if (/^h[1-6]$/.test(node.tagName)) {
          const last = node.children.at(-1);
          const custom = last?.type === 'text' && /\s*\[\[([^\]]+)\]\]\s*$/.exec(last.value);
          if (custom) { node.properties.id = custom[1]; last.value = last.value.slice(0, custom.index); }
        }
        if (node.tagName === 'blockquote') {
          const paragraph = node.children.find((c) => c.tagName === 'p');
          const first = paragraph?.children[0];
          const marker = first?.type === 'text' && /^\[!(TIP|NOTE|WARNING|IMPORTANT|CAUTION)\]\s*/.exec(first.value);
          if (marker) {
            first.value = first.value.slice(marker[0].length);
            node.tagName = 'aside';
            node.properties.className = ['admonition', marker[1].toLowerCase()];
            const labels = { TIP: 'СОВЕТ', NOTE: 'ПРИМЕЧАНИЕ', WARNING: 'ПРЕДУПРЕЖДЕНИЕ', IMPORTANT: 'ВАЖНО', CAUTION: 'ОСТОРОЖНО' };
            node.children.unshift({ type: 'element', tagName: 'p', properties: { className: ['admonition-title'] }, children: [{ type: 'text', value: language === 'ru-RU' ? labels[marker[1]] : marker[1] }] });
          }
        }
        if (node.tagName === 'a' && node.properties.href) node.properties.href = resolveCourseLink(node.properties.href, id, language, ids);
        for (const key of ['src', 'poster']) if (typeof node.properties[key] === 'string') node.properties[key] = resolveAsset(node.properties[key], id, language);
      });
    };
  }
  const html = String(await unified().use(remarkParse).use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw)
    .use(transform).use(rehypeSanitize, schema).use(rehypeSlug)
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .use(() => (tree) => visit(tree, 'element', (node) => {
      if (/^h[1-3]$/.test(node.tagName)) headings.push({ id: node.properties.id, text: toText(node), depth: Number(node.tagName[1]) });
    })).use(rehypeStringify).process(markdown));
  return { html, widgets, headings, warnings };
}

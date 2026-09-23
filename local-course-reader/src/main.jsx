import React, { useEffect, useId, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import parse, { domToReact } from 'html-react-parser';
import './styles.css';

const storage = {
  get(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* Reading also works without storage. */ } },
};
const lessonUrl = (lang, id) => `/${lang}/${id}`;
const safeUrl = (url) => typeof url === 'string' && /^(https?:\/\/|\/course\/)/i.test(url) ? url : undefined;
function routeFromLocation() {
  const match = /^\/(ru|en)\/(.+?)\/?$/.exec(location.pathname);
  if (match) {
    try { return { lang: match[1], id: decodeURIComponent(match[2]) }; }
    catch { return { lang: match[1], id: '__not-found__' }; }
  }
  if (location.pathname !== '/') return { lang: 'ru', id: '__not-found__' };
  const saved = storage.get('agents-course:last', '/ru/unit0/introduction');
  const valid = /^\/(ru|en)\/[\w/-]+$/.test(saved) ? saved : '/ru/unit0/introduction';
  history.replaceState(null, '', valid);
  return routeFromLocation();
}
function useRoute() {
  const [route, setRoute] = useState(routeFromLocation);
  useEffect(() => {
    const onPop = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (url) => {
    history.pushState(null, '', url);
    setRoute(routeFromLocation());
  };
  return [route, navigate];
}
const titleFor = (page, lang) => page.titles[lang] || page.titles.en || page.titles.ru || page.id;
const available = (page, lang) => lang === 'ru' || page.languages.includes('en');
function flatten(nodes) { return nodes.flatMap((n) => n.id ? [n.id] : flatten(n.children)); }
function filterTree(nodes, pages, lang, query) {
  return nodes.flatMap((node) => {
    if (node.id) {
      const p = pages[node.id];
      const matches = `${p.id} ${p.titles.ru || ''} ${p.titles.en || ''}`.toLocaleLowerCase().includes(query);
      return available(p, lang) && matches ? [node] : [];
    }
    const groupMatches = Object.values(node.titles).join(' ').toLocaleLowerCase().includes(query);
    const children = filterTree(node.children, pages, lang, groupMatches ? '' : query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function NavGroup({ node, pages, route, searching }) {
  const active = flatten(node.children).includes(route.id);
  const [expanded, setExpanded] = useState(active);
  useEffect(() => { if (active) setExpanded(true); }, [active]);
  return <details className="nav-group" open={expanded || searching} onToggle={(event) => { if (!searching) setExpanded(event.currentTarget.open); }}>
    <summary><span>{node.titles[route.lang] || node.titles.en}</span><span className="group-count">{flatten(node.children).length}</span></summary>
    <NavNodes nodes={node.children} pages={pages} route={route} searching={searching} />
  </details>;
}
function NavNodes({ nodes, pages, route, searching }) {
  return <ul>{nodes.map((node) => <li key={node.id || node.key}>{node.id
    ? <a className={`lesson-link ${route.id === node.id ? 'active' : ''}`} aria-current={route.id === node.id ? 'page' : undefined} href={lessonUrl(route.lang, node.id)}>
      <span>{titleFor(pages[node.id], route.lang)}</span>{route.lang === 'ru' && !pages[node.id].languages.includes('ru') && <small title="Страница на английском">EN</small>}
    </a>
    : <NavGroup node={node} pages={pages} route={route} searching={searching} />}</li>)}</ul>;
}

class WidgetBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <aside className="component-fallback">Элемент показан в упрощённом виде.<pre>{JSON.stringify(this.props.widget, null, 2)}</pre></aside> : this.props.children;
  }
}
const quizText = (value) => String(value).split(/(<code>[\s\S]*?<\/code>)/g).map((part, i) => part.startsWith('<code>') ? <code key={i}>{part.slice(6, -7)}</code> : part);
function Question({ choices }) {
  const [selected, setSelected] = useState([]), [checked, setChecked] = useState(false);
  const name = useId();
  const multiple = choices.filter((c) => c.correct).length > 1;
  const correct = choices.every((choice, i) => Boolean(choice.correct) === selected.includes(i));
  return <fieldset className="quiz">
    <legend>{multiple ? 'Выберите все верные ответы' : 'Выберите ответ'}</legend>
    {choices.map((choice, i) => <label key={i} className={`quiz-choice ${checked ? choice.correct ? 'correct' : selected.includes(i) ? 'incorrect' : '' : ''}`}>
      <input type={multiple ? 'checkbox' : 'radio'} name={name} checked={selected.includes(i)} onChange={() => {
        setChecked(false);
        setSelected(multiple ? selected.includes(i) ? selected.filter((n) => n !== i) : [...selected, i] : [i]);
      }} />
      <span>{quizText(choice.text)}{checked && choice.explain && <span className="explanation">{choice.correct ? '✓ ' : ''}{quizText(choice.explain)}</span>}</span>
    </label>)}
    <div className="quiz-actions"><button className="primary-button" disabled={!selected.length} onClick={() => setChecked(true)}>Проверить ответ</button><span role="status">{checked && (correct ? '✓ Верно!' : 'Попробуйте ещё раз. Пояснения — выше.')}</span></div>
  </fieldset>;
}
function Banner({ notebooks = [], askForHelpUrl }) {
  return <aside className="notebook-banner"><span aria-hidden="true">↗</span><strong>Практика</strong>
    {notebooks.map((notebook, i) => safeUrl(notebook.value) && <a key={i} href={notebook.value} target="_blank" rel="noreferrer">{notebook.label || 'Открыть блокнот'} ↗</a>)}
    {safeUrl(askForHelpUrl) && <a href={askForHelpUrl} target="_blank" rel="noreferrer">Помощь ↗</a>}
  </aside>;
}
function SafeImage({ src, alt = 'Иллюстрация курса', width, height }) {
  const [failed, setFailed] = useState(false);
  if (failed || !safeUrl(src)) return <span className="image-fallback">▧ {alt} · Изображение недоступно{safeUrl(src) && <> · <a href={src} target="_blank" rel="noreferrer">Открыть источник ↗</a></>}</span>;
  const dimension = (v) => /^\d+(?:\.\d+)?%?$/.test(v || '') ? v.endsWith('%') ? v : `${v}px` : undefined;
  return <img src={src} alt={alt} loading="lazy" style={{ width: dimension(width), height: dimension(height) }} onError={() => setFailed(true)} />;
}
function Embed({ src, title = 'Интерактивный материал', height }) {
  const [loaded, setLoaded] = useState(false);
  if (!safeUrl(src)) return <aside className="embed-placeholder">Встраиваемый ресурс недоступен.</aside>;
  return <section className="embed">
    {loaded ? <iframe src={src} title={title} loading="lazy" height={Math.max(300, Math.min(Number(height) || 450, 850))} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" allow="fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      : <div className="embed-placeholder"><span className="embed-icon" aria-hidden="true">▷</span><strong>{title}</strong><p>Видео или интерактивный пример · требуется интернет</p><button onClick={() => setLoaded(true)}>Загрузить материал</button></div>}
    <a className="embed-source" href={src} target="_blank" rel="noreferrer">Открыть отдельно ↗</a>
  </section>;
}
function Tabs({ nodes, options }) {
  const tabs = nodes.filter((node) => node.name === 'hfoption');
  const [selected, setSelected] = useState(0), uid = useId();
  if (!tabs.length) return <div>{domToReact(nodes, options)}</div>;
  return <div className="code-tabs"><div role="tablist" aria-label="Фреймворк">{tabs.map((node, i) => <button key={i} role="tab" id={`${uid}-tab-${i}`} aria-controls={`${uid}-panel-${i}`} aria-selected={i === selected} tabIndex={i === selected ? 0 : -1} onClick={() => setSelected(i)} onKeyDown={(event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (selected + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setSelected(next); document.getElementById(`${uid}-tab-${next}`)?.focus();
  }}>{node.attribs.id || `Вариант ${i + 1}`}</button>)}</div>
    {tabs.map((node, i) => <div role="tabpanel" key={i} id={`${uid}-panel-${i}`} aria-labelledby={`${uid}-tab-${i}`} hidden={i !== selected}>{domToReact(node.children, options)}</div>)}
  </div>;
}
const domText = (node) => node.type === 'text' ? node.data : (node.children || []).map(domText).join('');
function CodeBlock({ node, options }) {
  const [message, setMessage] = useState('Копировать');
  const lang = node.children.find((n) => n.name === 'code')?.attribs.class?.match(/language-([^\s]+)/)?.[1] || 'text';
  return <div className="code-block"><div className="code-toolbar"><span>{lang}</span><button onClick={async () => {
    try { await navigator.clipboard.writeText(domText(node)); setMessage('Скопировано'); }
    catch { setMessage('Выделите код вручную'); }
  }}>{message}</button></div><pre>{domToReact(node.children, options)}</pre></div>;
}
function LessonContent({ lesson, lang }) {
  return useMemo(() => {
    const options = { replace(node) {
      if (node.type !== 'tag') return;
      if (node.name === 'course-widget') {
        const widget = lesson.widgets[Number(node.attribs['data-index'])];
        if (!widget) return <span>Элемент недоступен.</span>;
        return <WidgetBoundary widget={widget}>{widget.type === 'Question' ? <Question {...widget.props} /> : <Banner {...widget.props} />}</WidgetBoundary>;
      }
      if (node.name === 'hfoptions') return <Tabs nodes={node.children} options={options} />;
      if (node.name === 'hfoption') return <section><h4>{node.attribs.id}</h4>{domToReact(node.children, options)}</section>;
      if (node.name === 'img') return <SafeImage {...node.attribs} />;
      if (node.name === 'iframe') return <Embed {...node.attribs} />;
      if (node.name === 'pre') return <CodeBlock node={node} options={options} />;
      if (node.name === 'table') return <div className="table-scroll"><table>{domToReact(node.children, options)}</table></div>;
      if (node.name === 'a') {
        const href = node.attribs.href?.replace(/^\/lesson\//, `/${lang}/`);
        const external = /^https?:|^\/\//.test(href || '');
        return <a href={href} id={node.attribs.id} title={node.attribs.title} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{domToReact(node.children, options)}</a>;
      }
    } };
    return <div className="prose" lang={lesson.language === 'en' ? 'en' : 'ru'}>{parse(lesson.html, options)}</div>;
  }, [lesson, lang]);
}

function Reader({ manifest }) {
  const [route, navigate] = useRoute();
  const [query, setQuery] = useState('');
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900 && storage.get('agents-course:sidebar', 'open') === 'open');
  const [result, setResult] = useState(null), [error, setError] = useState('');
  const page = manifest.pages[route.id];
  const sourceLanguage = route.lang === 'ru' && page?.languages.includes('ru') ? 'ru-RU' : 'en';
  const origin = page?.origins?.[sourceLanguage === 'en' ? 'en' : 'ru'];
  const canRead = page && available(page, route.lang);
  const pageKey = `${sourceLanguage}/${route.id}`;
  const lesson = result?.key === pageKey ? result.lesson : null;
  const sequence = useMemo(() => flatten(manifest.tree).filter((id) => available(manifest.pages[id], route.lang)), [manifest, route.lang]);
  const position = sequence.indexOf(route.id), previous = sequence[position - 1], next = sequence[position + 1];
  const tree = useMemo(() => filterTree(manifest.tree, manifest.pages, route.lang, query.trim().toLocaleLowerCase()), [manifest, route.lang, query]);
  const group = manifest.tree.find((n) => !n.id && flatten(n.children).includes(route.id));

  useEffect(() => {
    if (!canRead) return;
    setError('');
    const controller = new AbortController();
    fetch(`/course/pages/${pageKey}.json`, { signal: controller.signal }).then((r) => {
      if (!r.ok) throw new Error(`Не удалось загрузить урок (${r.status}). Выполните npm run dev или обновите курс.`);
      return r.json();
    }).then((data) => setResult({ key: pageKey, lesson: data })).catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    storage.set('agents-course:last', lessonUrl(route.lang, route.id));
    document.title = `${titleFor(page, route.lang)} · Agents Course`;
    return () => controller.abort();
  }, [pageKey, canRead, page, route.lang, route.id]);
  useEffect(() => {
    if (!lesson) return;
    const timer = setTimeout(() => {
      if (location.hash) {
        let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = location.hash.slice(1); }
        document.getElementById(id)?.scrollIntoView();
      } else window.scrollTo(0, 0);
    }, 30);
    return () => clearTimeout(timer);
  }, [lesson, route.id, route.lang]);

  const onLink = (event) => {
    const link = event.target.closest('a');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !/^\/(ru|en)\//.test(url.pathname)) return;
    if (url.pathname === location.pathname && url.hash) return;
    event.preventDefault(); navigate(url.pathname + url.search + url.hash);
    if (window.innerWidth <= 900) setSidebar(false);
  };
  return <div className={sidebar ? 'reader' : 'reader sidebar-hidden'} onClick={onLink}>
    <a className="skip-link" href="#lesson">К содержимому</a>
    <header className="topbar">
      <button className="icon-button menu-button" aria-label={sidebar ? 'Свернуть оглавление' : 'Открыть оглавление'} aria-expanded={sidebar} aria-controls="course-navigation" onClick={() => setSidebar((open) => { storage.set('agents-course:sidebar', open ? 'closed' : 'open'); return !open; })}>☰</button>
      <a className="brand" href={lessonUrl(route.lang, 'unit0/introduction')}><span className="brand-mark" aria-hidden="true">🤗</span><span>Hugging Face <strong>Agents Course</strong></span></a>
      <span className="local-badge"><i />Локальный курс</span>
      <label className="search"><span aria-hidden="true">⌕</span><input type="search" value={query} onFocus={() => setSidebar(true)} onChange={(e) => { setQuery(e.target.value); setSidebar(true); }} placeholder="Найти урок…" aria-label="Поиск по названиям уроков" />{query && <button aria-label="Очистить поиск" onClick={() => setQuery('')}>×</button>}</label>
      <div className="language-switch" aria-label="Язык курса">{['ru', 'en'].map((lang) => <button key={lang} aria-pressed={route.lang === lang} onClick={() => navigate(lessonUrl(lang, route.id))}>{lang.toUpperCase()}</button>)}</div>
    </header>
    {sidebar && <button className="sidebar-backdrop" aria-label="Закрыть оглавление" onClick={() => setSidebar(false)} />}
    <aside className="sidebar" id="course-navigation" hidden={!sidebar}>
      <div className="sidebar-heading"><span>СОДЕРЖАНИЕ КУРСА</span><span>{sequence.length} уроков</span></div>
      <nav aria-label="Оглавление">{tree.length ? <NavNodes nodes={tree} pages={manifest.pages} route={route} searching={Boolean(query)} /> : <p className="empty-search">Уроки не найдены. Попробуйте другое название.</p>}</nav>
      <footer className="sidebar-footer"><span>Официальные материалы Hugging Face</span><a href="https://github.com/huggingface/agents-course" target="_blank" rel="noreferrer">Исходный репозиторий ↗</a><small>Версия {manifest.revision.slice(0, 8)} · RU {manifest.counts.ru} / EN {manifest.counts.en}</small></footer>
    </aside>
    <main className="main" id="lesson" tabIndex={-1}>
      {!page ? <div className="status-card"><h1>Урок не найден</h1><p>Такого пути нет в локальном курсе.</p><a href={lessonUrl(route.lang, 'unit0/introduction')}>Открыть начало курса →</a></div>
        : !canRead ? <div className="status-card"><h1>Английская версия отсутствует</h1><p>Этот файл есть только в русской версии репозитория.</p><a href={lessonUrl('ru', route.id)}>Открыть русский текст →</a></div>
          : <div className="reading-layout"><article>
            <div className="article-meta"><span>{group?.titles[route.lang] || group?.titles.en || 'Материалы курса'}</span><span className="page-counter">{position + 1} / {sequence.length}</span></div>
            {route.lang === 'ru' && sourceLanguage === 'en' && <div className="language-notice" role="note">Для этой страницы русский перевод отсутствует — показана английская версия.</div>}
            {origin?.kind?.startsWith('local-') && (origin.sourceChanged || origin.translationChanged) && <div className="language-notice" role="note">{origin.sourceChanged ? 'Английский оригинал обновился: русский перевод требует сверки.' : 'Русский текст изменён после проверки перевода и требует сверки.'}</div>}
            {error ? <div className="status-card" role="alert">{error}<button onClick={() => location.reload()}>Повторить</button></div>
              : lesson ? <LessonContent key={pageKey} lesson={lesson} lang={route.lang} /> : <div className="loading" role="status">Загружаем урок…</div>}
            {lesson && <>
              <div className="source-line"><span>{origin?.kind === 'local-adaptation' ? 'Локально обновлённый русский урок · RU' : origin?.kind === 'local-translation' ? 'Локальный перевод с помощью ИИ · RU' : `Текст из официального репозитория · ${sourceLanguage === 'en' ? 'EN' : 'RU'}`}</span><a href={`/course/source/${sourceLanguage}/${route.id}.mdx`} download>Скачать MDX ↓</a></div>
              <nav className="page-navigation" aria-label="Переход между уроками">
                {previous ? <a href={lessonUrl(route.lang, previous)} rel="prev"><small>← Предыдущая</small><strong>{titleFor(manifest.pages[previous], route.lang)}</strong></a> : <span />}
                {next ? <a href={lessonUrl(route.lang, next)} rel="next"><small>Следующая →</small><strong>{titleFor(manifest.pages[next], route.lang)}</strong></a> : <span />}
              </nav>
            </>}
          </article>
            <aside className="page-toc" aria-label="На этой странице"><span>НА ЭТОЙ СТРАНИЦЕ</span>{lesson?.headings.filter((h) => h.depth > 1).map((h, i) => <a key={`${h.id}-${i}`} className={h.depth === 3 ? 'nested' : ''} href={`#${h.id}`}>{h.text}</a>)}<a className="up-link" href="#lesson">↑ В начало страницы</a></aside>
          </div>}
    </main>
  </div>;
}

function App() {
  const [manifest, setManifest] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    fetch('/course/manifest.json').then((r) => { if (!r.ok) throw new Error('Оглавление не найдено. Выполните npm run dev.'); return r.json(); }).then(setManifest).catch((err) => setError(err.message));
  }, []);
  if (error) return <div className="status-card" role="alert"><h1>Не удалось открыть курс</h1><p>{error}</p><button onClick={() => location.reload()}>Повторить</button></div>;
  return manifest ? <Reader manifest={manifest} /> : <div className="loading" role="status">Открываем Hugging Face Agents Course…</div>;
}

createRoot(document.getElementById('root')).render(<App />);

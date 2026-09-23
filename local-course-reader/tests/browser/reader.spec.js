import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  // Core reader must work even when every external image/service is unavailable.
  await page.route(/^https?:\/\/(?!(?:localhost|127\.0\.0\.1)(?::|\/))/, (route) => route.abort());
});
async function openLesson(page, route) {
  const response = await page.goto(route);
  expect(response.status()).toBe(200);
  await expect(page.locator('article .prose')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('Unit 0–4, таблицы, подсветка, картинки, iframe и прямые URL', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const route of ['/ru/unit0/introduction', '/ru/unit1/introduction', '/ru/unit1/what-are-llms', '/ru/unit1/tools', '/ru/unit2/smolagents/code_agents', '/ru/unit3/agentic-rag/tools', '/ru/unit4/hands-on']) {
    await openLesson(page, route);
    await page.reload();
    await expect(page.locator('article .prose')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await openLesson(page, '/ru/unit0/introduction');
  await expect(page.locator('.prose table')).toBeVisible();
  await expect(page.locator('.image-fallback').first()).toBeVisible();
  await expect(page.locator('#syllabus')).toContainText(/программа/i);
  await openLesson(page, '/ru/unit1/tools');
  await expect(page.locator('pre code .hljs-keyword').first()).toBeVisible();
  await page.locator('.prose details summary').click();
  await expect(page.locator('.prose details pre').first()).toBeVisible();
  await openLesson(page, '/ru/unit1/what-are-llms');
  await expect(page.getByRole('button', { name: 'Загрузить материал' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить материал' }).first().click();
  await expect(page.locator('iframe').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('RU/EN, локальные обновления, RU-only, предыдущая/следующая, история и localStorage', async ({ page }) => {
  await openLesson(page, '/ru/unit1/introduction');
  await expect(page.locator('.prose h1')).toHaveText('Введение в ИИ-агентов');
  await expect(page.locator('.source-line')).toContainText('Локально обновлённый русский урок');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/unit1\/introduction$/);
  await expect(page.locator('.prose')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.language-notice')).toHaveCount(0);
  await page.locator('[rel=next]').click();
  await expect(page).toHaveURL(/\/en\/unit1\/what-are-agents$/);
  await page.locator('[rel=prev]').click();
  await expect(page).toHaveURL(/\/en\/unit1\/introduction$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/unit1\/what-are-agents$/);
  await openLesson(page, '/ru/unit2/introduction');
  await expect(page.locator('.language-notice')).toHaveCount(0);
  await expect(page.locator('.prose')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.source-line')).toContainText('Локальный перевод');
  await page.goto('/');
  await expect(page).toHaveURL(/\/ru\/unit2\/introduction$/);
  await openLesson(page, '/ru/unit1/get-your-certificate');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Английская версия отсутствует' })).toBeVisible();
  await expect(page.locator('.prose')).toHaveCount(0);
});

test('исходный quiz, вкладки фреймворков, banner, внутренние ссылки и якорь', async ({ page }) => {
  await openLesson(page, '/ru/unit1/quiz1');
  const quiz = page.locator('.quiz').first();
  await quiz.getByRole('radio').nth(1).check();
  await quiz.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(quiz.getByRole('status')).toHaveText('✓ Верно!');
  await expect(quiz.locator('.explanation').first()).toBeVisible();
  await openLesson(page, '/ru/unit3/agentic-rag/tools');
  const tabs = page.locator('.code-tabs').first();
  await expect(tabs.getByRole('tabpanel')).toContainText('smolagents');
  await tabs.getByRole('tab', { name: 'llama-index', exact: true }).click();
  await expect(tabs.getByRole('tabpanel')).toContainText('llama_index');
  await tabs.getByRole('tab', { name: 'langgraph', exact: true }).click();
  await expect(tabs.getByRole('tabpanel')).toContainText('langchain');
  await openLesson(page, '/ru/unit2/smolagents/code_agents');
  await expect(page.locator('.notebook-banner').getByRole('link', { name: /Google Colab/ })).toBeVisible();
  await expect(page.locator('.admonition').first()).toBeVisible();
  await openLesson(page, '/ru/unit3/agentic-rag/agent');
  await page.locator('.prose a[href="/ru/unit3/agentic-rag/tools"]').first().click();
  await expect(page).toHaveURL(/\/ru\/unit3\/agentic-rag\/tools$/);
  await openLesson(page, '/ru/unit0/introduction#syllabus');
  await expect.poll(() => page.locator('#syllabus').evaluate((el) => Math.abs(el.getBoundingClientRect().top - 100))).toBeLessThan(15);
});

test('поиск, сворачивание sidebar, мобильный экран и неизвестный маршрут', async ({ page }) => {
  await openLesson(page, '/ru/unit0/introduction');
  const search = page.getByRole('searchbox');
  await search.fill('what are llms');
  await expect(page.locator('nav[aria-label="Оглавление"] a')).toHaveCount(1);
  await page.locator('nav[aria-label="Оглавление"] a').click();
  await expect(page).toHaveURL(/what-are-llms$/);
  await page.getByRole('button', { name: 'Очистить поиск' }).click();
  await page.getByRole('button', { name: 'Свернуть оглавление' }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Открыть оглавление' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('article .prose')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/ru/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Урок не найден' })).toBeVisible();
});

test('все 150 версий уроков доступны через HTTP; статические ресурсы и исходники', async ({ request }) => {
  const response = await request.get('/course/manifest.json');
  const manifest = await response.json();
  for (const page of Object.values(manifest.pages)) for (const lang of page.languages) {
    const sourceLang = lang === 'ru' ? 'ru-RU' : 'en';
    const content = await request.get(`/course/pages/${sourceLang}/${page.id}.json`);
    expect(content.status()).toBe(200);
    expect((await content.json()).html.length).toBeGreaterThan(30);
  }
  const source = await request.get('/course/source/ru-RU/unit1/introduction.mdx');
  expect(await source.text()).toContain('# Введение в ИИ-агентов');
  for (const file of ['agent.py', 'manual_agent.py', 'requirements.txt', 'test_agent.py']) {
    expect((await request.get(`/course/examples/first-local-agent/${file}`)).status()).toBe(200);
  }
  expect((await request.get('/course/LICENSE')).status()).toBe(200);
});

test('будущие страницы без RU используют EN; устаревший перевод помечен', async ({ page }) => {
  await page.route('**/course/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    manifest.pages['unit2/introduction'].languages = ['en'];
    manifest.pages['unit4/introduction'].origins.ru.sourceChanged = true;
    await route.fulfill({ response, json: manifest });
  });
  await openLesson(page, '/ru/unit2/introduction');
  await expect(page.locator('.language-notice')).toHaveText('Для этой страницы русский перевод отсутствует — показана английская версия.');
  await expect(page.locator('.prose')).toHaveAttribute('lang', 'en');
  await openLesson(page, '/ru/unit4/introduction');
  await expect(page.locator('.language-notice')).toContainText('оригинал обновился');
  await expect(page.locator('.prose')).toHaveAttribute('lang', 'ru');
});

test('все 51 переведённый урок отображаются; новый quiz проверяет ответы', async ({ page, request }) => {
  test.setTimeout(90000);
  const manifest = await (await request.get('/course/manifest.json')).json();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const translated = Object.values(manifest.pages).filter((p) => p.origins.ru?.kind === 'local-translation');
  expect(translated).toHaveLength(51);
  for (const lesson of translated) {
    await openLesson(page, `/ru/${lesson.id}`);
    await expect(page.locator('.prose')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('.source-line')).toContainText('Локальный перевод');
    await expect(page.locator('.component-fallback')).toHaveCount(0);
    await expect(page.locator('.prose')).toContainText(/[А-Яа-яЁё]/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), lesson.id).toBe(true);
  }
  await openLesson(page, '/ru/bonus-unit2/quiz');
  const quiz = page.locator('.quiz').first();
  await quiz.getByRole('radio').first().check();
  await quiz.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(quiz.getByRole('status')).toHaveText('✓ Верно!');
  await expect(quiz.locator('.explanation').first()).toContainText('Наблюдаемость');
  await openLesson(page, '/ru/unit2/smolagents/quiz2');
  await expect(page.locator('.quiz code').first()).toHaveText('@tool');
  await expect(page.locator('.quiz').first()).not.toContainText('<code>');
  expect(errors).toEqual([]);
  await openLesson(page, '/ru/unit4/introduction');
  await page.screenshot({ path: 'test-results/reader-translated.png', fullPage: false });
});

test('обновлённое начало курса ведёт к локальному агенту на Ubuntu', async ({ page, request }) => {
  for (const route of [
    '/ru/unit0/introduction',
    '/ru/unit0/onboarding',
    '/ru/unit1/introduction',
    '/ru/unit1/what-are-agents',
    '/ru/unit1/what-are-llms',
    '/ru/unit1/tools',
    '/ru/unit1/thoughts',
    '/ru/unit1/actions',
    '/ru/unit1/dummy-agent-library',
    '/ru/unit1/tutorial',
    '/ru/unit1/final-quiz',
    '/ru/unit1/conclusion',
  ]) {
    await openLesson(page, route);
    await expect(page.locator('.source-line')).toContainText('Локально обновлённый русский урок');
    await expect(page.locator('.language-notice')).toHaveCount(0);
  }
  await openLesson(page, '/ru/unit1/tutorial');
  await expect(page.locator('.prose h1')).toContainText('локального агента на Ubuntu');
  await expect(page.locator('.prose')).toContainText('qwen3:4b-instruct');
  await expect(page.locator('.prose')).toContainText('LangGraph');
  await expect(page.locator('.prose')).not.toContainText('продублируйте это пространство');
  const download = page.locator('a[href="/course/examples/first-local-agent/agent.py"]').first();
  await expect(download).toBeVisible();
  expect((await request.get(await download.getAttribute('href'))).status()).toBe(200);
  await page.screenshot({ path: 'test-results/reader-local-agent.png', fullPage: false });
});

test('снимок интерфейса с загруженными внешними изображениями', async ({ page }) => {
  await page.unrouteAll();
  await openLesson(page, '/ru/unit1/introduction');
  await page.waitForFunction(() => [...document.querySelectorAll('.prose img')].every((img) => img.complete), undefined, { timeout: 15000 }).catch(() => {});
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/reader-desktop.png', fullPage: false });
});

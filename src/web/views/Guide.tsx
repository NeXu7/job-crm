// «Как пользоваться»: how the CRM fits together, a live first-steps checklist, sections, scenarios, tips,
// who does what (Claude vs. the user), badge glossary, troubleshooting. Text only; the checklist reads the state
// (plus TODOs in positioning.md from /api/doc-todos).
import { useEffect, useState, type ReactNode } from 'react';
import { href } from '../router';
import { api } from '../api';
import { Dots, plural } from '../ui';
import { coverage, questionStatus } from '../../shared/interview';
import { recipeIds } from '../../shared/resume';
import type { DocTodo } from '../../shared/gaps';
import type { State } from '../store';

const TOC: [string, string][] = [
  ['idea', 'Как устроено'],
  ['start', 'С чего начать'],
  ['sections', 'Разделы'],
  ['scenarios', 'Сценарии'],
  ['rhythm', 'Ритм работы'],
  ['tips', 'Как эффективнее'],
  ['claude', 'Claude и ты'],
  ['signs', 'Значки и статусы'],
  ['trouble', 'Если что-то не так'],
];

const scroller = () => document.querySelector('main');
const scrollToSection = (id: string) => document.getElementById(`g-${id}`)?.scrollIntoView({ block: 'start' });

export function Guide({ s, section }: { s: State; section?: string }) {
  const [active, setActive] = useState(section || TOC[0][0]);

  // deep link #/guide/<section>
  useEffect(() => { if (section) scrollToSection(section); }, [section]);

  // scroll spy: the last section whose top has passed the top of the work area
  useEffect(() => {
    const main = scroller();
    if (!main) return;
    const onScroll = () => {
      const top = main.getBoundingClientRect().top + 80;
      let cur = TOC[0][0];
      for (const [id] of TOC) {
        const el = document.getElementById(`g-${id}`);
        if (el && el.getBoundingClientRect().top <= top) cur = id;
      }
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) cur = TOC.at(-1)![0];
      setActive(cur);
    };
    onScroll();
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header className="vh">
        <div><h1>Как пользоваться</h1><p className="sub">Что умеет CRM, в каком порядке её заполнять, сценарии от вакансии до оффера и что делает Claude, а что — только ты.</p></div>
      </header>
      <div className="f-layout">
        <aside className="f-side" aria-label="Содержание">
          {TOC.map(([id, name]) => (
            <a key={id} href={href(`guide/${id}`)} className={active === id ? 'on' : ''} onClick={() => scrollToSection(id)}><span>{name}</span></a>
          ))}
        </aside>
        <div className="stack guide">
          <Idea />
          <Start s={s} />
          <Sections />
          <Scenarios />
          <Rhythm />
          <Tips />
          <ClaudeRoles />
          <Signs />
          <Trouble s={s} />
        </div>
      </div>
    </>
  );
}

function Sec({ id, title, sub, children }: { id: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel g-sec" id={`g-${id}`}>
      <div><h2>{title}</h2>{sub && <p className="hint">{sub}</p>}</div>
      {children}
    </section>
  );
}

const L = ({ to, children }: { to: string; children: ReactNode }) => <a href={href(to)}>{children}</a>;

function Idea() {
  return (
    <Sec id="idea" title="Как устроено" sub="Одна мысль: всё собирается из банков. Хороший банк — быстрые отклики и спокойные интервью.">
      <div className="g-flow" aria-label="Поток данных">
        <div className="g-node"><b>Сырьё</b><span>диктовки, заметки, логи сессий</span></div>
        <span className="g-arr" aria-hidden="true">→</span>
        <div className="g-node key"><b>Банки</b><span>факты · истории · вопросы и ответы · сильные и слабые стороны</span></div>
        <span className="g-arr" aria-hidden="true">→</span>
        <div className="g-node"><b>Под вакансию</b><span>резюме · разбор и fit · подготовка к интервью</span></div>
        <span className="g-arr" aria-hidden="true">→</span>
        <div className="g-node"><b>Воронка</b><span>стадии, сроки, таймлайн</span></div>
      </div>
      <p className="hint">↺ Вопросы, которые реально задали, и новые истории возвращаются в банки — каждая следующая подготовка короче.</p>
      <ul className="list">
        <li><b>Одна цифра живёт в одном месте.</b> Резюме, ответы и разбор вакансий ссылаются на факт по id. Поправил факт — поправилось везде, кроме уже отправленных резюме.</li>
        <li><b>Данные — обычные файлы под git в твоём рабочем пространстве.</b> Это отдельная папка со своим git-репозиторием, её создаёт <code className="mono">npm run setup -- &lt;папка&gt;</code>. <span className="mono">00-profile/</span> — банки и профиль, <span className="mono">02-pipeline/</span> — отклики и компании, <span className="mono">04-resume/</span> — рецепты резюме. Правки из интерфейса сами коммитятся (подряд идущие — одним коммитом через несколько секунд), их видно в журнале на «Сегодня».</li>
        <li><b>Приложение и данные — в разных папках.</b> Код Job CRM — свой репозиторий, в рабочем пространстве он виден как ссылка <span className="mono">app</span>. Обновляешь приложение (<code className="mono">git pull</code> в его репозитории) — данные не трогаются; данные можно хранить в своём приватном git.</li>
        <li><b>CRM и Claude Code правят одни и те же файлы.</b> Claude Code запускай в папке рабочего пространства: там лежат <span className="mono">CLAUDE.md</span> с правилами и скилл <code className="mono">/fill</code>. Его правки сразу появляются в интерфейсе, внизу всплывает «Обновлено вне интерфейса».</li>
        <li><b>Сохранение само.</b> Текстовые поля сохраняются, когда уходишь из поля. Кнопки «Сохранить» почти нигде нет.</li>
      </ul>
    </Sec>
  );
}

type Check = { ok: boolean | null; title: string; detail: ReactNode; to: string; cta: string };

const POSITIONING_DOC = '00-profile/positioning.md';
const listOf = (xs: (string | false | undefined)[]) => xs.filter(Boolean).join(', ');

function Start({ s }: { s: State }) {
  // TODOs in positioning.md; null while unknown (request pending or failed)
  const [docs, setDocs] = useState<DocTodo[] | null>(null);
  useEffect(() => { void api.get<DocTodo[]>('/api/doc-todos').then(setDocs).catch(() => setDocs(null)); }, [s]);

  const p = s.profile;
  const c = p.contacts || {};
  const verified = s.facts.filter((f) => f.status === 'verified').length;
  const drafts = s.facts.filter((f) => f.status === 'draft').length;
  const proof = s.facts.filter((f) => f.status === 'needs-proof').length;
  const high = s.questions.filter((q) => q.priority === 'high' && q.category !== 'reverse' && !q.app_field);
  const highReady = high.filter((q) => questionStatus(q) === 'ready').length;
  const holes = coverage(s.stories, s.questions).filter((h) => h.gap);
  const fresh = s.notes.filter((n) => n.status === 'new').length;
  const filled = s.recipes.filter((r) => recipeIds(r).length > 0);
  const posTodos = docs ? docs.filter((d) => d.file === POSITIONING_DOC).length : null;
  const headerMissing = listOf([!p.name?.trim() && 'имя', !c.email && 'email', !(c.linkedin || c.phone) && 'LinkedIn или телефон']);
  const ctxMissing = listOf([!p.positioning?.trim() && 'позиционирование', !p.context?.trim() && 'контекст поиска']);
  const icpN = s.icp.criteria.length;
  const icpTpl = s.icp.criteria.filter((x) => s.icpTemplate?.includes(x.id)).length;
  const extDir = s.extensionDir;

  const checks: Check[] = [
    {
      ok: s.claude.status === 'ok', title: 'Claude подключён', to: 'today', cta: 'Статус внизу меню',
      detail: s.claude.status === 'ok'
        ? 'Разбор вакансий, подбор вопросов и черновики ответов работают.'
        : <>В терминале выполни <code className="mono">claude auth login</code>, потом «Проверить» внизу меню. Без этого вакансии сохраняются, но не разбираются.</>,
    },
    {
      ok: !headerMissing, title: 'Шапка резюме', to: 'facts/profile', cta: 'Профиль',
      detail: 'Имя, контакты, образование. Попадает в каждое резюме.' + (headerMissing ? ` Не хватает: ${headerMissing}.` : ''),
    },
    {
      ok: !ctxMissing, title: 'Позиционирование и контекст поиска', to: 'facts/profile', cta: 'Профиль',
      detail: 'Одна строка о том, кто ты и что ищешь, и контекст: часовой пояс, где живёшь и готов ли к переезду, формат найма, ограничения. Оба поля — по-английски, уходят в запросы к Claude: по ним он ставит флаги и fit.'
        + (ctxMissing ? ` Не заполнено: ${ctxMissing}.` : ''),
    },
    {
      ok: icpN > 0 && icpTpl === 0, title: 'Критерии ICP', to: 'facts/icp', cta: 'Критерии ICP',
      detail: !icpN
        ? 'Критериев нет — Claude не ставит вакансиям fit. Добавь 4–6: формат, право на работу, сегмент, стадия, роль, деньги.'
        : icpTpl
          ? `По ним Claude ставит вакансиям fit от 0 до ${icpN * 2}. Примеров из шаблона без изменений: ${icpTpl} из ${icpN} — перепиши в них «целюсь» и «отсекаю» под себя или удали лишние.`
          : `По ним Claude ставит вакансиям fit от 0 до ${icpN * 2}. Сейчас критериев: ${icpN}.`,
    },
    {
      ok: posTodos === null ? null : posTodos === 0, title: 'Документ позиционирования', to: 'fill/3/docs', cta: 'TODO в «Наполнении»',
      detail: posTodos
        ? <>В <span className="mono">{POSITIONING_DOC}</span> осталось TODO: {posTodos}. Это нарратив, из которого берутся строка позиционирования, ICP, треки и ответ на «расскажи о себе». Заполняй с Claude Code: попроси его пройтись по TODO вместе с тобой.</>
        : <>Свободный текст в <span className="mono">{POSITIONING_DOC}</span>: кто ты на рынке и как об этом рассказываешь. {posTodos === 0 ? 'Открытых TODO нет.' : ''}</>,
    },
    {
      ok: s.experiences.length > 0 && s.facts.length > 0 && drafts === 0, title: 'Опыт и факты', to: 'facts', cta: 'Банк фактов',
      detail: !s.experiences.length
        ? <>Банк пуст. Добавь первое место работы («+ Опыт») и факты к нему или пройди <code className="mono">/fill</code> в Claude Code — он начнёт с профиля и мест работы.</>
        : !s.facts.length
          ? `Опыт есть (${s.experiences.length}), фактов пока нет. Факт — глагол, что сделал, масштаб, цифра.`
          : `${verified} из ${s.facts.length} проверено` + (drafts ? `, ${drafts} ${plural(drafts, 'черновик ждёт', 'черновика ждут', 'черновиков ждут')} твоего решения` : '') + (proof ? `, ${proof} нужно подкрепить` : '') + '.',
    },
    {
      ok: filled.length > 0, title: 'Базовое резюме по треку', to: 'builder', cta: 'Конструктор',
      detail: !s.recipes.length
        ? 'Треков нет — создай первый в конструкторе.'
        : filled.length
          ? `Треки: ${s.recipes.map((r) => r.name || r.id).join(', ')}.`
          : `${s.recipes.length > 1 ? 'Рецепты' : 'Рецепт'} «${s.recipes.map((r) => r.name || r.id).join('», «')}» пока без фактов — отметь в конструкторе проверенные факты, которые идут в резюме.`,
    },
    {
      ok: high.length > 0 && highReady === high.length, title: 'Ответы на частые вопросы', to: 'interview', cta: 'Интервью',
      detail: high.length ? `Готово ${highReady} из ${high.length} вопросов, которые задают почти всегда.` : 'В банке нет вопросов с пометкой «почти всегда».',
    },
    {
      ok: holes.length === 0, title: 'Истории для behavioral', to: 'interview/stories', cta: 'Матрица историй',
      detail: holes.length ? `Нет сильной истории: ${holes.map((h) => h.name).join(', ')}.` : 'Под каждую компетенцию с вопросами есть полная история.',
    },
    {
      ok: fresh === 0, title: 'Сырьё разобрано', to: 'fill', cta: 'Наполнение',
      detail: fresh ? `Не разобрано заметок: ${fresh}. Разбери с Claude: /fill сырьё.` : 'Неразобранных заметок нет. Старое резюме или выгрузку LinkedIn можно сбросить в сырьё — Claude разберёт их в черновики.',
    },
    {
      ok: s.applications.length > 0, title: 'Первая вакансия в воронке', to: 'pipeline', cta: 'Воронка',
      detail: s.applications.length ? `Откликов в CRM: ${s.applications.length}.` : 'Вставь ссылку на вакансию в любом месте страницы или нажми «+ Вакансия» в меню.',
    },
    {
      ok: null, title: 'Расширение браузера', to: 'guide/trouble', cta: 'Как поставить',
      detail: <>Нужно для LinkedIn и страниц за логином. Chrome → <span className="mono">chrome://extensions</span> → режим разработчика → «Загрузить распакованное» → <ExtensionDir dir={extDir} />.</>,
    },
  ];
  const done = checks.filter((x) => x.ok).length;

  return (
    <Sec id="start" title="С чего начать" sub={`Считается по текущим данным: готово ${done} из ${checks.filter((x) => x.ok !== null).length}. Порядок — от фундамента к откликам.`}>
      <div className="stack tight">
        <h3>Запуск</h3>
        <p className="hint">
          Данные живут в рабочем пространстве — папке, которую один раз создаёт <code className="mono">npm run setup -- &lt;папка&gt;</code> в репозитории Job CRM. В ней же лежат <span className="mono">CLAUDE.md</span>, скилл <code className="mono">/fill</code> и ссылка <span className="mono">app</span> на приложение, поэтому все команды запускаются оттуда.
          {s.root && <> Твоё рабочее пространство: <span className="mono">{s.root}</span>.</>}
        </p>
        <pre className="code">{[
          '# в папке рабочего пространства',
          `npm --prefix app start          # CRM → ${location.origin}`,
          'claude                          # Claude Code с правилами этой папки, внутри — /fill',
          'npm --prefix app run check      # проверить данные после ручных правок',
        ].join('\n')}</pre>
      </div>
      <ol className="g-check">
        {checks.map((x) => (
          <li key={x.title} className={x.ok ? 'ok' : ''}>
            <span className={`pill ${x.ok ? 'good' : x.ok === null ? '' : 'warn'}`} aria-label={x.ok ? 'готово' : x.ok === null ? 'не проверяется' : 'не готово'}><i>{x.ok ? '✓' : x.ok === null ? '?' : '!'}</i></span>
            <div><b>{x.title}</b><p className="hint">{x.detail}</p></div>
            <a className="btn sm ghost" href={href(x.to)} onClick={x.to.startsWith('guide/') ? () => scrollToSection(x.to.slice(6)) : undefined}>{x.cta}</a>
          </li>
        ))}
      </ol>
      <p className="callout">Не обязательно закрывать всё до первого отклика. Минимум: Claude, шапка, контекст и критерии ICP (чтобы разбор вакансий был по делу), базовое резюме по твоему треку и проверенные факты, которые в него входят. Остальное наполняется параллельно.</p>
    </Sec>
  );
}

/** Where the unpacked extension lives: the absolute path if the server reports it, else a description. */
function ExtensionDir({ dir }: { dir?: string }) {
  return dir
    ? <>папка <span className="mono">{dir}</span></>
    : <>папка <span className="mono">extension</span> в репозитории Job CRM (из рабочего пространства — <span className="mono">app/extension</span>)</>;
}

function Area({ to, title, what, items }: { to: string; title: string; what: string; items: ReactNode[] }) {
  return (
    <div className="g-area">
      <a href={href(to)}><b>{title}</b></a>
      <p className="small">{what}</p>
      <ul className="list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function Sections() {
  return (
    <Sec id="sections" title="Разделы" sub="Что где лежит и что там делать. Число в меню — сколько там ждёт тебя.">
      <div className="g-areas">
        <Area to="today" title="Сегодня" what="Стартовая страница дня." items={[
          '«Требует действия»: просроченные шаги, ошибки разбора, пустые «почему», нет резюме, красные флаги, незаконченная подготовка',
          'Воронка по стадиям с конверсией и разбивка по трекам',
          'Журнал: кто что менял — ты в интерфейсе или Claude',
        ]} />
        <Area to="pipeline" title="Воронка" what="Канбан всех откликов." items={[
          'Строка сверху: ссылка → сохранить и разобрать; «Пустая карточка» — если вакансии нет онлайн',
          'Перетаскивание карточек между стадиями (с гейтами, см. ниже)',
          'На карточке: fit, трек, lock, флаги, срок следующего шага',
        ]} />
        <Area to="pipeline" title="Карточка отклика" what="Всё про одну вакансию, пять вкладок." items={[
          <><b>Обзор</b> — «почему они / почему я», разбор требований с фактами, что выяснить, следующий шаг, fit по ICP, флаги, люди</>,
          <><b>Вакансия</b> — сохранённый текст, снимок и скриншот; ручная вставка текста</>,
          <><b>Резюме</b> — зафиксированные версии: PDF, текст для формы, «Отметить отправленным»</>,
          <><b>Подготовка</b> — вероятные вопросы под вакансию с ответами, шпаргалка, тренировка</>,
          <><b>Таймлайн</b> — письма, созвоны, этапы</>,
        ]} />
        <Area to="builder" title="Конструктор резюме" what="Факты → рецепт → живой лист A4." items={[
          'Без вакансии — правишь базовые рецепты по трекам или создаёшь новый трек',
          'Из карточки — версия под вакансию: отличия от базы подсвечены',
          'Проверки: влезает ли в страницу, покрыты ли требования (JD), есть ли цифры в каждом буллете',
          '«Зафиксировать (lock)», «Скачать PDF», «Текст для формы»',
        ]} />
        <Area to="facts" title="Банк фактов" what="Опыт и факты — атомы резюме." items={[
          'Фильтры: проверены / подкрепить / черновики, теги, поиск по тексту и метрикам',
          '«Что дополнить»: требования вакансий, под которые нет фактов',
          <>Вкладки <L to="facts/summaries">Саммари</L>, <L to="facts/profile">Профиль</L>, <L to="facts/icp">Критерии ICP</L></>,
        ]} />
        <Area to="interview" title="Интервью" what="Банк вопросов и ответов, истории, сильные и слабые стороны." items={[
          '«Что подготовить»: частые вопросы без ответа, дыры в историях, текущие процессы',
          'Варианты ответа под трек, черновик от Claude, «Тренировка»',
          <><L to="interview/stories">Истории</L> — STAR и матрица покрытия компетенций; <L to="interview/sides">Сильные и слабые</L> — что подчеркнуть и где будут копать</>,
        ]} />
        <Area to="fill" title="Наполнение" what="Что не заполнено в банках — по важности." items={[
          'Прогресс по каждому банку',
          'Очередь пробелов: «Сначала», «Потом», «Когда-нибудь»',
          '«Сбросить сырьё»: надиктуй как есть, Claude разберёт в банки черновиками',
        ]} />
      </div>
    </Sec>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="g-steps">{children}</ol>;
}

function Scenarios() {
  return (
    <Sec id="scenarios" title="Сценарии" sub="Типовые пути от начала до конца.">
      <div className="g-scn">
        <h3>1 · Нашёл вакансию → отправил отклик</h3>
        <Steps>
          <li><b>Сохрани.</b> Вставь ссылку в любом месте страницы (не в поле ввода) или «+ Вакансия» в меню. LinkedIn и страницы за логином — кнопкой расширения или <span className="mono">Alt+Shift+S</span> на самой вакансии.</li>
          <li><b>Подожди разбор.</b> Сервер сохранит страницу, Claude заполнит компанию, требования с фактами под них, флаги, fit по ICP и тезисы для «почему». Карточка сразу в «Исследую».</li>
          <li><b>Отсей.</b> Посмотри fit и красные флаги на «Обзоре». Не твоё — сразу в «Закрыто» с итогом, без «почему».</li>
          <li><b>Напиши «почему они» и «почему я» сам</b>, по 2–3 предложения. Тезисы Claude — сырьё, не ответ. Без обоих полей карточка не уйдёт в «Готов к отклику».</li>
          <li><b>Собери резюме.</b> Вкладка «Резюме» → «Открыть в конструкторе». База — рецепт твоего трека. В «Проверках» жёлтые JD — требования без факта в резюме: если подходящий факт есть в банке, рядом будет кнопка с его id.</li>
          <li><b>Зафиксируй.</b> «Зафиксировать (lock)» замораживает текст. Дальше «Скачать PDF» или «Текст для формы», если сайт просит вставить резюме полями.</li>
          <li><b>Отправь сам</b> на сайте компании, потом «Отметить отправленным». Карточка уйдёт в «Отклик», follow-up встанет через 7 дней и всплывёт на «Сегодня».</li>
        </Steps>

        <h3>2 · Компания ответила → интервью</h3>
        <Steps>
          <li><b>Передвинь в «Скрининг»</b> и поставь следующий шаг с датой созвона. Запиши в «Таймлайн», кто написал, добавь людей на «Обзоре».</li>
          <li><b>Открой «Подготовку».</b> Список вопросов Claude подбирает сам сразу после разбора: до 12 из банка и до 8 своих под эту вакансию. «Подобрать заново» нужен, только если подбор не удался или вакансия изменилась — это ещё один запрос из квоты.</li>
          <li><b>Пройди список.</b> Где ответ из банка не подходит — «Адаптировать под вакансию» или черновик Claude из твоих историй и фактов. Ответ под вакансию перекрывает банк только здесь.</li>
          <li><b>Прочитай «Что подчеркнуть» и «Где будут копать»</b> внизу вкладки: сильные стороны и слабые места под этот трек с заготовками.</li>
          <li><b>«Тренировка»</b>: вопрос → отвечаешь вслух → сверяешься с заготовкой → «Плавал / Нормально / Уверенно». Слабые пойдут первыми в следующий раз.</li>
          <li><b>Перед созвоном — «Шпаргалка»</b>: копирует вопросы с ответами в Markdown. Из «Выяснить у них» возьми свои вопросы к интервьюеру.</li>
          <li><b>Сразу после</b> отметь «Спросили» у заданных вопросов, новые добавь с галочкой «спросили на интервью». Хорошие — «В банк»: они начнут всплывать в других вакансиях.</li>
          <li><b>Ретро.</b> Попроси Claude Code разобрать интервью по шаблону <span className="mono">02-pipeline/interviews/_TEMPLATE.md</span>: что спросили, где плавал, что дописать в банк.</li>
        </Steps>

        <h3>3 · Наполнить банки с Claude</h3>
        <Steps>
          <li><b>Сбрось сырьё.</b> «Наполнение» → «Сбросить сырьё»: надиктуй историю, цифры, мысли как есть, с повторами. Сырьё стоит первым в очереди Claude.</li>
          <li><b>Открой Claude Code</b> в папке своего рабочего пространства (в терминале: <code className="mono">cd &lt;папка&gt;</code>, потом <code className="mono">claude</code>) и набери <code className="mono">/fill</code>. Для длинной сессии выбери Sonnet в меню модели — дешевле по квоте. Можно сразу режим: <code className="mono">/fill сырьё</code>, <code className="mono">/fill факты &lt;id опыта&gt;</code>, <code className="mono">/fill истории</code>, <code className="mono">/fill ответы motivation</code>, <code className="mono">/fill стороны</code>. В пустом банке Claude сам начнёт с профиля и мест работы.</li>
          <li><b>Отвечай на вопросы по одному.</b> Claude спросит: что делал лично ты, результат в цифрах против чего, какой был компромисс. Не помнишь — так и скажи, он запишет пробел.</li>
          <li><b>Claude пишет только черновики</b> со ссылкой на лог сессии в <span className="mono">00-profile/notes/</span>. Цифры — только твои.</li>
          <li><b>Проверь в CRM.</b> Черновики видны в «Банке фактов» и «Интервью». «Проверен» у фактов и «готов» у ответов ставишь только ты.</li>
        </Steps>

        <h3>4 · Подготовиться к интервью вообще, без вакансии</h3>
        <Steps>
          <li><b>«Интервью» → «Что подготовить»</b> → «Показать без ответа». Начни с вопросов «Почти всегда».</li>
          <li><b>Нет ответа — не пиши из головы.</b> Привяжи истории и факты (это «опора») и попроси черновик у Claude: он соберёт ответ только из них, а чего не хватает — перечислит.</li>
          <li><b>Закрой дыры в матрице историй</b>: компетенция с вопросами, но без истории на две точки — первая цель для <code className="mono">/fill истории</code>.</li>
          <li><b>Заполни сильные и слабые стороны</b>: питч с доказательством и ответ на то, где будут копать.</li>
          <li><b>«Тренировка»</b> по категории или треку — фильтры слева и сверху задают набор вопросов.</li>
        </Steps>

        <h3>5 · Отказ, тишина, закрытие</h3>
        <Steps>
          <li><b>Передвинь в «Закрыто»</b> и запиши итог: отказ на каком этапе, отозвал, тишина.</li>
          <li><b>Отметь «Спросили»</b> и перенеси вопросы в банк, даже если не прошёл: следующий раз будешь готов.</li>
          <li><b>Раз в неделю смотри «По трекам»</b> на «Сегодня»: какой трек даёт ответы. Если никакой — менять стоит базовое резюме или выбор вакансий, а не количество откликов.</li>
        </Steps>
      </div>
    </Sec>
  );
}

function Rhythm() {
  return (
    <Sec id="rhythm" title="Ритм работы" sub="Чтобы CRM помогала, а не копила хвосты.">
      <div className="g-cols">
        <div>
          <h3>Каждый день · 15 минут</h3>
          <ul className="list">
            <li>«Сегодня» → «Требует действия» сверху вниз: красное, потом жёлтое.</li>
            <li>Выполнил шаг — «Сделано» в карточке; он уйдёт в таймлайн. Поставь следующий с датой.</li>
            <li>Новые вакансии — ссылкой, отсев по fit и флагам сразу.</li>
            <li>Вспомнил историю или цифру — сразу в сырьё, голосом.</li>
          </ul>
        </div>
        <div>
          <h3>Раз в неделю · час</h3>
          <ul className="list">
            <li>Сессия <code className="mono">/fill</code> по очереди «Сначала».</li>
            <li>Черновики Claude: принять, поправить или удалить. Факты «подкрепить» — найти пруф.</li>
            <li>«По трекам» и воронка: где теряются отклики.</li>
            <li>«Что дополнить» в банке фактов: какие требования повторяются, а фактов нет.</li>
            <li>Тренировка частых вопросов, даже без интервью на горизонте.</li>
          </ul>
        </div>
      </div>
    </Sec>
  );
}

function Tips() {
  const tips: [string, ReactNode][] = [
    ['Сначала банк, потом объём.', 'Одна проверенная цифра работает во всех резюме и ответах. Десять откликов со слабой базой хуже трёх с сильной.'],
    ['Отсекай рано.', 'Низкий fit или флаг, который ты не готов принять, — в «Закрыто» до того, как тратишь время на «почему» и резюме.'],
    ['«Почему они / почему я» — главный текст.', 'Это и мотивация в письме, и ответ на первые вопросы интервью: «Подготовка» берёт его оттуда. Пиши своими словами.'],
    ['Меньше правок к базе.', 'Сильное базовое резюме по треку плюс 1–3 факта под вакансию. Дифф показывает, что вычитывать; чем он меньше, тем быстрее отклик.'],
    ['Lock перед каждой отправкой.', 'Через месяц на интервью откроешь ровно тот текст, который видел интервьюер. Одинаковый хеш — одинаковое резюме.'],
    ['Требование без фактов — сигнал.', 'Либо у тебя есть такой опыт и его надо занести через сырьё, либо вакансия не твоя.'],
    ['Следующий шаг с датой у каждой активной карточки.', 'Без даты «Сегодня» не напомнит, и отклик тихо умрёт.'],
    ['Реальные вопросы дороже придуманных.', '«Спросили» и «В банк» после каждого созвона — так банк учится на твоих интервью.'],
    ['Тренируйся вслух.', 'Чтение заготовки не равно ответу. Честно ставь «Плавал» — это определяет, что тренировать первым.'],
    ['Не жми Claude без причины.', '«Переразобрать», «Подобрать заново» и «Черновик» — вызовы из квоты подписки. Повторяй, только если изменился текст вакансии или банк.'],
  ];
  return (
    <Sec id="tips" title="Как эффективнее">
      <ol className="g-tips">{tips.map(([t, d]) => <li key={t}><b>{t}</b> {d}</li>)}</ol>
    </Sec>
  );
}

function ClaudeRoles() {
  return (
    <Sec id="claude" title="Claude и ты" sub="Кто что делает и где граница.">
      <table className="t">
        <thead><tr><th>Кто</th><th>Что делает</th></tr></thead>
        <tbody>
          <tr><td><b>Claude в CRM</b><br /><span className="hint">сам, по кнопке или при сохранении</span></td>
            <td><ul className="list">
              <li>Разбор вакансии: компания, требования → факты, флаги, fit, тезисы «почему» (Sonnet)</li>
              <li>Подбор вероятных вопросов под вакансию (Sonnet)</li>
              <li>Черновики ответов только из твоих историй и фактов (Opus)</li>
            </ul></td></tr>
          <tr><td><b>Claude Code</b><br /><span className="hint">в терминале, в папке рабочего пространства</span></td>
            <td><ul className="list">
              <li><code className="mono">/fill</code> — сессии наполнения банков, разбор сырья</li>
              <li>Тезисы для «почему они», подготовка к конкретному интервью, ретро</li>
              <li>Правки в банках и откликах по твоей просьбе. Его коммиты в журнале помечены «Claude»</li>
            </ul></td></tr>
          <tr><td><b>Только ты</b></td>
            <td><ul className="list">
              <li>«Проверен» у фактов и «готов» у ответов</li>
              <li>«Почему они / почему я» — Claude только предлагает тезисы</li>
              <li>Отправка откликов и писем, перевод карточек через гейты</li>
            </ul></td></tr>
        </tbody>
      </table>
      <p className="callout"><b>Правила, которые Claude не нарушает:</b> не придумывает цифры (новый факт — черновик с источником и вопросом к тебе), не трогает зафиксированные резюме, не меняет id фактов, ничего не отправляет наружу.</p>
    </Sec>
  );
}

function Signs() {
  return (
    <Sec id="signs" title="Значки и статусы">
      <table className="t g-signs">
        <tbody>
          <tr><td><span className="pill good"><i>✓</i>проверен</span> <span className="pill warn"><i>!</i>нужно подкрепить</span> <span className="pill accent"><i>✎</i>черновик</span></td>
            <td>Статус факта. В резюме ставь проверенные; «подкрепить» тоже можно, с предупреждением — цифра есть, пруфа нет. Черновик в резюме не попадает: сначала прими его в банке.</td></tr>
          <tr><td><span className="fit good">10/12</span> <span className="fit">7/12</span> <span className="fit warn">4/12</span></td>
            <td>Fit по критериям ICP: по 0–2 за критерий. Claude ставит при разборе, ты правишь кликом по точкам на «Обзоре».</td></tr>
          <tr><td><Dots value={0} /> <Dots value={1} /> <Dots value={2} /></td>
            <td>0 / частично / полностью. В fit — насколько вакансия попадает в критерий; в матрице историй — насколько история покрывает компетенцию.</td></tr>
          <tr><td><span className="hash">lock 3f9a2c</span></td>
            <td>Зафиксированная версия резюме. На карточке воронки — отправленная или последняя зафиксированная.</td></tr>
          <tr><td><span className="pill good"><i>✓</i>JD</span> <span className="pill warn"><i>!</i>JD</span></td>
            <td>Требование вакансии в конструкторе: закрыто фактом в резюме или нет. «Фактов под это нет» — кандидат в банк.</td></tr>
          <tr><td><span className="pill bad"><i>×</i>просрочено</span> <span className="pill warn">завтра</span></td>
            <td>Срок следующего шага.</td></tr>
          <tr><td>Числа в меню</td>
            <td><ul className="list">
              <li><b>Сегодня</b> — карточки, требующие действия</li>
              <li><b>Воронка</b> — открытые отклики</li>
              <li><b>Банк фактов</b> — факты не в статусе «проверен»</li>
              <li><b>Интервью</b> — частые вопросы без готового ответа</li>
              <li><b>Наполнение</b> — пробелы «Сначала»</li>
            </ul></td></tr>
          <tr><td>Гейты воронки</td>
            <td>Дальше «Исследую» — только с «почему они» и «почему я». Дальше «Готов к отклику» — только с lock. Не пускает — всплывёт кнопка, куда идти.</td></tr>
        </tbody>
      </table>
    </Sec>
  );
}

function Trouble({ s }: { s: State }) {
  const rows: [string, ReactNode][] = [
    ['«Claude: нужен вход»', <>В терминале <code className="mono">claude auth login</code>, затем «Проверить» внизу меню. Упавшие разборы перезапустятся сами.</>],
    ['«Claude CLI не найден»', <>Поставь Claude Code (<span className="mono">claude.com/claude-code</span>), войди через <code className="mono">claude auth login</code>, потом «Проверить» внизу меню. Без него вакансии сохраняются, но не разбираются.</>],
    ['«Страница требует входа»', 'LinkedIn без входа прячет вакансию. Открой её в своём браузере и сохрани расширением или вставь текст на вкладке «Вакансия» → «Вставить текст вручную».'],
    ['«Разбор не удался»', 'Причина — в красной плашке в карточке. Потом «Переразобрать» в шапке. Если страница сохранилась криво — «Перезахватить».'],
    ['Не сохраняется страница или не печатается PDF', <>Чаще всего не установлен Chromium — он нужен для снимков вакансий и печати PDF. Один раз выполни в репозитории Job CRM (из рабочего пространства — в папке <span className="mono">app</span>): <code className="mono">npx playwright install chromium</code>.</>],
    ['«Файлы с ошибками» на «Сегодня»', <>Файл YAML сломан ручной правкой и не загружен. Попроси Claude Code починить или выполни в папке рабочего пространства <code className="mono">npm --prefix app run check</code> — он покажет, что не так.</>],
    ['CRM не запускается: «Не найдено рабочее пространство»', <>CRM не знает, где данные. Создай их: <code className="mono">npm run setup -- &lt;папка&gt;</code> в репозитории Job CRM. Если папка уже есть — запускай из неё (<code className="mono">npm --prefix app start</code>) или подключи её: <code className="mono">npm run setup -- --link &lt;папка&gt;</code> в репозитории Job CRM запишет путь в <span className="mono">.env</span>.</>],
    ['Журнал пуст, коммитов нет', <>Рабочее пространство должно быть своим git-репозиторием (setup делает <code className="mono">git init</code>), а в git — заданы имя и почта: <code className="mono">git config --global user.name "…"</code> и <code className="mono">user.email</code>.</>],
    ['Не пускает в следующую стадию', 'Это гейт: нет «почему» или нет lock. Тост покажет кнопку, куда идти.'],
    ['Удалил не то', 'Все данные под git рабочего пространства, правки из интерфейса сами коммитятся через несколько секунд. Попроси Claude Code вернуть из истории.'],
    ['Расширение', <>Chrome → <span className="mono">chrome://extensions</span> → «Режим разработчика» → «Загрузить распакованное» → <ExtensionDir dir={s.extensionDir} />. На вакансии — кнопка расширения «Сохранить страницу» или <span className="mono">Alt+Shift+S</span>. Пишет «CRM не отвечает» — запусти CRM: <code className="mono">npm --prefix app start</code> в папке рабочего пространства. CRM запущена на другом порту (<span className="mono">CRM_PORT</span>) — впиши его в поле «Порт CRM» внизу окошка расширения.</>],
    ['Мелочи', 'Удаление просит второй клик («Точно?»). Esc закрывает окна. Ссылку можно вставить в любом месте страницы — CRM предложит сохранить вакансию.'],
  ];
  return (
    <Sec id="trouble" title="Если что-то не так">
      <dl className="g-faq">{rows.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
    </Sec>
  );
}

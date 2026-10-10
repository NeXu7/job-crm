// Data file schemas. The source of truth is the YAML/Markdown in the user's workspace;
// these schemas validate them on read (server, `npm run check`) and define the UI types.
import { z } from 'zod';

export const FACT_STATUSES = ['verified', 'needs-proof', 'draft'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

const str = z.string();
const strList = z.array(z.string()).default([]);

export const FactSchema = z.object({
  id: str.min(1),
  text: str.default(''),
  short: str.optional(),
  ru: str.optional(),
  tags: strList,
  roles: strList,
  metrics: strList,
  status: z.enum(FACT_STATUSES).default('draft'),
  source: str.optional(),
  stories: strList,
  note: str.optional(),
  derived_from: str.optional(),
});
export type FactData = z.infer<typeof FactSchema>;
/** A fact together with the id of the experience it belongs to (implicit in the file). */
export type Fact = FactData & { exp: string };

export const ExperienceSchema = z.object({
  id: str.min(1),
  org: str.min(1),
  /** job — a workplace with dates; section — a separate resume section (teaching, projects). */
  kind: z.enum(['job', 'section']).default('job'),
  title: str.default(''),
  start: str.optional(), // YYYY-MM
  end: str.optional(), // YYYY-MM | present
  location: str.optional(),
  blurb: str.optional(),
  order: z.number().default(100),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const FactFileSchema = z.object({
  experience: ExperienceSchema,
  facts: z.array(FactSchema).default([]),
});

export const SummarySchema = z.object({
  id: str.min(1),
  label: str.default(''),
  text: str.default(''),
  status: z.enum(FACT_STATUSES).default('verified'),
  roles: strList,
});
export type Summary = z.infer<typeof SummarySchema>;
export const SummariesFileSchema = z.object({ summaries: z.array(SummarySchema).default([]) });

export const EducationSchema = z.object({
  id: str.min(1),
  school: str,
  field: str.default(''),
  degree: str.optional(),
  start: str.optional(),
  end: str.optional(),
});
export const ProfileSchema = z.object({
  name: str.default(''),
  location: str.default(''),
  contacts: z
    .object({
      email: str.optional(),
      phone: str.optional(),
      linkedin: str.optional(),
      github: str.optional(),
      website: str.optional(),
    })
    .default({}),
  education: z.array(EducationSchema).default([]),
  languages: z.array(z.object({ name: str, level: str.default('') })).default([]),
  /** One-line positioning — a hint for vacancy parsing. */
  positioning: str.optional(),
  /** Free text, English: time zone, location / relocation, employment format (employee/contractor/EoR), other constraints.
   *  Goes into Claude prompts (analyze, prep, drafts); omitted when empty. */
  context: str.optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const RecipeSchema = z.object({
  id: str.min(1),
  name: str.default(''),
  headline: str.default(''),
  summary: str.default(''),
  /** Experience id → ordered list of fact ids. An experience with no key is hidden; with an empty list — only the role and dates line. */
  facts: z.record(z.string(), z.array(z.string())).default({}),
  template: str.default('classic'),
  pages: z.number().default(1),
  /** For a vacancy recipe: id of the base recipe (track). */
  base: str.optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const IcpSchema = z.object({
  criteria: z
    .array(z.object({ id: str, name: str, target: str.default(''), reject: str.default('') }))
    .default([]),
});
export type Icp = z.infer<typeof IcpSchema>;

export const CompanySchema = z.object({
  slug: str.min(1),
  name: str.min(1),
  domains: strList,
  website: str.optional(),
  about: str.optional(),
  segment: str.optional(),
  stage: str.optional(),
  size: str.optional(),
  hq: str.optional(),
  notes: str.optional(),
});
export type Company = z.infer<typeof CompanySchema>;

// ---------- interview: question bank, answers, stories ----------

/** Question bank categories. Order is the UI order. `specific` — vacancy-specific questions only. */
export const QUESTION_CATEGORIES = [
  ['intro', 'Знакомство', 'Первые минуты любого разговора'],
  ['motivation', 'Мотивация', 'Почему уходишь, почему они, чего хочешь'],
  ['probe', 'Неудобные', 'Вопросы в слабые места профиля'],
  ['behavioral', 'Behavioral', 'Истории по STAR: конфликт, провал, влияние'],
  ['leadership', 'Лидерство', 'Команда, найм, перформанс, рост людей'],
  ['product', 'Продукт и бизнес', 'Метрики, приоритизация, ROI, build vs buy'],
  ['ai', 'Профессия и техника', 'Вопросы по твоей области: инструменты, архитектура, кейсы'],
  ['logistics', 'Условия', 'Деньги, сроки, локация, право на работу'],
  ['reverse', 'Мои вопросы', 'Что спросить у них'],
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number][0] | 'specific';
export const CATEGORY_IDS = QUESTION_CATEGORIES.map((c) => c[0]) as QuestionCategory[];
export const categoryName = (c: string) => (c === 'specific' ? 'Под вакансию' : QUESTION_CATEGORIES.find((x) => x[0] === c)?.[1] || c);

/** Behavioral competencies: questions find stories by them, and the coverage matrix finds gaps. */
export const COMPETENCIES = [
  ['conflict', 'Конфликт'],
  ['influence', 'Влияние без власти'],
  ['failure', 'Провал'],
  ['prioritization', 'Приоритизация'],
  ['people', 'Рост людей'],
  ['team', 'Сборка команды'],
  ['hard-talk', 'Сложный разговор'],
  ['client', 'Клиент'],
  ['tech-choice', 'Техвыбор'],
  ['roi', 'Метрики и ROI'],
  ['data-decision', 'Данные изменили решение'],
  ['ambiguity', 'Неопределённость'],
  ['ownership', 'Ownership'],
] as const;
export type Competency = (typeof COMPETENCIES)[number][0];
export const competencyName = (c?: string) => COMPETENCIES.find((x) => x[0] === c)?.[1] || c || '';

export const ANSWER_STATUSES = ['draft', 'ready'] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export const AnswerSchema = z.object({
  /** Variant name: "short", "for the PM track". Optional. */
  label: str.optional(),
  /** Tracks this variant is for. Empty — any. */
  roles: strList,
  text: str.default(''),
  status: z.enum(ANSWER_STATUSES).default('draft'),
  stories: strList,
  facts: strList,
});
export type Answer = z.infer<typeof AnswerSchema>;

export const PracticeSchema = z.object({ date: str, score: z.number().min(0).max(2) });
export type Practice = z.infer<typeof PracticeSchema>;

export const QuestionSchema = z.object({
  id: str.min(1),
  text: str.default(''),
  ru: str.optional(),
  /** Other phrasings of the same question. */
  variants: strList,
  /** high — asked almost always; medium — often, if the track or requirements fit; low — sometimes. */
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  roles: strList,
  /** Tags from the fact bank vocabulary: the question surfaces if they appear in the vacancy requirements. */
  tags: strList,
  competency: str.optional(),
  /** Free-form topic label for grouping (optional). */
  topic: str.optional(),
  /** The answer is taken from the application card: whyThem or whyMe. */
  app_field: z.enum(['whyThem', 'whyMe']).optional(),
  answers: z.array(AnswerSchema).default([]),
  practice: PracticeSchema.optional(),
  note: str.optional(),
  source: str.optional(),
});
export type QuestionData = z.infer<typeof QuestionSchema>;
export type Question = QuestionData & { category: QuestionCategory };
export const QuestionFileSchema = z.object({ questions: z.array(QuestionSchema).default([]) });

export const StorySchema = z.object({
  id: str.min(1),
  title: str.default(''),
  /** Experience id from the fact bank. */
  exp: str.optional(),
  /** Competency → 1 (partial) or 2 (full). */
  covers: z.record(z.string(), z.number().min(0).max(2)).default({}),
  situation: str.default(''),
  task: str.default(''),
  action: str.default(''),
  result: str.default(''),
  tradeoff: str.default(''),
  reflection: str.default(''),
  facts: strList,
  status: z.enum(ANSWER_STATUSES).default('draft'),
  note: str.optional(),
  source: str.optional(),
});
export type Story = z.infer<typeof StorySchema>;
export const StoriesFileSchema = z.object({ stories: z.array(StorySchema).default([]) });
export const STAR_FIELDS = [
  ['situation', 'Situation', 'Контекст: где, какая команда, что на кону'],
  ['task', 'Task', 'Задача и ограничения: что именно требовалось от тебя'],
  ['action', 'Action', 'Что сделал сам, какие решения принимал'],
  ['result', 'Result', 'Результат в цифрах относительно базы'],
  ['tradeoff', 'Компромисс', 'От чего отказался и почему'],
  ['reflection', 'Reflection', 'Что сделал бы иначе'],
] as const;

/** Strength: what to emphasize and how to prove it. */
export const StrengthSchema = z.object({
  id: str.min(1),
  title: str.default(''),
  /** What I say at the interview, in English: 1–2 sentences. */
  pitch: str.default(''),
  ru: str.optional(),
  roles: strList,
  /** Tags from the fact bank vocabulary: the strength surfaces in prep if they appear in the requirements. */
  tags: strList,
  facts: strList,
  stories: strList,
  status: z.enum(ANSWER_STATUSES).default('draft'),
  note: str.optional(),
  source: str.optional(),
});
export type Strength = z.infer<typeof StrengthSchema>;

/** Profile weakness: how it gets probed and what I answer. */
export const WeaknessSchema = z.object({
  id: str.min(1),
  title: str.default(''),
  /** How it sounds at the interview. */
  sounds: str.default(''),
  /** Prepared answer. */
  counter: str.default(''),
  /** Bank questions that probe it. */
  questions: strList,
  roles: strList,
  tags: strList,
  facts: strList,
  stories: strList,
  status: z.enum(ANSWER_STATUSES).default('draft'),
  note: str.optional(),
  source: str.optional(),
});
export type Weakness = z.infer<typeof WeaknessSchema>;
export const StrengthsFileSchema = z.object({
  strengths: z.array(StrengthSchema).default([]),
  weaknesses: z.array(WeaknessSchema).default([]),
});

/** Raw material: dictated, pasted, fill session log. 00-profile/notes/<date>-<topic>.md */
export const NOTE_KINDS = ['dump', 'session'] as const;
export const NoteMetaSchema = z.object({
  title: str.default(''),
  date: str.default(''),
  /** new — not yet sorted into the banks; processed — sorted. */
  status: z.enum(['new', 'processed']).default('new'),
  kind: z.enum(NOTE_KINDS).default('dump'),
});
export type Note = z.infer<typeof NoteMetaSchema> & { file: string; words: number };

/** State of a question in prep for a specific vacancy. A bank question is `q`, a custom one is `id` + `text`. */
export const PrepItemSchema = z.object({
  q: str.optional(),
  id: str.optional(),
  text: str.optional(),
  ru: str.optional(),
  category: str.optional(),
  competency: str.optional(),
  /** Why the question is likely (from Claude). */
  why: str.optional(),
  /** Claude's talking points: what to build the answer on. Not a finished answer. */
  angle: str.optional(),
  source: z.enum(['claude', 'manual', 'interview']).optional(),
  /** Answer for this vacancy; overrides the bank answer. */
  answer: str.optional(),
  stories: strList,
  facts: strList,
  /** Date the question was asked at an interview. */
  asked: str.optional(),
  /** At which stage it was asked: screen, HM, final… */
  asked_at: str.optional(),
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
  practice: PracticeSchema.optional(),
});
export type PrepItem = z.infer<typeof PrepItemSchema>;
export const prepKey = (i: PrepItem) => i.q || i.id || '';

export const PrepSchema = z.object({
  claude: z
    .object({
      status: z.enum(['pending', 'running', 'done', 'failed', 'none']).default('none'),
      at: str.optional(),
      model: str.optional(),
      error: str.optional(),
    })
    .default({ status: 'none' }),
  items: z.array(PrepItemSchema).default([]),
});
export type Prep = z.infer<typeof PrepSchema>;

export const STAGES = ['research', 'ready', 'applied', 'screen', 'interview', 'offer', 'closed'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_NAMES: Record<Stage, string> = {
  research: 'Исследую',
  ready: 'Готов к отклику',
  applied: 'Отклик',
  screen: 'Скрининг',
  interview: 'Интервью',
  offer: 'Оффер',
  closed: 'Закрыто',
};
export const stageIndex = (s: Stage) => STAGES.indexOf(s);

const TimelineSchema = z.object({ date: str, kind: str, text: str.default('') });
export type TimelineEntry = z.infer<typeof TimelineSchema>;

export const RequirementSchema = z.object({
  text: str,
  quote: str.optional(),
  tags: strList,
  must: z.boolean().optional(),
  fact_ids: strList,
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const ApplicationMetaSchema = z.object({
  id: str.min(1),
  company: str.default(''), // company slug
  company_name: str.default(''),
  role: str.default(''),
  track: str.optional(),
  stage: z.enum(STAGES).default('research'),
  stage_since: str.default(''),
  /** The furthest stage reached (for the funnel). */
  reached: z.enum(STAGES).default('research'),
  outcome: str.optional(),
  created: str.default(''),
  url: str.optional(),
  source: str.optional(),
  location: str.optional(),
  team_tz: str.optional(),
  comp: str.optional(),
  summary: str.optional(),
  fit: z.record(z.string(), z.number()).default({}),
  fit_notes: z.record(z.string(), z.string()).default({}),
  flags: strList,
  requirements: z.array(RequirementSchema).default([]),
  why_points: strList,
  questions: strList,
  next: z.object({ text: str, date: str }).optional(),
  people: z.array(z.object({ name: str, role: str.default(''), contact: str.optional() })).default([]),
  sent_lock: str.optional(),
  legacy: z.boolean().optional(),
  capture: z
    .object({
      status: z.enum(['pending', 'running', 'done', 'failed', 'authwall', 'none']).default('none'),
      method: str.optional(),
      at: str.optional(),
      error: str.optional(),
      final_url: str.optional(),
    })
    .default({ status: 'none' }),
  analysis: z
    .object({
      status: z.enum(['pending', 'running', 'done', 'failed', 'none']).default('none'),
      at: str.optional(),
      model: str.optional(),
      error: str.optional(),
    })
    .default({ status: 'none' }),
  timeline: z.array(TimelineSchema).default([]),
});
export type ApplicationMeta = z.infer<typeof ApplicationMetaSchema>;

export type ResolvedBullet = { id: string; text: string };
export type Resolved = {
  name: string;
  headline: string;
  contacts: string[];
  summary: string;
  summaryId: string;
  jobs: { exp: string; org: string; title: string; period: string; location?: string; bullets: ResolvedBullet[] }[];
  sections: { exp: string; title: string; bullets: ResolvedBullet[] }[];
  education: { school: string; field: string; degree?: string; period: string }[];
};

export const LockSchema = z.object({
  hash: str,
  content_hash: str,
  created_at: str,
  application: str,
  base: str.optional(),
  template: str.default('classic'),
  patch: strList,
  recipe: RecipeSchema,
  resolved: z.any(),
});
export type Lock = Omit<z.infer<typeof LockSchema>, 'resolved'> & { resolved: Resolved };

export type Application = ApplicationMeta & {
  whyThem: string;
  whyMe: string;
  notes: string;
  /** Working recipe for this vacancy (before sending). */
  recipe?: Recipe;
  locks: Lock[];
  files: { html: boolean; md: boolean; png: boolean };
  /** Interview prep: applications/<id>/prep.yaml. */
  prep: Prep;
};

export type JournalEntry = { hash: string; date: string; subject: string; agent: 'claude' | 'ui' | 'other' };

export type AppState = {
  profile: Profile;
  icp: Icp;
  summaries: Summary[];
  experiences: Experience[];
  facts: Fact[];
  recipes: Recipe[];
  companies: Company[];
  applications: Application[];
  questions: Question[];
  stories: Story[];
  strengths: Strength[];
  weaknesses: Weakness[];
  notes: Note[];
  claude: { status: 'unknown' | 'ok' | 'auth' | 'missing' | 'error'; message?: string };
  today: string;
  /** Absolute path of the workspace (the data folder). */
  root?: string;
  /** Absolute path of the browser extension folder in the app checkout. */
  extensionDir?: string;
  /** Environment problems for the user (git is missing, autocommit failed…), in Russian. */
  warnings?: string[];
  /** Ids of ICP criteria still word for word as in the app's template (the user has not rewritten them). */
  icpTemplate?: string[];
};

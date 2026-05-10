import type { Chapter, ExamTemplate } from "@prisma/client";
import { z } from "zod";

import { getSectionMarks, safeJsonParse } from "@/lib/utils";
import { isUsableBanglaWord } from "@/lib/quality";
import {
  ANTONYM_PAIRS,
  buildExcerpt,
  cleanOcrText,
  extractBanglaWords,
  extractSentences,
  pickDistinctWords,
} from "@/lib/text";
import type { QuestionTypeValue, SectionBlueprint } from "@/types/domain";

export type GeneratedQuestionDraft = {
  sectionKey: string;
  sectionTitle: string;
  itemOrder: number;
  subLabel: string | null;
  questionType: QuestionTypeValue;
  prompt: string;
  answerText: string | null;
  marks: number;
  chapterId: string | null;
  sourceExcerpt: string | null;
  metadataJson: string | null;
};

type GenerateQuestionInput = {
  selectedChapters: Chapter[];
  template: ExamTemplate;
  usedPrompts: string[];
};

const DEFAULT_GEMINI_QUESTION_MODEL =
  process.env.GEMINI_QUESTION_MODEL ?? "models/gemini-3.1-flash-lite";
const GEMINI_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const ENABLE_AI_QUESTION_GENERATION = ["1", "true", "yes"].includes(
  process.env.FSQUEST_ENABLE_AI_QUESTIONS?.trim().toLowerCase() ?? "",
);
const FILL_BLANK_SKIP_WORDS = new Set([
  "একবার",
  "গিয়ে",
  "আমার",
  "আগে",
  "তাই",
  "রাজা",
  "বলল",
  "বললেন",
  "করুন",
  "করতে",
  "ধরে",
  "নিয়ে",
]);

const aiQuestionItemSchema = z.object({
  chapterRef: z.string().trim().min(1).nullable(),
  prompt: z.string().trim().min(1),
  answerText: z.string().trim().min(1).nullable(),
  sourceExcerpt: z.string().trim().min(1).nullable(),
  options: z.array(z.string().trim().min(1)).min(2).max(4).nullable(),
});

type AiQuestionItem = z.infer<typeof aiQuestionItemSchema>;
type GlossaryEntry = {
  word: string;
  meaning: string;
};
type ChapterAnalysis = {
  bodyText: string;
  bodySentences: string[];
  glossary: GlossaryEntry[];
  questionPrompts: string[];
  blankCandidates: Array<{
    prompt: string;
    answer: string | null;
  }>;
  titleForReading: string;
};

function normalizePromptKey(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLooseKey(value: string) {
  return value
    .normalize("NFC")
    .replace(/[^\p{Script=Bengali}\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase();
}

function getSubLabel(index: number) {
  return ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ"][index] ?? `${index + 1}`;
}

function chooseChapter(chapters: Chapter[], index: number) {
  return chapters[index % chapters.length] ?? chapters[0];
}

function buildFillBlankSentence(sentence: string) {
  if (!isCleanQuestionSource(sentence)) {
    return null;
  }

  const words = extractBanglaWords(sentence).filter(
    (word) => word.length >= 4 && !FILL_BLANK_SKIP_WORDS.has(word),
  );
  const targetWord = words[0];

  if (!targetWord) {
    return null;
  }

  return {
    prompt: sentence.replace(targetWord, "..............."),
    answer: targetWord,
  };
}

function isCleanQuestionSource(value: string) {
  const banglaChars = (value.match(/[\u0980-\u09FF]/gu) ?? []).length;
  const latinChars = (value.match(/[A-Za-z]/g) ?? []).length;
  if (/[,،]\s*।?$/u.test(value)) {
    return false;
  }

  return (
    banglaChars >= 12 &&
    latinChars <= Math.max(1, Math.floor(banglaChars / 8)) &&
    !/[�ÃÂ]|AOA|sy|Tu Pe|BBs|\[[^\]]+\]|[0-9۰-۹০-৯]{6,}|[_=]{2,}/u.test(value)
  );
}

function buildShortAnswerFromSentence(sentence: string) {
  const rules: Array<{
    regex: RegExp;
    prompt: (...matches: string[]) => string;
    answer: (...matches: string[]) => string;
  }> = [
    {
      regex:
        /([\p{Script=Bengali}]+)\s+(প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম)\s+শ্রেণিতে\s+পড়ে/u,
      prompt: (name) => `${name} কোন শ্রেণিতে পড়ে?`,
      answer: (_, grade) => `${grade} শ্রেণিতে পড়ে।`,
    },
    {
      regex: /আমরা\s+এক ভাই,\s*এক বোন/u,
      prompt: () => "আমরা কয় ভাইবোন?",
      answer: () => "এক ভাই, এক বোন।",
    },
    {
      regex: /(.+?)\s+একসাথে\s+স্কুলে\s+যাই/u,
      prompt: () => "কারা একসাথে স্কুলে যায়?",
      answer: (group) => `${group.trim()} একসাথে স্কুলে যায়।`,
    },
    {
      regex: /(.+?)\s+মাঠে\s+নানা রকম ফসল ফলান/u,
      prompt: (subject) => `${subject.trim()} কী করেন?`,
      answer: () => "মাঠে নানা রকম ফসল ফলান।",
    },
    {
      regex: /সেটি\s+আমার\s+মা\s+দেখাশোনা\s+করেন/u,
      prompt: () => "ফসল কে দেখাশোনা করেন?",
      answer: () => "আমার মা দেখাশোনা করেন।",
    },
    {
      regex: /^(.+?)\s+মানে\s+(.+)$/u,
      prompt: (subject) => `${subject.trim()} মানে কী?`,
      answer: (_subject, meaning) => `${meaning.trim()}।`,
    },
    {
      regex: /প্রত্যেক জাতির নিজেদের কিছু (.+?) আছে/u,
      prompt: () => "প্রত্যেক জাতির কী আছে?",
      answer: () => "প্রত্যেক জাতির নিজেদের কিছু উৎসব আছে।",
    },
  ];

  for (const rule of rules) {
    const match = sentence.match(rule.regex);
    if (match) {
      return {
        prompt: rule.prompt(...match.slice(1)),
        answer: rule.answer(...match.slice(1)),
      };
    }
  }

  const focus = extractBanglaWords(sentence).find(
    (word) =>
      !["প্রত্যেক", "নিজেদের", "কিছু", "নানা", "রকম", "বিভিন্ন", "মানুষ", "উৎসব"].includes(
        word,
      ),
  );
  return {
    prompt: focus ? `${focus} সম্পর্কে কী বলা হয়েছে?` : "পাঠে কী বলা হয়েছে?",
    answer: `${sentence.replace(/\s+/g, " ").trim()}।`.replace(/।।$/u, "।"),
  };
}

function normalizeQuestionWord(word: string) {
  if (word.length >= 4 && word.endsWith("ে")) {
    return word.slice(0, -1);
  }

  return word;
}

function buildMcq(sentence: string, optionPool: string[]) {
  const words = extractBanglaWords(sentence).filter((word) => word.length >= 4);
  const answer = words[0];
  if (!answer) {
    return null;
  }

  const distractors = optionPool.filter((word) => word !== answer).slice(0, 3);
  if (distractors.length < 3) {
    return null;
  }

  const options = [answer, ...distractors].sort((a, b) => a.localeCompare(b, "bn"));
  const labeledOptions = options
    .map((option, index) => `(${getSubLabel(index)}) ${option}`)
    .join("  ");

  return {
    prompt: `${sentence.replace(answer, "_____")}\n${labeledOptions}`,
    answer,
    metadataJson: JSON.stringify({ options }),
  };
}

function buildMatchingPairCandidates(text: string, glossary: GlossaryEntry[]) {
  const knownPairs: Array<[string, string]> = [
    ["পিঁপড়া", "পিলপিল"],
    ["মুরগি", "কক কক"],
    ["ব্যাঙ", "ঘ্যাঙর ঘ্যাং"],
    ["টানতে টানতে বলা", "হেইও"],
    ["সিপাই", "সৈনিক"],
    ["গুজব", "মিথ্যা তথ্য"],
    ["রটানো", "ছড়ানো"],
  ];
  const candidates = [
    ...knownPairs.filter(([left, right]) => text.includes(left) && text.includes(right)),
    ...glossary.map((entry) => [entry.word, entry.meaning] as [string, string]),
  ];
  const seen = new Set<string>();

  return candidates.filter(([left, right]) => {
    const key = `${normalizeLooseKey(left)}:${normalizeLooseKey(right)}`;
    if (!left.trim() || !right.trim() || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractReadingTitle(title: string) {
  return title.replace(/^পাঠ\s*[০-৯0-9]+[^—-]*[—-]\s*/u, "").trim() || title.trim();
}

function parseGlossaryEntries(text: string) {
  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();
  let inGlossary = false;

  for (const line of cleanOcrText(text).split("\n")) {
    if (/^(শব্দ শিখি|শব্দভান্ডার|বুঝে নিই)/u.test(line)) {
      inGlossary = true;
      continue;
    }

    if (/^(অনুশীলনী|[۰-۹0-9]+[।.)])/u.test(line)) {
      inGlossary = false;
    }

    if (!inGlossary) {
      continue;
    }

    const match = line.match(
      /^([\p{Script=Bengali}]{2,}(?:[\s\p{Script=Bengali}]{0,20})?)\s*[—–\-_:]\s*(.+)$/u,
    );
    if (!match) {
      continue;
    }

    const word = match[1].replace(/\s+/g, " ").trim();
    const meaning = match[2].replace(/\s+/g, " ").trim();
    if (!word || !meaning || !isUsableBanglaWord(word) || /মানে/u.test(word)) {
      continue;
    }

    const wordKey = normalizeLooseKey(word);
    if (!wordKey || seen.has(wordKey)) {
      continue;
    }

    seen.add(wordKey);
    entries.push({ word, meaning });
  }

  return entries;
}

function extractQuestionPromptsFromText(text: string) {
  const prompts: string[] = [];
  const seen = new Set<string>();

  for (const line of cleanOcrText(text).split("\n")) {
    const cleaned = line.replace(/^[০-৯0-9]+[।.)]?\s*/u, "").trim();
    const match = cleaned.match(/^\(([ক-ঞ])\)\s*(.+)$/u);
    if (!match) {
      continue;
    }

    const prompt = match[2].replace(/\s+/g, " ").trim();
    if (!prompt || /[._]{3,}|[…]{2,}/u.test(prompt) || !/[?]$/u.test(prompt)) {
      continue;
    }

    const key = normalizePromptKey(prompt);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    prompts.push(prompt);
  }

  return prompts;
}

function extractBlankCandidates(text: string) {
  const blanks: Array<{ prompt: string; answer: string | null }> = [];
  const seen = new Set<string>();

  for (const line of cleanOcrText(text).split("\n")) {
    if (!/[._]{3,}|[…]{2,}/u.test(line)) {
      continue;
    }

    const prompt = line
      .replace(/^[০-৯0-9]+[।.)]?\s*/u, "")
      .replace(/\(([ক-ঞ])\)\s*/u, "($1) ")
      .replace(/[._]{3,}|[…]{2,}/gu, "...............")
      .replace(/\s+/g, " ")
      .trim();

    if (!prompt || prompt.length < 25 || extractBanglaWords(prompt).length < 3) {
      continue;
    }

    const key = normalizePromptKey(prompt);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    blanks.push({
      prompt,
      answer: null,
    });
  }

  return blanks;
}

function extractBodyText(text: string) {
  const lines = cleanTextForQuestionGeneration(text).split("\n");
  const sectionStart = lines.findIndex((line) =>
    /^(শব্দ শিখি|শব্দভান্ডার|অনুশীলনী|বুঝে নিই|একই অর্থের শব্দ শিখি)/u.test(line),
  );
  const cutoff = sectionStart >= 0 ? sectionStart : lines.length;

  return lines
    .slice(0, cutoff)
    .filter((line) => !/^(পাঠ\s*[০-৯0-9]+|[০-৯0-9]+[.)]?$)/u.test(line))
    .filter((line, index) => !(index === 0 && line.length <= 30 && !/[।?!]/u.test(line)))
    .join("\n");
}

function analyzeChapter(chapter: Chapter): ChapterAnalysis {
  const bodyText = extractBodyText(chapter.text);
  const bodySentences = extractSentences(bodyText);
  return {
    bodyText,
    bodySentences,
    glossary: parseGlossaryEntries(chapter.text),
    questionPrompts: extractQuestionPromptsFromText(chapter.text),
    blankCandidates: extractBlankCandidates(chapter.text),
    titleForReading: extractReadingTitle(chapter.title),
  };
}

function getKnownShortAnswer(question: string) {
  if (/পিঁপড়া রাজার দরবারে গেল কেন/u.test(question)) {
    return "মুরগি তার বাসা ভেঙে ফেলেছিল বলে পিঁপড়া রাজার দরবারে গেল।";
  }

  if (/কে মুরগির ডিম ভেঙেছিল/u.test(question)) {
    return "সাপ মুরগির ডিম ভেঙেছিল।";
  }

  if (/বুলবুলি কোথায় ঢুকে পড়েছিল/u.test(question)) {
    return "বুলবুলি সারস পাখির মুখে ঢুকে পড়েছিল।";
  }

  if (/কীভাবে ব্যাঙের গায়ে দাগ হলো/u.test(question)) {
    return "কাঁঠাল গাছের কষ গড়িয়ে ব্যাঙের গায়ে পড়ায় দাগ হলো।";
  }

  return null;
}

function retrieveBestAnswerSentence(question: string, sentences: string[]) {
  const knownAnswer = getKnownShortAnswer(question);
  if (knownAnswer) {
    return knownAnswer;
  }

  const tokens = extractBanglaWords(question).filter(
    (token) =>
      ![
        "কোন",
        "কারা",
        "কাদের",
        "কী",
        "কি",
        "কত",
        "কেন",
        "কখন",
        "কোথায়",
        "কোথায়",
        "কীভাবে",
        "কিভাবে",
        "উৎসব",
      ].includes(token),
  );
  const cleanSentences = sentences.filter(isCleanQuestionSource);
  let bestSentence = cleanSentences[0] ?? "";
  let bestScore = -1;

  for (const sentence of cleanSentences) {
    const sentenceWords = new Set(extractBanglaWords(sentence));
    const score = tokens.reduce(
      (sum, token) => sum + (sentenceWords.has(token) ? 2 : sentence.includes(token) ? 1 : 0),
      0,
    );

    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  return bestSentence && bestScore >= 2
    ? `${bestSentence.replace(/\s+/g, " ").trim()}।`.replace(/।।$/u, "।")
    : null;
}

function buildMemorizationPassage(chapter: Chapter, analysis: ChapterAnalysis) {
  const lines = analysis.bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && isCleanQuestionSource(line));
  const titleForReading = analysis.titleForReading;
  const isPoem =
    lines.length >= 4 &&
    lines.slice(0, 4).every((line) => line.length <= 30) &&
    lines.filter((line) => /[।?!]/u.test(line)).length <= 2;

  if (isPoem) {
    const passage = lines.slice(0, 4).join("\n");
    return {
      prompt: `${titleForReading} পাঠ/কবিতা থেকে প্রথম ৪টি চরণ মুখস্থ লেখ।`,
      answerText: passage,
    };
  }

  const passage = analysis.bodySentences.filter(isCleanQuestionSource).slice(0, 2).join("। ");
  return {
    prompt: `“${titleForReading}” পাঠ থেকে মুখস্থ অংশ শুদ্ধভাবে লেখ।`,
    answerText: passage ? `${passage}।`.replace(/।।$/u, "।") : buildExcerpt(analysis.bodyText),
  };
}

function cleanTextForQuestionGeneration(text: string) {
  return cleanOcrText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }

      if (/^[\d০-৯\s.,:;=+\-_/()%]+$/u.test(line)) {
        return false;
      }

      const banglaChars = (line.match(/[\u0980-\u09FF]/gu) ?? []).length;
      const latinChars = (line.match(/[A-Za-z]/g) ?? []).length;
      return banglaChars > 0 && latinChars <= Math.max(2, Math.floor(banglaChars / 3));
    })
    .join("\n");
}

function getTypeSpecificGuidance(section: SectionBlueprint) {
  switch (section.type) {
    case "MEMORIZATION":
      return "Create a memorization prompt from the selected lesson. The answer should be the exact passage students are expected to write.";
    case "WORD_MEANING":
      return "Each prompt must be only a Bangla word from the lesson. The answer should be its simple Bangla meaning.";
    case "SENTENCE_MAKING":
      return "Each prompt must be only a Bangla word. The answer should be one simple original Bangla sentence using that word.";
    case "FILL_IN_BLANK":
      return "Each prompt must be a Bangla sentence with one blank written as ............... and answerText must contain only the missing word or phrase.";
    case "ANTONYM":
      return "Each prompt must be one Bangla word and answerText must be its opposite word suitable for primary school level.";
    case "SHORT_ANSWER":
      return "Each prompt must be a short Bangla question. The answer should be concise and directly supported by the source.";
    case "ORAL_READING":
      return "Prompt should tell the teacher what part the student will read aloud, usually the lesson title or a short passage label. answerText should be null.";
    case "MCQ":
      return "Each prompt must be a Bangla multiple-choice question. Also provide exactly 4 Bangla options in the options array and answerText must be the correct option text.";
    case "MATCHING":
      return "Each prompt should be the left-side Bangla item for a matching question, ending with a dash. answerText must contain the correct right-side match.";
    default:
      return "Keep the language simple, clear, and age-appropriate.";
  }
}

function buildQuestionPrompt({
  selectedChapters,
  blueprint,
  usedPrompts,
  template,
  retryNote,
}: GenerateQuestionInput & {
  blueprint: SectionBlueprint[];
  retryNote?: string | null;
}) {
  const chapterContext = selectedChapters
    .map((chapter, index) => {
      const cleaned = cleanTextForQuestionGeneration(chapter.text).slice(0, 12000);
      return [
        `Chapter ${index + 1}: ${chapter.title}`,
        `Pages: ${chapter.startPage ?? "?"}-${chapter.endPage ?? "?"}`,
        cleaned,
      ].join("\n");
    })
    .join("\n\n====================\n\n");

  const priorPromptBlock = usedPrompts.length
    ? `Avoid reusing these earlier question prompts exactly:\n${usedPrompts
        .slice(0, 40)
        .map((prompt, index) => `${index + 1}. ${prompt}`)
        .join("\n")}`
    : "There are no previous prompts to avoid for this run.";

  const sectionGuide = blueprint
    .map(
      (section) =>
        `- ${section.id}: ${section.title}; type=${section.type}; exact_items=${section.itemCount}; guidance=${getTypeSpecificGuidance(section)}`,
    )
    .join("\n");

  return `You are creating a Bangla-medium primary school question paper for Bangladesh.

Target:
- Class: ${selectedChapters[0]?.bookId ? template.classLevel : "Three"}
- Subject: Bangla Literature
- Exam type: ${template.examType}
- Total marks: ${template.totalMarks}

Source rules:
- Use only the selected textbook chapter content below.
- Keep all output in clean Bangla Unicode.
- Keep the wording simple enough for primary school students.
- Do not copy the printed অনুশীলনী questions word-for-word.
- Do not solve or fill in textbook exercises from the source.
- Do not invent facts not supported by the source text.
- Avoid duplicate prompts inside this paper.
- If the OCR source contains some noise, infer carefully from the nearby Bangla context, but do not rewrite the chapter into a different meaning.

Return rules:
- Return only valid JSON that matches the schema.
- Each section key must contain exactly the required number of items.
- For each item, set chapterRef to the exact chapter title you used.
- Use answerText=null only when that truly fits the question type.
- For non-MCQ sections, set options to null.

Section requirements:
${sectionGuide}

${priorPromptBlock}

${retryNote ? `Retry note:\n${retryNote}\n` : ""}

Selected chapters:
${chapterContext}`;
}

function buildAiResponseSchema(blueprint: SectionBlueprint[]) {
  const itemSchema = {
    type: "object",
    properties: {
      chapterRef: {
        type: ["string", "null"],
        description: "Exact title of the source chapter used for this item.",
      },
      prompt: {
        type: "string",
        description: "Question prompt shown to the student, always in Bangla.",
      },
      answerText: {
        type: ["string", "null"],
        description: "Teacher-side answer or expected response in Bangla.",
      },
      sourceExcerpt: {
        type: ["string", "null"],
        description: "Short supporting excerpt or clue from the source chapter.",
      },
      options: {
        type: ["array", "null"],
        items: {
          type: "string",
        },
        description: "Four Bangla options for MCQ only. Otherwise null.",
      },
    },
    required: ["chapterRef", "prompt", "answerText", "sourceExcerpt", "options"],
  };

  const properties = Object.fromEntries(
    blueprint.map((section) => [
      section.id,
      {
        type: "array",
        minItems: section.itemCount,
        maxItems: section.itemCount,
        items: itemSchema,
      },
    ]),
  );

  return {
    type: "object",
    properties,
    required: blueprint.map((section) => section.id),
  };
}

function parseAiSectionPayload(
  rawPayload: string,
  blueprint: SectionBlueprint[],
) {
  const sectionShape = Object.fromEntries(
    blueprint.map((section) => [
      section.id,
      z.array(aiQuestionItemSchema).length(section.itemCount),
    ]),
  );
  const parser = z.object(sectionShape);
  return parser.parse(JSON.parse(rawPayload)) as Record<string, AiQuestionItem[]>;
}

function resolveChapterIdFromRef(chapters: Chapter[], chapterRef: string | null, index: number) {
  if (!chapterRef) {
    return chooseChapter(chapters, index);
  }

  const normalizedRef = normalizeLooseKey(chapterRef);
  const exactMatch = chapters.find(
    (chapter) => normalizeLooseKey(chapter.title) === normalizedRef,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const partialMatch = chapters.find((chapter) =>
    normalizeLooseKey(chapter.title).includes(normalizedRef),
  );
  return partialMatch ?? chooseChapter(chapters, index);
}

async function generateQuestionDraftsWithAi({
  selectedChapters,
  template,
  usedPrompts,
}: GenerateQuestionInput) {
  if (!ENABLE_AI_QUESTION_GENERATION) {
    return null;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const blueprint = safeJsonParse<SectionBlueprint[]>(template.structureJson, []);
  if (blueprint.length === 0) {
    return null;
  }

  let retryNote: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: buildQuestionPrompt({
                selectedChapters,
                template,
                usedPrompts,
                blueprint,
                retryNote,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseJsonSchema: buildAiResponseSchema(blueprint),
      },
    });

    let response: Response | null = null;
    for (let requestAttempt = 1; requestAttempt <= 4; requestAttempt += 1) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${DEFAULT_GEMINI_QUESTION_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: requestBody,
        },
      );

      if (response.ok || !GEMINI_RETRY_STATUSES.has(response.status) || requestAttempt === 4) {
        break;
      }

      await sleep(1500 * requestAttempt);
    }

    if (!response || !response.ok) {
      throw new Error(
        `Gemini question generation failed with status ${response?.status ?? "unknown"}.`,
      );
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
    };
    const rawText = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!rawText) {
      throw new Error("Gemini returned an empty question payload.");
    }

    const parsed = parseAiSectionPayload(rawText, blueprint);
    const usedSet = new Set(usedPrompts.map(normalizePromptKey));
    const questions: GeneratedQuestionDraft[] = [];
    let duplicatePrompt: string | null = null;

    for (const section of blueprint) {
      const items = parsed[section.id];
      if (!items) {
        throw new Error(`Gemini omitted section ${section.id}.`);
      }

      items.forEach((item, index) => {
        const prompt = item.prompt.replace(/\s+/g, " ").trim();
        if (!prompt) {
          throw new Error(`Gemini returned an empty prompt for ${section.id}.`);
        }
        if (usedSet.has(normalizePromptKey(prompt))) {
          duplicatePrompt = prompt;
          return;
        }
        usedSet.add(normalizePromptKey(prompt));

        const chapter = resolveChapterIdFromRef(selectedChapters, item.chapterRef, index);
        questions.push({
          sectionKey: section.id,
          sectionTitle: section.title,
          itemOrder: index + 1,
          subLabel: section.itemCount > 1 ? getSubLabel(index) : null,
          questionType: section.type,
          prompt,
          answerText: item.answerText?.trim() || null,
          marks: getSectionMarks(section, index),
          chapterId: chapter.id,
          sourceExcerpt: item.sourceExcerpt?.trim() || chapter.excerpt,
          metadataJson:
            item.options && item.options.length > 0
              ? JSON.stringify({ options: item.options })
              : null,
        });
      });
    }

    if (!duplicatePrompt && questions.length === blueprint.reduce((sum, section) => sum + section.itemCount, 0)) {
      return questions;
    }

    retryNote =
      `The last attempt reused or skipped a blocked prompt, including: ${duplicatePrompt ?? "unknown"}.\n` +
      "Replace any repeated prompt with a different source-based item and return the full paper again.";
  }

  throw new Error("Gemini could not produce a fresh non-repeating paper after retrying.");
}

function generateQuestionDraftsFallback({
  selectedChapters,
  template,
  usedPrompts,
}: GenerateQuestionInput) {
  const blueprint = safeJsonParse<SectionBlueprint[]>(template.structureJson, []);
  const chapterAnalyses = new Map(
    selectedChapters.map((chapter) => [chapter.id, analyzeChapter(chapter)]),
  );
  const allText = selectedChapters
    .map((chapter) => chapterAnalyses.get(chapter.id)?.bodyText ?? chapter.text)
    .join("\n\n");
  const allSentences = extractSentences(allText);
  const allWords = pickDistinctWords(allText, 80);
  const antonymWordPool = ANTONYM_PAIRS.filter(
    ([word]) => allText.includes(word),
  );
  const allGlossary = selectedChapters.flatMap(
    (chapter) => chapterAnalyses.get(chapter.id)?.glossary ?? [],
  );
  const allMatchingPairs = selectedChapters.flatMap((chapter) => {
    const analysis = chapterAnalyses.get(chapter.id) ?? analyzeChapter(chapter);
    return buildMatchingPairCandidates(chapter.text, analysis.glossary);
  });
  const allQuestionPrompts = selectedChapters.flatMap(
    (chapter) => chapterAnalyses.get(chapter.id)?.questionPrompts ?? [],
  );
  const allBlankCandidates = selectedChapters.flatMap(
    (chapter) => chapterAnalyses.get(chapter.id)?.blankCandidates ?? [],
  );
  const usedSet = new Set(usedPrompts.map(normalizePromptKey));
  const questions: GeneratedQuestionDraft[] = [];

  for (const section of blueprint) {
    let producedCount = 0;
    const maxAttempts = Math.max(section.itemCount + 30, 40);

    for (
      let candidateIndex = 0;
      producedCount < section.itemCount && candidateIndex < maxAttempts;
      candidateIndex += 1
    ) {
      const chapter = chooseChapter(selectedChapters, candidateIndex);
      const analysis = chapterAnalyses.get(chapter.id) ?? analyzeChapter(chapter);
      const sectionBase = {
        sectionKey: section.id,
        sectionTitle: section.title,
        itemOrder: producedCount + 1,
        subLabel: section.itemCount > 1 ? getSubLabel(producedCount) : null,
        questionType: section.type,
        marks: getSectionMarks(section, producedCount),
      } as const;

      let question: GeneratedQuestionDraft | null = null;

      if (section.type === "MEMORIZATION") {
        const memorization = buildMemorizationPassage(chapter, analysis);
        question = {
          ...sectionBase,
          prompt: memorization.prompt,
          answerText: memorization.answerText || chapter.excerpt || buildExcerpt(chapter.text),
          chapterId: chapter.id,
          sourceExcerpt: chapter.excerpt,
          metadataJson: null,
        };
      }

      if (section.type === "WORD_MEANING") {
        const entry =
          analysis.glossary[candidateIndex] ??
          allGlossary[candidateIndex] ??
          null;
        const word =
          entry?.word ??
          pickDistinctWords(analysis.bodyText || chapter.text, section.itemCount + 10)[candidateIndex] ??
          allWords[candidateIndex];
        if (!word) {
          continue;
        }
        question = {
          ...sectionBase,
          prompt: word,
          answerText: entry?.meaning ?? null,
          chapterId: chapter.id,
          sourceExcerpt: entry ? `${entry.word} - ${entry.meaning}` : chapter.excerpt,
          metadataJson: null,
        };
      }

      if (section.type === "SENTENCE_MAKING") {
        const word = normalizeQuestionWord((
          analysis.glossary.map((entry) => entry.word)[candidateIndex] ??
          pickDistinctWords(analysis.bodyText || chapter.text, section.itemCount + 12)[candidateIndex] ??
          allWords[candidateIndex + 4] ??
          allWords[candidateIndex]
        )?.trim() ?? "");
        if (!word) {
          continue;
        }
        question = {
          ...sectionBase,
          prompt: word,
          answerText: `${word} শব্দটি দিয়ে নিজের বাক্য লিখবে।`,
          chapterId: chapter.id,
          sourceExcerpt: chapter.excerpt,
          metadataJson: null,
        };
      }

      if (section.type === "FILL_IN_BLANK") {
        const sentence =
          analysis.bodySentences
            .map(buildFillBlankSentence)
            .filter((item): item is NonNullable<typeof item> => Boolean(item))[candidateIndex] ??
          allSentences
            .map(buildFillBlankSentence)
            .filter((item): item is NonNullable<typeof item> => Boolean(item))[candidateIndex] ??
          analysis.blankCandidates.filter((item) => item.answer?.trim())[candidateIndex] ??
          allBlankCandidates.filter((item) => item.answer?.trim())[candidateIndex];
        if (!sentence) {
          continue;
        }

        question = {
          ...sectionBase,
          prompt: sentence.prompt,
          answerText: sentence.answer ?? null,
          chapterId: chapter.id,
          sourceExcerpt: sentence.prompt,
          metadataJson: null,
        };
      }

      if (section.type === "ANTONYM") {
        const pair = antonymWordPool[candidateIndex] ?? ANTONYM_PAIRS[candidateIndex];
        if (!pair) {
          continue;
        }
        question = {
          ...sectionBase,
          prompt: pair[0],
          answerText: pair[1],
          chapterId: chapter.id,
          sourceExcerpt: chapter.excerpt,
          metadataJson: null,
        };
      }

      if (section.type === "SHORT_ANSWER") {
        const prompt =
          analysis.questionPrompts[candidateIndex] ??
          allQuestionPrompts[candidateIndex] ??
          null;
        const answer =
          prompt
            ? retrieveBestAnswerSentence(prompt, analysis.bodySentences)
            : null;
        const sentence =
          analysis.bodySentences.filter(isCleanQuestionSource)[candidateIndex] ??
          allSentences.filter(isCleanQuestionSource)[candidateIndex];
        const qa =
          prompt && answer && isCleanQuestionSource(answer)
            ? {
                prompt,
                answer,
              }
            : buildShortAnswerFromSentence(sentence ?? chapter.excerpt ?? chapter.title);
        question = {
          ...sectionBase,
          prompt: qa.prompt,
          answerText: qa.answer,
          chapterId: chapter.id,
          sourceExcerpt: answer ?? sentence ?? chapter.excerpt,
          metadataJson: null,
        };
      }

      if (section.type === "ORAL_READING") {
        question = {
          ...sectionBase,
          prompt: analysis.titleForReading,
          answerText: null,
          chapterId: chapter.id,
          sourceExcerpt: chapter.excerpt,
          metadataJson: null,
        };
      }

      if (section.type === "MCQ") {
        const sentence = analysis.bodySentences[candidateIndex] ?? allSentences[candidateIndex];
        const mcq = buildMcq(sentence ?? chapter.excerpt ?? chapter.title, allWords);
        if (!mcq) {
          continue;
        }
        question = {
          ...sectionBase,
          prompt: mcq.prompt,
          answerText: mcq.answer,
          chapterId: chapter.id,
          sourceExcerpt: sentence ?? chapter.excerpt,
          metadataJson: mcq.metadataJson,
        };
      }

      if (section.type === "MATCHING") {
        const matchingPairs = buildMatchingPairCandidates(chapter.text, analysis.glossary);
        const pair = matchingPairs[candidateIndex] ?? allMatchingPairs[candidateIndex];
        if (!pair) {
          continue;
        }
        question = {
          ...sectionBase,
          prompt: `${pair[0]} -`,
          answerText: pair[1],
          chapterId: chapter.id,
          sourceExcerpt: `${pair[0]} - ${pair[1]}`,
          metadataJson: null,
        };
      }

      if (!question) {
        continue;
      }

      if (usedSet.has(normalizePromptKey(question.prompt))) {
        continue;
      }

      usedSet.add(normalizePromptKey(question.prompt));
      questions.push(question);
      producedCount += 1;
    }
  }

  return questions;
}

export async function generateQuestionDrafts(input: GenerateQuestionInput) {
  try {
    const aiQuestions = await generateQuestionDraftsWithAi(input);
    if (aiQuestions?.length) {
      return aiQuestions;
    }
  } catch (error) {
    console.error("AI question generation failed. Falling back to heuristic generator.", error);
  }

  return generateQuestionDraftsFallback(input);
}

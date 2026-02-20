import { useState, useEffect, useRef, useCallback } from "react";
import { render, Box, Text, Static, useApp } from "ink";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

// ── Models ──────────────────────────────────────────────────────────────────

const MODELS = [
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
  { id: "moonshotai/kimi-k2", name: "Kimi K2" },
  // { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek 3.2" },
  { id: "z-ai/glm-5", name: "GLM-5" },
  { id: "openai/gpt-5.2", name: "GPT-5.2" },
  { id: "anthropic/claude-opus-4.6", name: "Opus 4.6" },
  { id: "anthropic/claude-sonnet-4.6", name: "Sonnet 4.6" },
  { id: "x-ai/grok-4.1-fast", name: "Grok 4.1" },
] as const;

type Model = (typeof MODELS)[number];

const MODEL_COLORS: Record<string, string> = {
  "Gemini 3.1 Pro": "cyan",
  "Kimi K2": "green",
  "Kimi K2.5": "magenta",
  "DeepSeek 3.2": "greenBright",
  "GLM-5": "cyanBright",
  "GPT-5.2": "yellow",
  "Opus 4.6": "blue",
  "Sonnet 4.6": "red",
  "Grok 4.1": "white",
};

const NAME_PAD = 16;

// ── OpenRouter ──────────────────────────────────────────────────────────────

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// ── Types ───────────────────────────────────────────────────────────────────

type TaskInfo = {
  model: Model;
  startedAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
};

type VoteInfo = {
  voter: Model;
  startedAt: number;
  finishedAt?: number;
  votedFor?: Model;
  error?: boolean;
};

type RoundState = {
  num: number;
  phase: "prompting" | "answering" | "voting" | "done";
  prompter: Model;
  promptTask: TaskInfo;
  prompt?: string;
  contestants: [Model, Model];
  answerTasks: [TaskInfo, TaskInfo];
  votes: VoteInfo[];
  scoreA?: number;
  scoreB?: number;
};

type GameState = {
  completed: RoundState[];
  active: RoundState | null;
  scores: Record<string, number>;
  done: boolean;
};

// ── Logger ──────────────────────────────────────────────────────────────────

const LOGS_DIR = join(import.meta.dir, "logs");
mkdirSync(LOGS_DIR, { recursive: true });
const LOG_FILE = join(
  LOGS_DIR,
  `game-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
);

function log(
  level: "INFO" | "WARN" | "ERROR",
  category: string,
  message: string,
  data?: Record<string, unknown>,
) {
  const ts = new Date().toISOString();
  let line = `[${ts}] ${level} [${category}] ${message}`;
  if (data) {
    line += "\n  " + JSON.stringify(data, null, 2).replace(/\n/g, "\n  ");
  }
  appendFileSync(LOG_FILE, line + "\n");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  validate: (result: T) => boolean,
  retries = 3,
  label = "unknown",
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      if (validate(result)) {
        log("INFO", label, `Success on attempt ${attempt}`, {
          result: typeof result === "string" ? result : String(result),
        });
        return result;
      }
      const msg = `Validation failed (attempt ${attempt}/${retries})`;
      log("WARN", label, msg, {
        result: typeof result === "string" ? result : String(result),
      });
      lastErr = new Error(`${msg}: ${JSON.stringify(result).slice(0, 100)}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log("WARN", label, `Error on attempt ${attempt}/${retries}: ${errMsg}`, {
        error: errMsg,
        stack: err instanceof Error ? err.stack : undefined,
      });
      lastErr = err;
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  log("ERROR", label, `All ${retries} attempts failed`, {
    lastError: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  throw lastErr;
}

// Minimum length for a real response (not junk like "The" or "")
function isRealString(s: string, minLength = 5): boolean {
  return s.length >= minLength;
}

function cleanResponse(text: string): string {
  return text.trim().replace(/^["']|["']$/g, "");
}

// ── AI functions ────────────────────────────────────────────────────────────

const PROMPT_SYSTEM = `You are a comedy writer for the game Quiplash. Generate a single funny fill-in-the-blank prompt that players will try to answer. The prompt should be surprising and designed to elicit hilarious responses. Return ONLY the prompt text, nothing else. Keep it short (under 15 words).

Use a wide VARIETY of prompt formats. Do NOT always use "The worst thing to..." — mix it up! Here are examples of the range of styles:

- The worst thing to hear from your GPS
- A terrible name for a dog
- A rejected name for a new fast food restaurant
- The worst thing to hear during surgery
- A bad name for a superhero
- A terrible name for a new perfume
- The worst thing to find in your sandwich
- A rejected slogan for a toothpaste brand
- The worst thing to say during a job interview
- A bad name for a country
- The worst thing to say when meeting your partner's parents
- A terrible name for a retirement home
- A rejected title for a romantic comedy
- The world's least popular ice cream flavor
- A terrible fortune cookie message
- What you don't want to hear from your dentist
- The worst name for a band
- A rejected Hallmark card message
- Something you shouldn't yell in a library
- The least intimidating martial arts move

Come up with something ORIGINAL — don't copy these examples.`;

async function callGeneratePrompt(model: Model): Promise<string> {
  log("INFO", `prompt:${model.name}`, "Calling API", { modelId: model.id });
  const { text, usage } = await generateText({
    model: openrouter.chat(model.id),
    system: PROMPT_SYSTEM,
    prompt:
      "Generate a single original Quiplash prompt. Be creative and don't repeat common patterns.",
    // temperature: 1.2,
    // maxOutputTokens: 80,
  });
  log("INFO", `prompt:${model.name}`, "Raw response", {
    rawText: text,
    usage,
  });
  return cleanResponse(text);
}

async function callGenerateAnswer(
  model: Model,
  prompt: string,
): Promise<string> {
  log("INFO", `answer:${model.name}`, "Calling API", {
    modelId: model.id,
    prompt,
  });
  const { text, usage } = await generateText({
    model: openrouter.chat(model.id),
    system: `You are playing Quiplash! You'll be given a fill-in-the-blank prompt. Give the FUNNIEST possible answer. Be creative, edgy, unexpected, and concise. Reply with ONLY your answer — no quotes, no explanation, no preamble. Keep it short (under 12 words).`,
    prompt: `Fill in the blank: ${prompt}`,
    // temperature: 1.2,
    // maxOutputTokens: 60,
  });
  log("INFO", `answer:${model.name}`, "Raw response", {
    rawText: text,
    usage,
  });
  return cleanResponse(text);
}

async function callVote(
  voter: Model,
  prompt: string,
  a: { answer: string },
  b: { answer: string },
): Promise<"A" | "B"> {
  log("INFO", `vote:${voter.name}`, "Calling API", {
    modelId: voter.id,
    prompt,
    answerA: a.answer,
    answerB: b.answer,
  });
  const { text, usage } = await generateText({
    model: openrouter.chat(voter.id),
    system: `You are a judge in a comedy game. You'll see a fill-in-the-blank prompt and two answers. Pick which answer is FUNNIER. You MUST respond with exactly "A" or "B" — nothing else.`,
    prompt: `Prompt: "${prompt}"\n\nAnswer A: "${a.answer}"\nAnswer B: "${b.answer}"\n\nWhich is funnier? Reply with just A or B.`,
    // temperature: 0.3,
    // maxOutputTokens: 5,
  });
  log("INFO", `vote:${voter.name}`, "Raw response", { rawText: text, usage });
  const cleaned = text.trim().toUpperCase();
  if (!cleaned.startsWith("A") && !cleaned.startsWith("B")) {
    throw new Error(`Invalid vote: "${text.trim()}"`);
  }
  return cleaned.startsWith("A") ? "A" : "B";
}

// ── Game loop ───────────────────────────────────────────────────────────────

async function runGame(runs: number, state: GameState, rerender: () => void) {
  for (let r = 1; r <= runs; r++) {
    const shuffled = shuffle([...MODELS]);
    const prompter = shuffled[0]!;
    const contA = shuffled[1]!;
    const contB = shuffled[2]!;
    const voters = shuffled.slice(3);
    const now = Date.now();

    // Initialize round
    const round: RoundState = {
      num: r,
      phase: "prompting",
      prompter,
      promptTask: { model: prompter, startedAt: now },
      contestants: [contA, contB],
      answerTasks: [
        { model: contA, startedAt: 0 },
        { model: contB, startedAt: 0 },
      ],
      votes: [],
    };
    state.active = round;
    log("INFO", "round", `=== Round ${r}/${runs} ===`, {
      prompter: prompter.name,
      contestants: [contA.name, contB.name],
      voters: voters.map((v) => v.name),
    });
    rerender();

    // ── Prompt phase ──
    try {
      const prompt = await withRetry(
        () => callGeneratePrompt(prompter),
        (s) => isRealString(s, 10),
        3,
        `R${r}:prompt:${prompter.name}`,
      );
      round.promptTask.finishedAt = Date.now();
      round.promptTask.result = prompt;
      round.prompt = prompt;
      rerender();
    } catch {
      round.promptTask.finishedAt = Date.now();
      round.promptTask.error = "Failed after 3 attempts";
      round.phase = "done";
      state.completed = [...state.completed, round];
      state.active = null;
      rerender();
      continue;
    }

    // ── Answer phase ──
    round.phase = "answering";
    const answerStart = Date.now();
    round.answerTasks[0].startedAt = answerStart;
    round.answerTasks[1].startedAt = answerStart;
    rerender();

    await Promise.all(
      round.answerTasks.map(async (task) => {
        try {
          const answer = await withRetry(
            () => callGenerateAnswer(task.model, round.prompt!),
            (s) => isRealString(s, 3),
            3,
            `R${r}:answer:${task.model.name}`,
          );
          task.result = answer;
        } catch {
          task.error = "Failed to answer";
          task.result = "[no answer]";
        }
        task.finishedAt = Date.now();
        rerender();
      }),
    );

    // ── Vote phase ──
    round.phase = "voting";
    const answerA = round.answerTasks[0].result!;
    const answerB = round.answerTasks[1].result!;
    const voteStart = Date.now();
    round.votes = voters.map((v) => ({ voter: v, startedAt: voteStart }));
    rerender();

    await Promise.all(
      round.votes.map(async (vote) => {
        try {
          const showAFirst = Math.random() > 0.5;
          const first = showAFirst ? { answer: answerA } : { answer: answerB };
          const second = showAFirst ? { answer: answerB } : { answer: answerA };

          const result = await withRetry(
            () => callVote(vote.voter, round.prompt!, first, second),
            (v) => v === "A" || v === "B",
            3,
            `R${r}:vote:${vote.voter.name}`,
          );
          const votedFor = showAFirst
            ? result === "A"
              ? contA
              : contB
            : result === "A"
              ? contB
              : contA;

          vote.finishedAt = Date.now();
          vote.votedFor = votedFor;
        } catch {
          vote.finishedAt = Date.now();
          vote.error = true;
        }
        rerender();
      }),
    );

    // ── Score ──
    let votesA = 0;
    let votesB = 0;
    for (const v of round.votes) {
      if (v.votedFor === contA) votesA++;
      else if (v.votedFor === contB) votesB++;
    }
    round.scoreA = votesA * 100;
    round.scoreB = votesB * 100;
    round.phase = "done";
    state.scores[contA.name] = (state.scores[contA.name] || 0) + round.scoreA;
    state.scores[contB.name] = (state.scores[contB.name] || 0) + round.scoreB;
    rerender();

    // Brief pause so the user can see the result
    await new Promise((r) => setTimeout(r, 2000));

    // Archive round
    state.completed = [...state.completed, round];
    state.active = null;
    rerender();
  }

  state.done = true;
  rerender();
}

// ── Components ──────────────────────────────────────────────────────────────

function Timer({
  startedAt,
  finishedAt,
}: {
  startedAt: number;
  finishedAt?: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (finishedAt) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [finishedAt]);
  const elapsed = ((finishedAt ?? now) - startedAt) / 1000;
  return <Text dimColor>({elapsed.toFixed(1)}s)</Text>;
}

function MName({ model, pad }: { model: Model; pad?: boolean }) {
  const name = pad ? model.name.padEnd(NAME_PAD) : model.name;
  return (
    <Text bold color={MODEL_COLORS[model.name]}>
      {name}
    </Text>
  );
}

function RoundView({ round, total }: { round: RoundState; total: number }) {
  const [contA, contB] = round.contestants;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header */}
      <Box>
        <Text bold inverse backgroundColor="blue">
          {` ROUND ${round.num}/${total} `}
        </Text>
      </Box>
      <Text dimColor>{"─".repeat(50)}</Text>

      {/* Prompt */}
      <Box marginTop={1} gap={1}>
        <Text bold inverse backgroundColor="magenta">
          {" PROMPT "}
        </Text>
        <MName model={round.prompter} />
        {!round.prompt && <Text dimColor>writing a prompt...</Text>}
        <Timer
          startedAt={round.promptTask.startedAt}
          finishedAt={round.promptTask.finishedAt}
        />
      </Box>
      {round.promptTask.error && (
        <Box marginLeft={2}>
          <Text color="red">✗ {round.promptTask.error}</Text>
        </Box>
      )}
      {round.prompt && (
        <Box marginLeft={2} marginTop={1}>
          <Text bold color="yellow">
            "{round.prompt}"
          </Text>
        </Box>
      )}

      {/* Answers */}
      {round.phase !== "prompting" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold inverse backgroundColor="cyan">
            {" ANSWERS "}
          </Text>
          {round.answerTasks.map((task, i) => (
            <Box key={i} marginLeft={2} gap={1}>
              <MName model={task.model} pad />
              {!task.finishedAt ? (
                <Text dimColor>thinking...</Text>
              ) : task.error ? (
                <Text color="red">✗ {task.error}</Text>
              ) : (
                <Text bold>"{task.result}"</Text>
              )}
              {task.startedAt > 0 && (
                <Timer
                  startedAt={task.startedAt}
                  finishedAt={task.finishedAt}
                />
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Votes */}
      {(round.phase === "voting" || round.phase === "done") && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold inverse backgroundColor="yellow" color="red">
            {" VOTES "}
          </Text>
          {round.votes.map((vote, i) => (
            <Box key={i} marginLeft={2} gap={1}>
              <MName model={vote.voter} pad />
              {!vote.finishedAt ? (
                <Text dimColor>voting...</Text>
              ) : vote.error || !vote.votedFor ? (
                <Text color="red">✗ failed</Text>
              ) : (
                <Text>
                  {"→ "}
                  <MName model={vote.votedFor} />
                </Text>
              )}
              <Timer startedAt={vote.startedAt} finishedAt={vote.finishedAt} />
            </Box>
          ))}
        </Box>
      )}

      {/* Round result */}
      {round.phase === "done" &&
        round.scoreA !== undefined &&
        round.scoreB !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{"─".repeat(50)}</Text>
            <Box marginLeft={2} gap={1}>
              {round.scoreA > round.scoreB ? (
                <Text>
                  <MName model={contA} />{" "}
                  <Text bold>
                    wins! ({round.scoreA / 100} vs {round.scoreB / 100} votes)
                  </Text>
                </Text>
              ) : round.scoreB > round.scoreA ? (
                <Text>
                  <MName model={contB} />{" "}
                  <Text bold>
                    wins! ({round.scoreB / 100} vs {round.scoreA / 100} votes)
                  </Text>
                </Text>
              ) : (
                <Text bold>
                  TIE! ({round.scoreA / 100} - {round.scoreB / 100})
                </Text>
              )}
            </Box>
            <Box marginLeft={2} gap={1}>
              <MName model={contA} />
              <Text dimColor>+{round.scoreA}</Text>
              <Text dimColor>|</Text>
              <MName model={contB} />
              <Text dimColor>+{round.scoreB}</Text>
            </Box>
            <Text dimColor>{"─".repeat(50)}</Text>
          </Box>
        )}
    </Box>
  );
}

function Scoreboard({ scores }: { scores: Record<string, number> }) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const maxScore = sorted[0]?.[1] || 1;
  const barWidth = 30;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold inverse backgroundColor="magenta">
        {" FINAL SCORES "}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {sorted.map(([name, score], i) => {
          const filled = Math.round((score / maxScore) * barWidth);
          const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
          const medal =
            i === 0 ? " 👑" : i === 1 ? " 🥈" : i === 2 ? " 🥉" : "";
          return (
            <Box key={name} marginLeft={2} gap={1}>
              <Text>{String(i + 1).padStart(2)}.</Text>
              <Text bold color={MODEL_COLORS[name]}>
                {name.padEnd(NAME_PAD)}
              </Text>
              <Text color={MODEL_COLORS[name]}>{bar}</Text>
              <Text bold>{score}</Text>
              <Text>{medal}</Text>
            </Box>
          );
        })}
      </Box>
      {sorted[0] && sorted[0][1] > 0 && (
        <Box marginTop={1} marginLeft={2}>
          <Text>
            {"🏆 "}
            <Text bold color={MODEL_COLORS[sorted[0][0]]}>
              {sorted[0][0]}
            </Text>
            <Text bold> is the funniest AI!</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}

function Game({ runs }: { runs: number }) {
  const stateRef = useRef<GameState>({
    completed: [],
    active: null,
    scores: Object.fromEntries(MODELS.map((m) => [m.name, 0])),
    done: false,
  });
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    runGame(runs, stateRef.current, rerender).then(() => {
      setTimeout(() => process.exit(0), 200);
    });
  }, []);

  const state = stateRef.current;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} gap={1}>
        <Text bold inverse backgroundColor="magenta">
          {" QUIPSLOP "}
        </Text>
        <Text dimColor>AI vs AI comedy showdown — {runs} rounds</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Models: {MODELS.map((m) => m.name).join(", ")}</Text>
      </Box>

      <Static items={state.completed}>
        {(round: RoundState) => (
          <RoundView key={round.num} round={round} total={runs} />
        )}
      </Static>

      {state.active && <RoundView round={state.active} total={runs} />}

      {state.done && <Scoreboard scores={state.scores} />}
      {state.done && (
        <Box marginTop={1}>
          <Text dimColor>Log: {LOG_FILE}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

const runsArg = process.argv.find((a) => a.startsWith("runs="));
const runs = runsArg ? parseInt(runsArg.split("=")[1] ?? "5", 10) : 5;

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Error: Set OPENROUTER_API_KEY environment variable");
  process.exit(1);
}

log("INFO", "startup", `Game starting: ${runs} rounds`, {
  models: MODELS.map((m) => m.id),
});

render(<Game runs={runs} />);

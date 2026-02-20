import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./frontend.css";

// ── Types (mirrors game.ts) ─────────────────────────────────────────────────

type Model = { id: string; name: string };
type TaskInfo = { model: Model; startedAt: number; finishedAt?: number; result?: string; error?: string };
type VoteInfo = { voter: Model; startedAt: number; finishedAt?: number; votedFor?: Model; error?: boolean };
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
type GameState = { completed: RoundState[]; active: RoundState | null; scores: Record<string, number>; done: boolean };
type ServerMessage = { type: "state"; data: GameState; totalRounds: number };

// ── Model Assets & Colors ───────────────────────────────────────────────────

const MODEL_COLORS: Record<string, string> = {
  "Gemini 3.1 Pro": "#4285F4",
  "Kimi K2": "#00E599",
  "DeepSeek 3.2": "#4D6BFE",
  "GLM-5": "#1F63EC",
  "GPT-5.2": "#10A37F",
  "Opus 4.6": "#D97757",
  "Sonnet 4.6": "#D97757",
  "Grok 4.1": "#FFFFFF",
};

function getColor(name: string): string {
  return MODEL_COLORS[name] ?? "#A1A1A1";
}

function getLogo(name: string): string | null {
  if (name.includes("Gemini")) return "/assets/logos/gemini.svg";
  if (name.includes("Kimi")) return "/assets/logos/kimi.svg";
  if (name.includes("DeepSeek")) return "/assets/logos/deepseek.svg";
  if (name.includes("GLM")) return "/assets/logos/glm.svg";
  if (name.includes("GPT")) return "/assets/logos/openai.svg";
  if (name.includes("Opus") || name.includes("Sonnet")) return "/assets/logos/claude.svg";
  if (name.includes("Grok")) return "/assets/logos/grok.svg";
  return null;
}

// ── Components ──────────────────────────────────────────────────────────────

function Timer({ startedAt, finishedAt }: { startedAt: number; finishedAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (finishedAt) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [finishedAt]);
  const elapsed = ((finishedAt ?? now) - startedAt) / 1000;
  return <span className="timer">{elapsed.toFixed(1)}s</span>;
}

function ModelName({ model, className = "", showLogo = true }: { model: Model; className?: string, showLogo?: boolean }) {
  const logo = getLogo(model.name);
  const color = getColor(model.name);
  return (
    <span className={`model-name ${className}`} style={{ color }}>
      {showLogo && logo && <img src={logo} alt="" className="model-logo" />}
      {model.name}
    </span>
  );
}

function PromptCard({ round }: { round: RoundState }) {
  if (round.phase === "prompting" && !round.prompt) {
    return (
      <div className="prompt-card prompt-card--loading">
        <div className="prompt-card__by">
          <ModelName model={round.prompter} /> is cooking up a prompt…
        </div>
        <div className="prompt-card__text prompt-card__text--loading">
          <span className="dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
      </div>
    );
  }

  if (round.promptTask.error) {
    return (
      <div className="prompt-card prompt-card--error">
        <div className="prompt-card__text" style={{ color: "#ef4444" }}>Prompt generation failed</div>
      </div>
    );
  }

  return (
    <div className="prompt-card">
      <div className="prompt-card__by">
        Prompted by <ModelName model={round.prompter} />
      </div>
      <div className="prompt-card__text">{round.prompt}</div>
    </div>
  );
}

function ContestantPanel({
  task,
  voteCount,
  totalVotes,
  isWinner,
  showVotes,
}: {
  task: TaskInfo;
  voteCount: number;
  totalVotes: number;
  isWinner: boolean;
  showVotes: boolean;
}) {
  const color = getColor(task.model.name);
  const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

  return (
    <div className={`contestant ${isWinner ? "contestant--winner" : ""}`} style={{ borderColor: color }}>
      <div className="contestant__header">
        <div className="contestant__name">
          <ModelName model={task.model} />
        </div>
        {isWinner && <div className="contestant__winner-badge">WINNER</div>}
      </div>
      
      <div className="contestant__answer">
        {!task.finishedAt ? (
          <span className="contestant__thinking">
            <span className="dots"><span>.</span><span>.</span><span>.</span></span>
          </span>
        ) : task.error ? (
          <span className="contestant__error">✗ {task.error}</span>
        ) : (
          <span className="contestant__text">&ldquo;{task.result}&rdquo;</span>
        )}
      </div>

      {showVotes && (
        <div className="contestant__votes">
          <div className="vote-bar">
            <div className="vote-bar__fill" style={{ width: `${pct}%`, background: color }} />
          </div>
          <div className="vote-bar__label">
            <span className="vote-bar__count" style={{ color }}>{voteCount}</span>
            <span className="vote-bar__pct">{pct}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function VoteTicker({ votes }: { votes: VoteInfo[] }) {
  const finishedVotes = votes.filter((v) => v.finishedAt);
  const pendingVotes = votes.filter((v) => !v.finishedAt);

  return (
    <div className="vote-ticker">
      <div className="vote-ticker__header">
        <span className="vote-ticker__title">JUDGES</span>
        <span className="vote-ticker__status">
          {finishedVotes.length} / {votes.length}
        </span>
      </div>
      <div className="vote-ticker__list">
        {finishedVotes.map((vote, i) => (
          <div key={`f-${i}`} className="vote-entry vote-entry--in">
            <ModelName model={vote.voter} showLogo={false} />
            <span className="vote-entry__arrow">→</span>
            {vote.error || !vote.votedFor ? (
              <span className="vote-entry__error">abstained</span>
            ) : (
              <ModelName model={vote.votedFor} showLogo={false} />
            )}
          </div>
        ))}
        {pendingVotes.map((vote, i) => (
          <div key={`p-${i}`} className="vote-entry vote-entry--pending">
            <ModelName model={vote.voter} showLogo={false} />
            <span className="vote-entry__pending">deliberating…</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Arena({ round, total }: { round: RoundState; total: number }) {
  const [contA, contB] = round.contestants;
  const showVotes = round.phase === "voting" || round.phase === "done";
  const isDone = round.phase === "done";

  let votesA = 0,
    votesB = 0;
  for (const v of round.votes) {
    if (v.votedFor?.name === contA.name) votesA++;
    else if (v.votedFor?.name === contB.name) votesB++;
  }
  const totalVotes = votesA + votesB;

  const phaseLabel =
    round.phase === "prompting"
      ? "✍️ WRITING PROMPT"
      : round.phase === "answering"
        ? "💭 ANSWERING"
        : round.phase === "voting"
          ? "🗳️ JUDGES VOTING"
          : "✅ ROUND COMPLETE";

  return (
    <div className="arena">
      <div className="arena__header-row">
        <div className="arena__round-badge">
          ROUND {round.num} <span className="arena__round-of">/ {total}</span>
        </div>
        <div className="arena__phase">{phaseLabel}</div>
      </div>

      <PromptCard round={round} />

      {round.phase !== "prompting" && (
        <>
          <div className="showdown">
            <ContestantPanel
              task={round.answerTasks[0]}
              voteCount={votesA}
              totalVotes={totalVotes}
              isWinner={isDone && votesA > votesB}
              showVotes={showVotes}
            />
            <ContestantPanel
              task={round.answerTasks[1]}
              voteCount={votesB}
              totalVotes={totalVotes}
              isWinner={isDone && votesB > votesA}
              showVotes={showVotes}
            />
          </div>

          {showVotes && <VoteTicker votes={round.votes} />}

          {isDone && votesA === votesB && (
            <div className="round-result">IT&rsquo;S A TIE!</div>
          )}
        </>
      )}
    </div>
  );
}

function PastRoundEntry({ round }: { round: RoundState }) {
  const [contA, contB] = round.contestants;
  let votesA = 0,
    votesB = 0;
  for (const v of round.votes) {
    if (v.votedFor?.name === contA.name) votesA++;
    else if (v.votedFor?.name === contB.name) votesB++;
  }

  const isAWinner = votesA > votesB;
  const isBWinner = votesB > votesA;

  return (
    <div className="past-round">
      <div className="past-round__header">
        <span className="past-round__num">R{round.num}</span>
        <span className="past-round__prompt">{round.prompt}</span>
      </div>
      <div className="past-round__detail">
        <div className={`past-round__competitor ${isAWinner ? 'past-round__competitor--winner' : ''}`}>
          <div className="past-round__competitor-header">
            <ModelName model={contA} />
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span className="past-round__score">{votesA}</span>
              {isAWinner && <span className="past-round__winner-tag">WINNER</span>}
            </div>
          </div>
          <span className="past-round__answer">&ldquo;{round.answerTasks[0].result}&rdquo;</span>
        </div>
        <div className={`past-round__competitor ${isBWinner ? 'past-round__competitor--winner' : ''}`}>
          <div className="past-round__competitor-header">
            <ModelName model={contB} />
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span className="past-round__score">{votesB}</span>
              {isBWinner && <span className="past-round__winner-tag">WINNER</span>}
            </div>
          </div>
          <span className="past-round__answer">&ldquo;{round.answerTasks[1].result}&rdquo;</span>
        </div>
      </div>
    </div>
  );
}

function GameOver({ scores }: { scores: Record<string, number> }) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const champion = sorted[0];

  return (
    <div className="game-over">
      <div className="game-over__title">GAME OVER</div>
      {champion && champion[1] > 0 && (
        <div className="game-over__champion">
          <div className="game-over__crown">👑</div>
          <div className="game-over__name" style={{ color: getColor(champion[0]) }}>
            {getLogo(champion[0]) && <img src={getLogo(champion[0])!} alt="" />}
            {champion[0]}
          </div>
          <div className="game-over__subtitle">is the funniest AI!</div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ scores, activeRound }: { scores: Record<string, number>; activeRound: RoundState | null }) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const maxScore = sorted[0]?.[1] || 1;

  const competing = activeRound
    ? new Set([activeRound.contestants[0].name, activeRound.contestants[1].name])
    : new Set<string>();
  const judging = activeRound ? new Set(activeRound.votes.map((v) => v.voter.name)) : new Set<string>();
  const prompting = activeRound?.prompter.name ?? null;

  return (
    <aside className="sidebar">
      <div className="sidebar__header">STANDINGS</div>
      <div className="sidebar__list">
        {sorted.map(([name, score], i) => {
          const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
          const color = getColor(name);
          const isActive = competing.has(name);
          const isJudging = judging.has(name);
          const isPrompting = name === prompting;

          let role = "";
          if (isActive) role = "⚔️";
          else if (isPrompting) role = "✍️";
          else if (isJudging) role = "🗳️";

          return (
            <div key={name} className={`standing ${isActive ? "standing--active" : ""}`}>
              <div className="standing__rank">{i === 0 && score > 0 ? "👑" : `${i + 1}.`}</div>
              <div className="standing__info">
                <div className="standing__name-row">
                  <ModelName model={{id: name, name}} />
                  {role && <span className="standing__role">{role}</span>}
                </div>
                <div className="standing__bar-row">
                  <div className="standing__bar">
                    <div className="standing__bar-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <span className="standing__score">{score}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {activeRound && (
        <div className="sidebar__legend">
          <span>⚔️ COMPETING</span>
          <span>✍️ PROMPTING</span>
          <span>🗳️ JUDGING</span>
        </div>
      )}
    </aside>
  );
}

function ConnectingScreen() {
  return (
    <div className="connecting">
      <div className="connecting__logo">QUIPSLOP</div>
      <div className="connecting__text">Connecting<span className="dots"><span>.</span><span>.</span><span>.</span></span></div>
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [totalRounds, setTotalRounds] = useState(5);
  const [connected, setConnected] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/ws`;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onmessage = (e) => {
        const msg: ServerMessage = JSON.parse(e.data);
        if (msg.type === "state") {
          setState(msg.data);
          setTotalRounds(msg.totalRounds);
        }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (mainRef.current) {
      // Don't auto-scroll aggressively if they are just reading past rounds
      // but maybe scroll to top of arena when round changes?
      // Leaving this simple for now.
    }
  }, [state?.active?.num]);

  if (!connected || !state) {
    return <ConnectingScreen />;
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__logo">QUIPSLOP</h1>
        <p className="header__tagline">AI vs AI Comedy Showdown</p>
      </header>

      <div className="layout">
        <main className="main" ref={mainRef}>
          {state.active && <Arena round={state.active} total={totalRounds} />}

          {!state.active && !state.done && state.completed.length > 0 && (
            <div className="arena-waiting">
              Next round starting<span className="dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          )}

          {!state.active && !state.done && state.completed.length === 0 && (
            <div className="arena-waiting">
              Game starting<span className="dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          )}

          {state.done && <GameOver scores={state.scores} />}

          {state.completed.length > 0 && (
            <div className="history">
              <div className="history__title">PAST ROUNDS</div>
              {[...state.completed].reverse().map((round) => (
                <PastRoundEntry key={round.num} round={round} />
              ))}
            </div>
          )}
        </main>

        <Sidebar scores={state.scores} activeRound={state.active} />
      </div>
    </div>
  );
}

// ── Mount ───────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

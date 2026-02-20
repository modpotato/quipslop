import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./frontend.css";

// ── Types (mirrors game.ts) ─────────────────────────────────────────────────

type Model = { id: string; name: string };

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

type ServerMessage = {
  type: "state";
  data: GameState;
  totalRounds: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function modelClass(name: string): string {
  return "model-" + name.toLowerCase().replace(/[\s.]+/g, "-");
}

function barClass(name: string): string {
  return "bar-" + name.toLowerCase().replace(/[\s.]+/g, "-");
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
  return <span className="timer">({elapsed.toFixed(1)}s)</span>;
}

function MName({ model }: { model: Model }) {
  return <span className={`bold ${modelClass(model.name)}`}>{model.name}</span>;
}

function RoundView({ round, total }: { round: RoundState; total: number }) {
  const [contA, contB] = round.contestants;

  return (
    <div className="round">
      <span className="round-header">ROUND {round.num}/{total}</span>
      <div className="divider">{"─".repeat(50)}</div>

      {/* Prompt */}
      <div className="phase">
        <div className="phase-row">
          <span className="badge badge-prompt">PROMPT</span>
          <MName model={round.prompter} />
          {!round.prompt && !round.promptTask.error && (
            <span className="spinner">writing a prompt...</span>
          )}
          <Timer startedAt={round.promptTask.startedAt} finishedAt={round.promptTask.finishedAt} />
        </div>
        {round.promptTask.error && (
          <div className="phase-row"><span className="error">✗ {round.promptTask.error}</span></div>
        )}
        {round.prompt && (
          <div className="prompt-text">"{round.prompt}"</div>
        )}
      </div>

      {/* Answers */}
      {round.phase !== "prompting" && (
        <div className="phase">
          <span className="badge badge-answers">ANSWERS</span>
          {round.answerTasks.map((task, i) => (
            <div key={i} className="phase-row">
              <MName model={task.model} />
              {!task.finishedAt ? (
                <span className="spinner">thinking...</span>
              ) : task.error ? (
                <span className="error">✗ {task.error}</span>
              ) : (
                <span className="answer-text">"{task.result}"</span>
              )}
              {task.startedAt > 0 && (
                <Timer startedAt={task.startedAt} finishedAt={task.finishedAt} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Votes */}
      {(round.phase === "voting" || round.phase === "done") && (
        <div className="phase">
          <span className="badge badge-votes">VOTES</span>
          {round.votes.map((vote, i) => (
            <div key={i} className="phase-row">
              <MName model={vote.voter} />
              {!vote.finishedAt ? (
                <span className="spinner">voting...</span>
              ) : vote.error || !vote.votedFor ? (
                <span className="error">✗ failed</span>
              ) : (
                <span><span className="vote-arrow">→ </span><MName model={vote.votedFor} /></span>
              )}
              <Timer startedAt={vote.startedAt} finishedAt={vote.finishedAt} />
            </div>
          ))}
        </div>
      )}

      {/* Round result */}
      {round.phase === "done" && round.scoreA !== undefined && round.scoreB !== undefined && (
        <div className="round-result">
          <div>
            {round.scoreA > round.scoreB ? (
              <span className="result-winner">
                <MName model={contA} /> wins! ({round.scoreA / 100} vs {round.scoreB / 100} votes)
              </span>
            ) : round.scoreB > round.scoreA ? (
              <span className="result-winner">
                <MName model={contB} /> wins! ({round.scoreB / 100} vs {round.scoreA / 100} votes)
              </span>
            ) : (
              <span className="result-winner">TIE! ({round.scoreA / 100} - {round.scoreB / 100})</span>
            )}
          </div>
          <div className="result-detail">
            <MName model={contA} /> <span className="dim">+{round.scoreA}</span>
            {" | "}
            <MName model={contB} /> <span className="dim">+{round.scoreB}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Scoreboard({ scores }: { scores: Record<string, number> }) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const maxScore = sorted[0]?.[1] || 1;
  const medals = ["👑", "🥈", "🥉"];

  return (
    <div className="scoreboard">
      <span className="scoreboard-title">FINAL SCORES</span>
      {sorted.map(([name, score], i) => {
        const pct = Math.round((score / maxScore) * 100);
        return (
          <div key={name} className="score-row">
            <span className="score-rank">{i + 1}.</span>
            <span className={`score-name ${modelClass(name)}`}>{name}</span>
            <div className="score-bar-track">
              <div className={`score-bar-fill ${barClass(name)}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="score-value">{score}</span>
            {i < 3 && <span className="score-medal">{medals[i]}</span>}
          </div>
        );
      })}
      {sorted[0] && sorted[0][1] > 0 && (
        <div className="winner-banner">
          🏆 <span className={`bold ${modelClass(sorted[0][0])}`}>{sorted[0][0]}</span>
          <span className="bold"> is the funniest AI!</span>
        </div>
      )}
    </div>
  );
}

function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [totalRounds, setTotalRounds] = useState(5);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state]);

  if (!connected || !state) {
    return (
      <div className="connecting">
        <span className="connecting-dot">●</span> Connecting to Quipslop...
      </div>
    );
  }

  return (
    <div>
      <div className="header">
        <span className="header-title">QUIPSLOP</span>
        <div className="header-sub">AI vs AI comedy showdown — {totalRounds} rounds</div>
      </div>

      {state.completed.map((round) => (
        <RoundView key={round.num} round={round} total={totalRounds} />
      ))}

      {state.active && <RoundView round={state.active} total={totalRounds} />}

      {state.done && <Scoreboard scores={state.scores} />}

      <div ref={bottomRef} />
    </div>
  );
}

// ── Mount ───────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

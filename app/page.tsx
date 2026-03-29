"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Screen = "home" | "vote";

interface RoomState {
  code: string;
  token: string;
  eventName: string;
  threshold: number;
  cooldown: number;
}

interface Results {
  total_votes: number;
  stay_count: number;
  leave_count: number;
  leave_percent: number;
  verdict: string;
  decision_reached: boolean;
  reasons: { reason: string; count: number }[];
}

const REASON_LABELS: Record<string, string> = {
  too_loud:    "🔊 Too loud",
  not_my_vibe: "😐 Not my vibe",
  tired:       "😴 Tired",
  too_late:    "🕐 Too late",
  other:       "💬 Other",
};

// ── API helper ────────────────────────────────────────────────────────────────

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.detail || "Something went wrong"), { status: res.status });
  return data as T;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [screen, setScreen]           = useState<Screen>("home");
  const [room, setRoom]               = useState<RoomState | null>(null);
  const [results, setResults]         = useState<Results | null>(null);
  const [memberCount, setMemberCount] = useState(0);

  // Home form
  const [eventName, setEventName]   = useState("");
  const [email, setEmail]           = useState("");
  const [threshold, setThreshold]   = useState(51);
  const [cooldownMin, setCooldownMin] = useState(0);
  const [joinCode, setJoinCode]     = useState("");
  const [homeError, setHomeError]   = useState("");
  const [joinError, setJoinError]   = useState("");

  // Vote state
  const [currentVote, setCurrentVote]       = useState<"stay" | "leave" | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [showReasons, setShowReasons]       = useState(false);
  const [cooldownUntil, setCooldownUntil]   = useState<string | null>(null);
  const [cooldownMsg, setCooldownMsg]       = useState("");
  const [copied, setCopied]                 = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-join from ?join= URL param
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("join");
    if (code) {
      setJoinCode(code.toUpperCase());
      handleJoin(code.toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────

  const fetchResults = useCallback(async (code: string) => {
    try {
      const [r, roomInfo] = await Promise.all([
        api<Results>("GET", `/rooms/${code}/results`),
        api<{ member_count: number }>("GET", `/rooms/${code}`),
      ]);
      setResults(r);
      setMemberCount(roomInfo.member_count);
    } catch { /* silently ignore poll errors */ }
  }, []);

  const startPolling = useCallback((code: string) => {
    fetchResults(code);
    pollRef.current = setInterval(() => fetchResults(code), 3000);
  }, [fetchResults]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Enter room ─────────────────────────────────────────────────────────────

  const enterRoom = useCallback((joined: {
    code: string; event_name: string; member_token: string;
    leave_threshold: number; vote_cooldown: number;
  }) => {
    setRoom({
      code: joined.code, token: joined.member_token,
      eventName: joined.event_name,
      threshold: joined.leave_threshold, cooldown: joined.vote_cooldown,
    });
    setScreen("vote");
    startPolling(joined.code);
  }, [startPolling]);

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate() {
    setHomeError("");
    if (!eventName.trim()) return setHomeError("Enter an event name first");
    if (threshold < 1 || threshold > 100) return setHomeError("Threshold must be between 1 and 100");
    if (cooldownMin < 0 || cooldownMin > 60) return setHomeError("Cooldown must be between 0 and 60 minutes");
    try {
      const created = await api<{ code: string }>("POST", "/rooms", {
        event_name: eventName.trim(),
        creator_email: email.trim() || null,
        leave_threshold: threshold,
        vote_cooldown: cooldownMin,
      });
      const joined = await api<{
        code: string; event_name: string; member_token: string;
        leave_threshold: number; vote_cooldown: number;
      }>("POST", `/rooms/${created.code}/join`);
      enterRoom(joined);
    } catch (e: unknown) {
      setHomeError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  // ── Join ──────────────────────────────────────────────────────────────────

  async function handleJoin(code?: string) {
    setJoinError("");
    const c = (code ?? joinCode).toUpperCase();
    if (c.length !== 6) return setJoinError("Room codes are 6 letters");
    try {
      const joined = await api<{
        code: string; event_name: string; member_token: string;
        leave_threshold: number; vote_cooldown: number;
      }>("POST", `/rooms/${c}/join`);
      enterRoom(joined);
    } catch (e: unknown) {
      setJoinError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  // ── Vote ──────────────────────────────────────────────────────────────────

  async function castVote(choice: "stay" | "leave", reason?: string) {
    if (!room) return;
    if (cooldownUntil && new Date() < new Date(cooldownUntil)) {
      const mins = Math.ceil((new Date(cooldownUntil).getTime() - Date.now()) / 60000);
      setCooldownMsg(`Cooldown active — try again in ~${mins} min`);
      return;
    }
    setCooldownMsg("");
    try {
      const res = await api<{ cooldown_until?: string }>("POST", `/rooms/${room.code}/vote`, {
        member_token: room.token, choice, reason: reason ?? null,
      });
      setCurrentVote(choice);
      setCooldownUntil(res.cooldown_until ?? null);
      setShowReasons(false);
      setSelectedReason(null);
      fetchResults(room.code);
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      if (err.status === 429) setCooldownMsg(err.message ?? "Cooldown active");
    }
  }

  function selectReason(reason: string) {
    setSelectedReason(reason);
    castVote("leave", reason);
  }

  // ── Go home ───────────────────────────────────────────────────────────────

  function goHome() {
    stopPolling();
    setRoom(null); setResults(null); setMemberCount(0);
    setCurrentVote(null); setSelectedReason(null);
    setShowReasons(false); setCooldownUntil(null); setCooldownMsg("");
    setEventName(""); setJoinCode(""); setEmail("");
    setHomeError(""); setJoinError("");
    setScreen("home");
  }

  async function copyShareUrl() {
    if (!room) return;
    await navigator.clipboard.writeText(`${window.location.origin}?join=${room.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function verdictClass(verdict: string) {
    if (verdict.includes("LEAVE")) return "leave";
    if (verdict.includes("STAY"))  return "stay";
    if (verdict.includes("tie"))   return "tie";
    return "";
  }

  const total    = results?.total_votes ?? 0;
  const stayPct  = total ? (results!.stay_count  / total) * 100 : 0;
  const leavePct = total ? (results!.leave_count / total) * 100 : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="wordmark">Sway<span className="wordmark-dot">.</span></div>
      <p className="tagline">Stay or leave? Let the group decide.</p>

      <div className="card">

        {/* ── Home ── */}
        {screen === "home" && (
          <div>
            <p className="section-label">Create a room</p>
            <input
              className="input"
              type="text"
              placeholder="Event name"
              maxLength={100}
              value={eventName}
              onChange={e => setEventName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
            />
            <input
              className="input"
              type="email"
              placeholder="Your email (optional)"
              style={{ fontSize: "0.875rem", marginBottom: 12 }}
              value={email}
              onChange={e => setEmail(e.target.value)}
            />

            <div className="settings-group">
              <div className="settings-row">
                <div>
                  <div className="settings-label">Decision threshold</div>
                  <div className="settings-sub">% of leave votes needed</div>
                </div>
                <div className="settings-control">
                  <input
                    type="number"
                    className="num-input"
                    min={1} max={100}
                    value={threshold}
                    onChange={e => setThreshold(Number(e.target.value))}
                  />
                  <span className="num-unit">%</span>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-label">Vote cooldown</div>
                  <div className="settings-sub">Minutes before changing vote</div>
                </div>
                <div className="settings-control">
                  <input
                    type="number"
                    className="num-input"
                    min={0} max={60}
                    value={cooldownMin}
                    onChange={e => setCooldownMin(Number(e.target.value))}
                  />
                  <span className="num-unit">min</span>
                </div>
              </div>
            </div>

            <button className="btn btn-primary" onClick={handleCreate}>
              Create room
            </button>
            {homeError && <div className="error-msg">{homeError}</div>}

            <div className="divider">or join one</div>

            <input
              className="input input-code"
              type="text"
              placeholder="XXXXXX"
              maxLength={6}
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handleJoin()}
            />
            <button className="btn btn-ghost" onClick={() => handleJoin()}>
              Join room
            </button>
            {joinError && <div className="error-msg">{joinError}</div>}
          </div>
        )}

        {/* ── Vote screen ── */}
        {screen === "vote" && room && (
          <div>
            <div className="room-header">
              <div className="room-code-badge">{room.code}</div>
              <div className="room-event-name">{room.eventName}</div>
            </div>

            <div className="share-row">
              <input
                className="share-input"
                type="text"
                readOnly
                value={typeof window !== "undefined" ? `${window.location.origin}?join=${room.code}` : ""}
                onClick={e => (e.target as HTMLInputElement).select()}
              />
              <button className="share-copy-btn" onClick={copyShareUrl}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>

            {cooldownMsg && (
              <div className="cooldown-notice">{cooldownMsg}</div>
            )}

            <div className="vote-grid">
              <button
                className={`vote-btn stay${currentVote === "stay" ? " selected" : ""}`}
                onClick={() => castVote("stay")}
              >
                <span className="vote-icon">🎵</span>
                <span className="vote-label">Stay</span>
              </button>
              <button
                className={`vote-btn leave${currentVote === "leave" ? " selected" : ""}`}
                onClick={() => setShowReasons(v => !v)}
              >
                <span className="vote-icon">🚪</span>
                <span className="vote-label">Leave</span>
              </button>
            </div>

            {showReasons && (
              <div className="reasons-section">
                <p className="section-label" style={{ marginBottom: 8 }}>Why do you want to leave?</p>
                <div className="reason-chips">
                  {Object.entries(REASON_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      className={`reason-chip${selectedReason === key ? " selected" : ""}`}
                      onClick={() => selectReason(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: "0.875rem", padding: "10px", marginTop: 0 }}
                  onClick={() => castVote("leave")}
                >
                  Leave anyway
                </button>
              </div>
            )}

            {results && (
              <>
                {results.decision_reached && (
                  <div style={{ textAlign: "center", marginBottom: 10 }}>
                    <span className={`decision-pill${results.verdict.includes("LEAVE") ? " leave" : ""}`}>
                      {results.verdict.includes("LEAVE") ? "Time to leave" : "Staying put"}
                    </span>
                  </div>
                )}

                <div className={`verdict-box${results.verdict ? ` ${verdictClass(results.verdict)}` : ""}`}>
                  <div className="verdict-text">{results.verdict}</div>
                </div>

                <p className="threshold-hint">
                  Decision at {room.threshold}% leave votes
                  {room.cooldown > 0 ? ` · ${room.cooldown}min cooldown` : ""}
                </p>

                <div className="bar-row">
                  <div className="bar-label">Stay</div>
                  <div className="bar-track">
                    <div className="bar-fill stay" style={{ width: `${stayPct}%` }} />
                  </div>
                  <div className="bar-count">{results.stay_count}</div>
                </div>
                <div className="bar-row">
                  <div className="bar-label">Leave</div>
                  <div className="bar-track">
                    <div className="bar-fill leave" style={{ width: `${leavePct}%` }} />
                  </div>
                  <div className="bar-count">{results.leave_count}</div>
                </div>

                {results.reasons.length > 0 && (
                  <div className="reasons-breakdown">
                    <p className="section-label" style={{ marginBottom: 10 }}>Why leaving</p>
                    {results.reasons.map(({ reason, count }) => (
                      <div key={reason} className="reason-bar-row">
                        <div className="reason-bar-label">
                          {REASON_LABELS[reason] ?? reason}
                        </div>
                        <div className="reason-bar-track">
                          <div
                            className="reason-bar-fill"
                            style={{ width: `${(count / results.reasons[0].count) * 100}%` }}
                          />
                        </div>
                        <div className="reason-bar-count">{count}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="meta-row">
                  {memberCount} {memberCount === 1 ? "person" : "people"} in room
                  {" · "}
                  {total} {total === 1 ? "vote" : "votes"}
                </div>
              </>
            )}

            <button className="btn btn-text" onClick={goHome}>Leave room</button>
          </div>
        )}

      </div>
    </>
  );
}

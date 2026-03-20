import { useState } from "react";
import type { AgentStep, SessionDetailPayload, SessionThreadSummary } from "../../src/types";
import type { SessionsData } from "../../src/ui/dashboardMessages";
import {
  actorBadgeClass,
  actorIcon,
  actorLabel,
  agentStepBadgeClass,
  formatDuration,
  formatPause,
  formatPhaseLabel,
  formatStepDetail,
} from "../dashboardUtils";

interface Props {
  data: SessionsData | null;
  loading: boolean;
  allSessionDetails: Map<string, SessionDetailPayload>;
  onLoad: () => void;
  onRequestSessionDetail: (sessionId: string) => void;
}

export function SessionsTab({ data, loading, allSessionDetails, onLoad, onRequestSessionDetail }: Props) {
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");

  if (!data) {
    return (
      <div id="db-tab-sessions" className="db-tab-pane active" role="tabpanel">
        <div className="db-lazy-placeholder">
          <p>Click to load Sessions data.</p>
          <button className="db-load-btn" disabled={loading} onClick={onLoad}>
            {loading ? (
              <>
                <span className="db-loading-spinner" />
                Loading…
              </>
            ) : (
              "📂 Load Sessions"
            )}
          </button>
        </div>
      </div>
    );
  }

  // Request details for sessions not yet loaded
  for (const session of data.sessionSummaries) {
    if (!allSessionDetails.has(session.sessionId)) {
      onRequestSessionDetail(session.sessionId);
      break; // Load one at a time
    }
  }

  // Flatten all threads from loaded session details
  const flat: Array<{ thread: SessionThreadSummary; sessionId: string }> = [];
  for (const [sessionId, detail] of allSessionDetails) {
    for (const thread of detail.threads.filter((t) => t.stepCount > 0)) {
      flat.push({ thread, sessionId });
    }
  }
  flat.sort((a, b) => Date.parse(b.thread.startedAt) - Date.parse(a.thread.startedAt));

  const isLoading = data.sessionSummaries.some((s) => !allSessionDetails.has(s.sessionId));

  function selectThread(threadId: string, sessionId: string) {
    setSelectedThreadId(threadId);
    setSelectedSessionId(sessionId);
  }

  const selectedDetail = selectedSessionId ? allSessionDetails.get(selectedSessionId) ?? null : null;

  return (
    <div id="db-tab-sessions" className="db-tab-pane active" role="tabpanel">
      <div className="db-session-layout">
        <section className="db-session-list">
          <ThreadList
            flat={flat}
            selectedThreadId={selectedThreadId}
            selectedSessionId={selectedSessionId}
            isLoading={isLoading}
            onSelect={selectThread}
          />
        </section>
        <section className="db-session-detail">
          <div className="db-session-detail-header">
            <h2 style={{ margin: 0 }}>Threads</h2>
          </div>
          <div className="db-session-detail-body">
            <ThreadDetail
              detail={selectedDetail}
              selectedThreadId={selectedThreadId}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function ThreadList({
  flat,
  selectedThreadId,
  selectedSessionId,
  isLoading,
  onSelect,
}: {
  flat: Array<{ thread: SessionThreadSummary; sessionId: string }>;
  selectedThreadId: string;
  selectedSessionId: string;
  isLoading: boolean;
  onSelect: (threadId: string, sessionId: string) => void;
}) {
  if (flat.length === 0) {
    return (
      <div className="db-empty-panel">
        {isLoading ? "Loading threads…" : "No threads with activity were detected."}
      </div>
    );
  }

  return (
    <div className="db-session-list-body">
      {flat.map(({ thread, sessionId }) => {
        const isActive = thread.threadId === selectedThreadId && sessionId === selectedSessionId;
        return (
          <button
            key={`${sessionId}-${thread.threadId}`}
            className={`db-thread-row${isActive ? " active" : ""}`}
            onClick={() => onSelect(thread.threadId, sessionId)}
          >
            <div className="db-thread-row-title">
              {thread.hasAutonomousRun ? "🤖 " : ""}
              {thread.title}
            </div>
            <div className="db-thread-row-subtext">
              {new Date(thread.startedAt).toLocaleString()}
            </div>
            <div className="db-thread-row-meta">
              <span>{thread.stepCount} steps</span>
              <span>{thread.estimatedMinutesSaved.toFixed(1)} min saved</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ThreadDetail({
  detail,
  selectedThreadId,
}: {
  detail: SessionDetailPayload | null;
  selectedThreadId: string;
}) {
  if (!selectedThreadId) {
    return <div className="db-empty-panel">Select a thread to inspect its timeline.</div>;
  }
  if (!detail) {
    return <div className="db-empty-panel">Loading thread detail…</div>;
  }

  const sortedThreads = [...detail.threads]
    .filter((t) => t.stepCount > 0)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const selectedThread =
    sortedThreads.find((t) => t.threadId === selectedThreadId) ?? sortedThreads[0] ?? null;

  if (!selectedThread) {
    return <div className="db-empty-panel">No thread detail with activity is available.</div>;
  }

  const steps: AgentStep[] = detail.stepsByThread[selectedThread.threadId] ?? [];
  const longestPause = steps.reduce((max, s) => Math.max(max, s.durationMs ?? 0), 0);

  return (
    <>
      <div className="db-thread-detail-header-block">
        <div>
          <strong>{selectedThread.title}</strong>
          <div style={{ marginTop: "4px", fontSize: "0.84em", opacity: 0.74 }}>
            {new Date(selectedThread.startedAt).toLocaleString()}
          </div>
        </div>
        <div className="db-thread-detail-metrics">
          <span className="db-thread-chip">{selectedThread.stepCount} steps</span>
          <span className="db-thread-chip">{selectedThread.estimatedMinutesSaved.toFixed(1)} min saved</span>
          {selectedThread.longestPauseMs > 0 && (
            <span className="db-thread-chip">Longest wait {formatPause(selectedThread.longestPauseMs)}</span>
          )}
          {selectedThread.hasAutonomousRun && (
            <span className="db-thread-chip autonomous">🤖 Autonomous</span>
          )}
        </div>
      </div>
      <div className="db-agent-step-timeline">
        {steps.length > 0 ? (
          steps.map((step, i) => <StepRow key={`${step.timestamp}-${i}`} step={step} longestPause={longestPause} />)
        ) : (
          <div className="db-empty-panel">No timeline signals were recorded for this thread.</div>
        )}
      </div>
    </>
  );
}

function StepRow({ step, longestPause }: { step: AgentStep; longestPause: number }) {
  const pause = step.durationMs ?? 0;
  const isLongest = pause > 0 && pause === longestPause;

  return (
    <div
      className={`db-agent-step-row${isLongest ? " longest-pause" : ""}${step.isSignificantPause ? " significant-pause" : ""}`}
    >
      <div className={`db-agent-step-body${step.isFallback ? " fallback" : ""}`}>
        <div className="db-agent-step-meta">
          <span>{new Date(step.timestamp).toLocaleString()}</span>
        </div>
        <div className="db-agent-step-chip-row">
          <span className={`db-agent-step-chip db-agent-step-chip-actor ${actorBadgeClass(step.actor)}`}>
            <span>{actorIcon(step.actor)}</span>
            <span>{actorLabel(step.actor)}</span>
          </span>
          <span className={`db-agent-step-badge ${agentStepBadgeClass(step.label)}`}>{step.label}</span>
          {step.durationMs !== undefined ? (
            <span
              className={`db-agent-step-chip db-agent-step-chip-duration${isLongest ? " longest" : ""}`}
            >
              ⏱ {formatPause(step.durationMs)}
            </span>
          ) : (
            <span className="db-agent-step-chip db-agent-step-chip-duration pending">Current</span>
          )}
        </div>
        <div className="db-agent-step-detail">{formatStepDetail(step.detail, step.label)}</div>
        <div className="db-agent-step-submeta">
          <span>{formatPhaseLabel(step.phase)}</span>
          <span>{step.rawIntent || "signal"}</span>
        </div>
        {isLongest && <div className="db-agent-step-duration-note">Longest wait</div>}
        {step.isSignificantPause && step.durationMs !== undefined && (
          <div className="db-agent-step-separator">(Significant Pause)</div>
        )}
      </div>
    </div>
  );
}

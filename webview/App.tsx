import { useEffect, useRef, useState } from "react";
import type { SessionDetailPayload } from "../src/types";
import type {
  DashboardPayload,
  HostToWebviewMessage,
  PromptInsightsData,
  SessionsData,
  WebviewToHostMessage,
} from "../src/ui/dashboardMessages";
import { FlowTab } from "./components/FlowTab";
import { HealthTab } from "./components/HealthTab";
import { OverviewTab } from "./components/OverviewTab";
import { PromptInsightsTab } from "./components/PromptInsightsTab";
import { SessionsTab } from "./components/SessionsTab";
import { TabBar } from "./components/TabBar";

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHostMessage): void;
  getState(): { currentTab?: string } | undefined;
  setState(state: { currentTab?: string }): void;
};

interface DashboardWindow extends Window {
  __dashboardData?: DashboardPayload;
}
declare const window: DashboardWindow;

const VALID_TABS = new Set(["overview", "health", "flow", "prompt-insights", "sessions"]);

export function App() {
  const vscodeRef = useRef(acquireVsCodeApi());
  const vscode = vscodeRef.current;

  const [payload, setPayload] = useState<DashboardPayload | null>(() => window.__dashboardData ?? null);
  const [currentTab, setCurrentTab] = useState<string>(() => {
    const saved = vscode.getState();
    if (saved?.currentTab && VALID_TABS.has(saved.currentTab)) {
      return saved.currentTab;
    }
    return "overview";
  });
  const [promptInsightsData, setPromptInsightsData] = useState<PromptInsightsData | null>(null);
  const [sessionsData, setSessionsData] = useState<SessionsData | null>(null);
  const [allSessionDetails, setAllSessionDetails] = useState<Map<string, SessionDetailPayload>>(new Map());
  const [promptInsightsPending, setPromptInsightsPending] = useState(false);
  const [sessionsPending, setSessionsPending] = useState(false);
  const [hasMoreData, setHasMoreData] = useState(false);
  const [historicalPending, setHistoricalPending] = useState(false);

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      if (msg.type === "dashboardData") {
        setPayload(msg.payload);
        setPromptInsightsData(null);
        setSessionsData(null);
        setAllSessionDetails(new Map());
        setPromptInsightsPending(false);
        setSessionsPending(false);
        setHasMoreData(msg.payload.hasMoreData);
        setHistoricalPending(false);
      } else if (msg.type === "tabData") {
        if (msg.tab === "promptInsights") {
          setPromptInsightsPending(false);
          setPromptInsightsData(msg.payload as PromptInsightsData);
        } else if (msg.tab === "sessions") {
          setSessionsPending(false);
          setSessionsData(msg.payload as SessionsData);
        }
      } else if (msg.type === "sessionDetailData") {
        if (msg.payload) {
          const detail = msg.payload;
          setAllSessionDetails((prev) => {
            const next = new Map(prev);
            next.set(detail.sessionId, detail);
            return next;
          });
        }
      }
      // exportComplete handled by child components
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  function switchTab(tabId: string) {
    setCurrentTab(tabId);
    vscode.setState({ currentTab: tabId });
  }

  function postMessage(msg: WebviewToHostMessage) {
    vscode.postMessage(msg);
  }

  function handleLoadPromptInsights() {
    if (promptInsightsPending || promptInsightsData) return;
    setPromptInsightsPending(true);
    postMessage({ type: "requestTabData", tab: "promptInsights" });
  }

  function handleLoadSessions() {
    if (sessionsPending || sessionsData) return;
    setSessionsPending(true);
    postMessage({ type: "requestTabData", tab: "sessions" });
  }

  function handleLoadHistorical() {
    if (historicalPending) return;
    setHistoricalPending(true);
    postMessage({ type: "loadMoreData" });
  }

  function handleRequestSessionDetail(sessionId: string) {
    postMessage({ type: "requestSessionDetail", payload: { sessionId } });
  }

  if (!payload) {
    return <div style={{ padding: "20px", opacity: 0.7 }}>Loading dashboard…</div>;
  }

  return (
    <>
      <h1>🤖 GitHub Copilot Usage Dashboard</h1>
      <TabBar currentTab={currentTab} onTabChange={switchTab} />
      {currentTab === "overview" && <OverviewTab payload={payload} postMessage={postMessage} />}
      {currentTab === "health" && (
        <HealthTab
          payload={payload}
          hasMoreData={hasMoreData}
          historicalPending={historicalPending}
          onLoadHistorical={handleLoadHistorical}
          postMessage={postMessage}
        />
      )}
      {currentTab === "flow" && <FlowTab payload={payload} />}
      {currentTab === "prompt-insights" && (
        <PromptInsightsTab data={promptInsightsData} loading={promptInsightsPending} onLoad={handleLoadPromptInsights} />
      )}
      {currentTab === "sessions" && (
        <SessionsTab
          data={sessionsData}
          loading={sessionsPending}
          allSessionDetails={allSessionDetails}
          onLoad={handleLoadSessions}
          onRequestSessionDetail={handleRequestSessionDetail}
        />
      )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionDetailPayload } from "../../src/types";
import type {
  DashboardPayload,
  HostToWebviewMessage,
  PromptInsightsData,
  SessionsData,
  WebviewToHostMessage,
} from "../../src/ui/dashboardMessages";

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

export interface DashboardHook {
  payload: DashboardPayload | null;
  currentTab: string;
  promptInsightsData: PromptInsightsData | null;
  sessionsData: SessionsData | null;
  allSessionDetails: Map<string, SessionDetailPayload>;
  promptInsightsPending: boolean;
  sessionsPending: boolean;
  hasMoreData: boolean;
  historicalPending: boolean;
  switchTab: (tabId: string) => void;
  postMessage: (msg: WebviewToHostMessage) => void;
  handleLoadPromptInsights: () => void;
  handleLoadSessions: () => void;
  handleLoadHistorical: () => void;
  handleRequestSessionDetail: (sessionId: string) => void;
}

export function useDashboard(): DashboardHook {
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

  const switchTab = useCallback((tabId: string) => {
    setCurrentTab(tabId);
    vscode.setState({ currentTab: tabId });
  }, []);

  const postMessage = useCallback((msg: WebviewToHostMessage) => {
    vscode.postMessage(msg);
  }, []);

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

  const handleRequestSessionDetail = useCallback(
    (sessionId: string) => {
      postMessage({ type: "requestSessionDetail", payload: { sessionId } });
    },
    [postMessage],
  );

  return {
    payload,
    currentTab,
    promptInsightsData,
    sessionsData,
    allSessionDetails,
    promptInsightsPending,
    sessionsPending,
    hasMoreData,
    historicalPending,
    switchTab,
    postMessage,
    handleLoadPromptInsights,
    handleLoadSessions,
    handleLoadHistorical,
    handleRequestSessionDetail,
  };
}

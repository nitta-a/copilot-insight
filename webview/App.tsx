import { FlowTab } from "./components/FlowTab";
import { HealthTab } from "./components/HealthTab";
import { OverviewTab } from "./components/OverviewTab";
import { PromptInsightsTab } from "./components/PromptInsightsTab";
import { SessionsTab } from "./components/SessionsTab";
import { TabBar } from "./components/TabBar";
import { useDashboard } from "./hooks/useDashboard";

export function App() {
  const {
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
  } = useDashboard();

  if (!payload) {
    return <div style={{ padding: "20px", opacity: 0.7 }}>Loading dashboard…</div>;
  }

  return (
    <>
      <h1>🤖 GitHub Copilot Usage Dashboard</h1>
      <TabBar currentTab={currentTab} onTabChange={switchTab} />
      {/* key={currentTab} forces React to fully unmount/remount the content subtree
          on every tab change, ensuring Chart.js canvas elements start fresh and
          are not left in a stale painting state by VS Code WebView's repaint cycle. */}
      <div key={currentTab}>
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
      </div>
    </>
  );
}

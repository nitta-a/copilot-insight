interface Props {
  currentTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  { id: "overview", label: "📊 Overview (ROI)" },
  { id: "health", label: "🔍 Health (Diagnostics)" },
  { id: "flow", label: "🌊 Flow (Velocity)" },
  { id: "prompt-insights", label: "💬 Prompt Insights" },
  { id: "sessions", label: "📂 Sessions" },
];

export function TabBar({ currentTab, onTabChange }: Props) {
  return (
    <div className="db-tabs" role="tablist">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          className={`db-tab-btn${currentTab === id ? " active" : ""}`}
          data-tab={id}
          role="tab"
          aria-selected={currentTab === id}
          onClick={() => onTabChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

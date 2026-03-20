import type { PromptInsightsData } from "../../src/ui/dashboardMessages";
import { BubbleChart } from "./charts/BubbleChart";
import { DonutChart } from "./charts/DonutChart";
import { TurnContextCharts } from "./TurnContextCharts";

interface Props {
  data: PromptInsightsData | null;
  loading: boolean;
  onLoad: () => void;
}

export function PromptInsightsTab({ data, loading, onLoad }: Props) {
  if (!data) {
    return (
      <div id="db-tab-prompt-insights" className="db-tab-pane active" role="tabpanel">
        <div className="db-lazy-placeholder">
          <p>Click to load Prompt Insights data.</p>
          <button className="db-load-btn" disabled={loading} onClick={onLoad}>
            {loading ? (
              <>
                <span className="db-loading-spinner" />
                Loading…
              </>
            ) : (
              "📊 Load Prompt Insights"
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="db-tab-prompt-insights" className="db-tab-pane active" role="tabpanel">
      <TagCloud topKeywords={data.topKeywords} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "24px",
          marginTop: "16px",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 600 }}>Intent Breakdown</h3>
          <DonutChart entries={data.chatIntentBreakdown} title="intents" canvasId="db-intent-donut" />
          {data.chatIntentBreakdown.length === 0 && (
            <p className="no-data">No intent data available.</p>
          )}
        </div>
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 600 }}>
            Command &amp; Participant Usage
          </h3>
          <DonutChart entries={data.commandUsageBreakdown} title="commands" canvasId="db-command-donut" />
          {data.commandUsageBreakdown.length === 0 && (
            <p className="no-data" style={{ fontSize: "12px", opacity: 0.7 }}>
              No slash command or @participant data detected in logs.
            </p>
          )}
        </div>
        {data.promptLengthScatterData.length > 0 && (
          <div>
            <h3 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 600 }}>
              Prompt Length vs Acceptance Rate
            </h3>
            <BubbleChart
              data={data.promptLengthScatterData}
              xLabel="Prompt Length (chars)"
              yLabel="Acceptance Rate (%)"
            />
          </div>
        )}
      </div>
      <TurnContextCharts turnStats={data.turnStats} contextStats={data.contextStats} />
    </div>
  );
}

function TagCloud({ topKeywords }: { topKeywords: PromptInsightsData["topKeywords"] }) {
  if (topKeywords.length === 0) return null;

  const counts = topKeywords.map((k) => k.count);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  const range = maxCount - minCount || 1;
  const MinEm = 0.85;
  const MaxEm = 2.2;
  const MinOpacity = 0.55;
  const MaxOpacity = 1.0;

  return (
    <>
      <h2>🔍 Top Keywords</h2>
      <div className="tag-cloud">
        {topKeywords.map(({ word, count }) => {
          const ratio = (count - minCount) / range;
          const size = (MinEm + ratio * (MaxEm - MinEm)).toFixed(2);
          const opacity = (MinOpacity + ratio * (MaxOpacity - MinOpacity)).toFixed(2);
          return (
            <span
              key={word}
              className="tag-cloud-item"
              style={{ fontSize: `${size}em`, opacity: Number(opacity) }}
              title={`${word} (${count})`}
            >
              {word}
            </span>
          );
        })}
      </div>
    </>
  );
}

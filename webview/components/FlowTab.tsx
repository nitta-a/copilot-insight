import type { DashboardPayload } from "../../src/ui/dashboardMessages";
import { ModelAutonomyLeverageMap } from "../charts/ModelAutonomyLeverageMap";

interface Props {
  payload: DashboardPayload;
}

export function FlowTab({ payload }: Props) {
  const { agenticStats } = payload;
  const hasAgenticData = agenticStats.agentIntelligenceOverview.autonomousRatioByModel.length > 0;

  return (
    <div id="db-tab-flow" className="db-tab-pane active" role="tabpanel">
      {hasAgenticData ? (
        <ModelAutonomyLeverageMap data={agenticStats.agentIntelligenceOverview.autonomousRatioByModel} />
      ) : (
        <p className="no-data">No agentic flow data detected in the current period.</p>
      )}
    </div>
  );
}

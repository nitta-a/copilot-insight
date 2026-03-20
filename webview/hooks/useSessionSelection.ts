import { useEffect, useState } from "react";
import type { SessionDetailPayload } from "../../src/types";
import type { SessionsData } from "../../src/ui/dashboardMessages";

interface UseSessionSelectionOptions {
  data: SessionsData | null;
  allSessionDetails: Map<string, SessionDetailPayload>;
  onRequestSessionDetail: (sessionId: string) => void;
}

export interface SessionSelectionHook {
  selectedThreadId: string;
  selectedSessionId: string;
  selectThread: (threadId: string, sessionId: string) => void;
  selectedDetail: SessionDetailPayload | null;
}

export function useSessionSelection({
  data,
  allSessionDetails,
  onRequestSessionDetail,
}: UseSessionSelectionOptions): SessionSelectionHook {
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");

  // Request session details one at a time as they become available.
  // Using useEffect prevents duplicate requests across renders.
  useEffect(() => {
    if (!data) return;
    for (const session of data.sessionSummaries) {
      if (!allSessionDetails.has(session.sessionId)) {
        onRequestSessionDetail(session.sessionId);
        break; // Load one at a time; next fires when this one resolves
      }
    }
  }, [data, allSessionDetails, onRequestSessionDetail]);

  function selectThread(threadId: string, sessionId: string) {
    setSelectedThreadId(threadId);
    setSelectedSessionId(sessionId);
  }

  const selectedDetail = selectedSessionId ? (allSessionDetails.get(selectedSessionId) ?? null) : null;

  return {
    selectedThreadId,
    selectedSessionId,
    selectThread,
    selectedDetail,
  };
}

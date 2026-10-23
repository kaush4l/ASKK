import { Suspense } from "react";

import { AgentPage } from "@/components/agents/agent-page";

export const metadata = { title: "Debug · ASKK" };

// ?name=<agent> is read in the browser (static export): Suspense keeps the build from waiting on it.
export default function Page() {
  return (
    <Suspense>
      <AgentPage />
    </Suspense>
  );
}

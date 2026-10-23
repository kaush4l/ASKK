import { Suspense } from "react";

import { WorkflowPage } from "@/components/workflow/workflow-page";

export const metadata = { title: "Workflows · ASKK" };

// ?id=<workflow artifact>&stage=<stage> are read in the browser (static export): Suspense keeps the build from waiting on them.
export default function Page() {
  return (
    <Suspense>
      <WorkflowPage />
    </Suspense>
  );
}

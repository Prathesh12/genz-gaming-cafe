"use client";

import { useEffect } from "react";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Detail stays on the server log; staff see a plain message.
    console.error("[genz] Page error:", error);
  }, [error]);

  return (
    <ErrorState
      title="This screen could not load"
      description="Nothing was saved or charged. Try again — if it keeps happening, check that the database is reachable."
      action={
        <Button onClick={reset}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
      }
      className="mt-10"
    />
  );
}

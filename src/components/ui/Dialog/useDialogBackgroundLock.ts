import { useLayoutEffect } from "react";
import { lockPageBackground } from "../../PageShell/lockPageBackground";

export function useDialogBackgroundLock(active: boolean) {
  useLayoutEffect(() => {
    if (active) return lockPageBackground();
  }, [active]);
}

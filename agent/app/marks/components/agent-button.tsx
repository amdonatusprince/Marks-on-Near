import { useSession } from "@agent-native/core/client/hooks";
import {
  getAgentSidebarState,
  SIDEBAR_STATE_CHANGE_EVENT,
  type AgentSidebarStateChangeDetail,
} from "@agent-native/core/client/agent-sidebar-state";
import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

/** Opens the agent beside the page, or sends a signed-out visitor to sign in and back. */
export function AgentButton() {
  const { status } = useSession();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // The return path needs window.location, which the server does not have.
  // Rendering it on the first paint makes Chrome throw the hydration away.
  const [href, setHref] = useState("/sign-in");

  useEffect(() => {
    setHref(
      buildSignInReturnHref({
        returnTo: location.pathname + location.search,
      }),
    );
  }, [location.pathname, location.search]);

  useEffect(() => {
    setOpen(getAgentSidebarState()?.open ?? false);
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<AgentSidebarStateChangeDetail>)
        .detail;
      if (typeof detail?.open === "boolean") setOpen(detail.open);
    };
    window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, onChange);
  }, []);

  if (status !== "authenticated") {
    return (
      <a
        className="btn-line min-h-10 px-3 py-2 text-sm"
        href={href}
        aria-disabled={status === "loading" ? true : undefined}
      >
        Agent
      </a>
    );
  }

  return (
    <button
      type="button"
      className="btn-line min-h-10 px-3 py-2 text-sm"
      aria-pressed={open}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("agent-panel:toggle", { detail: { focus: true } }),
        )
      }
    >
      Agent
    </button>
  );
}

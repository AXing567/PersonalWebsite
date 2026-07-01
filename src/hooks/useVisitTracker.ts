import { useEffect, useRef } from "react";

const HEARTBEAT_MS = 15000;
const KICKED_MESSAGE_KEY = "personal-site-kicked-message";
const KICKED_SUPPRESSION_MS = 30 * 60 * 1000;
const KICKED_UNTIL_KEY = "personal-site-kicked-until";

const createVisitId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const sendVisitEvent = (payload: Record<string, unknown>, options: { useBeacon?: boolean } = {}) => {
  const body = JSON.stringify(payload);

  if (options.useBeacon && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/visit-track", blob)) return;
  }

  return fetch("/api/visit-track", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    keepalive: true,
  }).catch(() => undefined);
};

const getKickedUntil = () => {
  const value = window.localStorage.getItem(KICKED_UNTIL_KEY);
  const kickedUntil = value ? Number(value) : 0;
  return Number.isFinite(kickedUntil) ? kickedUntil : 0;
};

const isTrackingSuppressed = () => getKickedUntil() > Date.now();

export const useVisitTracker = (route: string) => {
  const visitRef = useRef({
    id: createVisitId(),
    route,
    startedAt: Date.now(),
  });
  const isKickedRef = useRef(false);

  useEffect(() => {
    if (isTrackingSuppressed()) {
      if (route !== "/") {
        window.location.hash = "#/";
      }
      return undefined;
    }

    const visit = {
      id: createVisitId(),
      route,
      startedAt: Date.now(),
    };
    visitRef.current = visit;
    isKickedRef.current = false;

    const payload = {
      event: "heartbeat",
      id: visit.id,
      page: route,
      referrer: document.referrer,
      startedAt: visit.startedAt,
    };
    const handleVisitResponse = async (response: Response | void) => {
      if (!response || isKickedRef.current) return;

      try {
        const data = (await response.json()) as { kicked?: boolean; message?: string };
        if (!data.kicked) return;

        isKickedRef.current = true;
        window.sessionStorage.setItem(KICKED_MESSAGE_KEY, data.message || "当前访问会话已被管理员结束。");
        window.localStorage.setItem(KICKED_UNTIL_KEY, String(Date.now() + KICKED_SUPPRESSION_MS));
        if (window.location.hash !== "#/") {
          window.location.hash = "#/";
        }
      } catch {
        // Visit tracking must stay invisible to normal browsing.
      }
    };

    void sendVisitEvent(payload)?.then(handleVisitResponse);

    const intervalId = window.setInterval(() => {
      if (isKickedRef.current) {
        window.clearInterval(intervalId);
        return;
      }

      void sendVisitEvent({
        ...payload,
        event: "heartbeat",
      })?.then(handleVisitResponse);
    }, HEARTBEAT_MS);

    return () => {
      window.clearInterval(intervalId);
      if (isKickedRef.current) return;
      sendVisitEvent({
        ...payload,
        event: "end",
      }, { useBeacon: true });
    };
  }, [route]);

  useEffect(() => {
    const handlePageHide = () => {
      if (isKickedRef.current) return;
      const visit = visitRef.current;
      sendVisitEvent({
        event: "end",
        id: visit.id,
        page: visit.route,
        referrer: document.referrer,
        startedAt: visit.startedAt,
      }, { useBeacon: true });
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);
};

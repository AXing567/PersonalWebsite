import { useEffect, useRef, useState } from "react";
import AdminPage from "./pages/AdminPage";
import ArticlesPage from "./pages/ArticlesPage";
import AvatarPage from "./pages/AvatarPage";
import CapabilitiesPage from "./pages/CapabilitiesPage";
import HomePage from "./pages/HomePage";
import PersonalSiteProjectPage from "./pages/PersonalSiteProjectPage";
import ResumePage from "./pages/ResumePage";
import RouteLoader from "./components/RouteLoader";
import { useScrollReveal } from "./hooks/useScrollReveal";
import { useSiteTheme } from "./hooks/useSiteTheme";
import { useVisitTracker } from "./hooks/useVisitTracker";

const getRoute = () => window.location.hash.replace("#", "") || "/";
const getRouteBase = (route: string) => route.split("?")[0] || "/";

const routeLabels: Record<string, string> = {
  "/": "Home",
  "/admin": "Admin Console",
  "/admin/articles": "Article Admin",
  "/admin/avatar": "Avatar Admin",
  "/admin/files": "File Admin",
  "/admin/settings": "Settings Admin",
  "/admin/visits": "Visit Admin",
  "/articles": "Writing Desk",
  "/avatar": "AI Avatar",
  "/capabilities": "Capability Map",
  "/personal-site": "Project System",
  "/resume": "Resume",
};

const ROUTE_LOADER_MS = 180;

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const routeLoaderTimeoutRef = useRef<number | null>(null);
  const routeBase = getRouteBase(route);
  const routeStageKey = routeBase === "/admin" || routeBase.startsWith("/admin/") ? "/admin" : route;
  useScrollReveal(routeBase);
  useSiteTheme();
  useVisitTracker(routeBase);

  useEffect(() => {
    const handleHashChange = () => {
      if (routeLoaderTimeoutRef.current) {
        window.clearTimeout(routeLoaderTimeoutRef.current);
      }

      setIsRouteLoading(true);
      setRoute(getRoute());
      routeLoaderTimeoutRef.current = window.setTimeout(() => {
        setIsRouteLoading(false);
        routeLoaderTimeoutRef.current = null;
      }, ROUTE_LOADER_MS);
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      if (routeLoaderTimeoutRef.current) {
        window.clearTimeout(routeLoaderTimeoutRef.current);
      }
    };
  }, []);

  const page =
    routeBase === "/admin" || routeBase.startsWith("/admin/") ? (
      <AdminPage />
    ) : routeBase === "/resume" ? (
      <ResumePage />
    ) : routeBase === "/avatar" ? (
      <AvatarPage />
    ) : routeBase === "/articles" ? (
      <ArticlesPage />
    ) : routeBase === "/capabilities" ? (
      <CapabilitiesPage />
    ) : routeBase === "/personal-site" ? (
      <PersonalSiteProjectPage />
    ) : (
      <HomePage />
    );

  return (
    <>
      <RouteLoader isActive={isRouteLoading} label={routeLabels[routeBase] ?? "Loading"} />
      <div className="route-stage" key={routeStageKey}>
        {page}
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { getPublicSiteSettings, type SiteSettings } from "../utils/adminAccess";

export type SiteTheme = SiteSettings["siteTheme"];

const DEFAULT_SITE_THEME: SiteTheme = "aurora";
const SITE_THEME_EVENT = "personal-site-theme-change";

const normalizeSiteTheme = (value: unknown): SiteTheme =>
  value === "frost" || value === "moss" || value === "aurora" ? value : DEFAULT_SITE_THEME;

export const applySiteTheme = (theme: SiteTheme) => {
  document.documentElement.dataset.siteTheme = theme;
  window.dispatchEvent(new CustomEvent(SITE_THEME_EVENT, { detail: { theme } }));
};

export const useSiteTheme = () => {
  const [siteTheme, setSiteTheme] = useState<SiteTheme>(DEFAULT_SITE_THEME);

  useEffect(() => {
    let isMounted = true;

    void getPublicSiteSettings()
      .then((settings) => {
        if (!isMounted) return;
        const nextTheme = normalizeSiteTheme(settings.siteTheme);
        setSiteTheme(nextTheme);
        applySiteTheme(nextTheme);
      })
      .catch(() => {
        applySiteTheme(DEFAULT_SITE_THEME);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return siteTheme;
};

export const onSiteThemeChange = (listener: (theme: SiteTheme) => void) => {
  const handleThemeChange = (event: Event) => {
    listener(normalizeSiteTheme((event as CustomEvent<{ theme?: unknown }>).detail?.theme));
  };

  window.addEventListener(SITE_THEME_EVENT, handleThemeChange);
  return () => window.removeEventListener(SITE_THEME_EVENT, handleThemeChange);
};

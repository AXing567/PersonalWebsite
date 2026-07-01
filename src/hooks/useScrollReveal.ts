import { useLayoutEffect } from "react";

const REVEAL_SELECTOR = ".reveal";
const VISIBLE_CLASS = "is-visible";
const READY_CLASS = "reveal-ready";

export function useScrollReveal(refreshKey: string) {
  useLayoutEffect(() => {
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (reduceMotionQuery.matches || !("IntersectionObserver" in window)) {
      document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((element) => {
        element.classList.add(READY_CLASS, VISIBLE_CLASS);
      });
      return undefined;
    }

    const revealElements = new Set<HTMLElement>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          const element = entry.target;
          element.classList.add(VISIBLE_CLASS);
          observer.unobserve(element);
        });
      },
      {
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.16,
      },
    );

    const registerElement = (element: HTMLElement) => {
      if (revealElements.has(element)) {
        return;
      }

      revealElements.add(element);
      element.classList.add(READY_CLASS);
      observer.observe(element);

      window.requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const isInViewport = rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
        if (isInViewport) {
          element.classList.add(VISIBLE_CLASS);
          observer.unobserve(element);
        }
      });
    };

    const scanRevealElements = (root: ParentNode = document) => {
      root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach(registerElement);
    };

    scanRevealElements();

    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }

          if (node.matches(REVEAL_SELECTOR)) {
            registerElement(node);
          }

          scanRevealElements(node);
        });
      });
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
      revealElements.forEach((element) => {
        element.classList.remove(READY_CLASS, VISIBLE_CLASS);
      });
    };
  }, [refreshKey]);
}

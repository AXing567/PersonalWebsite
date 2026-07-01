import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

export type ProgressSection = {
  id: string;
  label: string;
};

type ReadingProgressProps = {
  sections: ProgressSection[];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function ReadingProgress({ sections }: ReadingProgressProps) {
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const activeSection = sections.find((section) => section.id === activeId) ?? sections[0];

  useEffect(() => {
    let frameId = 0;

    const updateProgress = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const nextProgress = clamp(Math.round((scrollTop / scrollRange) * 100), 0, 100);

      let nextActiveId = sectionIds[0] ?? "";
      for (const id of sectionIds) {
        const element = document.getElementById(id);
        if (!element) continue;

        const sectionTop = element.getBoundingClientRect().top + scrollTop;
        if (scrollTop + window.innerHeight * 0.34 >= sectionTop) {
          nextActiveId = id;
        }
      }

      setProgress(nextProgress);
      setActiveId(nextActiveId);
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateProgress);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [sectionIds]);

  const handleSectionClick = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  if (!sections.length) {
    return null;
  }

  const progressStyle = {
    height: `${progress}%`,
    "--mobile-progress-width": `${progress}%`,
  } as CSSProperties;

  return (
    <aside className="reading-progress" aria-label="页面阅读进度">
      <div className="reading-progress-meter" aria-hidden="true">
        <span style={progressStyle} />
      </div>
      <div className="reading-progress-copy">
        <strong>{progress}%</strong>
        <span>{activeSection?.label ?? "正在浏览"}</span>
      </div>
      <div className="reading-progress-sections">
        {sections.map((section) => (
          <button
            aria-current={section.id === activeId ? "step" : undefined}
            key={section.id}
            onClick={() => handleSectionClick(section.id)}
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>
    </aside>
  );
}

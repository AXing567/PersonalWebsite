import type { TimelineItem } from "../data/resumeTypes";

type TimelineProps = {
  items: TimelineItem[];
};

export default function Timeline({ items }: TimelineProps) {
  return (
    <div className="timeline">
      {items.map((item) => (
        <article className="timeline-item" key={`${item.period}-${item.title}`}>
          <div className="timeline-dot" aria-hidden="true" />
          <div>
            <span className="timeline-period">{item.period}</span>
            <h3>{item.title}</h3>
            <p className="timeline-org">{item.organization}</p>
            <ul>
              {item.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </div>
        </article>
      ))}
    </div>
  );
}

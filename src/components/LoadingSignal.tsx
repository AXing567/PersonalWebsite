import type { CSSProperties } from "react";

type LoadingSignalStep = {
  label: string;
};

type LoadingSignalProps = {
  label: string;
  steps?: LoadingSignalStep[];
};

const defaultSteps = [{ label: "校验访问" }, { label: "读取资料" }, { label: "准备界面" }];

export default function LoadingSignal({ label, steps = defaultSteps }: LoadingSignalProps) {
  return (
    <div className="loading-signal" role="status" aria-live="polite">
      <div className="loading-signal-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="loading-signal-copy">
        <strong>{label}</strong>
        <div className="loading-signal-steps" aria-hidden="true">
          {steps.map((step, index) => (
            <span key={step.label} style={{ "--step-index": index } as CSSProperties}>
              {step.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

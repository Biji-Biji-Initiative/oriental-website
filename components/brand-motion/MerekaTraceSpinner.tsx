import { MEREKA_MARK_DOT, MEREKA_MARK_PATH, MEREKA_MARK_VIEWBOX, MEREKA_TRACE_DURATION_MS } from "@/lib/brand-motion";

type MerekaTraceSpinnerProps = {
  className?: string;
  label?: string;
};

export function MerekaTraceSpinner({ className, label }: MerekaTraceSpinnerProps) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      data-duration-ms={MEREKA_TRACE_DURATION_MS}
      role={label ? "img" : undefined}
      viewBox={MEREKA_MARK_VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="mereka-trace-glow" height="180%" width="180%" x="-40%" y="-40%">
          <feGaussianBlur result="blur" stdDeviation="7" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="mereka-trace__body">
        <path d={MEREKA_MARK_PATH} />
        <circle cx={MEREKA_MARK_DOT.cx} cy={MEREKA_MARK_DOT.cy} r={MEREKA_MARK_DOT.radius} />
      </g>

      <g className="mereka-trace__outline">
        <path d={MEREKA_MARK_PATH} pathLength={1} />
        <circle
          className="mereka-trace__outline-dot"
          cx={MEREKA_MARK_DOT.cx}
          cy={MEREKA_MARK_DOT.cy}
          pathLength={1}
          r={MEREKA_MARK_DOT.radius}
        />
      </g>

      <g className="mereka-trace__light" filter="url(#mereka-trace-glow)">
        <path d={MEREKA_MARK_PATH} pathLength={1} />
        <circle
          className="mereka-trace__light-dot"
          cx={MEREKA_MARK_DOT.cx}
          cy={MEREKA_MARK_DOT.cy}
          pathLength={1}
          r={MEREKA_MARK_DOT.radius}
        />
      </g>
    </svg>
  );
}

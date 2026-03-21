import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";

interface RadialProgressProps {
  value: number; // 0-100
  label?: string;
}

export function RadialProgress({ value, label }: RadialProgressProps) {
  const size = 28;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  const offset = circumference - (clamped / 100) * circumference;

  const svg = (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/30"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-foreground/70"
        style={{ transition: "stroke-dashoffset 0.3s ease" }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        className="rotate-[90deg] origin-center text-[8px] text-foreground/70"
      >
        {Math.round(clamped)}
      </text>
    </svg>
  );

  if (!label) {
    return svg;
  }

  return (
    <TooltipProvider delay={600}>
      <Tooltip>
        <TooltipTrigger className="inline-flex">{svg}</TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

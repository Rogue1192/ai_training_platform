import { useLocation } from "wouter";
import { Brain, MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";

const MODULES = [
  {
    id: "ai_answerforge",
    label: "AI AnswerForge",
    icon: Brain,
    rootPath: "/",
    matchPrefixes: ["/", "/campaigns", "/businesses", "/packages", "/client-dashboards", "/prompts", "/llm-insights", "/emails", "/agencies", "/cost-tracking", "/audit", "/settings"],
  },
  {
    id: "ctr",
    label: "CTR Module",
    icon: MousePointerClick,
    rootPath: "/ctr",
    matchPrefixes: ["/ctr"],
  },
];

export function ModuleSwitcher({ isCollapsed }: { isCollapsed: boolean }) {
  const [location, setLocation] = useLocation();

  const activeModule = MODULES.find((m) =>
    m.matchPrefixes.some((prefix) =>
      prefix === "/" ? location === "/" : location.startsWith(prefix)
    )
  ) ?? MODULES[0];

  if (isCollapsed) {
    return (
      <div className="flex flex-col gap-1 px-2 py-2">
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          const isActive = mod.id === activeModule.id;
          return (
            <button
              key={mod.id}
              onClick={() => setLocation(mod.rootPath)}
              title={mod.label}
              className={cn(
                "h-8 w-8 flex items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="flex rounded-lg bg-muted p-1 gap-1">
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          const isActive = mod.id === activeModule.id;
          return (
            <button
              key={mod.id}
              onClick={() => setLocation(mod.rootPath)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{mod.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

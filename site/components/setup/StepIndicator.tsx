import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface Step {
  label: string
}

interface StepIndicatorProps {
  steps: Step[]
  currentStep: number
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-start justify-center mb-6 px-2">
      {steps.map((step, i) => {
        const isCompleted = i < currentStep
        const isCurrent = i === currentStep

        return (
          <div key={step.label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300",
                  isCompleted &&
                    "bg-primary text-primary-foreground shadow-lg shadow-primary/25",
                  isCurrent &&
                    "bg-primary/15 ring-2 ring-primary text-primary",
                  !isCompleted &&
                    !isCurrent &&
                    "bg-white/5 border border-white/10 text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="size-3.5" strokeWidth={2.5} />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium whitespace-nowrap transition-colors",
                  isCurrent ? "text-primary" : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>

            {i < steps.length - 1 && (
              <div
                className={cn(
                  "h-px w-10 sm:w-14 mx-1 mb-5 transition-all duration-500",
                  i < currentStep ? "bg-primary" : "bg-white/10"
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

import { AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface ErrorAlertProps {
  message: string
  className?: string
}

export function ErrorAlert({ message, className }: ErrorAlertProps) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-xl bg-red-500/8 border border-red-500/20 p-3",
        className
      )}
      role="alert"
    >
      <AlertCircle className="size-4 text-red-400 mt-0.5 shrink-0" />
      <p className="text-sm text-red-300 leading-relaxed">{message}</p>
    </div>
  )
}

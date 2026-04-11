"use client"

import { useState } from "react"
import { StepIndicator } from "./StepIndicator"
import { WelcomeStep } from "./steps/WelcomeStep"
import { TelegramCredentialsStep } from "./steps/TelegramCredentialsStep"
import { TelegramAuthStep } from "./steps/TelegramAuthStep"
import { GroupSelectStep } from "./steps/GroupSelectStep"
import { MT5Step } from "./steps/MT5Step"
import { CompleteStep } from "./steps/CompleteStep"

export interface SetupData {
  apiId: string
  apiHash: string
  phone: string
  code: string
  groupId: string
  groupName: string
  mt5Login: string
  mt5Password: string
  mt5Server: string
}

export interface StepProps {
  data: SetupData
  onDataChange: (partial: Partial<SetupData>) => void
  onNext: () => void
  onBack: () => void
  isLoading: boolean
  error: string | null
}

const INDICATOR_STEPS = [
  { label: "Telegram API" },
  { label: "Login" },
  { label: "Gruppo" },
  { label: "MetaTrader" },
]

export function SetupWizard() {
  const [step, setStep] = useState(0)
  const [isLoading] = useState(false)
  const [error] = useState<string | null>(null)
  const [data, setData] = useState<SetupData>({
    apiId: "",
    apiHash: "",
    phone: "",
    code: "",
    groupId: "",
    groupName: "",
    mt5Login: "",
    mt5Password: "",
    mt5Server: "",
  })

  const updateData = (partial: Partial<SetupData>) => {
    setData(prev => ({ ...prev, ...partial }))
  }

  const goNext = () => setStep(s => Math.min(s + 1, 5))
  const goBack = () => setStep(s => Math.max(s - 1, 0))

  const props: StepProps = {
    data,
    onDataChange: updateData,
    onNext: goNext,
    onBack: goBack,
    isLoading,
    error,
  }

  const showIndicator = step >= 1 && step <= 4

  return (
    <div className="w-full">
      {showIndicator && (
        <StepIndicator
          steps={INDICATOR_STEPS}
          currentStep={step - 1}
        />
      )}
      <div key={step} className="step-enter">
        {step === 0 && <WelcomeStep {...props} />}
        {step === 1 && <TelegramCredentialsStep {...props} />}
        {step === 2 && <TelegramAuthStep {...props} />}
        {step === 3 && <GroupSelectStep {...props} />}
        {step === 4 && <MT5Step {...props} />}
        {step === 5 && <CompleteStep {...props} />}
      </div>
    </div>
  )
}

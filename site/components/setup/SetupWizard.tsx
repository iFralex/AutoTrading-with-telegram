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
  // Step 1 — Telegram API
  apiId: string
  apiHash: string
  // Step 2 — autenticazione Telegram
  phone: string
  code: string
  loginKey: string   // da request_code
  userId: string     // da verify_code
  // Step 3 — gruppo
  groupId: string
  groupName: string
  // Step 4 — MetaTrader 5
  mt5Login: string
  mt5Password: string
  mt5Server: string
  mt5AccountName: string  // da verify_mt5 (per il riepilogo finale)
}

export interface StepProps {
  data: SetupData
  onDataChange: (partial: Partial<SetupData>) => void
  onNext: () => void
  onBack: () => void
}

const INDICATOR_STEPS = [
  { label: "Telegram API" },
  { label: "Login" },
  { label: "Gruppo" },
  { label: "MetaTrader" },
]

export function SetupWizard() {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<SetupData>({
    apiId: "",
    apiHash: "",
    phone: "",
    code: "",
    loginKey: "",
    userId: "",
    groupId: "",
    groupName: "",
    mt5Login: "",
    mt5Password: "",
    mt5Server: "",
    mt5AccountName: "",
  })

  const updateData = (partial: Partial<SetupData>) =>
    setData(prev => ({ ...prev, ...partial }))

  const goNext = () => setStep(s => Math.min(s + 1, 5))
  const goBack = () => setStep(s => Math.max(s - 1, 0))

  const props: StepProps = { data, onDataChange: updateData, onNext: goNext, onBack: goBack }

  return (
    <div className="w-full">
      {step >= 1 && step <= 4 && (
        <StepIndicator steps={INDICATOR_STEPS} currentStep={step - 1} />
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

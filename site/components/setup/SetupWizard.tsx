"use client"

import { useState } from "react"
import { StepIndicator } from "./StepIndicator"
import { WelcomeStep } from "./steps/WelcomeStep"
import { PhoneStep } from "./steps/PhoneStep"
import { TelegramCredentialsStep } from "./steps/TelegramCredentialsStep"
import { TelegramAuthStep } from "./steps/TelegramAuthStep"
import { GroupSelectStep } from "./steps/GroupSelectStep"
import { MT5Step } from "./steps/MT5Step"
import { SizingStrategyStep } from "./steps/SizingStrategyStep"
import { ExtractionInstructionsStep } from "./steps/ExtractionInstructionsStep"
import { ManagementStrategyStep } from "./steps/ManagementStrategyStep"
import { DeletionStrategyStep } from "./steps/DeletionStrategyStep"
import { CompleteStep } from "./steps/CompleteStep"
import { api, type SetupSession } from "@/lib/api"

export interface SetupData {
  // Step 1 — Numero di telefono
  phone: string
  // Step 2 — Telegram API
  apiId: string
  apiHash: string
  // Step 2b — login_key da request_code (inviato nel passo credenziali)
  loginKey: string
  // Step 3 — autenticazione Telegram
  code: string
  userId: string
  // Step 4 — gruppo
  groupId: string
  groupName: string
  // Step 5 — MetaTrader 5
  mt5Login: string
  mt5Password: string
  mt5Server: string
  mt5AccountName: string  // da verify_mt5 (per il riepilogo finale)
  // Step 6 — strategia di sizing
  sizingStrategy: string
  // Step 7 — istruzioni estrazione AI
  extractionInstructions: string
  // Step 8 — strategia di gestione
  managementStrategy: string
  // Step 9 — strategia messaggi eliminati
  deletionStrategy: string
}

export interface StepProps {
  data: SetupData
  onDataChange: (partial: Partial<SetupData>) => void
  onNext: () => void
  onBack: () => void
}

/**
 * Passi mostrati nell'indicatore (esclusi Welcome e Phone che hanno layout proprio).
 * I passi 2-6 corrispondono agli indici 0-4 dell'indicatore.
 */
const INDICATOR_STEPS = [
  { label: "Credenziali" },
  { label: "Login" },
  { label: "Gruppo" },
  { label: "MetaTrader" },
  { label: "Sizing" },
  { label: "Estrazione" },
  { label: "Gestione" },
  { label: "Eliminazioni" },
]

/**
 * Wizard di setup.
 *
 * Step map:
 *   0 — Welcome
 *   1 — PhoneStep (nuovo)
 *   2 — TelegramCredentialsStep  (invia anche OTP alla fine)
 *   3 — TelegramAuthStep         (verifica OTP / 2FA)
 *   4 — GroupSelectStep
 *   5 — MT5Step
 *   6 — SizingStrategyStep
 *   7 — ExtractionInstructionsStep
 *   8 — ManagementStrategyStep
 *   9 — DeletionStrategyStep
 *  10 — CompleteStep
 */
export function SetupWizard() {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<SetupData>({
    phone: "",
    apiId: "",
    apiHash: "",
    loginKey: "",
    code: "",
    userId: "",
    groupId: "",
    groupName: "",
    mt5Login: "",
    mt5Password: "",
    mt5Server: "",
    mt5AccountName: "",
    sizingStrategy: "",
    extractionInstructions: "",
    managementStrategy: "",
    deletionStrategy: "",
  })

  const updateData = (partial: Partial<SetupData>) =>
    setData(prev => ({ ...prev, ...partial }))

  // ── Navigazione con persistenza della sessione ────────────────────────────

  /**
   * Avanza di un passo e salva in sessione i dati del passo corrente.
   * La sessione è già stata creata sul server al completamento del PhoneStep.
   */
  const goNext = async () => {
    // Salva i dati del passo appena completato nella sessione server
    try {
      switch (step) {
        // Passi 2 e 3: il salvataggio avviene direttamente nel componente
        // con il valore fresco dall'API (evita stale closure React)
        case 4:
          // Gruppo selezionato
          await api.saveSession({
            phone: data.phone,
            group_id: data.groupId,
            group_name: data.groupName,
          })
          break
        case 5:
          // Credenziali MT5
          await api.saveSession({
            phone: data.phone,
            mt5_login: Number(data.mt5Login),
            mt5_server: data.mt5Server,
            mt5_password: data.mt5Password,
          })
          break
        case 6:
          // Strategia di sizing
          await api.saveSession({
            phone: data.phone,
            sizing_strategy: data.sizingStrategy,
          })
          break
        case 7:
          // Istruzioni estrazione AI
          await api.saveSession({
            phone: data.phone,
            extraction_instructions: data.extractionInstructions || undefined,
          })
          break
        case 8:
          // Strategia di gestione
          await api.saveSession({
            phone: data.phone,
            management_strategy: data.managementStrategy,
          })
          break
        case 9:
          // Strategia messaggi eliminati
          await api.saveSession({
            phone: data.phone,
            deletion_strategy: data.deletionStrategy,
          })
          break
      }
    } catch {
      // Fallimento del salvataggio sessione non blocca il wizard
    }
    setStep(s => Math.min(s + 1, 10))
  }

  /**
   * Torna al passo precedente e cancella dalla sessione i dati del passo
   * che si sta lasciando, così l'utente può reinserirli.
   */
  const goBack = async () => {
    try {
      switch (step) {
        case 2:
          // Lascia le credenziali Telegram (torna al telefono)
          await api.clearSessionFields(data.phone, ["api_id", "api_hash", "login_key"])
          updateData({ apiId: "", apiHash: "", loginKey: "" })
          break
        case 3:
          // Lascia l'auth OTP (torna alle credenziali)
          await api.clearSessionFields(data.phone, ["login_key", "user_id"])
          updateData({ loginKey: "", userId: "", code: "" })
          break
        case 5:
          // Lascia il passo MT5 (torna al gruppo)
          await api.clearSessionFields(data.phone, ["mt5_login", "mt5_password", "mt5_server"])
          updateData({ mt5Login: "", mt5Password: "", mt5Server: "", mt5AccountName: "" })
          break
        case 6:
          // Lascia il sizing (torna a MT5)
          await api.clearSessionFields(data.phone, ["sizing_strategy"])
          updateData({ sizingStrategy: "" })
          break
        case 7:
          // Lascia estrazione (torna al sizing)
          await api.clearSessionFields(data.phone, ["extraction_instructions"])
          updateData({ extractionInstructions: "" })
          break
        case 8:
          // Lascia la gestione (torna all'estrazione)
          await api.clearSessionFields(data.phone, ["management_strategy"])
          updateData({ managementStrategy: "" })
          break
        case 9:
          // Lascia le eliminazioni (torna alla gestione)
          await api.clearSessionFields(data.phone, ["deletion_strategy"])
          updateData({ deletionStrategy: "" })
          break
        // step 4 (Group → Auth): nessuna pulizia, Auth mostrerà "già autenticato"
        // step 10 (Complete → Eliminazioni): nessuna pulizia
      }
    } catch {
      // Errore di pulizia sessione: procedi comunque
    }
    setStep(s => Math.max(s - 1, 0))
  }

  /**
   * Salta direttamente a uno step specifico (usato dal PhoneStep quando
   * viene trovata una sessione esistente).
   */
  const jumpToStep = (targetStep: number, session: SetupSession) => {
    updateData({
      apiId:          String(session.api_id ?? ""),
      apiHash:        session.api_hash ?? "",
      loginKey:       session.login_key ?? "",
      userId:         session.user_id ?? "",
      groupId:        session.group_id ?? "",
      groupName:      session.group_name ?? "",
      mt5Login:       String(session.mt5_login ?? ""),
      mt5Server:      session.mt5_server ?? "",
      sizingStrategy:         session.sizing_strategy ?? "",
      extractionInstructions: session.extraction_instructions ?? "",
      managementStrategy:     session.management_strategy ?? "",
      deletionStrategy:       session.deletion_strategy ?? "",
      // mt5Password resta vuoto: viene recuperato dal server in completeSetup
    })
    setStep(targetStep)
  }

  const props: StepProps = { data, onDataChange: updateData, onNext: goNext, onBack: goBack }

  return (
    <div className="w-full">
      {step >= 2 && step <= 9 && (
        <StepIndicator steps={INDICATOR_STEPS} currentStep={step - 2} />
      )}
      <div key={step} className="step-enter">
        {step === 0 && <WelcomeStep {...props} />}
        {step === 1 && (
          <PhoneStep {...props} onJumpToStep={jumpToStep} />
        )}
        {step === 2 && <TelegramCredentialsStep {...props} />}
        {step === 3 && <TelegramAuthStep {...props} />}
        {step === 4 && <GroupSelectStep {...props} />}
        {step === 5 && <MT5Step {...props} />}
        {step === 6 && <SizingStrategyStep {...props} />}
        {step === 7 && <ExtractionInstructionsStep {...props} />}
        {step === 8 && <ManagementStrategyStep {...props} />}
        {step === 9 && <DeletionStrategyStep {...props} />}
        {step === 10 && <CompleteStep {...props} />}
      </div>
    </div>
  )
}

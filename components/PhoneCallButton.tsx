"use client";

import { useState } from "react";
import { Phone, Loader2, CheckCircle } from "lucide-react";
import { ConversationState } from "@/types";

interface Props {
  state: ConversationState;
  sessionId: string;
  onCallStarted?: () => void;
}

export default function PhoneCallButton({ state, sessionId, onCallStarted }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "called">("idle");

  const phoneNumber = state.patient?.phone;

  const handleCall = async () => {
    if (!phoneNumber) {
      alert("Please provide your phone number in the chat first.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: `+1${phoneNumber.replace(/\D/g, "")}`,
          state: { ...state, sessionId },
        }),
      });

      if (res.ok) {
        setStatus("called");
        onCallStarted?.();
      } else {
        alert("Unable to initiate call. Please try again.");
        setStatus("idle");
      }
    } catch {
      alert("Call failed. Please try again.");
      setStatus("idle");
    }
  };

  if (status === "called") {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 text-sm rounded-xl border border-green-200"
      >
        <CheckCircle className="w-4 h-4" />
        <span className="hidden sm:inline">Calling...</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleCall}
      disabled={status === "loading"}
      title="Switch to voice call"
      className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-xl transition-colors"
    >
      {status === "loading" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Phone className="w-4 h-4" />
      )}
      <span className="hidden sm:inline">Call me</span>
    </button>
  );
}

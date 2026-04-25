"use client";

import { useState } from "react";
import { Phone, Loader2, CheckCircle, X } from "lucide-react";
import { ConversationState } from "@/types";

interface Props {
  state: ConversationState;
  sessionId: string;
  onCallStarted?: () => void;
}

export default function PhoneCallButton({ state, sessionId, onCallStarted }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "called">("idle");
  const [showModal, setShowModal] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");

  const handleOpen = () => {
    setPhoneInput(state.patient?.phone ?? "2674636782");
    setShowModal(true);
  };

  const handleCall = async () => {
    const phone = phoneInput.replace(/\D/g, "");
    if (phone.length < 10) {
      alert("Please enter a valid 10-digit phone number.");
      return;
    }

    setStatus("loading");
    setShowModal(false);

    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: `+1${phone}`,
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
    <>
      <button
        onClick={handleOpen}
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <Phone className="w-5 h-5 text-green-600" />
              </div>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <h2 className="text-lg font-semibold text-gray-900 mb-1">Switch to Voice Call</h2>
            <p className="text-sm text-gray-500 mb-5">
              Our AI will call you and pick up right where you left off in the chat.
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-1">Your phone number</label>
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="(555) 555-5555"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-2"
              onKeyDown={(e) => e.key === "Enter" && handleCall()}
              autoFocus
            />
            <p className="text-xs text-gray-400 mb-5">
              Standard call rates may apply. By proceeding, you agree to receive a call from Kyron Medical.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCall}
                disabled={status === "loading"}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                Call Me Now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

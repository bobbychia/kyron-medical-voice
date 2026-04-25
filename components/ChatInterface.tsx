"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Phone, Loader2, Bot, User, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Message, AIModel, ConversationState, AvailabilitySlot, Doctor } from "@/types";
import { formatDisplay } from "@/lib/dateUtils";
import PhoneCallButton from "@/components/PhoneCallButton";
import TimeSlotPicker from "@/components/TimeSlotPicker";
import PreferredTimePicker from "@/components/PreferredTimePicker";

const INITIAL_MESSAGE: Message = {
  id: "init",
  role: "assistant",
  content: "Hello! I'm your Kyron Medical assistant. 👋\n\nI can help you with:\n• **Scheduling an appointment** with one of our specialists\n• **Prescription refill** requests\n• **Office information** — hours, location & more\n\nHow can I assist you today?",
  timestamp: new Date(),
};

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<AIModel>("claude");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<Partial<ConversationState & {
    availableSlots: AvailabilitySlot[];
    matchedDoctor: Doctor;
  }>>({ step: "greeting" });
  const [voiceCalling, setVoiceCalling] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll for session updates after voice call
  useEffect(() => {
    if (!voiceCalling) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/session?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.step === "booked" && state.step !== "booked") {
        setState((prev) => ({ ...prev, step: "booked" }));
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Your appointment has been confirmed via phone call! You should receive a confirmation email shortly.",
          timestamp: new Date(),
        }]);
        setVoiceCalling(false);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [voiceCalling, sessionId, state.step]);

  const sendMessage = useCallback(async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          sessionId,
          model,
          history: messages,
          smsConsent,
        }),
      });

      const data = await res.json();

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setState(data.state);

      // Auto-book when confirmed
      if (data.state?.step === "booked" && data.state?.patient && data.state?.matchedDoctor && data.state?.selectedSlot) {
        await fetch("/api/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient: data.state.patient,
            doctor: data.state.matchedDoctor,
            slot: data.state.selectedSlot,
          }),
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "I'm sorry, I encountered an error. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, messages, model, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
            <Stethoscope className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-gray-900">Kyron Medical</h1>
            <p className="text-xs text-gray-500">AI Medical Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Model selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(["claude", "gpt", "gemini"] as AIModel[]).map((m) => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  model === m
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {m === "claude" ? "Claude" : m === "gpt" ? "GPT-4o" : "Gemini"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-none"
                    : "bg-white text-gray-800 shadow-sm rounded-tl-none border border-gray-100"
                }`}
              >
                {msg.content.split("\n").map((line, i) => (
                  <p key={i} className={i > 0 ? "mt-1" : ""}>
                    {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                      part.startsWith("**") && part.endsWith("**")
                        ? <strong key={j}>{part.slice(2, -2)}</strong>
                        : part
                    )}
                  </p>
                ))}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-4 h-4 text-gray-600" />
                </div>
              )}
            </div>
          ))}

          {/* Initial quick actions */}
          {(state.step === "greeting" || state.step === "collect_name") && messages.length <= 1 && (
            <div className="flex flex-col gap-2 max-w-sm ml-11">
              <p className="text-xs text-gray-500 mb-1">Quick actions:</p>
              {[
                { label: "📅 Schedule an appointment", value: "I'd like to schedule an appointment" },
                { label: "⚡ What's the next available appointment?", value: "What's the next available appointment?" },
                { label: "💊 Request a prescription refill", value: "I need a prescription refill" },
                { label: "📍 Office hours & location", value: "What are your office hours and location?" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => sendMessage(opt.value)}
                  className="text-left px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm text-blue-700 hover:bg-blue-50 transition-colors shadow-sm"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Specialty picker */}
          {state.step === "collect_reason" && (
            <div className="flex flex-col gap-2 max-w-sm">
              <p className="text-xs text-gray-500 ml-1">Select a concern or type your own:</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "🦴 Bone & Joint Pain", value: "I have bone and joint pain" },
                  { label: "❤️ Heart & Chest", value: "I have chest pain and heart concerns" },
                  { label: "🧠 Headache & Neurology", value: "I have headaches and neurological symptoms" },
                  { label: "🫁 Stomach & Digestion", value: "I have stomach and digestive issues" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => sendMessage(opt.value)}
                    className="text-left px-3 py-2 bg-white border border-blue-200 rounded-xl text-sm text-blue-700 hover:bg-blue-50 transition-colors shadow-sm"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Out-of-scope notice */}
          {state.step === "match_doctor" && (
            <div className="flex flex-col gap-2 max-w-sm ml-11">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-xs font-medium text-amber-700 mb-2">⚠️ Outside our treatment scope</p>
                <p className="text-xs text-amber-600 mb-3">Our practice currently treats bone &amp; joint, heart, neurology, and digestive conditions.</p>
                <div className="flex flex-col gap-1.5">
                  {[
                    { label: "🦴 Bone & Joint Pain", value: "I have bone and joint pain" },
                    { label: "❤️ Heart & Chest", value: "I have chest pain and heart concerns" },
                    { label: "🧠 Headache & Neurology", value: "I have headaches and neurological symptoms" },
                    { label: "🫁 Stomach & Digestion", value: "I have stomach and digestive issues" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => sendMessage(opt.value)}
                      className="text-left px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs text-amber-800 hover:bg-amber-50 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Preferred time picker */}
          {state.step === "request_preferred_time" && state.availableSlots && (
            <PreferredTimePicker
              slots={state.availableSlots}
              onSelect={(slot) => {
                const d = new Date(slot.date + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "long", month: "long", day: "numeric", year: "numeric",
                });
                const [h, m] = slot.time.split(":").map(Number);
                const ampm = h >= 12 ? "PM" : "AM";
                const hour = h % 12 || 12;
                sendMessage(`${d} at ${hour}:${String(m).padStart(2, "0")} ${ampm}`);
              }}
            />
          )}

          {/* Time slot picker */}
          {state.step === "show_slots" && state.availableSlots && state.matchedDoctor && (
            <TimeSlotPicker
              doctor={state.matchedDoctor}
              slots={state.availableSlots}
              onSelect={(slot) => {
                const idx = state.availableSlots!.indexOf(slot) + 1;
                sendMessage(String(idx));
              }}
              onRequestMore={() => sendMessage("none of these work, show me more options")}
            />
          )}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
              <div className="bg-white shadow-sm border border-gray-100 rounded-2xl rounded-tl-none px-4 py-3">
                <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Doctor matched banner */}
      {state.matchedDoctor && state.step !== "booked" && (
        <div className="bg-blue-50 border-t border-blue-100 px-4 py-2">
          <div className="max-w-2xl mx-auto flex items-center gap-2 text-sm text-blue-700">
            <Stethoscope className="w-4 h-4" />
            <span>Matched with <strong>{state.matchedDoctor.name}</strong> · {state.matchedDoctor.specialty}</span>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        {["collect_email", "collect_reason", "match_doctor", "show_slots", "confirm_booking", "booked"].includes(state.step ?? "") && (
          <div className="max-w-2xl mx-auto mb-2">
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={smsConsent}
                onChange={(e) => setSmsConsent(e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              I consent to receive SMS appointment reminders
            </label>
          </div>
        )}
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <div className="flex-1 flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={loading || state.step === "booked"}
              className="rounded-xl border-gray-200 focus:ring-blue-500"
            />
          </div>
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading || state.step === "booked"}
            size="icon"
            className="bg-blue-600 hover:bg-blue-700 rounded-xl h-10 w-10"
          >
            <Send className="w-4 h-4" />
          </Button>
          <PhoneCallButton state={state as ConversationState} sessionId={sessionId} onCallStarted={() => setVoiceCalling(true)} />
        </div>
      </div>
    </div>
  );
}

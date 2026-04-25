"use client";

import { useEffect, useState } from "react";
import { formatDisplay } from "@/lib/dateUtils";

interface Slot {
  id: string;
  date: string;
  time: string;
  available: boolean;
}

interface Patient {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface Appointment {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
  patient: Patient;
  slot: Slot;
}

interface Doctor {
  id: string;
  name: string;
  specialty: string;
  slots: Slot[];
  appointments: Appointment[];
}

export default function AdminDashboard() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"slots" | "appointments">("slots");

  const fetchData = async () => {
    const res = await fetch("/api/admin");
    const data = await res.json();
    setDoctors(data);
    setSelectedDoctor(prev => prev ?? (data.length > 0 ? data[0].id : null));
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const toggleSlot = async (slotId: string, available: boolean) => {
    await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId, available: !available }),
    });
    fetchData();
  };

  const deleteSlot = async (slotId: string) => {
    await fetch("/api/admin", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    fetchData();
  };

  const addSlot = async () => {
    if (!newDate || !newTime || !selectedDoctor) return;
    setAdding(true);
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctorId: selectedDoctor, date: newDate, time: newTime }),
    });
    setNewDate("");
    setNewTime("");
    setAdding(false);
    fetchData();
  };

  const doctor = doctors.find((d) => d.id === selectedDoctor);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Loading...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Kyron Medical — Admin Dashboard</h1>
          <p className="text-sm text-gray-500">Manage doctor availability and appointments</p>
        </div>
        <div className="flex items-center gap-4">
          <a href="/" className="text-sm text-blue-600 hover:underline">← Back to Chat</a>
          <button
            onClick={async () => {
              await fetch("/api/admin/login", { method: "DELETE" });
              window.location.href = "/admin/login";
            }}
            className="text-sm text-gray-500 hover:text-red-600 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar: doctor list */}
        <aside className="w-64 bg-white border-r border-gray-200 p-4 space-y-2 overflow-y-auto">
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDoctor(d.id)}
              className={`w-full text-left px-3 py-3 rounded-lg transition-colors ${
                selectedDoctor === d.id
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <p className="font-medium text-sm">{d.name}</p>
              <p className="text-xs text-gray-500">{d.specialty}</p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs text-green-600">{d.slots.filter(s => s.available).length} open</span>
                <span className="text-xs text-gray-400">{d.appointments.length} appts</span>
              </div>
            </button>
          ))}
        </aside>

        {/* Main content */}
        <main className="flex-1 p-6 overflow-y-auto">
          {doctor && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{doctor.name}</h2>
                  <p className="text-sm text-gray-500">{doctor.specialty}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTab("slots")}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium ${tab === "slots" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}
                  >
                    Slots ({doctor.slots.length})
                  </button>
                  <button
                    onClick={() => setTab("appointments")}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium ${tab === "appointments" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}
                  >
                    Appointments ({doctor.appointments.length})
                  </button>
                </div>
              </div>

              {tab === "slots" && (
                <>
                  {/* Add slot form */}
                  <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex gap-3 items-end">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Date</label>
                      <input
                        type="date"
                        value={newDate}
                        onChange={(e) => setNewDate(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Time</label>
                      <input
                        type="time"
                        value={newTime}
                        onChange={(e) => setNewTime(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      onClick={addSlot}
                      disabled={adding || !newDate || !newTime}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {adding ? "Adding..." : "+ Add Slot"}
                    </button>
                  </div>

                  {/* Slots table */}
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-4 py-3 text-gray-600 font-medium">Date & Time</th>
                          <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
                          <th className="text-right px-4 py-3 text-gray-600 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {doctor.slots.map((slot) => (
                          <tr key={slot.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900">{formatDisplay(slot.date, slot.time)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                slot.available ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                              }`}>
                                {slot.available ? "Available" : "Booked"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right space-x-2">
                              {slot.available && (
                                <button
                                  onClick={() => toggleSlot(slot.id, slot.available)}
                                  className="text-xs text-orange-600 hover:underline"
                                >
                                  Block
                                </button>
                              )}
                              {!slot.available && (
                                <button
                                  onClick={() => toggleSlot(slot.id, slot.available)}
                                  className="text-xs text-green-600 hover:underline"
                                >
                                  Unblock
                                </button>
                              )}
                              <button
                                onClick={() => deleteSlot(slot.id)}
                                className="text-xs text-red-500 hover:underline"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {tab === "appointments" && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {doctor.appointments.length === 0 ? (
                    <p className="text-gray-500 text-sm p-6">No appointments yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-4 py-3 text-gray-600 font-medium">Patient</th>
                          <th className="text-left px-4 py-3 text-gray-600 font-medium">Date & Time</th>
                          <th className="text-left px-4 py-3 text-gray-600 font-medium">Contact</th>
                          <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {doctor.appointments.map((appt) => (
                          <tr key={appt.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900 font-medium">
                              {appt.patient.firstName} {appt.patient.lastName}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {formatDisplay(appt.slot.date, appt.slot.time)}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              <p>{appt.patient.email}</p>
                              <p>{appt.patient.phone}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                {appt.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

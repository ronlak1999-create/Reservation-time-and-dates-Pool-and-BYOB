import React, { useState, useEffect, useCallback } from "react";

const AREAS = ["Pool Table", "BYOB Room 1", "BYOB Room 2"];
const STORAGE_KEY = "venue-bookings";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function emptyForm(area) {
  return {
    id: null,
    area,
    guestName: "",
    phone: "",
    date: "",
    partySize: "",
    time: "",
    hours: "",
    hourlyRate: "",
    advanceAmount: "",
    advancePaid: false,
    paid: false,
    notes: "",
  };
}

function currency(n) {
  const num = Number(n) || 0;
  return "Rs. " + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function closingDateTime(b) {
  // The venue closes at 12am - so a booking stays "active" for its whole
  // calendar date, and only becomes past once that date's midnight closing
  // time has been reached (i.e. the next calendar day begins).
  if (!b.date) return null;
  const d = new Date(b.date + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 1);
  return d;
}

function isPastBooking(b) {
  const close = closingDateTime(b);
  if (!close) return false;
  return close.getTime() <= Date.now();
}

function isExpiredBooking(b) {
  const close = closingDateTime(b);
  if (!close) return false;
  const hrs = (Date.now() - close.getTime()) / (1000 * 60 * 60);
  return hrs > 72;
}

export default function VenuePOS() {
  const [bookings, setBookings] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("Pool Table");
  const [form, setForm] = useState(emptyForm("Pool Table"));
  const [editingId, setEditingId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [error, setError] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const lastLocalWriteRef = React.useRef(0);

  const loadFromStorage = useCallback(async (silent) => {
    if (!window.storage) {
      setStorageAvailable(false);
      setLoaded(true);
      return;
    }
    // skip a poll if we just wrote locally less than 5s ago, to avoid
    // a slow/failed remote read clobbering a fresh local add
    if (silent && Date.now() - lastLocalWriteRef.current < 5000) {
      return;
    }
    if (!silent) setSyncing(true);
    try {
      const result = await window.storage.get(STORAGE_KEY, true);
      let parsed = [];
      if (result && result.value) {
        const p = JSON.parse(result.value);
        parsed = Array.isArray(p) ? p : [];
      }
      const kept = parsed.filter((b) => !isExpiredBooking(b));
      setBookings(kept);
      if (kept.length !== parsed.length && window.storage) {
        try {
          await window.storage.set(STORAGE_KEY, JSON.stringify(kept), true);
        } catch (e) {
          // non-critical
        }
      }
      setLastSynced(new Date());
      setStorageAvailable(true);
    } catch (e) {
      // key may not exist yet on first run - that's fine, not a real error
      if (!String(e && e.message).toLowerCase().includes("not found") &&
          !String(e && e.message).toLowerCase().includes("key")) {
        setStorageAvailable(false);
      }
    }
    setSyncing(false);
    setLoaded(true);
  }, []);

  const saveToStorage = useCallback(async (next) => {
    lastLocalWriteRef.current = Date.now();
    if (!window.storage) {
      setStorageAvailable(false);
      return;
    }
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(next), true);
      setLastSynced(new Date());
      setError("");
    } catch (e) {
      setError(
        "Saved on this screen only - live sync failed (" +
          (e && e.message ? e.message : "unknown error") +
          "). Try Refresh."
      );
    }
  }, []);

  useEffect(() => {
    loadFromStorage(false);
    const interval = setInterval(() => loadFromStorage(true), 4000);
    return () => clearInterval(interval);
  }, [loadFromStorage]);

  useEffect(() => {
    setForm(emptyForm(tab));
    setEditingId(null);
  }, [tab]);

  const resetForm = () => {
    setForm(emptyForm(tab));
    setEditingId(null);
  };

  const startEdit = (b) => {
    setForm({
      id: b.id,
      area: b.area,
      guestName: b.guestName,
      phone: b.phone || "",
      date: b.date || "",
      partySize: b.partySize,
      time: b.time,
      hours: b.hours,
      hourlyRate: b.hourlyRate,
      advanceAmount: b.advanceAmount,
      advancePaid: b.advancePaid,
      paid: b.paid,
      notes: b.notes || "",
    });
    setEditingId(b.id);
  };

  const submitForm = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    try {
      if (!form.guestName || !form.guestName.trim()) {
        setError("Enter a guest name first.");
        return;
      }
      if (!form.date) {
        setError("Pick a date first.");
        return;
      }
      if (!form.time || !form.time.trim()) {
        setError("Enter a time first.");
        return;
      }
      setError("");
      let next;
      if (editingId) {
        next = bookings.map((b) => (b.id === editingId ? { ...form, id: editingId } : b));
      } else {
        next = [...bookings, { ...form, id: uid() }];
      }
      setBookings(next);
      resetForm();
      await saveToStorage(next);
    } catch (err) {
      setError("Something went wrong adding this booking: " + (err && err.message ? err.message : String(err)));
    }
  };

  const togglePaid = async (id) => {
    const next = bookings.map((b) => (b.id === id ? { ...b, paid: !b.paid } : b));
    setBookings(next);
    await saveToStorage(next);
  };

  const toggleAdvance = async (id) => {
    const next = bookings.map((b) => (b.id === id ? { ...b, advancePaid: !b.advancePaid } : b));
    setBookings(next);
    await saveToStorage(next);
  };

  const deleteBooking = async (id) => {
    const next = bookings.filter((b) => b.id !== id);
    setBookings(next);
    await saveToStorage(next);
    if (editingId === id) resetForm();
    setConfirmDeleteId(null);
  };

  const total = (b) => (Number(b.hours) || 0) * (Number(b.hourlyRate) || 0);

  const areaBookings = bookings.filter((b) => b.area === tab && !isPastBooking(b));
  const historyBookings = bookings
    .filter((b) => isPastBooking(b) && !isExpiredBooking(b))
    .sort((a, c) => {
      const da = closingDateTime(a);
      const dc = closingDateTime(c);
      return (dc ? dc.getTime() : 0) - (da ? da.getTime() : 0);
    });

  const tabs = [...AREAS, "History"];

  return (
    <div className="w-full max-w-5xl mx-auto p-4 text-slate-900">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-bold">Venue Booking &amp; POS</h1>
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${syncing ? "bg-amber-400" : "bg-emerald-500"}`}></span>
          {syncing ? "Syncing..." : lastSynced ? `Synced ${lastSynced.toLocaleTimeString()}` : "Not synced yet"}
          <button
            onClick={() => loadFromStorage(false)}
            className="ml-1 px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 text-slate-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {!storageAvailable && (
        <p className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-1.5 mb-3">
          Live sync isn't available right now - bookings will still work but may only show on this
          screen. Try the Refresh button, or reload this artifact.
        </p>
      )}
      <p className="text-xs text-slate-500 mb-4">
        Shared data - visible to everyone using this POS.
      </p>

      <div className="flex flex-wrap gap-1 mb-4 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px ${
              tab === t
                ? "border-red-600 text-red-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {!loaded && <p className="text-sm text-slate-500">Loading bookings...</p>}

      {loaded && AREAS.includes(tab) && (
        <div>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 bg-slate-50 border border-slate-200 rounded-lg p-3"
          >
            <input
              placeholder="Guest name"
              value={form.guestName}
              onChange={(e) => setForm({ ...form, guestName: e.target.value })}
              className="col-span-2 border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Phone number"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="col-span-2 border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Party size"
              type="number"
              min="0"
              value={form.partySize}
              onChange={(e) => setForm({ ...form, partySize: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Hours booked"
              type="number"
              min="0"
              step="0.5"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Rate / hour (Rs.)"
              type="number"
              min="0"
              value={form.hourlyRate}
              onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Advance amount (Rs.)"
              type="number"
              min="0"
              value={form.advanceAmount}
              onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="col-span-2 border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.advancePaid}
                onChange={(e) => setForm({ ...form, advancePaid: e.target.checked })}
              />
              Advance paid
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.paid}
                onChange={(e) => setForm({ ...form, paid: e.target.checked })}
              />
              Fully paid
            </label>
            {error && <p className="col-span-full text-xs text-red-600">{error}</p>}
            <div className="col-span-full flex gap-2 mt-1">
              <button
                type="button"
                onClick={submitForm}
                className="bg-red-600 text-white text-sm font-medium px-3 py-1.5 rounded hover:bg-red-700"
              >
                {editingId ? "Save changes" : "Add booking"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 pr-2">Guest</th>
                  <th className="py-1.5 pr-2">Phone</th>
                  <th className="py-1.5 pr-2">Date</th>
                  <th className="py-1.5 pr-2">Time</th>
                  <th className="py-1.5 pr-2">Party</th>
                  <th className="py-1.5 pr-2">Hours</th>
                  <th className="py-1.5 pr-2">Rate</th>
                  <th className="py-1.5 pr-2">Total</th>
                  <th className="py-1.5 pr-2">Advance</th>
                  <th className="py-1.5 pr-2">Paid</th>
                  <th className="py-1.5 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {areaBookings.length === 0 && (
                  <tr>
                    <td colSpan="11" className="py-4 text-center text-slate-400">
                      No bookings yet for {tab}.
                    </td>
                  </tr>
                )}
                {areaBookings.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2 font-medium">{b.guestName}</td>
                    <td className="py-1.5 pr-2">{b.phone || "-"}</td>
                    <td className="py-1.5 pr-2">{b.date || "-"}</td>
                    <td className="py-1.5 pr-2">{b.time}</td>
                    <td className="py-1.5 pr-2">{b.partySize || "-"}</td>
                    <td className="py-1.5 pr-2">{b.hours || "-"}</td>
                    <td className="py-1.5 pr-2">{currency(b.hourlyRate)}</td>
                    <td className="py-1.5 pr-2 font-medium">{currency(total(b))}</td>
                    <td className="py-1.5 pr-2">
                      <button
                        onClick={() => toggleAdvance(b.id)}
                        className={`text-xs px-2 py-1 rounded ${
                          b.advancePaid
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {b.advancePaid ? `Yes - ${currency(b.advanceAmount)}` : "No"}
                      </button>
                    </td>
                    <td className="py-1.5 pr-2">
                      <button
                        onClick={() => togglePaid(b.id)}
                        className={`text-xs px-2 py-1 rounded ${
                          b.paid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {b.paid ? "Paid" : "Unpaid"}
                      </button>
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {confirmDeleteId === b.id ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs text-slate-600">Cancel booking?</span>
                          <button
                            onClick={() => deleteBooking(b.id)}
                            className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs border border-slate-300 px-2 py-1 rounded hover:bg-slate-100"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(b)}
                            className="text-xs text-slate-500 hover:text-slate-800 mr-2"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(b.id)}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loaded && tab === "History" && (
        <div>
          <p className="text-xs text-slate-500 mb-3">
            Bookings whose date and time have passed. These drop off automatically 72 hours after
            their scheduled time.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 pr-2">Area</th>
                  <th className="py-1.5 pr-2">Guest</th>
                  <th className="py-1.5 pr-2">Phone</th>
                  <th className="py-1.5 pr-2">Date</th>
                  <th className="py-1.5 pr-2">Time</th>
                  <th className="py-1.5 pr-2">Total</th>
                  <th className="py-1.5 pr-2">Paid</th>
                  <th className="py-1.5 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {historyBookings.length === 0 && (
                  <tr>
                    <td colSpan="8" className="py-4 text-center text-slate-400">
                      No past bookings in the last 72 hours.
                    </td>
                  </tr>
                )}
                {historyBookings.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">{b.area}</td>
                    <td className="py-1.5 pr-2 font-medium">{b.guestName}</td>
                    <td className="py-1.5 pr-2">{b.phone || "-"}</td>
                    <td className="py-1.5 pr-2">{b.date || "-"}</td>
                    <td className="py-1.5 pr-2">{b.time}</td>
                    <td className="py-1.5 pr-2">{currency(total(b))}</td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          b.paid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {b.paid ? "Paid" : "Unpaid"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {confirmDeleteId === b.id ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs text-slate-600">Remove?</span>
                          <button
                            onClick={() => deleteBooking(b.id)}
                            className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs border border-slate-300 px-2 py-1 rounded hover:bg-slate-100"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(b.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

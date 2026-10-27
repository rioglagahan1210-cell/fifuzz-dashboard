
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://vptutmfidlanmyijfikk.supabase.co';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhbGciOiJIUzI1NiIsInJlZiI6InZwdHV0bWZpZGxhbm15aWpmaWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwOTU1OTQsImV4cCI6MjEwODY3MTU5NH0.g5lAZuXKLeZO89jlZac1F5WEDLgF_wOIot-yp8K5wQE';

const supabase = createClient(supabaseUrl, supabaseKey);

interface Slot {
  id: number;
  slot_name?: string | null;
  current_uid?: string | null;
  uid?: string | null;
  item_name?: string | null;
  weight?: number | string | null;
  temperature?: number | string | null;
  temp?: number | string | null;
  humidity?: number | string | null;
  status?: string | null;
  time_in?: string | null;
}

type Notice = {
  type: 'success' | 'error';
  message: string;
};

function formatMetric(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number.toLocaleString('id-ID', { maximumFractionDigits: 1 })
    : '--';
}

function formatTime(value?: string | null) {
  if (!value) return '--';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '--';

  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSlotMeta(slot: Slot) {
  const status = (slot.status ?? 'empty').toLowerCase();
  const hasWeight =
    slot.weight !== null &&
    slot.weight !== undefined &&
    slot.weight !== '';

  const isLowStock =
    status === 'occupied' &&
    hasWeight &&
    Number(slot.weight) < 50;

  if (status === 'pending_input') {
    return {
      kind: 'pending',
      label: 'INPUT REQUIRED',
      accent: 'border-t-violet-600',
      badge: 'border-violet-200 bg-violet-50 text-violet-800',
      description: 'Menunggu identitas barang',
    };
  }

  if (status === 'violation') {
    return {
      kind: 'violation',
      label: 'FIFO ALERT',
      accent: 'border-t-red-500',
      badge: 'border-red-200 bg-red-50 text-red-700',
      description: 'Periksa urutan pengambilan',
    };
  }

  if (isLowStock) {
    return {
      kind: 'low',
      label: 'LOW STOCK',
      accent: 'border-t-amber-400',
      badge: 'border-amber-200 bg-amber-50 text-amber-800',
      description: 'Berat berada di bawah 50 g',
    };
  }

  if (status === 'occupied') {
    return {
      kind: 'occupied',
      label: 'IN USE',
      accent: 'border-t-violet-600',
      badge: 'border-violet-200 bg-violet-50 text-violet-800',
      description: 'Barang tercatat di dalam rak',
    };
  }

  return {
    kind: 'empty',
    label: 'EMPTY',
    accent: 'border-t-[#ddd6e7]',
    badge: 'border-[#e8e2ee] bg-[#f7f5fa] text-[#777080]',
    description: 'Avaliable Slot Can Use',
  };
}

export default function EPantryDashboard() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [itemNameInput, setItemNameInput] = useState('');
  const [systemStatus, setSystemStatus] = useState('CONNECTING');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fetchSlots = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .order('id', { ascending: true });

      if (error) {
        setSystemStatus('OFFLINE');
        return;
      }

      const records = (data ?? []) as Slot[];

      setSlots(records);

      const pending = records.find(
        (slot) => slot.status === 'pending_input'
      );

      if (pending) {
        setSelectedSlot(pending);
      }
    } catch {
      setSystemStatus('OFFLINE');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSlots();

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'slots',
        },
        (payload) => {
          void fetchSlots();

          const updated = payload.new as Partial<Slot>;

          if (
            updated &&
            updated.id &&
            updated.status === 'pending_input'
          ) {
            setSelectedSlot(updated as Slot);
            setItemNameInput('');
            setNotice(null);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setSystemStatus('ONLINE');
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setSystemStatus('OFFLINE');
        } else {
          setSystemStatus('CONNECTING');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchSlots]);

  const summary = useMemo(() => {
    const occupied = slots.filter(
      (slot) => getSlotMeta(slot).kind === 'occupied'
    ).length;

    const empty = slots.filter(
      (slot) => getSlotMeta(slot).kind === 'empty'
    ).length;

    const attention = slots.filter((slot) => {
      const kind = getSlotMeta(slot).kind;
      return ['pending', 'violation', 'low'].includes(kind);
    }).length;

    return {
      total: slots.length,
      occupied,
      empty,
      attention,
    };
  }, [slots]);

  const handleSaveItemName = async () => {
    if (!selectedSlot || isSaving) return;

    setIsSaving(true);
    setNotice(null);

    try {
      const { error } = await supabase
        .from('slots')
        .update({
          item_name:
            itemNameInput.trim() ||
            `Barang Slot ${selectedSlot.id}`,
          status: 'occupied',
          time_in: new Date().toISOString(),
        })
        .eq('id', selectedSlot.id);

      if (error) {
        setNotice({
          type: 'error',
          message: 'Data gagal disimpan. Periksa koneksi dan izin database.',
        });
        return;
      }

      const savedId = selectedSlot.id;

      setSelectedSlot(null);
      setItemNameInput('');

      await fetchSlots();

      setNotice({
        type: 'success',
        message: `Identitas barang pada Storage ${savedId} berhasil disimpan.`,
      });
    } catch {
      setNotice({
        type: 'error',
        message: 'Terjadi kesalahan ketika menghubungi database.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const closeModal = () => {
    setSelectedSlot(null);
    setItemNameInput('');
  };

  const temperatureOf = (slot: Slot) =>
    slot.temperature ?? slot.temp;

  const uidOf = (slot: Slot) =>
    slot.current_uid ?? slot.uid ?? 'RFID-TAG-NEW';

  return (
    <main className="min-h-screen bg-[#f6f4f8] px-4 py-5 text-[#21192b] sm:px-6 lg:px-10 lg:py-8">
      <div className="mx-auto max-w-7xl">

        {/* HEADER */}
        <header className="mb-8 flex flex-col gap-6 rounded-2xl border border-[#e5deeb] bg-white p-5 shadow-sm sm:p-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#61358b] text-sm font-black tracking-tight text-white">
              FF
            </div>

            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#765491]">
                Inventory control
              </p>

              <h1 className="text-2xl font-extrabold tracking-[-0.045em] text-[#21192b] sm:text-3xl">
                FI-FUZZ
                <span className="ml-2 font-medium text-[#8a8192]">
                  Smart Storage
                </span>
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#756c7d]">
                Smart Food Storage for Food Quality Preservation Using Sugeno Fuzzy Logic and Automated FIFO with IoT Telemetry and Notification
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[#eee8f2] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="min-w-[150px]">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8a8192]">
                Realtime connection
              </p>

              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    systemStatus === 'ONLINE'
                      ? 'bg-[#6b3c98]'
                      : systemStatus === 'OFFLINE'
                        ? 'bg-red-500'
                        : 'bg-amber-400'
                  }`}
                />

                <span className="text-sm font-bold tracking-wide text-[#31263c]">
                  {systemStatus}
                </span>
              </div>
            </div>

            <div className="hidden h-10 w-px bg-[#e8e2ee] sm:block" />

            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8a8192]">
                Workspace
              </p>
              <p className="text-sm font-semibold text-[#31263c]">
                FI-FUZZ Operator
              </p>
            </div>
          </div>
        </header>

        {/* NOTIFICATION */}
        {notice && (
          <div
            role="status"
            className={`mb-6 flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${
              notice.type === 'success'
                ? 'border-violet-200 bg-violet-50 text-violet-900'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            <p className="leading-6">{notice.message}</p>

            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Tutup notifikasi"
              className="shrink-0 px-1 text-lg leading-none opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </div>
        )}

        {/* SUMMARY */}
        <section className="mb-9">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#765491]">
                System overview
              </p>
              <h2 className="text-xl font-bold tracking-tight text-[#21192b]">
                Inventory at a glance
              </h2>
            </div>

            <p className="text-xs text-[#817789]">
              Summary of the status of all storage slots
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: 'Total storage',
                value: summary.total,
                note: 'Registered Units',
                marker: 'bg-[#61358b]',
              },
              {
                label: 'Occupied',
                value: summary.occupied,
                note: 'Items Registered',
                marker: 'bg-[#8c65ae]',
              },
              {
                label: 'Empty slots',
                value: summary.empty,
                note: 'Avaliable Capacity',
                marker: 'bg-[#c9c0d2]',
              },
              {
                label: 'Needs attention',
                value: summary.attention,
                note: 'Requires Inspection',
                marker: 'bg-[#b67c30]',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="relative overflow-hidden rounded-xl border border-[#e6dfec] bg-white p-4 sm:p-5"
              >
                <div className={`absolute inset-x-0 top-0 h-[3px] ${stat.marker}`} />

                <p className="text-xs font-medium text-[#817789]">
                  {stat.label}
                </p>

                <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-[#21192b] sm:text-4xl">
                  {stat.value.toString().padStart(2, '0')}
                </p>

                <p className="mt-2 text-[11px] text-[#958b9d]">
                  {stat.note}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* STORAGE GRID */}
        <section>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#765491]">
                STORAGE MANAGEMENT
              </p>

              <h2 className="text-2xl font-bold tracking-[-0.035em] text-[#21192b]">
                Storage units
              </h2>

              <p className="mt-1 text-sm text-[#817789]">
                Item Status, Weight, and Environmental Conditions
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#756c7d]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#61358b]" />
              <span>Data diperbarui otomatis</span>
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-xl border border-[#e6dfec] bg-white px-5 py-12 text-center">
              <p className="text-sm font-semibold text-[#493957]">
                Loading storage data
              </p>
              <p className="mt-2 text-xs text-[#958b9d]">
                Menghubungkan ke database...
              </p>
            </div>
          ) : slots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#d8cce4] bg-white px-5 py-12 text-center">
              <h3 className="text-base font-bold text-[#31263c]">
                Belum ada slot penyimpanan
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#817789]">
                Data belum ditemukan pada tabel slots. Periksa data awal
                dan konfigurasi akses database Supabase.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {slots.map((slot) => {
                const meta = getSlotMeta(slot);

                return (
                  <article
                    key={slot.id}
                    className={`flex min-h-[280px] flex-col rounded-xl border border-[#e6dfec] border-t-4 ${meta.accent} bg-white p-5 transition-colors duration-150 hover:border-x-[#d8cbe5] hover:border-b-[#d8cbe5] sm:p-6`}
                  >
                    {/* CARD HEADER */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#958b9d]">
                          Storage unit
                        </p>

                        <h3 className="mt-1 text-xl font-extrabold tracking-tight text-[#21192b]">
                          {String(slot.slot_name || `Storage ${String(slot.id).padStart(2, '0')}`)}
                        </h3>
                      </div>

                      <span
                        className={`inline-flex shrink-0 items-center rounded-md border px-2 py-1 text-[9px] font-bold tracking-[0.08em] ${meta.badge}`}
                      >
                        {meta.label}
                      </span>
                    </div>

                    <div className="my-5 border-t border-[#eee8f2]" />

                    {/* ITEM */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#958b9d]">
                        Item identity
                      </p>

                      <p className="mt-1 min-h-7 break-words text-base font-semibold text-[#30243a]">
                        {slot.item_name || 'No item assigned'}
                      </p>

                      <p className="mt-1 text-xs text-[#958b9d]">
                        {meta.description}
                      </p>
                    </div>

                    {/* WEIGHT */}
                    <div className="mt-6">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#958b9d]">
                        Current weight
                      </p>

                      <div className="mt-1 flex items-baseline gap-2">
                        <span
                          className={`text-4xl font-bold tabular-nums tracking-[-0.055em] ${
                            meta.kind === 'low'
                              ? 'text-amber-700'
                              : 'text-[#61358b]'
                          }`}
                        >
                          {formatMetric(slot.weight)}
                        </span>

                        <span className="text-sm font-medium text-[#817789]">
                          grams
                        </span>
                      </div>
                    </div>

                    {/* SENSOR DATA */}
                    <div className="mt-auto grid grid-cols-2 gap-3 border-t border-[#eee8f2] pt-4">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#958b9d]">
                          Temperature
                        </p>

                        <p className="mt-1 text-sm font-semibold tabular-nums text-[#31263c]">
                          {formatMetric(temperatureOf(slot))}
                          <span className="ml-1 text-xs font-normal text-[#817789]">
                            °C
                          </span>
                        </p>
                      </div>

                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#958b9d]">
                          Humidity
                        </p>

                        <p className="mt-1 text-sm font-semibold tabular-nums text-[#31263c]">
                          {formatMetric(slot.humidity)}
                          <span className="ml-1 text-xs font-normal text-[#817789]">
                            % RH
                          </span>
                        </p>
                      </div>

                      <div className="col-span-2 mt-1 flex items-center justify-between gap-2">
                        <p className="text-[10px] text-[#958b9d]">
                          FIFO entry
                        </p>

                        <p className="text-right text-[10px] font-medium tabular-nums text-[#665a73]">
                          {formatTime(slot.time_in)}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* FOOTER */}
        <footer className="mt-10 flex flex-col gap-2 border-t border-[#e5deeb] py-5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#958b9d] sm:flex-row sm:items-center sm:justify-between">
          <p>FI-FUZZ / Smart Storage System</p>
          <p>Supabase Realtime · Vercel</p>
        </footer>
      </div>

      {/* RFID MODAL */}
      {selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17111d]/60 p-4 backdrop-blur-[3px]">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="rfid-modal-title"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-[#e3d9ed] bg-white shadow-2xl"
          >
            <div className="h-1.5 bg-[#61358b]" />

            <div className="p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#765491]">
                    RFID identification
                  </p>

                  <h3
                    id="rfid-modal-title"
                    className="mt-2 text-2xl font-bold tracking-tight text-[#21192b]"
                  >
                    Identify item
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-[#817789]">
                    Tag baru terdeteksi. Masukkan nama barang untuk
                    mencatat identitas dan waktu masuk FIFO.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="Tutup modal"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#e8e2ee] text-xl text-[#817789] transition-colors hover:bg-[#f6f4f8] hover:text-[#21192b]"
                >
                  ×
                </button>
              </div>

              <div className="mt-6 rounded-xl border border-[#e8e0ef] bg-[#faf8fc] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-[#817789]">
                    Storage unit
                  </span>

                  <span className="text-sm font-bold text-[#49315f]">
                    #{selectedSlot.id}
                  </span>
                </div>

                <div className="mt-3 border-t border-[#e8e0ef] pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#958b9d]">
                    RFID UID
                  </p>

                  <p className="mt-1 break-all font-mono text-xs text-[#49315f]">
                    {uidOf(selectedSlot)}
                  </p>
                </div>
              </div>

              <form
                className="mt-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveItemName();
                }}
              >
                <label
                  htmlFor="item-name"
                  className="mb-2 block text-xs font-bold text-[#493957]"
                >
                  Nama barang / bahan pangan
                </label>

                <input
                  id="item-name"
                  type="text"
                  maxLength={100}
                  placeholder="Contoh: Beras Mentik"
                  value={itemNameInput}
                  onChange={(event) => setItemNameInput(event.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-[#dcd2e6] bg-white px-4 py-3 text-sm text-[#21192b] outline-none transition-colors placeholder:text-[#b0a6b9] focus:border-[#7950a0] focus:ring-2 focus:ring-[#61358b]/10"
                />

                <p className="mt-2 text-[10px] leading-5 text-[#958b9d]">
                  Jika nama dikosongkan, sistem akan menggunakan nama
                  otomatis berdasarkan nomor slot.
                </p>

                {notice?.type === 'error' && (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                    {notice.message}
                  </p>
                )}

                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={closeModal}
                    className="rounded-lg border border-[#e2dbe9] px-4 py-3 text-sm font-semibold text-[#62566e] transition-colors hover:bg-[#f6f4f8] disabled:cursor-not-allowed disabled:opacity-50 sm:w-1/3"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 rounded-lg bg-[#61358b] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#4f2875] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? 'Saving...' : 'Save item & activate FIFO'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { GameState, IsoDate, Level, SceneHandle, SceneTarget } from "@second-half/contracts";
import type { GameAdapter } from "@/lib/adapter";
import { createMockAdapter } from "@/lib/adapter";
import { draftReducer, toCheckIn } from "@/lib/checkin";
import { activeHabits, hudModel } from "@/lib/hud";
import { toastsForDay } from "@/lib/messages";
import { CheckInSheet } from "./CheckInSheet";
import { Hud } from "./Hud";
import { SceneSlot } from "./SceneSlot";
import { Toasts, type ToastItem } from "./Toasts";

const TOAST_MS = 4600;
const EVENT_GAP_MS = 700;

/** Home: the scene fills the screen, the HUD sits on top, tonight's check-in docks at the bottom. */
export function Home({ adapter: given }: { adapter?: GameAdapter }) {
  const adapter = useMemo(() => given ?? createMockAdapter(), [given]);
  const [state, setState] = useState<GameState | null>(null);
  const [sheet, setSheet] = useState<"checkin" | null>(null);
  const [draft, dispatch] = useReducer(draftReducer, {});
  const [busy, setBusy] = useState(false);
  const [closedOn, setClosedOn] = useState<IsoDate | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const scene = useRef<SceneHandle | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    let live = true;
    adapter.load().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [adapter]);

  const view = useMemo(() => (state ? adapter.toWorldView(state) : null), [adapter, state]);
  const habits = useMemo(() => (state ? activeHabits(state) : []), [state]);

  const pushToast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++toastId.current;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(null);
    scene.current?.focus({ kind: "home" });
  }, []);

  const onSelect = useCallback((t: SceneTarget & { level?: Level }) => {
    // Area, athlete and Vision sheets land in the next pull request. For now the scene just focuses.
    scene.current?.focus(t);
  }, []);

  const closeDay = async () => {
    if (!state || busy) return;
    setBusy(true);
    try {
      const checkIn = toCheckIn(draft, habits.map((h) => h.id), state.today);
      const { state: next, events } = await adapter.closeDay(state, checkIn);
      setState(next);
      setClosedOn(state.today);
      dispatch({ type: "reset" });
      closeSheet();
      events.forEach((e, i) => setTimeout(() => scene.current?.play(e), 300 + i * EVENT_GAP_MS));
      toastsForDay(events, next, adapter.rules).forEach((t, i) => setTimeout(() => pushToast(t), i * EVENT_GAP_MS * 1.5));
    } catch (err) {
      pushToast({ title: "Coach", body: "That check-in didn't save. Your answers are still here, so try Close the day again.", kind: "bad" });
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const openCheckIn = () => {
    if (closedOn && state && closedOn === state.today) {
      pushToast({ title: "Coach", body: "Today is closed. Tomorrow's check-in opens in the evening.", kind: "info" });
      return;
    }
    scene.current?.focus({ kind: "home" });
    setSheet("checkin");
  };

  const hud = state ? hudModel(state, adapter.rules) : null;
  const closed = !!state && closedOn === state.today;

  return (
    <main className="app">
      <SceneSlot view={view} onReady={(h) => (scene.current = h)} onSelect={onSelect} />
      {hud ? <Hud hud={hud} /> : null}
      <div className="dock">
        {state ? (
          <button className={`cta${closed ? " done" : ""}`} onClick={openCheckIn}>
            {closed ? (
              <>
                Day closed <small>· see you tomorrow</small>
              </>
            ) : (
              <>
                Tonight&apos;s check-in{" "}
                <small>
                  · {habits.length} {habits.length === 1 ? "habit" : "habits"}
                </small>
              </>
            )}
          </button>
        ) : null}
      </div>
      {state ? (
        <CheckInSheet
          open={sheet === "checkin"}
          state={state}
          rules={adapter.rules}
          habits={habits}
          draft={draft}
          dispatch={dispatch}
          busy={busy}
          onClose={closeSheet}
          onCloseDay={closeDay}
        />
      ) : null}
      <Toasts items={toasts} />
      {!state ? <div className="loading">Loading your game…</div> : null}
    </main>
  );
}

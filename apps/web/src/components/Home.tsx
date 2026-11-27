"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { AreaId, GameEvent, Level, PlanEdit, ResistanceId, SceneHandle, SceneTarget } from "@second-half/contracts";
import { ComingSoonError, createLocalAdapter, StaleGameError, type GameAdapter, type GameStep, type SavedGame } from "@/lib/adapter";
import { ASSETS_BASE_URL } from "@/lib/config";
import { rejection } from "@/lib/plan";
import { draftReducer, toCheckIn } from "@/lib/checkin";
import { localIsoDate } from "@/lib/dates";
import { activeHabits, hudModel } from "@/lib/hud";
import { toastsFor, toastsForDay, toastsForWeek, type Toast } from "@/lib/messages";
import { createSceneWithFallback } from "@/lib/sceneLoader";
import { browserStore } from "@/lib/storage";
import { CheckInSheet } from "./CheckInSheet";
import { DemoMenu, type DemoAction } from "./DemoMenu";
import { GoalEditor } from "./GoalEditor";
import { Hud, type HudTarget } from "./Hud";
import { LevelsScreen, type EditOutcome } from "./LevelsScreen";
import { SceneSlot } from "./SceneSlot";
import { Sheet } from "./Sheet";
import { AreaSheetBody, AthleteSheetBody, ResistanceSheetBody, sheetTitle, VisionSheetBody } from "./Sheets";
import { Toasts, type ToastItem } from "./Toasts";

const TOAST_MS = 4600;
const EVENT_GAP_MS = 700;
/** Matches the CSS breakpoint where the side sheet docks to the right. */
const SIDE_SHEET_QUERY = "(min-width: 900px)";

type DetailSheet =
  | { kind: "area"; area: AreaId; level?: Level }
  | { kind: "athlete" }
  | { kind: "vision" }
  | { kind: "resistance"; id: ResistanceId }
  | { kind: "goal"; goalId: string };
type OpenSheet = { kind: "checkin" } | DetailSheet;

/** Home: the scene fills the screen, the HUD sits on top, tonight's check-in docks at the bottom, details open as sheets. */
export function Home({ adapter: given, account }: { adapter?: GameAdapter; account?: ReactNode }) {
  const adapter = useMemo(() => given ?? createLocalAdapter({ store: browserStore() }), [given]);
  const [game, setGame] = useState<SavedGame | null>(null);
  // Latest game for handlers that run after an await (several plan edits in a row).
  const gameRef = useRef<SavedGame | null>(null);
  gameRef.current = game;
  /** A full screen over the map: "Your levels". */
  const [screen, setScreen] = useState<"levels" | null>(null);
  const screenOpener = useRef<HTMLElement | null>(null);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  // The last sheet shown, so its content stays put while it slides away.
  const [shown, setShown] = useState<OpenSheet | null>(null);
  const [draft, dispatch] = useReducer(draftReducer, {});
  const [busy, setBusy] = useState(false);
  const [lastEvents, setLastEvents] = useState<GameEvent[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const scene = useRef<SceneHandle | null>(null);
  const toastId = useRef(0);
  /** Toasts still queued from the last step, so opening a sheet can drop them. */
  const queued = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** The control that opened the sheet, so focus can go back to it when the sheet closes. */
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    adapter.load(localIsoDate(new Date())).then((g) => live && setGame(g));
    return () => {
      live = false;
    };
  }, [adapter]);

  const state = game?.state ?? null;
  const view = useMemo(() => (state ? adapter.toWorldView(state) : null), [adapter, state]);
  const habits = useMemo(() => (state ? activeHabits(state) : []), [state]);

  const pushToast = useCallback((t: Toast) => {
    const id = ++toastId.current;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  /** Applies a step: new game, events to the scene, toasts in the coach voice. */
  const applyStep = useCallback(
    (step: GameStep, toasts: Toast[]) => {
      setGame(step.game);
      setLastEvents(step.events);
      step.events.forEach((e, i) => setTimeout(() => scene.current?.play(e), 300 + i * EVENT_GAP_MS));
      queued.current = toasts.map((t, i) => setTimeout(() => pushToast(t), i * EVENT_GAP_MS * 1.5));
    },
    [pushToast],
  );

  const failed = useCallback(
    (err: unknown, what: string) => {
      if (err instanceof StaleGameError) {
        // Saved from another device (or the weekly job ran): show the latest game and let the player redo it.
        gameRef.current = err.game;
        setGame(err.game);
        pushToast({ title: "Coach", body: `Your game changed on another device, so this is the latest. ${what} didn't save; do it again here.`, kind: "info" });
        return;
      }
      console.error(err);
      pushToast({ title: "Coach", body: `${what} didn't go through. Nothing changed, so try again.`, kind: "bad" });
    },
    [pushToast],
  );

  const open = useCallback((s: OpenSheet) => {
    if (!opener.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The sheet's coach line carries the latest news, so toasts would only cover it.
    queued.current.forEach(clearTimeout);
    queued.current = [];
    setToasts([]);
    setSheet(s);
    setShown(s);
    if (s.kind === "checkin") scene.current?.focus({ kind: "home" });
    else if (s.kind === "area") scene.current?.focus({ kind: "area", area: s.area });
    else if (s.kind !== "goal") scene.current?.focus(s);
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(null);
    scene.current?.focus({ kind: "home" });
  }, []);

  // Return focus once the sheet is closed and the background is no longer inert.
  useEffect(() => {
    if (sheet !== null || !opener.current) return;
    const el = opener.current;
    opener.current = null;
    if (el.isConnected) el.focus({ preventScroll: true });
  }, [sheet]);

  const onSelect = useCallback(
    (t: SceneTarget & { level?: Level }) => {
      switch (t.kind) {
        case "home":
          closeSheet();
          return;
        case "area":
          open(t.level ? { kind: "area", area: t.area, level: t.level } : { kind: "area", area: t.area });
          return;
        case "athlete":
        case "vision":
          open({ kind: t.kind });
          return;
        case "resistance":
          open({ kind: "resistance", id: t.id });
          return;
        default: {
          const unhandled: never = t;
          return unhandled;
        }
      }
    },
    [open, closeSheet],
  );

  const openLevels = useCallback(() => {
    screenOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    opener.current = null;
    setSheet(null);
    setScreen("levels");
  }, []);

  const closeLevels = useCallback(() => {
    setScreen(null);
    const el = screenOpener.current;
    screenOpener.current = null;
    // The opener may have been inside a sheet that has since closed; fall back to the level badge.
    setTimeout(() => {
      const target = el?.isConnected && !el.closest("[inert]") ? el : document.querySelector<HTMLElement>("button.lvl");
      target?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (screen === null || sheet !== null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeLevels();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, sheet, closeLevels]);

  const onHud = useCallback((t: HudTarget) => (t.kind === "levels" ? openLevels() : open(t)), [open, openLevels]);

  /** One plan edit, reported back to the form that sent it. */
  const applyEdit = useCallback(
    async (edit: PlanEdit | null): Promise<EditOutcome> => {
      const g = gameRef.current;
      if (!edit) return { status: "unchanged" };
      if (!g) return { status: "failed" };
      try {
        const step = await adapter.applyPlanEdit(g, edit);
        const reason = rejection(step.events);
        gameRef.current = step.game;
        setGame(step.game);
        if (reason) return { status: "rejected", reason };
        setLastEvents(step.events);
        return { status: "applied" };
      } catch (err) {
        if (err instanceof ComingSoonError) return { status: "coming_soon" };
        if (err instanceof StaleGameError) failed(err, "That edit");
        else console.error(err);
        return { status: "failed" };
      }
    },
    [adapter, failed],
  );

  const saveVision = useCallback(
    async (text: string): Promise<EditOutcome> => {
      const g = gameRef.current;
      if (!g) return { status: "failed" };
      try {
        const next = await adapter.setVision(g, text);
        gameRef.current = next;
        setGame(next);
        return { status: "applied" };
      } catch (err) {
        if (err instanceof StaleGameError) failed(err, "Your Vision");
        else console.error(err);
        return { status: "failed" };
      }
    },
    [adapter, failed],
  );

  // A detail sheet leaves room for what it's about: tell the scene what the sheet covers, then frame the
  // subject (the athlete, an area, the summit or a Resistance marker) in the space left over.
  const sceneTarget: SceneTarget | null =
    sheet?.kind === "area"
      ? { kind: "area", area: sheet.area }
      : sheet?.kind === "athlete" || sheet?.kind === "vision"
        ? { kind: sheet.kind }
        : sheet?.kind === "resistance"
          ? { kind: "resistance", id: sheet.id }
          : null;
  const targetKey = sceneTarget ? JSON.stringify(sceneTarget) : "";
  useEffect(() => {
    if (!targetKey) {
      scene.current?.setInsets?.({ top: 0, right: 0, bottom: 0, left: 0 });
      return;
    }
    const target = JSON.parse(targetKey) as SceneTarget;
    const panel = document.querySelector<HTMLElement>("section.sheet.side");
    const frame = () => {
      const hud = document.querySelector<HTMLElement>("header.hud");
      if (!panel) return;
      const wide = matchMedia(SIDE_SHEET_QUERY).matches;
      scene.current?.setInsets?.({
        top: hud?.offsetHeight ?? 0,
        right: wide ? panel.offsetWidth : 0,
        bottom: wide ? 0 : panel.offsetHeight,
        left: 0,
      });
      scene.current?.focus(target);
    };
    const raf = requestAnimationFrame(frame);
    // Re-frame when the sheet changes detent or the window resizes.
    const ro = typeof ResizeObserver === "function" && panel ? new ResizeObserver(frame) : null;
    if (panel) ro?.observe(panel);
    window.addEventListener("resize", frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", frame);
    };
  }, [targetKey]);

  const canEdit = useMemo(() => (state ? adapter.canEditPlan(state) : false), [adapter, state]);

  const closed = !!game && game.closedOn === game.date;

  const closeDay = async () => {
    if (!game || busy) return;
    setBusy(true);
    try {
      const checkIn = toCheckIn(draft, habits.map((h) => h.id), game.date);
      const step = await adapter.closeDay(game, checkIn);
      dispatch({ type: "reset" });
      closeSheet();
      applyStep(step, toastsForDay(step.events, step.game.state, adapter.rules));
    } catch (err) {
      failed(err, "That check-in");
    } finally {
      setBusy(false);
    }
  };

  const run = async (what: string, fn: () => Promise<GameStep>, toasts: (s: GameStep) => Toast[]) => {
    if (!game || busy) return;
    setBusy(true);
    try {
      const step = await fn();
      applyStep(step, toasts(step));
    } catch (err) {
      failed(err, what);
    } finally {
      setBusy(false);
    }
  };

  const onDemo = async (a: DemoAction) => {
    if (!game) return;
    if (a === "week") {
      closeSheet();
      return run("The week", () => adapter.passWeek(game), (s) => toastsForWeek(s.events, s.game.state, adapter.rules));
    }
    setBusy(true);
    try {
      if (a === "day") {
        setGame(await adapter.nextDay(game));
        pushToast({ title: "Coach", body: "New day. Tonight's check-in is open.", kind: "info" });
      } else {
        closeSheet();
        dispatch({ type: "reset" });
        setLastEvents([]);
        setGame(await adapter.reset(localIsoDate(new Date())));
        pushToast({ title: "Coach", body: "Fresh start. Same mountain.", kind: "info" });
      }
    } catch (err) {
      failed(err, "That");
    } finally {
      setBusy(false);
    }
  };

  const openCheckIn = () => {
    if (closed) {
      pushToast({ title: "Coach", body: "Today is closed. Tomorrow's check-in opens in the evening.", kind: "info" });
      return;
    }
    open({ kind: "checkin" });
  };

  const hud = state && game ? hudModel(state, adapter.rules, game.date) : null;
  const detail = shown && shown.kind !== "checkin" ? shown : null;

  return (
    <main className="app">
      {/* Everything behind an open sheet is inert, so Tab and screen readers stay in the sheet. */}
      <div className="backdrop" inert={sheet !== null}>
        <div className="backdrop" inert={screen !== null}>
        <SceneSlot view={view} createScene={createSceneWithFallback} assetsBaseUrl={ASSETS_BASE_URL} onReady={(h) => (scene.current = h)} onSelect={onSelect} />
        {hud && game ? <Hud hud={hud} onOpen={onHud} actions={adapter.mode === "local" ? <DemoMenu date={game.date} busy={busy} onAction={onDemo} /> : account} /> : null}
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
        </div>
        {screen === "levels" && state ? (
          <LevelsScreen
            state={state}
            rules={adapter.rules}
            canEdit={canEdit}
            onBack={closeLevels}
            onGoal={(g) => open({ kind: "goal", goalId: g.id })}
            apply={applyEdit}
            saveVision={saveVision}
          />
        ) : null}
      </div>
      {state ? (
        <CheckInSheet
          open={sheet?.kind === "checkin"}
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
      {state && game ? (
        <Sheet
          open={!!sheet && sheet.kind !== "checkin"}
          title={detail ? sheetTitle(detail, state) : "Details"}
          onClose={closeSheet}
          variant="side"
        >
          {detail?.kind === "area" ? (
            <AreaSheetBody
              state={state}
              area={detail.area}
              {...(detail.level ? { level: detail.level } : {})}
              rules={adapter.rules}
              events={lastEvents}
              onResistance={(id) => open({ kind: "resistance", id })}
              busy={busy}
              onVerify={(goalId, note) =>
                run("Logging that", () => adapter.verifyAchievement(game, goalId, note || undefined), (s) => toastsFor(s.events, s.game.state, adapter.rules))
              }
            />
          ) : detail?.kind === "athlete" ? (
            <AthleteSheetBody
              state={state}
              rules={adapter.rules}
              events={lastEvents}
              busy={busy}
              onLifeEvent={() => run("Logging that", () => adapter.startLifeEvent(game), (s) => toastsFor(s.events, s.game.state, adapter.rules))}
            />
          ) : detail?.kind === "vision" ? (
            <VisionSheetBody state={state} projected={adapter.projectedFinalScore(state)} date={game.date} onLevels={openLevels} />
          ) : detail?.kind === "resistance" ? (
            <ResistanceSheetBody
              state={state}
              id={detail.id}
              rules={adapter.rules}
              events={lastEvents}
              busy={busy}
              onEquip={(planId, on) =>
                run("That game plan", () => adapter.equipGamePlan(game, planId, on), (s) => {
                  const t = toastsFor(s.events, s.game.state, adapter.rules);
                  return t.length ? t : [{ title: "Game plan", body: on ? "Equipped. It halves this Resistance's next setback." : "Taken off.", kind: "info" }];
                })
              }
            />
          ) : detail?.kind === "goal" ? (
            <GoalEditor state={state} goalId={detail.goalId} apply={applyEdit} />
          ) : null}
        </Sheet>
      ) : null}
      <Toasts items={toasts} />
      {!state ? <div className="loading">Loading your game…</div> : null}
    </main>
  );
}

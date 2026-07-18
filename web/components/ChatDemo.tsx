"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = "present" | "listening" | "excused";
const STATUS_ORDER: Status[] = ["present", "listening", "excused"];

type Widget = {
  header: string;
  listCount: string;
  prompt: string;
  total: string;
  notRegistered: string;
  statuses: Record<Status, string>;
  admin: { refresh: string; edit: string; freeze: string; stop: string };
};

type Approval = {
  header: string;
  page: string;
  note: string;
  addTeacher: string;
  dismiss: string;
};

type Nudge = {
  text: string;
  hint: string;
  button: string;
};

const EMOJI: Record<Status | "pending", string> = {
  present: "✅",
  listening: "👂",
  excused: "🔔",
  pending: "⏳",
};

function applyNext(arr: (Status | null)[], status: Status): (Status | null)[] {
  const i = arr.findIndex((s) => s === null);
  if (i === -1) return arr;
  const next = [...arr];
  next[i] = status;
  return next;
}

export default function ChatDemo() {
  const t = useTranslations("demo");
  const w = t.raw("widget") as Widget;
  const approval = t.raw("approval") as Approval;
  const nudge = t.raw("nudge") as Nudge;
  const rosterNames = t.raw("roster") as string[];
  const guestName = t("guest");

  const [showCommand, setShowCommand] = useState(false);
  const [commandExiting, setCommandExiting] = useState(false);
  const [showWidget, setShowWidget] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const [nudgeActive, setNudgeActive] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [roster, setRoster] = useState<(Status | null)[]>(() =>
    rosterNames.map(() => null),
  );
  const [guestStatus, setGuestStatus] = useState<Status | null>(null);
  const [guestApproved, setGuestApproved] = useState(false);
  const [active, setActive] = useState<Status | null>(null);
  const [approveActive, setApproveActive] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const schedule = useCallback(() => {
    clearTimers();
    const push = (fn: () => void, at: number) =>
      timers.current.push(setTimeout(fn, at));

    // The admin sends the command — it slides in at the bottom of the chat.
    push(() => setShowCommand(true), 600);
    // The bot processes it: the widget renders and the command is deleted.
    push(() => setShowWidget(true), 1600);
    push(() => setCommandExiting(true), 2100);
    push(() => setShowCommand(false), 2500);

    // Rostered members self-register.
    push(() => setActive("present"), 3200);
    push(() => {
      setActive(null);
      setRoster((p) => applyNext(p, "present"));
    }, 3700);

    push(() => setActive("listening"), 4500);
    push(() => {
      setActive(null);
      setRoster((p) => applyNext(p, "listening"));
    }, 5000);

    // A walk-in (not on the roster) taps present: recorded live + queued.
    push(() => setActive("present"), 5900);
    push(() => {
      setActive(null);
      setGuestStatus("present");
    }, 6400);

    // The bot auto-pings the group: a data-free nudge with a button.
    push(() => setShowNudge(true), 7000);

    // Admin taps the nudge → the pending panel opens (privately).
    push(() => setNudgeActive(true), 7900);
    push(() => {
      setNudgeActive(false);
      setShowPending(true);
    }, 8300);

    // Admin admits the walk-in via the approval widget.
    push(() => setApproveActive(true), 9100);
    push(() => {
      setApproveActive(false);
      setGuestApproved(true);
    }, 9700);
  }, [clearTimers]);

  const play = useCallback(() => {
    clearTimers();
    setShowCommand(false);
    setCommandExiting(false);
    setShowWidget(false);
    setShowNudge(false);
    setNudgeActive(false);
    setShowPending(false);
    setRoster(rosterNames.map(() => null));
    setGuestStatus(null);
    setGuestApproved(false);
    setActive(null);
    setApproveActive(false);
    schedule();
  }, [clearTimers, schedule, rosterNames]);

  const onTap = useCallback(
    (status: Status) => {
      clearTimers();
      setActive(null);
      const i = roster.findIndex((s) => s === null);
      if (i !== -1) {
        setRoster((prev) => applyNext(prev, status));
      } else if (guestStatus === null) {
        // Roster is full — the next tap is treated as a walk-in visitor, which
        // makes the bot ping the group with the pending nudge.
        setGuestStatus(status);
        timers.current.push(setTimeout(() => setShowNudge(true), 700));
      }
    },
    [clearTimers, roster, guestStatus],
  );

  // Tapping the group nudge opens the pending panel (privately, in real life).
  const onOpenPanel = useCallback(() => {
    clearTimers();
    setNudgeActive(true);
    setShowPending(true);
    timers.current.push(setTimeout(() => setNudgeActive(false), 250));
  }, [clearTimers]);

  const onApprove = useCallback(() => {
    clearTimers();
    setApproveActive(false);
    setGuestApproved(true);
  }, [clearTimers]);

  useEffect(() => {
    schedule();
    return clearTimers;
  }, [schedule, clearTimers]);

  // Auto-scroll to the latest message, like a live Telegram chat. Once the
  // walk-in is approved we scroll back up to the group list so the viewer sees
  // her ⏳ tag has dropped off.
  const rosterKey = roster.join("|");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (guestApproved) {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [
    showCommand,
    commandExiting,
    showWidget,
    showNudge,
    showPending,
    guestStatus,
    guestApproved,
    rosterKey,
  ]);

  // Live list = roster members + the walk-in once she taps a status.
  const listItems = [
    ...rosterNames.map((name, i) => ({
      name,
      status: roster[i],
      guest: false,
    })),
    ...(guestStatus
      ? [{ name: guestName, status: guestStatus, guest: !guestApproved }]
      : []),
  ];

  const counts: Record<Status, number> = {
    present: 0,
    listening: 0,
    excused: 0,
  };
  listItems.forEach((item) => {
    if (item.status) counts[item.status] += 1;
  });
  const pending = roster.filter((s) => s === null).length;
  const done = pending === 0 && guestStatus !== null;
  const showApproval = showPending && guestStatus !== null && !guestApproved;
  // While the private approval panel is open the header reads as the teacher's
  // DM with the bot; otherwise it is the group chat.
  const inDm = showApproval;

  // Telegram inline-keyboard button (flat, translucent, centered accent text).
  const tgBtn =
    "flex items-center justify-center rounded-lg px-2 py-2.5 text-center text-[13px] font-medium tg-btn";
  const adminBtn = `${tgBtn} cursor-default`;

  return (
    <section id="demo" className="mx-auto max-w-6xl px-4 py-20">
      <div className="text-center">
        <h2 className="text-3xl font-bold sm:text-4xl">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted">{t("subtitle")}</p>
      </div>

      <div className="mx-auto mt-10 max-w-md">
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lg">
          {/* Chat header — switches context: the group (where /startlist runs
              and students tap) becomes the teacher's private chat with the bot
              while the pending-approval panel is open, then back to the group so
              the viewer sees the ⏳ tag drop off the approved walk-in. */}
          <div className="brand-gradient flex items-center gap-3 px-4 py-3 text-white">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white transition-all">
              {inDm ? (
                <Image
                  src="/logo-mark.svg"
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7"
                />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 text-brand"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                </svg>
              )}
            </div>
            <div className="leading-tight">
              <div className="font-semibold">
                {inDm ? t("botName") : t("groupName")}
              </div>
              <div className="text-xs opacity-80">
                {inDm ? t("botMeta") : t("groupMeta")}
              </div>
            </div>
          </div>

          {/* Chat transcript — a scrollable, bottom-anchored Telegram-style feed.
              Fixed height keeps layout stable and lets new messages scroll in. */}
          <div
            ref={scrollRef}
            className="tg-chat h-[620px] overflow-y-auto scroll-smooth p-4"
          >
            <div className="flex min-h-full flex-col justify-end gap-3">
              {/* 1. The admin runs the command (deleted by the bot once handled) */}
              {!inDm && showCommand && (
                <div className={`flex justify-end ${commandExiting ? "msg-out" : "msg-in"}`}>
                  <div className="tg-out max-w-[85%] rounded-2xl rounded-br-md px-3 py-1.5 shadow-sm">
                    <span className="font-mono text-sm">{t("command")}</span>
                    <span className="ms-2 inline-flex items-center gap-0.5 align-bottom">
                      <span className="tg-time text-[10px]">10:24</span>
                      <span className="tg-tick text-[11px] leading-none">✓✓</span>
                    </span>
                  </div>
                </div>
              )}

              {/* 2. The widget appears: a list message + the control message */}
              {!inDm && showWidget && (
                <>
                {/* List message with the names */}
                <div className="flex justify-start msg-in">
                  <div className="tg-in w-full max-w-[92%] rounded-2xl rounded-bl-md px-3 py-2 text-sm shadow-sm">
                    <div className="font-semibold">{t("list.header")}</div>
                    <ul className="mt-2 space-y-1">
                      {listItems.map((item) => (
                        <li
                          key={item.name}
                          className="flex items-center gap-2"
                        >
                          <span>{EMOJI[item.status ?? "pending"]}</span>
                          <span className={item.status ? "" : "opacity-60"}>
                            {item.name}
                          </span>
                          {item.guest && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-brand-2/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-2">
                              ⏳ {t("guestTag")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1 text-end text-[10px] tg-time">10:24</div>
                  </div>
                </div>

                {/* Control message: summary counts + inline keyboard */}
                <div className="flex justify-start msg-in">
                  <div className="tg-in w-full max-w-[92%] rounded-2xl rounded-bl-md shadow-sm">
                    <div className="px-3 pt-2 text-sm leading-relaxed">
                      <div className="font-semibold">{w.header}</div>
                      <div className="mt-2 space-y-0.5 text-[13px] opacity-80">
                        <div>
                          {w.total}: {listItems.length}
                        </div>
                        <div>
                          {w.statuses.present}: {counts.present}
                        </div>
                        <div>
                          {w.statuses.listening}: {counts.listening}
                        </div>
                        <div>
                          {w.statuses.excused}: {counts.excused}
                        </div>
                        <div>
                          {w.notRegistered}: {pending}
                        </div>
                        <div>{w.listCount}</div>
                      </div>
                      <p className="mt-3 text-[13px] italic opacity-70">
                        {w.prompt}
                      </p>
                      <div className="mt-1 text-end text-[10px] tg-time">10:24</div>
                    </div>

                    {/* Inline keyboard (Telegram-style, attached below the text) */}
                    <div className="grid gap-[3px] p-[3px]">
                      <div className="grid grid-cols-3 gap-[3px]">
                        {STATUS_ORDER.map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => onTap(status)}
                            disabled={done}
                            aria-label={w.statuses[status]}
                            className={`${tgBtn} ${
                              active === status ? "tg-btn-active" : ""
                            } ${done ? "cursor-not-allowed opacity-50" : ""}`}
                          >
                            {w.statuses[status]}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-[3px]">
                        <span className={adminBtn}>{w.admin.refresh}</span>
                        <span className={adminBtn}>{w.admin.edit}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-[3px]">
                        <span className={adminBtn}>{w.admin.freeze}</span>
                        <span className={adminBtn}>{w.admin.stop}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* 3. The bot auto-pings the group with a data-free nudge. It is
                removed once the pending walk-in is handled (queue empty),
                mirroring the real bot deleting the group ping. */}
            {!inDm && showNudge && !guestApproved && (
              <div className="flex justify-start msg-in">
                <div className="tg-in w-full max-w-[92%] rounded-2xl rounded-bl-md shadow-sm">
                  <div className="px-3 pt-2">
                    <div className="text-sm font-semibold">{nudge.text}</div>
                    <p className="mt-1 text-[13px] italic opacity-70">
                      {nudge.hint}
                    </p>
                    <div className="mt-1 text-end text-[10px] tg-time">10:25</div>
                  </div>
                  <div className="p-[3px]">
                    <button
                      type="button"
                      onClick={onOpenPanel}
                      className={`${tgBtn} w-full ${nudgeActive ? "tg-btn-active" : ""}`}
                    >
                      {nudge.button}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Walk-in approval — the pending-registrations panel (private) */}
            {showApproval && (
              <div className="flex flex-col items-start gap-1 msg-in">
                <div className="tg-in w-full max-w-[92%] rounded-2xl rounded-bl-md shadow-sm">
                  <div className="px-3 pt-2 text-sm">
                    <div className="font-semibold">{approval.header}</div>
                    <div className="text-[13px] opacity-70">
                      {approval.page}
                    </div>
                    <div className="mt-2">1. {guestName}</div>
                    <p className="mt-2 text-[13px] italic opacity-70">
                      {approval.note}
                    </p>
                    <div className="mt-1 text-end text-[10px] tg-time">10:25</div>
                  </div>
                  <div className="grid gap-[3px] p-[3px]">
                    <div className="grid grid-cols-2 gap-[3px]">
                      <button
                        type="button"
                        onClick={onApprove}
                        className={`${tgBtn} ${approveActive ? "tg-btn-active" : ""}`}
                      >
                        ➕ {guestName}
                      </button>
                      <span className={adminBtn}>{approval.addTeacher}</span>
                    </div>
                    <span className={`${adminBtn} w-full`}>
                      {approval.dismiss}
                    </span>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={play}
            className="rounded-full border border-border bg-card px-5 py-2 text-sm font-semibold transition hover:border-brand"
          >
            ↻ {t("restart")}
          </button>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crown, Sparkles, Volume2, VolumeX } from "lucide-react";

const WINNER_REVEAL_DELAY_MS = 450;

export type Winner = {
  name: string;
  number: number;
  job: string;
};

function playVictoryTone() {
  try {
    const AudioContextType = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextType) return;
    const context = new AudioContextType();
    const now = context.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.16, now + index * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.28);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.12);
      oscillator.stop(now + index * 0.12 + 0.3);
    });
  } catch {}
}

export function WinnerCelebration({
  winner,
  job,
  candidateNames,
  soundEnabled,
  onSoundEnabledChange,
  canDrawAgain,
  onDrawAgain,
  onClose,
}: {
  winner: Winner | null;
  job: string;
  candidateNames: string[];
  soundEnabled: boolean;
  onSoundEnabledChange: (enabled: boolean) => void;
  canDrawAgain: boolean;
  onDrawAgain: () => void;
  onClose: () => void;
}) {
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [revealed, setRevealed] = useState(false);
  const [skipRequested, setSkipRequested] = useState(false);
  const [shuffleIndex, setShuffleIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLButtonElement>(null);
  const closeActionRef = useRef(onClose);
  const names = useMemo(
    () => candidateNames.length ? candidateNames : [winner?.name ?? "추첨 준비 중"],
    [candidateNames, winner?.name],
  );

  useEffect(() => {
    closeActionRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = window.requestAnimationFrame(() => firstControlRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeActionRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (revealed) return;
    const shuffle = window.setInterval(() => setShuffleIndex((value) => value + 1), 90);
    return () => {
      window.clearInterval(shuffle);
    };
  }, [revealed]);

  useEffect(() => {
    if (!winner || revealed) return;
    const reveal = window.setTimeout(
      () => setRevealed(true),
      reduceMotion || skipRequested ? 0 : WINNER_REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(reveal);
  }, [reduceMotion, revealed, skipRequested, winner]);

  useEffect(() => {
    if (revealed && soundEnabled) playVictoryTone();
  }, [revealed, soundEnabled]);

  return (
    <div
      ref={dialogRef}
      className={`winner-overlay ${revealed ? "revealed" : "shuffling"}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="winner-dialog-title"
      aria-describedby="winner-dialog-status"
    >
      <h2 id="winner-dialog-title" className="visually-hidden">직업 추첨 결과</h2>
      <div className="winner-rays" aria-hidden="true" />
      {Array.from({ length: 30 }, (_, index) => (
        <i
          className="winner-confetti"
          key={index}
          aria-hidden="true"
          style={{ "--piece": index } as React.CSSProperties}
        />
      ))}
      <div className="winner-tools">
        <button ref={firstControlRef} onClick={() => onSoundEnabledChange(!soundEnabled)}>
          {soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          소리 {soundEnabled ? "켜짐" : "꺼짐"}
        </button>
        {!revealed && (
          <button
            onClick={() => {
              setSkipRequested(true);
              if (winner) setRevealed(true);
            }}
          >
            결과 바로 보기
          </button>
        )}
      </div>
      <div id="winner-dialog-status" className="winner-stage" aria-live="polite">
        {!revealed || !winner ? (
          <>
            <Sparkles aria-hidden="true" />
            <p>{job} 추첨 중</p>
            <strong>{names[shuffleIndex % names.length]}</strong>
            <span>{winner ? "당첨자를 바로 발표할게요" : "안전하게 저장하면서 뽑고 있어요"}</span>
          </>
        ) : (
          <>
            <Crown className="winner-crown" aria-hidden="true" />
            <p>{winner.job}</p>
            <strong>{winner.number}번 {winner.name}</strong>
            <h2>{winner.name} 당첨!</h2>
            <div className="button-row">
              {canDrawAgain && (
                <button className="button button-primary button-large" autoFocus onClick={onDrawAgain}>
                  같은 직업에서 다음 친구 뽑기
                </button>
              )}
              <button className={canDrawAgain ? "button button-light" : "button button-primary button-large"} autoFocus={!canDrawAgain} onClick={onClose}>
                {canDrawAgain ? "추첨 그만하기" : "결과 확인"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

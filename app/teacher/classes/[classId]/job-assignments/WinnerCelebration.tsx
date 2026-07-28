"use client";

import { useEffect, useMemo, useState } from "react";
import { Crown, Sparkles, Volume2, VolumeX } from "lucide-react";

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
  candidateNames,
  onClose,
}: {
  winner: Winner;
  candidateNames: string[];
  onClose: () => void;
}) {
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [revealed, setRevealed] = useState(reduceMotion);
  const [sound, setSound] = useState(false);
  const [shuffleIndex, setShuffleIndex] = useState(0);
  const names = useMemo(
    () => candidateNames.length ? candidateNames : [winner.name],
    [candidateNames, winner.name],
  );

  useEffect(() => {
    if (revealed) return;
    const shuffle = window.setInterval(() => setShuffleIndex((value) => value + 1), 90);
    const reveal = window.setTimeout(() => setRevealed(true), 3800);
    return () => {
      window.clearInterval(shuffle);
      window.clearTimeout(reveal);
    };
  }, [revealed]);

  useEffect(() => {
    if (revealed && sound) playVictoryTone();
  }, [revealed, sound]);

  return (
    <div className={`winner-overlay ${revealed ? "revealed" : "shuffling"}`} role="dialog" aria-modal="true" aria-label="당첨자 발표">
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
        <button onClick={() => setSound((value) => !value)}>
          {sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          소리 {sound ? "켜짐" : "꺼짐"}
        </button>
        {!revealed && <button onClick={() => setRevealed(true)}>연출 건너뛰기</button>}
      </div>
      <div className="winner-stage" aria-live="polite">
        {!revealed ? (
          <>
            <Sparkles aria-hidden="true" />
            <p>{winner.job} 추첨 중</p>
            <strong>{names[shuffleIndex % names.length]}</strong>
            <span>두근두근… 서버에 저장된 당첨자를 발표합니다</span>
          </>
        ) : (
          <>
            <Crown className="winner-crown" aria-hidden="true" />
            <p>{winner.job}</p>
            <strong>{winner.number}번 {winner.name}</strong>
            <h2>{winner.name} 당첨!</h2>
            <button className="button button-primary button-large" autoFocus onClick={onClose}>확인하고 다음 추첨</button>
          </>
        )}
      </div>
    </div>
  );
}

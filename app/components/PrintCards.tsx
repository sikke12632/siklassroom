"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

export type RegistrationCard = {
  id: string;
  student_number: number;
  official_name: string;
  activation_url: string;
  purpose?: string;
};

export function PrintCards({ cards, classLabel, onClose }: { cards: RegistrationCard[]; classLabel: string; onClose: () => void }) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [generationError, setGenerationError] = useState("");
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeActionRef = useRef(onClose);
  const printReady = cards.length > 0 && cards.every((card) => Boolean(images[card.id]));

  useEffect(() => {
    closeActionRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.classList.add("qr-printing");
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeActionRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        overlayRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
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
      document.body.classList.remove("qr-printing");
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(cards.map(async (card) => [card.id, await QRCode.toDataURL(card.activation_url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#183153", light: "#ffffff" },
    })] as const)).then((entries) => {
      if (!cancelled) setImages(Object.fromEntries(entries));
    }).catch(() => {
      if (!cancelled) setGenerationError("QR 이미지를 만들지 못했어요. 다시 만들기를 눌러 주세요.");
    });
    return () => { cancelled = true; };
  }, [cards, generationAttempt]);

  function retryGeneration() {
    setImages({});
    setGenerationError("");
    setGenerationAttempt((value) => value + 1);
  }

  return (
    <div ref={overlayRef} className="print-overlay" role="dialog" aria-modal="true" aria-label="학생 QR 카드 인쇄 미리보기">
      <div className="print-toolbar no-print">
        <div><strong>QR 카드 인쇄 미리보기</strong><span role={generationError ? "alert" : undefined}>{generationError || `${cards.length}장 · 같은 카드는 계속 로그인에 쓰고, 분실했을 때만 새로 발급하세요.`}</span></div>
        <div className="button-row">
          {generationError && <button className="button button-light" type="button" onClick={retryGeneration}>다시 만들기</button>}
          <button ref={closeButtonRef} className="button button-light" type="button" onClick={onClose}>닫기</button>
          <button className="button button-primary" type="button" disabled={!printReady} onClick={() => window.print()}>
            {printReady ? "A4 인쇄" : generationError ? "QR 준비 실패" : "QR 준비 중…"}
          </button>
        </div>
      </div>
      <main className="print-sheet">
        {cards.map((card) => (
          <article className="qr-card" key={card.id}>
            <div className="qr-card-heading"><span>직업교실</span><small>학생 개인 QR</small></div>
            <div className="qr-student"><b>{card.student_number}번</b><strong>{card.official_name}</strong></div>
            <div className="qr-code-wrap">
              {images[card.id] ? <Image src={images[card.id]} alt={`${card.student_number}번 ${card.official_name} 학생 로그인 QR`} width={320} height={320} unoptimized /> : <div className="qr-loading">QR 만드는 중</div>}
            </div>
            <p>{classLabel}</p>
            <ol>
              <li>휴대전화로 QR을 찍어요.</li>
              <li>{card.purpose === "reset" ? "새 비밀번호를 만든 뒤 로그인해요." : "처음 등록하거나 평소 비밀번호로 로그인해요."}</li>
              <li>비밀번호를 잊으면 선생님께 10분 재설정 허용을 요청해요.</li>
            </ol>
            <div className="one-time-key">학급 운영 중 다시 쓸 수 있는 개인 카드</div>
          </article>
        ))}
      </main>
    </div>
  );
}

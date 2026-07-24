"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

export type RegistrationCard = {
  id: string;
  student_number: number;
  official_name: string;
  activation_url: string;
  purpose?: string;
};

export function PrintCards({ cards, classLabel, onClose }: { cards: RegistrationCard[]; classLabel: string; onClose: () => void }) {
  const [images, setImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(cards.map(async (card) => [card.id, await QRCode.toDataURL(card.activation_url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#183153", light: "#ffffff" },
    })] as const)).then((entries) => {
      if (!cancelled) setImages(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [cards]);

  return (
    <div className="print-overlay" role="dialog" aria-modal="true" aria-label="학생 QR 카드 인쇄 미리보기">
      <div className="print-toolbar no-print">
        <div><strong>QR 카드 인쇄 미리보기</strong><span>{cards.length}장 · 발급할 때마다 이전 QR은 자동으로 무효가 됩니다.</span></div>
        <div className="button-row">
          <button className="button button-light" onClick={onClose}>닫기</button>
          <button className="button button-primary" onClick={() => window.print()}>A4 인쇄</button>
        </div>
      </div>
      <main className="print-sheet">
        {cards.map((card) => (
          <article className="qr-card" key={card.id}>
            <div className="qr-card-heading"><span>직업교실</span><small>{card.purpose === "reset" ? "비밀번호 다시 설정" : "처음 등록"}</small></div>
            <div className="qr-student"><b>{card.student_number}번</b><strong>{card.official_name}</strong></div>
            <div className="qr-code-wrap">
              {images[card.id] ? <Image src={images[card.id]} alt={`${card.student_number}번 ${card.official_name} 등록 QR`} width={320} height={320} unoptimized /> : <div className="qr-loading">QR 만드는 중</div>}
            </div>
            <p>{classLabel}</p>
            <ol><li>휴대전화로 QR을 찍어요.</li><li>내 이름을 확인하고 숫자 비밀번호를 만들어요.</li></ol>
            <div className="one-time-key">한 번만 쓸 수 있는 개인 카드</div>
          </article>
        ))}
      </main>
    </div>
  );
}

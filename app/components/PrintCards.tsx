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
    document.body.classList.add("qr-printing");
    return () => document.body.classList.remove("qr-printing");
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
    });
    return () => { cancelled = true; };
  }, [cards]);

  return (
    <div className="print-overlay" role="dialog" aria-modal="true" aria-label="학생 QR 카드 인쇄 미리보기">
      <div className="print-toolbar no-print">
        <div><strong>QR 카드 인쇄 미리보기</strong><span>{cards.length}장 · 같은 카드는 계속 로그인에 쓰고, 분실했을 때만 새로 발급하세요.</span></div>
        <div className="button-row">
          <button className="button button-light" onClick={onClose}>닫기</button>
          <button className="button button-primary" onClick={() => window.print()}>A4 인쇄</button>
        </div>
      </div>
      <main className="print-sheet">
        {cards.map((card) => (
          <article className="qr-card" key={card.id}>
            <div className="qr-card-heading"><span>직업교실</span><small>학생 개인 QR</small></div>
            <div className="qr-student"><b>{card.student_number}번</b><strong>{card.official_name}</strong></div>
            <div className="qr-code-wrap">
              {images[card.id] ? <Image src={images[card.id]} alt={`${card.student_number}번 ${card.official_name} 등록 QR`} width={320} height={320} unoptimized /> : <div className="qr-loading">QR 만드는 중</div>}
            </div>
            <p>{classLabel}</p>
            <ol><li>휴대전화로 QR을 찍어요.</li><li>처음 등록하거나 평소 비밀번호로 로그인해요.</li><li>비밀번호를 잊으면 선생님께 10분 재설정 허용을 요청해요.</li></ol>
            <div className="one-time-key">학급 운영 중 다시 쓸 수 있는 개인 카드</div>
          </article>
        ))}
      </main>
    </div>
  );
}

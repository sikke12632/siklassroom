"use client";

import {
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  PackageCheck,
  PackagePlus,
  Pencil,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  MartApiError,
  adjustMartInventory,
  martActionKey,
  martErrorMessage,
  saveMartProduct,
  type MartDashboard,
  type MartProduct,
} from "./mart-api";
import styles from "./MartPortal.module.css";

type Notice = { tone: "success" | "warning" | "danger"; message: string };

function amountText(amount: number, unit: string) {
  return `${amount.toLocaleString("ko-KR")} ${unit}`;
}

function noticeIcon(tone: Notice["tone"]) {
  return tone === "success"
    ? <CheckCircle2 aria-hidden="true" />
    : <CircleAlert aria-hidden="true" />;
}

function useAttemptKey(prefix: string) {
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  return {
    forSignature(signature: string) {
      if (!attempt.current || attempt.current.signature !== signature) {
        attempt.current = { signature, key: martActionKey(prefix) };
      }
      return attempt.current.key;
    },
    reset() {
      attempt.current = null;
    },
  };
}

export function MartProductsPanel({
  dashboard,
  onChanged,
}: {
  dashboard: MartDashboard;
  onChanged: () => Promise<void>;
}) {
  const { context, products, inventory } = dashboard;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("2");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const actionKey = useAttemptKey("product");
  const inventoryByProduct = useMemo(
    () => new Map(inventory.map((row) => [row.productId, row])),
    [inventory],
  );
  const editingProduct = editingId
    ? products.find((product) => product.id === editingId) ?? null
    : null;

  const reset = () => {
    setEditingId(null);
    setName("");
    setCategory("");
    setDescription("");
    setPrice("");
    setLowStockThreshold("2");
    setIsActive(true);
    actionKey.reset();
  };

  const edit = (product: MartProduct) => {
    setEditingId(product.id);
    setName(product.name);
    setCategory(product.category);
    setDescription(product.description);
    setPrice(String(product.price));
    setLowStockThreshold(String(product.lowStockThreshold));
    setIsActive(product.isActive);
    setNotice(null);
    actionKey.reset();
    document.getElementById("mart-product-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedPrice = Number(price);
    const parsedLowStockThreshold = Number(lowStockThreshold);
    if (!name.trim()) {
      setNotice({ tone: "warning", message: "상품 이름을 입력해 주세요." });
      return;
    }
    if (!category.trim()) {
      setNotice({ tone: "warning", message: "상품 분류를 입력해 주세요." });
      return;
    }
    if (!Number.isSafeInteger(parsedPrice) || parsedPrice <= 0) {
      setNotice({ tone: "warning", message: "가격은 1 이상의 정수로 입력해 주세요." });
      return;
    }
    if (!Number.isSafeInteger(parsedLowStockThreshold) || parsedLowStockThreshold < 0) {
      setNotice({ tone: "warning", message: "낮은 재고 알림 기준은 0 이상의 정수로 입력해 주세요." });
      return;
    }
    const signature = JSON.stringify([
      editingId,
      name.trim(),
      category.trim(),
      description.trim(),
      parsedPrice,
      parsedLowStockThreshold,
      isActive,
      editingProduct?.revision,
    ]);
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveMartProduct({
        classId: context.classroom.id,
        ...(editingId ? { productId: editingId } : {}),
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        price: parsedPrice,
        lowStockThreshold: parsedLowStockThreshold,
        isActive,
        ...(editingProduct ? { expectedRevision: editingProduct.revision } : {}),
        idempotencyKey: actionKey.forSignature(signature),
      });
      const message = result.deduplicated
        ? "같은 상품 저장 요청이 이미 반영되어 한 번만 처리했습니다."
        : editingId ? "상품 내용을 수정했습니다." : "새 상품을 만들었습니다. 이제 재고를 입고해 주세요.";
      reset();
      setNotice({ tone: result.deduplicated ? "warning" : "success", message });
      await onChanged();
    } catch (reason) {
      const code = reason instanceof MartApiError ? reason.code : "";
      setNotice({
        tone: code.includes("STALE") || code.includes("DUPLICATE") ? "warning" : "danger",
        message: martErrorMessage(reason),
      });
      if (code.includes("STALE") || code.includes("DUPLICATE")) await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="mart-product-management-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>상품 준비</p>
          <h2 id="mart-product-management-title">상품과 가격</h2>
          <p>상품 분류와 가격, 낮은 재고 알림 기준을 상품마다 정할 수 있어요.</p>
        </div>
        <span className={styles.stepBadge}>{products.length.toLocaleString("ko-KR")}개 상품</span>
      </div>

      {notice && (
        <div className={`${styles.notice} ${styles[notice.tone]}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {noticeIcon(notice.tone)}<p>{notice.message}</p>
        </div>
      )}

      <div className={styles.managementLayout}>
        <form id="mart-product-form" className={styles.card} onSubmit={submit}>
          <div className={styles.formHeading}>
            <div><Plus aria-hidden="true" /><div><h3>{editingId ? "상품 수정" : "새 상품"}</h3><p>{editingId ? "저장 전 최신 revision을 다시 확인합니다." : "처음에는 판매 가능 상태로 만들어요."}</p></div></div>
            {editingId && <button className={styles.textButton} type="button" onClick={reset} disabled={busy}>새 상품으로 전환</button>}
          </div>
          <div className={styles.formGrid}>
            <label>상품 이름<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} disabled={busy} required /></label>
            <label>상품 분류<input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={40} placeholder="예: 문구, 간식" disabled={busy} required /></label>
            <label>상품 설명<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="예: 부드럽게 잘 써지는 연필" disabled={busy} /></label>
            <label>현물화폐 가격<input type="number" inputMode="numeric" min={1} step={1} value={price} onChange={(event) => setPrice(event.target.value)} disabled={busy} required /></label>
            <label>낮은 재고 알림 기준<input type="number" inputMode="numeric" min={0} step={1} value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} disabled={busy} required /></label>
          </div>
          <label className={styles.checkLabel}>
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} disabled={busy} />
            판매 목록에 보이기
          </label>
          <button className={`${styles.button} ${styles.primary} ${styles.fullButton}`} type="submit" disabled={busy || context.classroom.status !== "active"}>
            {busy ? "저장 중" : editingId ? "상품 수정 저장" : "상품 만들기"}
          </button>
        </form>

        <section className={styles.card} aria-labelledby="mart-product-list-title">
          <div className={styles.formHeading}>
            <div><PackageCheck aria-hidden="true" /><div><h3 id="mart-product-list-title">등록 상품</h3><p>재고와 판매 상태를 함께 확인해요.</p></div></div>
          </div>
          {products.length === 0 ? (
            <div className={styles.emptyState}><PackagePlus aria-hidden="true" /><b>아직 상품이 없습니다.</b><p>왼쪽 양식에서 첫 상품을 만들어 주세요.</p></div>
          ) : (
            <ul className={styles.managementList}>
              {products.map((product) => {
                const stock = inventoryByProduct.get(product.id)?.onHand ?? 0;
                const low = stock <= product.lowStockThreshold;
                return (
                  <li key={product.id}>
                    <div>
                      <span className={styles.listKicker}>{product.isActive ? "판매 중" : "판매 숨김"} · {product.category}{product.description ? ` · ${product.description}` : ""}</span>
                      <b>{product.name}</b>
                      <span>{amountText(product.price, context.currency.unit)} · <em className={low ? styles.lowText : undefined}>재고 {stock}개</em> · 알림 {product.lowStockThreshold}개 이하</span>
                    </div>
                    <button className={styles.iconButton} type="button" onClick={() => edit(product)} disabled={busy} aria-label={`${product.name} 수정`}><Pencil aria-hidden="true" /></button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

export function MartInventoryPanel({
  dashboard,
  onChanged,
}: {
  dashboard: MartDashboard;
  onChanged: () => Promise<void>;
}) {
  const { context, products, inventory } = dashboard;
  const [productId, setProductId] = useState("");
  const [operation, setOperation] = useState<"receive" | "outbound" | "correct">("receive");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const actionKey = useAttemptKey("inventory");
  const inventoryByProduct = useMemo(
    () => new Map(inventory.map((row) => [row.productId, row])),
    [inventory],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const selectedProduct = productById.get(productId) ?? null;
  const selectedInventory = productId ? inventoryByProduct.get(productId) ?? null : null;
  const lowStockProducts = products.filter((product) => (
    product.isActive
    && (inventoryByProduct.get(product.id)?.onHand ?? 0) <= product.lowStockThreshold
  ));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    if (!selectedProduct) {
      setNotice({ tone: "warning", message: "재고를 바꿀 상품을 선택해 주세요." });
      return;
    }
    if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity < (operation === "correct" ? 0 : 1)) {
      setNotice({
        tone: "warning",
        message: operation === "correct"
          ? "실제 재고는 0개 이상이어야 합니다."
          : `${operation === "receive" ? "입고" : "출고"} 수량은 1개 이상이어야 합니다.`,
      });
      return;
    }
    const currentQuantity = selectedInventory?.onHand ?? 0;
    if (operation === "outbound" && parsedQuantity > currentQuantity) {
      setNotice({ tone: "warning", message: `현재 재고 ${currentQuantity}개보다 많이 출고할 수 없습니다.` });
      return;
    }
    if (operation === "correct" && parsedQuantity === currentQuantity) {
      setNotice({ tone: "warning", message: "현재 기록과 다른 실제 재고 수량을 입력해 주세요." });
      return;
    }
    if (operation === "correct" && !context.permissions.canEmergencyCorrect) {
      setNotice({ tone: "danger", message: "재고 비상 정정은 담임교사만 할 수 있습니다." });
      return;
    }
    if (reason.trim().length < 2) {
      setNotice({ tone: "warning", message: "나중에 알아볼 수 있도록 사유를 두 글자 이상 적어 주세요." });
      return;
    }
    const expectedRevision = selectedInventory?.revision ?? 0;
    const signature = JSON.stringify([productId, operation, parsedQuantity, reason.trim(), expectedRevision]);
    setBusy(true);
    setNotice(null);
    try {
      const result = await adjustMartInventory({
        classId: context.classroom.id,
        productId,
        operation,
        quantity: parsedQuantity,
        currentQuantity,
        reason: reason.trim(),
        expectedRevision,
        idempotencyKey: actionKey.forSignature(signature),
      });
      setQuantity("");
      setReason("");
      actionKey.reset();
      setNotice({
        tone: result.deduplicated ? "warning" : "success",
        message: result.deduplicated
          ? "같은 재고 요청이 이미 반영되어 한 번만 처리했습니다."
          : operation === "receive"
          ? "입고 수량과 사유를 기록했습니다."
          : operation === "outbound"
            ? "수동 출고 수량과 사유를 기록했습니다."
            : "실제 재고로 정정하고 사유를 기록했습니다.",
      });
      await onChanged();
    } catch (error) {
      const code = error instanceof MartApiError ? error.code : "";
      setNotice({ tone: code.includes("STALE") ? "warning" : "danger", message: martErrorMessage(error) });
      if (code.includes("STALE") || code === "MART_INSUFFICIENT_STOCK") await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="mart-inventory-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>물건 수량</p><h2 id="mart-inventory-title">입고·수동 출고·재고 정정</h2><p>판매 외 사용이나 폐기는 수동 출고로, 실제 수량 차이는 교사 비상 정정으로 기록해요.</p></div>
        <span className={lowStockProducts.length > 0 ? styles.alertBadge : styles.stepBadge}>낮은 재고 {lowStockProducts.length}개</span>
      </div>

      {lowStockProducts.length > 0 && (
        <div className={`${styles.notice} ${styles.warning}`} role="status">
          <CircleAlert aria-hidden="true" />
          <div><b>곧 채워야 할 상품</b><p>{lowStockProducts.map((product) => `${product.name} ${inventoryByProduct.get(product.id)?.onHand ?? 0}개`).join(" · ")}</p></div>
        </div>
      )}
      {notice && <div className={`${styles.notice} ${styles[notice.tone]}`} role={notice.tone === "danger" ? "alert" : "status"}>{noticeIcon(notice.tone)}<p>{notice.message}</p></div>}

      <div className={styles.managementLayout}>
        <form className={styles.card} onSubmit={submit}>
          <div className={styles.formHeading}><div><PackagePlus aria-hidden="true" /><div><h3>재고 변경 기록</h3><p>오래된 화면이면 서버가 저장을 막고 최신 수량을 알려 줍니다.</p></div></div></div>
          <label>상품<select value={productId} onChange={(event) => { setProductId(event.target.value); setNotice(null); actionKey.reset(); }} disabled={busy} required><option value="">상품 선택</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
          {selectedProduct && <div className={styles.currentStock}><span>현재 기록 재고</span><strong>{(selectedInventory?.onHand ?? 0).toLocaleString("ko-KR")}개</strong></div>}
          <fieldset className={styles.segmentedField} disabled={busy}>
            <legend>변경 종류</legend>
            <label><input type="radio" name="inventory-operation" value="receive" checked={operation === "receive"} onChange={() => { setOperation("receive"); setQuantity(""); actionKey.reset(); }} /> 입고</label>
            <label><input type="radio" name="inventory-operation" value="outbound" checked={operation === "outbound"} onChange={() => { setOperation("outbound"); setQuantity(""); actionKey.reset(); }} /> 수동 출고</label>
            {context.permissions.canEmergencyCorrect && <label><input type="radio" name="inventory-operation" value="correct" checked={operation === "correct"} onChange={() => { setOperation("correct"); setQuantity(""); actionKey.reset(); }} /> 실제 재고로 정정</label>}
          </fieldset>
          <label>{operation === "receive" ? "새로 들어온 수량" : operation === "outbound" ? "내보낼 수량" : "직접 센 실제 수량"}<input type="number" min={operation === "correct" ? 0 : 1} max={operation === "outbound" ? selectedInventory?.onHand : undefined} step={1} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy} required /></label>
          <label>{operation === "receive" ? "입고 사유" : operation === "outbound" ? "수동 출고 사유" : "정정 사유"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={160} rows={3} placeholder={operation === "receive" ? "예: 학급 물품 추가 구매" : operation === "outbound" ? "예: 수업 활동에 사용 또는 파손 폐기" : "예: 마감 후 직접 세어 확인"} disabled={busy} required /></label>
          {context.role === "teacher" && operation === "correct" && (
            <div className={styles.emergencyNotice}><ShieldAlert aria-hidden="true" /><p><b>교사 비상 정정으로 표시됩니다.</b><br />기존 기록은 지우지 않고 누가 왜 고쳤는지 남겨요.</p></div>
          )}
          <button className={`${styles.button} ${styles.primary} ${styles.fullButton}`} type="submit" disabled={busy || !selectedProduct || context.classroom.status !== "active"}>{busy ? "저장 중" : operation === "receive" ? "입고 기록 저장" : operation === "outbound" ? "수동 출고 저장" : "재고 정정 저장"}</button>
        </form>

        <section className={styles.card} aria-labelledby="mart-stock-list-title">
          <div className={styles.formHeading}><div><ClipboardCheck aria-hidden="true" /><div><h3 id="mart-stock-list-title">전체 재고</h3><p>낮은 재고는 문구로도 표시됩니다.</p></div></div></div>
          {products.length === 0 ? <div className={styles.emptyState}><PackagePlus aria-hidden="true" /><b>등록 상품이 없습니다.</b></div> : (
            <ul className={styles.stockList}>
              {products.map((product) => {
                const onHand = inventoryByProduct.get(product.id)?.onHand ?? 0;
                const low = onHand <= product.lowStockThreshold;
                return <li key={product.id}><div><b>{product.name}</b><span>{product.isActive ? "판매 중" : "판매 숨김"} · 알림 기준 {product.lowStockThreshold}개</span></div><strong className={low ? styles.lowText : undefined}>{onHand}개{low ? " · 낮음" : ""}</strong></li>;
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

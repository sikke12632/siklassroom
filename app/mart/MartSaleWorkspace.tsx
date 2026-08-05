"use client";

import {
  CheckCircle2,
  CircleAlert,
  Minus,
  PackageSearch,
  Plus,
  ReceiptText,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  MartApiError,
  buildMartSaleRequest,
  calculateMartCart,
  createMartSale,
  martActionKey,
  martErrorMessage,
  type MartDashboard,
  type MartProduct,
} from "./mart-api";
import styles from "./MartPortal.module.css";

type Notice = { tone: "success" | "warning" | "danger"; message: string };

function amountText(amount: number, unit: string) {
  return `${amount.toLocaleString("ko-KR")} ${unit}`;
}

export function MartSaleWorkspace({
  dashboard,
  onChanged,
}: {
  dashboard: MartDashboard;
  onChanged: () => Promise<void>;
}) {
  const { context, products, inventory } = dashboard;
  const [buyerId, setBuyerId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const saleAttempt = useRef<{ signature: string; key: string } | null>(null);
  const unit = context.currency.unit;

  const inventoryByProduct = useMemo(
    () => new Map(inventory.map((row) => [row.productId, row])),
    [inventory],
  );
  const activeProducts = products.filter((product) => product.isActive);
  const categories = useMemo(
    () => [...new Set(activeProducts.map((product) => product.category))]
      .sort((left, right) => left.localeCompare(right, "ko")),
    [activeProducts],
  );
  const visibleProducts = activeProducts.filter((product) => {
    const needle = query.trim().toLocaleLowerCase("ko-KR");
    const matchesQuery = !needle
      || product.name.toLocaleLowerCase("ko-KR").includes(needle)
      || product.category.toLocaleLowerCase("ko-KR").includes(needle)
      || product.description.toLocaleLowerCase("ko-KR").includes(needle);
    return matchesQuery && (category === "all" || product.category === category);
  });
  const cart = calculateMartCart(products, inventory, quantities);
  const eligibleStudents = context.students.filter((student) => student.status !== "excluded");

  const setQuantity = (product: MartProduct, nextQuantity: number) => {
    const maximum = inventoryByProduct.get(product.id)?.onHand ?? 0;
    const safeQuantity = Math.max(0, Math.min(maximum, nextQuantity));
    setQuantities((current) => {
      if (safeQuantity === 0) {
        const { [product.id]: _removed, ...remaining } = current;
        void _removed;
        return remaining;
      }
      return { ...current, [product.id]: safeQuantity };
    });
    setNotice(null);
  };

  const clearCart = () => {
    setQuantities({});
    saleAttempt.current = null;
    setNotice(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!buyerId) {
      setNotice({ tone: "warning", message: "먼저 구매 학생을 선택해 주세요." });
      return;
    }
    if (cart.lines.length === 0) {
      setNotice({ tone: "warning", message: "장바구니에 상품을 담아 주세요." });
      return;
    }
    if (cart.hasShortage) {
      setNotice({ tone: "warning", message: "재고보다 많이 담긴 상품이 있습니다. 수량을 확인해 주세요." });
      return;
    }

    setSubmitting(true);
    setNotice(null);
    try {
      const signature = JSON.stringify([
        buyerId,
        context.revision,
        cart.lines.map((line) => [
          line.productId,
          line.quantity,
          line.productRevision,
          line.inventoryRevision,
        ]),
      ]);
      if (!saleAttempt.current || saleAttempt.current.signature !== signature) {
        saleAttempt.current = { signature, key: martActionKey("sale") };
      }
      const request = buildMartSaleRequest({
        classId: context.classroom.id,
        buyerStudentId: buyerId,
        idempotencyKey: saleAttempt.current.key,
        expectedContextRevision: context.revision,
        cart,
      });
      const result = await createMartSale(request);
      setQuantities({});
      setBuyerId("");
      saleAttempt.current = null;
      setNotice({
        tone: result.deduplicated ? "warning" : "success",
        message: result.deduplicated
          ? "같은 판매가 이미 저장되어 있어 한 번만 반영했습니다."
          : `${result.sale.receiptNumber || "판매"} 기록을 안전하게 저장했습니다.`,
      });
      await onChanged();
    } catch (reason) {
      const code = reason instanceof MartApiError ? reason.code : "";
      const duplicate = code === "MART_SALE_DUPLICATE" || code === "MART_DUPLICATE";
      if (duplicate) {
        setQuantities({});
        setBuyerId("");
        saleAttempt.current = null;
      }
      setNotice({
        tone: code.includes("DUPLICATE") || code.includes("STALE") ? "warning" : "danger",
        message: martErrorMessage(reason),
      });
      if (
        code === "MART_INVENTORY_SHORT"
        || code === "MART_INSUFFICIENT_STOCK"
        || code.endsWith("_STALE")
        || duplicate
      ) {
        await onChanged();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="mart-sale-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>지금 할 일</p>
          <h2 id="mart-sale-title">현물화폐 판매 기록</h2>
          <p>학생과 상품을 고르는 동안에는 서버에 저장하지 않아요. 마지막 확정 때 한 번만 전송합니다.</p>
        </div>
        <span className={styles.stepBadge}>학생 선택 → 상품 담기 → 확정</span>
      </div>

      {notice && (
        <div
          className={`${styles.notice} ${styles[notice.tone]}`}
          role={notice.tone === "danger" ? "alert" : "status"}
          aria-live="polite"
        >
          {notice.tone === "success"
            ? <CheckCircle2 aria-hidden="true" />
            : <CircleAlert aria-hidden="true" />}
          <p>{notice.message}</p>
        </div>
      )}

      <form className={styles.saleLayout} onSubmit={submit}>
        <div className={styles.saleMain}>
          <section className={styles.card} aria-labelledby="mart-buyer-title">
            <div className={styles.compactHeading}>
              <span className={styles.numberBadge}>1</span>
              <div><h3 id="mart-buyer-title">구매 학생</h3><p>현물화폐를 낸 학생을 고르세요.</p></div>
            </div>
            <label>
              학생 선택
              <select value={buyerId} onChange={(event) => setBuyerId(event.target.value)}>
                <option value="">학생을 선택해 주세요</option>
                {eligibleStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.number}번 {student.name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className={styles.card} aria-labelledby="mart-products-title">
            <div className={styles.compactHeading}>
              <span className={styles.numberBadge}>2</span>
              <div><h3 id="mart-products-title">상품 담기</h3><p>버튼을 누르면 장바구니 금액이 바로 계산됩니다.</p></div>
            </div>
            <div className={styles.filters}>
              <label>
                <span className={styles.visuallyHidden}>상품 검색</span>
                <span className={styles.inputWithIcon}><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품 이름 검색" /></span>
              </label>
              <label>
                <span className={styles.visuallyHidden}>상품 분류</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="all">모든 분류</option>
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>

            {visibleProducts.length === 0 ? (
              <div className={styles.emptyState}>
                <PackageSearch aria-hidden="true" />
                <b>판매할 상품이 없습니다.</b>
                <p>검색 조건을 바꾸거나 상품·재고 메뉴에서 준비해 주세요.</p>
              </div>
            ) : (
              <div className={styles.productGrid}>
                {visibleProducts.map((product) => {
                  const stock = inventoryByProduct.get(product.id)?.onHand ?? 0;
                  const quantity = quantities[product.id] ?? 0;
                  const low = stock <= product.lowStockThreshold;
                  return (
                    <article className={styles.productCard} key={product.id}>
                      <div className={styles.productTopline}>
                        <span>{product.category}{product.description ? ` · ${product.description}` : ""}</span>
                        <span className={low ? styles.lowBadge : styles.stockBadge}>
                          {stock === 0 ? "품절" : low ? `낮은 재고 ${stock}개` : `재고 ${stock}개`}
                        </span>
                      </div>
                      <h4>{product.name}</h4>
                      <strong>{amountText(product.price, unit)}</strong>
                      <div className={styles.quantityControl} aria-label={`${product.name} 수량`}>
                        <button type="button" onClick={() => setQuantity(product, quantity - 1)} disabled={quantity === 0 || submitting} aria-label={`${product.name} 한 개 빼기`}><Minus aria-hidden="true" /></button>
                        <output aria-live="polite">{quantity}</output>
                        <button type="button" onClick={() => setQuantity(product, quantity + 1)} disabled={stock === 0 || quantity >= stock || submitting} aria-label={`${product.name} 한 개 담기`}><Plus aria-hidden="true" /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className={`${styles.card} ${styles.cart}`} aria-labelledby="mart-cart-title">
          <div className={styles.cartHeading}>
            <div><ShoppingCart aria-hidden="true" /><h3 id="mart-cart-title">장바구니</h3></div>
            <button type="button" className={styles.textButton} onClick={clearCart} disabled={cart.lines.length === 0 || submitting}><Trash2 aria-hidden="true" /> 비우기</button>
          </div>
          {cart.lines.length === 0 ? (
            <p className={styles.muted}>상품을 담으면 여기에 보여요.</p>
          ) : (
            <ul className={styles.cartLines}>
              {cart.lines.map((line) => (
                <li key={line.productId}>
                  <div><b>{line.name}</b><span>{line.quantity}개 × {amountText(line.unitPrice, unit)}</span></div>
                  <strong>{amountText(line.lineTotal, unit)}</strong>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.cartTotal}>
            <span>총 {cart.itemCount.toLocaleString("ko-KR")}개</span>
            <strong>{amountText(cart.totalAmount, unit)}</strong>
          </div>
          <div className={styles.physicalCashReminder}>
            <ReceiptText aria-hidden="true" />
            <p><b>받은 현물화폐를 확인했나요?</b><br />이 확정은 판매 기록과 재고만 반영합니다.</p>
          </div>
          <button
            className={`${styles.button} ${styles.primary} ${styles.fullButton}`}
            type="submit"
            disabled={submitting || !buyerId || cart.lines.length === 0 || cart.hasShortage || context.classroom.status !== "active"}
          >
            {submitting ? <><span className={styles.buttonSpinner} aria-hidden="true" /> 저장 중</> : "판매 확정 · 한 번만 저장"}
          </button>
        </aside>
      </form>
    </section>
  );
}

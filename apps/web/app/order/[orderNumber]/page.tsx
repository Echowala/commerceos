"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export default function OrderConfirmationPage() {
  const params = useParams<{ orderNumber: string }>();
  const orderNumber = decodeURIComponent(params.orderNumber ?? "");

  return (
    <main className="confirmation-page">
      <div className="confirmation-card">
        <span className="eyebrow">ORDER CONFIRMED</span>
        <h1>Thank you for your order.</h1>
        <p className="muted">Your order <strong>#{orderNumber}</strong> has been received.</p>
        <div className="cod-note">
          <strong>Cash on Delivery</strong>
          <span>Payment is due when your order is delivered.</span>
        </div>
        <Link className="checkout-button confirmation-link" href="/store">Continue shopping</Link>
      </div>
    </main>
  );
}

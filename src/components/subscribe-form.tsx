"use client";

import { useState } from "react";

export function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/express/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="subscribe-form">
        <p className="success-message">
          You&rsquo;re subscribed — we&rsquo;ll email you when a resort crosses the powder threshold.
        </p>
      </div>
    );
  }

  return (
    <form className="subscribe-form" onSubmit={onSubmit}>
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Subscribing..." : "Get powder alerts"}
      </button>
      {status === "error" && <p style={{ color: "#f87171", width: "100%", margin: 0, fontSize: 13 }}>Something went wrong — try again.</p>}
    </form>
  );
}

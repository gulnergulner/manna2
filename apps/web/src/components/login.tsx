"use client";
import { useState } from "react";
export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-card">
        <span className="eyebrow">PRIVATE AUDIO LIBRARY</span>
        <div className="sun">☀</div>
        <h1>만나</h1>
        <p className="subtitle">새벽의 말씀을, 나의 하루에.</p>
        <p>
          새가나안교회 새벽예배 음성 보관함입니다.
          <br />
          공유받은 비밀번호로 들어오세요.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const password = new FormData(e.currentTarget).get("password");
              const r = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
              });
              if (r.ok) location.reload();
              else setError((await r.json()).error);
            } catch {
              setError("연결을 확인해 주세요.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="password">접속 비밀번호</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
          <button disabled={busy}>
            {busy ? "확인 중…" : "보관함 들어가기 →"}
          </button>
          <p role="alert" className="error">
            {error}
          </p>
        </form>
        <small>전체 예배 음성을 제공합니다.</small>
      </div>
    </main>
  );
}
